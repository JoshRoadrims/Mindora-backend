import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole, requireAgreement } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const appointmentRouter = Router()

// Fixed session length — matches the industry-standard "60 min" sessions
// seen across comparable Kenyan platforms. A real per-professional
// availability calendar (with configurable slot lengths) is the natural
// next step beyond this; this is the minimum fix for the actual bug:
// nothing currently stops two patients booking the same professional at
// the same time.
const SESSION_DURATION_MINUTES = 60

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
  const requestedTime = new Date(scheduledFor)

  if (requestedTime < new Date()) {
    return res.status(400).json({ error: 'Appointment time must be in the future.' })
  }

  const professional = await prisma.professional.findUnique({ where: { id: professionalId } })
  if (!professional || !professional.verified) {
    return res.status(404).json({ error: 'Professional not found.' })
  }

  // Conflict check: with a fixed session length, two appointments for the
  // same professional overlap whenever their start times fall within one
  // session length of each other. Cancelled appointments free up the slot.
  const windowStart = new Date(requestedTime.getTime() - SESSION_DURATION_MINUTES * 60 * 1000)
  const windowEnd = new Date(requestedTime.getTime() + SESSION_DURATION_MINUTES * 60 * 1000)

  const conflict = await prisma.appointment.findFirst({
    where: {
      professionalId,
      status: { not: 'CANCELLED' },
      scheduledFor: { gt: windowStart, lt: windowEnd },
    },
  })

  if (conflict) {
    return res.status(409).json({
      error: 'This professional already has an appointment around that time. Please choose a different slot.',
    })
  }

  const fullFee = professional.feeKes ?? 0

  // If the patient is linked to an ACTIVE institution, that institution
  // covers coveragePercent% of the fee (capped at the full fee) — this is
  // the corporate EAP / student-discount mechanism.
  const user = await prisma.user.findUnique({ where: { id: req.auth.id }, include: { institution: true } })
  let sponsoringInstitutionId = null
  let institutionCoveredKes = 0

  if (user?.institution && user.institution.status === 'ACTIVE' && user.institution.coveragePercent > 0) {
    sponsoringInstitutionId = user.institution.id
    institutionCoveredKes = Math.min(
      fullFee,
      Math.round((fullFee * user.institution.coveragePercent) / 100)
    )
  }

  const appointment = await prisma.appointment.create({
    data: {
      userId: req.auth.id,
      professionalId,
      scheduledFor: requestedTime,
      type,
      feeKes: fullFee,
      sponsoringInstitutionId,
      institutionCoveredKes,
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
    metadata: sponsoringInstitutionId ? { institutionCoveredKes } : undefined,
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