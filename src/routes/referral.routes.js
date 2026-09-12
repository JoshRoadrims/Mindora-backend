import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const referralRouter = Router()

// A professional's referral queue. Only returns referrals assigned to
// *this* professional — never the whole table.
referralRouter.get('/', requireAuth, requireRole('professional'), async (req, res) => {
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

  // Only expose the anonymised identifier, never the user's real name/email,
  // to a professional viewing the queue.
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

// Single referral detail — re-checks ownership even though the list
// endpoint already filtered, because this is a distinct entry point and
// should never trust a referral ID passed in from the client alone.
referralRouter.get('/:id', requireAuth, requireRole('professional'), async (req, res) => {
  const referral = await prisma.referral.findUnique({
    where: { id: req.params.id },
    include: { flags: true, checkIn: { include: { answers: true } } },
  })

  if (!referral || referral.professionalId !== req.auth.id) {
    // Same error for "doesn't exist" and "not yours" — don't leak which one.
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

referralRouter.post('/:id/accept', requireAuth, requireRole('professional'), async (req, res) => {
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
