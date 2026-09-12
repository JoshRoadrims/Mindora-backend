import { verifyToken } from '../lib/auth.js'

// Attaches req.auth = { id, role } if a valid token is present.
// Does not itself reject unauthenticated requests — pair with requireAuth
// or requireRole for that.
export function attachAuth(req, _res, next) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyToken(header.slice(7))
      req.auth = { id: payload.sub, role: payload.role }
    } catch {
      // invalid/expired token — leave req.auth undefined, let downstream
      // middleware decide whether that's acceptable for this route
    }
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required.' })
  next()
}

// Usage: requireRole('professional') or requireRole('admin', 'professional')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required.' })
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }
    next()
  }
}
