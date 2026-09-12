import { prisma } from './prisma.js'

/**
 * Record an access/change to sensitive data. Call this from controllers
 * whenever a referral, clinical note, or check-in is read or written by
 * a professional or admin. Failures here are logged but never block the
 * request — an audit-log outage should not take down the product.
 */
export async function audit({ actorType, actorId, action, resourceType, resourceId, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorType,
        userId: actorType === 'user' ? actorId : undefined,
        professionalId: actorType === 'professional' ? actorId : undefined,
        adminId: actorType === 'admin' ? actorId : undefined,
        action,
        resourceType,
        resourceId,
        metadata,
      },
    })
  } catch (err) {
    console.error('[audit] failed to write audit log', err)
  }
}
