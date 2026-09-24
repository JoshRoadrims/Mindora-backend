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
// NOTE: the ratio thresholds below are still a placeholder, not a validated
// clinical instrument. What IS a real improvement: individual high-risk
// answers (self-harm, substance use) can override the average instead of
// being diluted by it — averaging alone let a single severe answer get lost
// among mild ones, which is not how real screening tools behave.
function computeRisk(answers) {
  const totalScore = answers.reduce((sum, a) => sum + a.value, 0)
  const maxScore = answers.length * 3
  const ratio = maxScore ? totalScore / maxScore : 0

  let riskLevel
  if (ratio >= 0.75) riskLevel = 'ACUTE'
  else if (ratio >= 0.55) riskLevel = 'HIGH'
  else if (ratio >= 0.3) riskLevel = 'ELEVATED'
  else riskLevel = 'LOW'

  // Trigger overrides — these can only push the tier UP, never down.
  const selfHarmAnswer = answers.find((a) => a.domain === 'selfharm')
  const substanceAnswer = answers.find((a) => a.domain === 'substance')

  const tierRank = { LOW: 0, ELEVATED: 1, HIGH: 2, ACUTE: 3 }
  const bumpTo = (level) => {
    if (tierRank[level] > tierRank[riskLevel]) riskLevel = level
  }

  if (selfHarmAnswer) {
    if (selfHarmAnswer.value >= 3) bumpTo('ACUTE')
    else if (selfHarmAnswer.value >= 1) bumpTo('HIGH')
  }

  // Tracks whether it was specifically the substance-use answer that
  // drove this result, so the frontend can show substance-specific
  // guidance (NACADA's helpline) rather than only generic messaging —
  // without this flag, a severe substance-use answer that happened to
  // coincide with an already-high overall score would be
  // indistinguishable from one that pushed the tier up on its own.
  let substanceFlag = false
  if (substanceAnswer?.value >= 3) {
    bumpTo('ELEVATED')
    substanceFlag = true
  }

  return { totalScore, maxScore, riskLevel, substanceFlag }
}

checkInRouter.post('/', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { answers } = parsed.data
  const { totalScore, maxScore, riskLevel, substanceFlag } = computeRisk(answers)

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
  if (riskLevel === 'ELEVATED' || riskLevel === 'HIGH' || riskLevel === 'ACUTE') {
    // Placeholder assignment: hand the referral to the first verified
    // professional. A real MVP needs a proper matching/routing algorithm
    // (specialty, availability, caseload) — this exists so the referral
    // actually reaches a professional's queue in this prototype rather
    // than sitting unassigned.
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
        reason: substanceFlag
          ? 'Screening responses indicate a concern related to alcohol or drug use that may benefit from professional support.'
          : 'Screening responses indicate that professional assessment may be beneficial.',
        flags: substanceFlag ? { create: [{ label: 'Substance use concern' }] } : undefined,
      },
    })
  }

  // HIGH and ACUTE results feed the admin safety queue, independent of
  // whether a referral was successfully assigned to a professional.
  if (riskLevel === 'HIGH' || riskLevel === 'ACUTE') {
    await prisma.safetyAlert.create({
      data: {
        referralId: referral?.id,
        userId: req.auth.id,
        riskLevel,
        note:
          riskLevel === 'ACUTE'
            ? 'Screening responses indicate a possible acute risk — requires urgent professional review.'
            : 'Screening responses indicate a high level of concern — requires prompt clinical assessment.',
      },
    })
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'check_in.submit',
    resourceType: 'check_in',
    resourceId: checkIn.id,
    metadata: { riskLevel, substanceFlag },
  })

  res.status(201).json({
    id: checkIn.id,
    riskLevel: checkIn.riskLevel,
    totalScore: checkIn.totalScore,
    maxScore: checkIn.maxScore,
    referralId: referral?.id ?? null,
    substanceFlag,
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