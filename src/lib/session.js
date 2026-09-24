import { prisma } from './prisma.js'
import {
  signAccessToken,
  generateRefreshTokenValue,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from './auth.js'

// Issues a fresh access + refresh token pair for a given account, and
// stores the refresh token's hash so it can later be looked up and revoked.
export async function issueSession({ id, role, adminRole }) {
  const accessToken = signAccessToken({ id, role, adminRole })

  const refreshValue = generateRefreshTokenValue()
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshValue),
      role,
      accountId: id,
      expiresAt: refreshTokenExpiryDate(),
    },
  })

  return { accessToken, refreshToken: refreshValue }
}

// Exchanges a valid, unrevoked refresh token for a new access token. Also
// rotates the refresh token itself (issues a new one, revokes the old) —
// this means a stolen refresh token can only be used once before the
// legitimate owner's next refresh silently invalidates it, limiting the
// damage window if one ever leaks.
export async function refreshSession(refreshValue) {
  const tokenHash = hashRefreshToken(refreshValue)
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } })

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    return null
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })

  let adminRole
  if (stored.role === 'admin') {
    const admin = await prisma.admin.findUnique({ where: { id: stored.accountId } })
    if (!admin) return null
    adminRole = admin.role
  }

  return issueSession({ id: stored.accountId, role: stored.role, adminRole })
}

// Revokes one specific refresh token — used on logout.
export async function revokeRefreshToken(refreshValue) {
  const tokenHash = hashRefreshToken(refreshValue)
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// Revokes every active refresh token for an account — "log out everywhere."
export async function revokeAllSessions(role, accountId) {
  await prisma.refreshToken.updateMany({
    where: { role, accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}