import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { z } from 'zod'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole, requireAdminRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const documentRouter = Router()

// Files now live in Cloudflare R2 (S3-compatible object storage) instead of
// local disk — local disk doesn't survive a server redeploy/restart and
// isn't encrypted at rest, both real problems for KYC documents (government
// IDs, professional licenses). R2 has zero egress fees, which matters here
// since admins re-open these files repeatedly during review.
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME

// Memory storage, not disk — the file buffer goes straight to R2 and is
// never written to this server's local filesystem at all.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Only PDF, JPG, or PNG files are allowed.'))
  },
})

const uploadSchema = z.object({
  type: z.enum(['LICENSE', 'GOVERNMENT_ID', 'DEGREE_CERTIFICATE', 'OTHER']),
})

// Professional uploads a KYC document. Starts PENDING — only an admin
// review can move it to APPROVED/REJECTED.
documentRouter.post(
  '/',
  requireAuth,
  requireRole('professional'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' })

    const parsed = uploadSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    // Generated object key, never the client-supplied filename — avoids
    // path/key collisions and injection via a crafted filename.
    const ext = req.file.originalname.includes('.')
      ? req.file.originalname.slice(req.file.originalname.lastIndexOf('.'))
      : ''
    const objectKey = `${crypto.randomUUID()}${ext}`

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    )

    const doc = await prisma.professionalDocument.create({
      data: {
        professionalId: req.auth.id,
        type: parsed.data.type,
        fileName: req.file.originalname,
        filePath: objectKey, // repurposed: now an R2 object key, not a local path
        status: 'PENDING',
      },
    })

    await audit({
      actorType: 'professional',
      actorId: req.auth.id,
      action: 'document.upload',
      resourceType: 'professional_document',
      resourceId: doc.id,
    })

    res.status(201).json(doc)
  }
)

// Professional's own documents, for their own KYC status view.
documentRouter.get('/mine', requireAuth, requireRole('professional'), async (req, res) => {
  const docs = await prisma.professionalDocument.findMany({
    where: { professionalId: req.auth.id },
    orderBy: { uploadedAt: 'desc' },
  })
  res.json(docs)
})

// Admin: all documents across all professionals. Reviewing credentials is a
// platform-level trust decision, same tier as verify/unverify — PLATFORM_ADMIN
// only, not CLINICAL_SAFETY_REVIEWER or SUPPORT.
documentRouter.get('/', requireAuth, requireAdminRole('PLATFORM_ADMIN'), async (req, res) => {
  const docs = await prisma.professionalDocument.findMany({
    include: { professional: true },
    orderBy: { uploadedAt: 'desc' },
  })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'admin.documents.list',
    resourceType: 'professional_document',
  })

  res.json(
    docs.map((d) => ({
      id: d.id,
      professionalId: d.professionalId,
      professionalFullName: d.professional.fullName,
      professionalEmail: d.professional.email,
      type: d.type,
      fileName: d.fileName,
      status: d.status,
      reviewNotes: d.reviewNotes,
      uploadedAt: d.uploadedAt,
      reviewedAt: d.reviewedAt,
    }))
  )
})

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNotes: z.string().optional(),
})

documentRouter.patch(
  '/:id/review',
  requireAuth,
  requireAdminRole('PLATFORM_ADMIN'),
  async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const doc = await prisma.professionalDocument.findUnique({ where: { id: req.params.id } })
    if (!doc) return res.status(404).json({ error: 'Document not found.' })

    const updated = await prisma.professionalDocument.update({
      where: { id: req.params.id },
      data: {
        status: parsed.data.status,
        reviewNotes: parsed.data.reviewNotes,
        reviewedAt: new Date(),
      },
    })

    await audit({
      actorType: 'admin',
      actorId: req.auth.id,
      action: parsed.data.status === 'APPROVED' ? 'document.approve' : 'document.reject',
      resourceType: 'professional_document',
      resourceId: doc.id,
    })

    res.json(updated)
  }
)

// Serves the actual file bytes, streamed from R2 — only the owning
// professional, or a PLATFORM_ADMIN reviewer, can ever read it. Access
// control is unchanged from the local-disk version; only where the bytes
// come from has changed.
documentRouter.get('/:id/file', requireAuth, async (req, res) => {
  const doc = await prisma.professionalDocument.findUnique({ where: { id: req.params.id } })
  if (!doc) return res.status(404).json({ error: 'Document not found.' })

  const isOwner = req.auth.role === 'professional' && req.auth.id === doc.professionalId
  const isPlatformAdmin = req.auth.role === 'admin' && req.auth.adminRole === 'PLATFORM_ADMIN'
  if (!isOwner && !isPlatformAdmin) {
    return res.status(403).json({ error: 'You do not have access to this document.' })
  }

  try {
    const object = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.filePath }))

    await audit({
      actorType: req.auth.role,
      actorId: req.auth.id,
      action: 'document.view_file',
      resourceType: 'professional_document',
      resourceId: doc.id,
    })

    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream')
    object.Body.pipe(res)
  } catch (err) {
    console.error('R2 file fetch error:', err)
    res.status(404).json({ error: 'File not found in storage.' })
  }
})