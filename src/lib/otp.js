import crypto from 'crypto'

const OTP_LENGTH = 6
const OTP_TTL_MINUTES = 10

export function generateOtpCode() {
  const num = crypto.randomInt(0, 1_000_000)
  return String(num).padStart(OTP_LENGTH, '0')
}

export function hashOtpCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export function otpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)
}