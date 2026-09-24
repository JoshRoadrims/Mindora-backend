import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const reviewRouter = Router()

const createReviewSchema = z.object({
  appointmentId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
})

// A patient reviews one of their own COMPLETED appointments — one review
// per appointment, enforced by the unique appointmentId on Review plus the
// explicit check below (the unique constraint is the real guarantee; the
// check gives a clear error message instead of a raw DB error).
reviewRouter.post('/', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = createReviewSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { appointmentId, rating, comment } = parsed.data

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appointment || appointment.userId !== req.auth.id) {
    return res.status(404).json({ error: 'Appointment not found.' })
  }
  if (appointment.status !== 'COMPLETED') {
    return res.status(400).json({ error: 'You can only review a completed appointment.' })
  }

  const existing = await prisma.review.findUnique({ where: { appointmentId } })
  if (existing) return res.status(409).json({ error: 'You have already reviewed this appointment.' })

  const review = await prisma.review.create({
    data: {
      userId: req.auth.id,
      professionalId: appointment.professionalId,
      appointmentId,
      rating,
      comment,
    },
  })

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'review.create',
    resourceType: 'review',
    resourceId: review.id,
  })

  res.status(201).json(review)
})

// Public-facing reviews for a professional — deliberately never includes
// who wrote them, only the rating, comment, and date. This is what lets a
// review live on a public directory profile without disclosing that a
// specific named person sought mental-health care.
reviewRouter.get('/professional/:professionalId', requireAuth, async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { professionalId: req.params.professionalId },
    select: { id: true, rating: true, comment: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const average =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null

  res.json({ reviews, average, count: reviews.length })
})

// A patient's own review for one appointment, if they left one — used to
// show "you already reviewed this" instead of the review form.
reviewRouter.get('/appointment/:appointmentId', requireAuth, requireRole('user'), async (req, res) => {
  const appointment = await prisma.appointment.findUnique({ where: { id: req.params.appointmentId } })
  if (!appointment || appointment.userId !== req.auth.id) {
    return res.status(404).json({ error: 'Appointment not found.' })
  }

  const review = await prisma.review.findUnique({ where: { appointmentId: req.params.appointmentId } })
  res.json(review)
})