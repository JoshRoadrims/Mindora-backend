import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'
import { CURRENT_AGREEMENT_VERSION } from '../lib/agreement.js'

export const professionalRouter = Router()

// Any authenticated person (user or professional) can browse the directory.
// Only verified professionals are ever listed publicly.
professionalRouter.get('/', requireAuth, async (_req, res) => {
  const professionals = await prisma.professional.findMany({
    where: { verified: true },
    orderBy: { createdAt: 'asc' },
  })
  res.json(professionals)
})

// Agreement status — placed before '/:id' would also be fine here since
// this is a two-segment path, but kept early for readability.
professionalRouter.get(
  '/agreement/status',
  requireAuth,
  requireRole('professional'),
  async (req, res) => {
    const professional = await prisma.professional.findUnique({ where: { id: req.auth.id } })
    if (!professional) return res.status(401).json({ error: 'Authentication required.' })

    res.json({
      accepted:
        professional.agreementAcceptedAt !== null &&
        professional.agreementVersion === CURRENT_AGREEMENT_VERSION,
      acceptedAt: professional.agreementAcceptedAt,
      acceptedVersion: professional.agreementVersion,
      currentVersion: CURRENT_AGREEMENT_VERSION,
    })
  }
)

professionalRouter.post(
  '/agreement/accept',
  requireAuth,
  requireRole('professional'),
  async (req, res) => {
    const updated = await prisma.professional.update({
      where: { id: req.auth.id },
      data: { agreementAcceptedAt: new Date(), agreementVersion: CURRENT_AGREEMENT_VERSION },
    })

    await audit({
      actorType: 'professional',
      actorId: req.auth.id,
      action: 'agreement.accept',
      resourceType: 'professional',
      resourceId: req.auth.id,
      metadata: { version: CURRENT_AGREEMENT_VERSION },
    })

    res.json({
      accepted: true,
      acceptedAt: updated.agreementAcceptedAt,
      acceptedVersion: updated.agreementVersion,
    })
  }
)

professionalRouter.get('/:id', requireAuth, async (req, res) => {
  const professional = await prisma.professional.findUnique({
    where: { id: req.params.id },
  })
  if (!professional || !professional.verified) {
    return res.status(404).json({ error: 'Professional not found.' })
  }
  res.json(professional)
})