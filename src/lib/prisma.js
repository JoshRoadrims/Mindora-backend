import { PrismaClient } from '@prisma/client'

// Reuse a single PrismaClient instance across the app (and across
// hot-reloads in dev) instead of creating a new one per request.
export const prisma = new PrismaClient()
