import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

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

professionalRouter.get('/:id', requireAuth, async (req, res) => {
  const professional = await prisma.professional.findUnique({
    where: { id: req.params.id },
  })
  if (!professional || !professional.verified) {
    return res.status(404).json({ error: 'Professional not found.' })
  }
  res.json(professional)
})