import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'
import { SCREENING_QUESTIONS, TOTAL_QUESTION_COUNT, scoreCheckIn } from '../lib/screening.js'

export const checkInRouter = Router()

const QUESTION_BY_ID = new Map(SCREENING_QUESTIONS.map((q) => [q.id, q]))

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        domain: z.string(),
        questionId: z.string(),
        value: z.number().int().min(0).max(3),
      })
    )
    .length(TOTAL_QUESTION_COUNT),
})

// Confirms the submitted answers are exactly the 20 real screening
// questions — no fewer, no duplicates, no made-up questionIds — and that
// each value fits its instrument's real scale (PHQ-9/GAD-7 are 0-3,
// CAGE-AID is yes/no, 0-1). Rejecting anything else here is what stops a
// client bug (or a tampered request) from silently producing a scored
// result that doesn't correspond to a real, complete screening.
function validateAnswersShape(answers) {
  const seen = new Set()
  for (const a of answers) {
    const question = QUESTION_BY_ID.get(a.questionId)
    if (!question) return `Unknown question: ${a.questionId}`
    if (seen.has(a.questionId)) return `Duplicate answer for: ${a.questionId}`
    seen.add(a.questionId)
    const maxForScale = question.scale === 'yesno' ? 1 : 3
    if (a.value > maxForScale) return `Invalid value for ${a.questionId}`
  }
  if (seen.size !== TOTAL_QUESTION_COUNT) return 'Missing one or more required questions.'
  return null
}

checkInRouter.post('/', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { answers } = parsed.data
  const shapeError = validateAnswersShape(answers)
  if (shapeError) return res.status(400).json({ error: shapeError })

  const answersMap = Object.fromEntries(answers.map((a) => [a.questionId, a.value]))
  const { riskLevel, substanceFlag, totalScore, maxScore, phq9Score, gad7Score, cageScore } =
    scoreCheckIn(answersMap)

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
    // Placeholder assignment: a real MVP needs a proper matching/routing
    // algorithm (specialty, availability, caseload) — this exists so the
    // referral actually reaches a professional's queue in this prototype
    // rather than sitting unassigned.
    //
    // One real piece of routing logic: a HIGH/ACUTE result for a Student
    // Rate-eligible patient prefers an experienced professional
    // (yearsExperience >= 3) first, falling back to "first verified" if
    // none is available — a serious result shouldn't default to the most
    // junior professional on the platform just because they happen to be
    // the ones who opted into the discounted tier.
    const user = await prisma.user.findUnique({ where: { id: req.auth.id }, select: { studentRateEligible: true } })
    const preferExperienced = user?.studentRateEligible && (riskLevel === 'HIGH' || riskLevel === 'ACUTE')

    let professional = null
    if (preferExperienced) {
      professional = await prisma.professional.findFirst({
        where: { verified: true, yearsExperience: { gte: 3 } },
        orderBy: { createdAt: 'asc' },
      })
    }
    if (!professional) {
      professional = await prisma.professional.findFirst({
        where: { verified: true },
        orderBy: { createdAt: 'asc' },
      })
    }

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
  // whether a referral was successfully assigned to a professional. ACUTE
  // here always includes a positive answer on the PHQ-9 self-harm item
  // (item 9) — see scoreCheckIn in screening.js.
  if (riskLevel === 'HIGH' || riskLevel === 'ACUTE') {
    await prisma.safetyAlert.create({
      data: {
        referralId: referral?.id,
        userId: req.auth.id,
        riskLevel,
        note:
          riskLevel === 'ACUTE'
            ? 'Screening responses indicate a possible acute risk (PHQ-9 self-harm item positive) — requires urgent professional review.'
            : 'Screening responses indicate a high level of concern (PHQ-9 or GAD-7 severe range) — requires prompt clinical assessment.',
      },
    })
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'check_in.submit',
    resourceType: 'check_in',
    resourceId: checkIn.id,
    metadata: { riskLevel, substanceFlag, phq9Score, gad7Score, cageScore },
  })

  res.status(201).json({
    id: checkIn.id,
    riskLevel: checkIn.riskLevel,
    totalScore: checkIn.totalScore,
    maxScore: checkIn.maxScore,
    referralId: referral?.id ?? null,
    substanceFlag,
    phq9Score,
    gad7Score,
    cageScore,
  })
})

// Full check-in history for the logged-in user, oldest first — used by the
// dashboard's stats cards and the wellbeing journey chart. Includes raw
// per-domain answers so the client can compute domain-level trends
// without a second round trip.
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