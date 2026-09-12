import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const appointmentRouter = Router()

const bookSchema = z.object({
  professionalId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  type: z.enum(['ONLINE', 'IN_PERSON']),
})

// Patient books a real appointment against a real professional.
appointmentRouter.post('/', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = bookSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { professionalId, scheduledFor, type } = parsed.data

  const professional = await prisma.professional.findUnique({ where: { id: professionalId } })
  if (!professional || !professional.verified) {
    return res.status(404).json({ error: 'Professional not found.' })
  }

  const appointment = await prisma.appointment.create({
    data: {
      userId: req.auth.id,
      professionalId,
      scheduledFor: new Date(scheduledFor),
      type,
      feeKes: professional.feeKes ?? 0,
    },
  })

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'appointment.book',
    resourceType: 'appointment',
    resourceId: appointment.id,
  })

  res.status(201).json(appointment)
})

// Patient's own appointments.
appointmentRouter.get('/mine', requireAuth, requireRole('user'), async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { userId: req.auth.id },
    include: { professional: true },
    orderBy: { scheduledFor: 'desc' },
  })
  res.json(appointments)
})

// Professional's own appointments — never another professional's.
appointmentRouter.get('/', requireAuth, requireRole('professional'), async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { professionalId: req.auth.id },
    orderBy: { scheduledFor: 'asc' },
  })

  const now = new Date()
  res.json({
    upcoming: appointments.filter((a) => a.scheduledFor >= now),
    past: appointments.filter((a) => a.scheduledFor < now),
  })
})