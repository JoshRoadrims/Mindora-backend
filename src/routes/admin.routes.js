import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const adminRouter = Router()

// Platform-wide counts. Cheap enough to compute on read at this scale;
// revisit with caching/materialized views once volumes grow.
adminRouter.get('/overview', requireAuth, requireRole('admin'), async (req, res) => {
  const [totalUsers, assessmentsCompleted, referralsMade, professionalsOnNetwork] =
    await Promise.all([
      prisma.user.count(),
      prisma.checkIn.count(),
      prisma.referral.count(),
      prisma.professional.count({ where: { verified: true } }),
    ])

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'admin.overview.view',
    resourceType: 'platform',
  })

  res.json({ totalUsers, assessmentsCompleted, referralsMade, professionalsOnNetwork })
})

// The four-tier safety queue. Counts by risk level plus the most recent
// referrals that still need professional/clinical attention.
adminRouter.get('/safety', requireAuth, requireRole('admin'), async (req, res) => {
  const riskCounts = await prisma.checkIn.groupBy({
    by: ['riskLevel'],
    _count: { riskLevel: true },
  })

  const counts = { LOW: 0, ELEVATED: 0, HIGH: 0, ACUTE: 0 }
  riskCounts.forEach((r) => {
    counts[r.riskLevel] = r._count.riskLevel
  })

  const recentReferrals = await prisma.referral.findMany({
    where: { status: { in: ['PENDING', 'ESCALATED'] } },
    include: { checkIn: true, flags: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'admin.safety.view',
    resourceType: 'platform',
  })

  res.json({
    counts,
    alerts: recentReferrals.map((r) => ({
      id: r.id,
      level: r.checkIn.riskLevel,
      note: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    })),
  })
})

// --- Professional management ---
// Unlike the public /api/professionals directory (verified only), this
// returns every professional regardless of verification status, since an
// admin's whole job here is to review and verify the unverified ones.
adminRouter.get('/professionals', requireAuth, requireRole('admin'), async (req, res) => {
  const professionals = await prisma.professional.findMany({
    orderBy: { createdAt: 'desc' },
  })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: 'admin.professionals.list',
    resourceType: 'professional',
  })

  res.json(professionals)
})

const verifySchema = z.object({ verified: z.boolean() })

adminRouter.patch('/professionals/:id/verify', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const professional = await prisma.professional.findUnique({ where: { id: req.params.id } })
  if (!professional) return res.status(404).json({ error: 'Professional not found.' })

  const updated = await prisma.professional.update({
    where: { id: req.params.id },
    data: { verified: parsed.data.verified },
  })

  await audit({
    actorType: 'admin',
    actorId: req.auth.id,
    action: parsed.data.verified ? 'professional.verify' : 'professional.unverify',
    resourceType: 'professional',
    resourceId: professional.id,
  })

  res.json(updated)
})