import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const checkInRouter = Router()

const submitSchema = z.object({
  answers: z.array(
    z.object({
      domain: z.string(),
      questionId: z.string(),
      value: z.number().int().min(0).max(3),
    })
  ),
})

// Risk scoring lives on the server, not the client — this is the one place
// it can't be tampered with or drift out of sync between screens.
// NOTE: this is a placeholder threshold, not a validated clinical instrument.
// Replace with a clinician-reviewed scoring model before handling real users.
function computeRisk(answers) {
  const totalScore = answers.reduce((sum, a) => sum + a.value, 0)
  const maxScore = answers.length * 3
  const ratio = maxScore ? totalScore / maxScore : 0
  const riskLevel = ratio >= 0.45 ? 'ELEVATED' : 'LOW'
  return { totalScore, maxScore, riskLevel }
}

checkInRouter.post('/', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { answers } = parsed.data
  const { totalScore, maxScore, riskLevel } = computeRisk(answers)

  const checkIn = await prisma.checkIn.create({
    data: {
      userId: req.auth.id,
      riskLevel,
      totalScore,
      maxScore,
      answers: { create: answers },
    },
  })

  let referral = null
  if (riskLevel === 'ELEVATED') {
    const professional = await prisma.professional.findFirst({
      where: { verified: true },
      orderBy: { createdAt: 'asc' },
    })

    referral = await prisma.referral.create({
      data: {
        userId: req.auth.id,
        checkInId: checkIn.id,
        professionalId: professional?.id,
        status: 'PENDING',
        reason:
          'Screening responses indicate that professional assessment may be beneficial.',
      },
    })
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'check_in.submit',
    resourceType: 'check_in',
    resourceId: checkIn.id,
    metadata: { riskLevel },
  })

  res.status(201).json({
    id: checkIn.id,
    riskLevel: checkIn.riskLevel,
    totalScore: checkIn.totalScore,
    maxScore: checkIn.maxScore,
    referralId: referral?.id ?? null,
  })
})

// Full check-in history for the logged-in user, oldest first — used by the
// dashboard's stats cards and the wellbeing journey chart. Includes raw
// per-domain answers so the client can compute domain-level trends
// (mood, sleep, stress, energy) without a second round trip.
checkInRouter.get('/', requireAuth, requireRole('user'), async (req, res) => {
  const checkIns = await prisma.checkIn.findMany({
    where: { userId: req.auth.id },
    orderBy: { completedAt: 'asc' },
    include: { answers: true },
  })
  res.json(checkIns)
})

// Most recent check-in for the logged-in user — used to render the
// dashboard's "current wellbeing" card and the result screen on refresh.
checkInRouter.get('/latest', requireAuth, requireRole('user'), async (req, res) => {
  const checkIn = await prisma.checkIn.findFirst({
    where: { userId: req.auth.id },
    orderBy: { completedAt: 'desc' },
  })

  if (!checkIn) return res.status(404).json({ error: 'No check-ins yet.' })
  res.json(checkIn)
})