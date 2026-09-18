import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole, requireAgreement } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const appointmentRouter = Router()

const bookSchema = z.object({
  professionalId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  type: z.enum(['ONLINE', 'IN_PERSON']),
})

// Patient booking — not gated by the professional agreement, since the
// patient isn't the one bound by it.
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

  let finalAppointment = appointment
  if (type === 'ONLINE') {
    finalAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { meetingUrl: `https://meet.jit.si/mindora-${appointment.id}` },
    })
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'appointment.book',
    resourceType: 'appointment',
    resourceId: appointment.id,
  })

  res.status(201).json(finalAppointment)
})

const statusSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED', 'NO_SHOW']),
})

appointmentRouter.patch(
  '/:id/status',
  requireAuth,
  requireRole('professional'),
  requireAgreement,
  async (req, res) => {
    const parsed = statusSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } })
    if (!appointment || appointment.professionalId !== req.auth.id) {
      return res.status(404).json({ error: 'Appointment not found.' })
    }

    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status: parsed.data.status },
    })

    await audit({
      actorType: 'professional',
      actorId: req.auth.id,
      action: 'appointment.status_update',
      resourceType: 'appointment',
      resourceId: appointment.id,
      metadata: { status: parsed.data.status },
    })

    res.json(updated)
  }
)

// Patient's own appointments — not gated by the professional agreement.
appointmentRouter.get('/mine', requireAuth, requireRole('user'), async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { userId: req.auth.id },
    include: { professional: true },
    orderBy: { scheduledFor: 'desc' },
  })
  res.json(appointments)
})

appointmentRouter.get('/', requireAuth, requireRole('professional'), requireAgreement, async (req, res) => {
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