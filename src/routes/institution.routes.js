import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdminRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const institutionRouter = Router()

// Institutions are business/compliance-sensitive partner records —
// PLATFORM_ADMIN only, same tier as Analytics and professional verification.

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['EMPLOYER', 'UNIVERSITY', 'HEALTHCARE_PROVIDER', 'INSURER', 'OTHER']),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
})

institutionRouter.get('/', requireAuth, requireAdminRole('PLATFORM_ADMIN'), async (req, res) => {
  const institutions = await prisma.institution.findMany({ orderBy: { createdAt: 'desc' } })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'admin.institutions.list',
    resourceType: 'institution',
  })

  res.json(institutions)
})

institutionRouter.post('/', requireAuth, requireAdminRole('PLATFORM_ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const institution = await prisma.institution.create({ data: parsed.data })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'institution.create',
    resourceType: 'institution',
    resourceId: institution.id,
  })

  res.status(201).json(institution)
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['EMPLOYER', 'UNIVERSITY', 'HEALTHCARE_PROVIDER', 'INSURER', 'OTHER']).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE']).optional(),
  notes: z.string().optional(),
})

institutionRouter.patch('/:id', requireAuth, requireAdminRole('PLATFORM_ADMIN'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const institution = await prisma.institution.findUnique({ where: { id: req.params.id } })
  if (!institution) return res.status(404).json({ error: 'Institution not found.' })

  const updated = await prisma.institution.update({
    where: { id: req.params.id },
    data: parsed.data,
  })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'institution.update',
    resourceType: 'institution',
    resourceId: institution.id,
  })

  res.json(updated)
})