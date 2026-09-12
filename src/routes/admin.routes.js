import { Router } from 'express'
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