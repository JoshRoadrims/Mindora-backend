import rateLimit from 'express-rate-limit'

// Tighter limit specifically on login attempts — this is the actual
// brute-force target (guessing a known email's password). Applies per IP,
// across all three login endpoints combined (user/professional/admin),
// since nothing stops someone from just switching which one they're
// guessing against.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' },
})

// Looser limit on registration — less brute-forceable than login (there's
// no "correct answer" to guess), but still worth capping to prevent
// automated spam account creation.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' },
})

// A loose, whole-API baseline as defense in depth — catches anything
// scripted hammering the backend broadly, not just auth specifically.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
})

// Strict limit on OTP verification attempts — a 6-digit code is only
// ~1 million possibilities, so this matters as much as the login limiter
// itself for actually stopping brute-force guessing of the code.
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Please request a new code.' },
})