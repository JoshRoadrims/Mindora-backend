import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole, requireAgreement } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const referralRouter = Router()

// A professional's referral queue. Only returns referrals assigned to
// *this* professional — never the whole table.
referralRouter.get('/', requireAuth, requireRole('professional'), requireAgreement, async (req, res) => {
  const referrals = await prisma.referral.findMany({
    where: { professionalId: req.auth.id },
    include: { flags: true, checkIn: true },
    orderBy: { createdAt: 'desc' },
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'referral.list',
    resourceType: 'referral',
  })

  res.json(
    referrals.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      riskLevel: r.checkIn.riskLevel,
      flags: r.flags.map((f) => f.label),
      createdAt: r.createdAt,
    }))
  )
})

referralRouter.get('/:id', requireAuth, requireRole('professional'), requireAgreement, async (req, res) => {
  const referral = await prisma.referral.findUnique({
    where: { id: req.params.id },
    include: { flags: true, checkIn: { include: { answers: true } } },
  })

  if (!referral || referral.professionalId !== req.auth.id) {
    return res.status(404).json({ error: 'Referral not found.' })
  }

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'referral.view',
    resourceType: 'referral',
    resourceId: referral.id,
  })

  res.json(referral)
})

referralRouter.post('/:id/accept', requireAuth, requireRole('professional'), requireAgreement, async (req, res) => {
  const referral = await prisma.referral.findUnique({ where: { id: req.params.id } })
  if (!referral || referral.professionalId !== req.auth.id) {
    return res.status(404).json({ error: 'Referral not found.' })
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: { status: 'ACCEPTED' },
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'referral.accept',
    resourceType: 'referral',
    resourceId: referral.id,
  })

  res.json(updated)
})