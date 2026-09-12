import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { hashPassword, verifyPassword, signToken } from '../lib/auth.js'

export const authRouter = Router()

const registerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// --- User ---

authRouter.post('/user/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { fullName, email, password } = parsed.data
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' })

  const user = await prisma.user.create({
    data: { fullName, email, passwordHash: await hashPassword(password) },
  })

  const token = signToken({ id: user.id, role: 'user' })
  res.status(201).json({ token, user: { id: user.id, fullName: user.fullName, email: user.email } })
})

authRouter.post('/user/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  const token = signToken({ id: user.id, role: 'user' })
  res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email } })
})

// --- Professional ---
// Note: in a real MVP, professional registration should not immediately grant
// a usable account — it should create an unverified record and require
// admin verification (credentials check) before `verified: true`.

authRouter.post('/professional/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { fullName, email, password } = parsed.data
  const existing = await prisma.professional.findUnique({ where: { email } })
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' })

  const professional = await prisma.professional.create({
    data: {
      fullName,
      email,
      passwordHash: await hashPassword(password),
      type: 'PSYCHOLOGIST',
      verified: false,
    },
  })

  const token = signToken({ id: professional.id, role: 'professional' })
  res.status(201).json({
    token,
    professional: { id: professional.id, fullName: professional.fullName, verified: professional.verified },
  })
})

authRouter.post('/professional/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { email, password } = parsed.data
  const professional = await prisma.professional.findUnique({ where: { email } })
  if (!professional || !(await verifyPassword(password, professional.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  const token = signToken({ id: professional.id, role: 'professional' })
  res.json({
    token,
    professional: { id: professional.id, fullName: professional.fullName, verified: professional.verified },
  })
})

// --- Admin ---
// Deliberately no self-registration route. Admin accounts touch the safety
// queue and platform-wide data, so they're provisioned out-of-band (seed
// script, or a future internal-only provisioning process) rather than
// through a public signup form.

authRouter.post('/admin/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { email, password } = parsed.data
  const admin = await prisma.admin.findUnique({ where: { email } })
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  const token = signToken({ id: admin.id, role: 'admin' })
  res.json({ token, admin: { id: admin.id, fullName: admin.fullName, role: admin.role } })
})