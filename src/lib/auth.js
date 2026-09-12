import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 12

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

// role: 'user' | 'professional' | 'admin'
export function signToken({ id, role }) {
  return jwt.sign({ sub: id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
