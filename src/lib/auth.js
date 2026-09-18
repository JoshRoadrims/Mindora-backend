import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 12

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

// portalRole: 'user' | 'professional' | 'admin'
// adminRole (only for portalRole 'admin'): 'PLATFORM_ADMIN' | 'CLINICAL_SAFETY_REVIEWER' | 'SUPPORT'
// Carrying adminRole in the token itself (not just the DB) means every
// request can check tiered access without an extra database lookup.
export function signToken({ id, role, adminRole }) {
  const payload = { sub: id, role }
  if (adminRole) payload.adminRole = adminRole
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}