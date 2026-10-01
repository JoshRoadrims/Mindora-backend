import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'
import { CURRENT_AGREEMENT_VERSION } from '../lib/agreement.js'
import {
  CURRENT_GROUP_CONSENT_VERSION,
  MAX_GROUP_MESSAGE_LENGTH,
  SUBSTANCE_USE_DEFAULT_RULES,
  generatePseudonym,
  containsContactDetails,
  containsCrisisLanguage,
} from '../lib/groups.js'

export const groupRouter = Router()

// Express 4 does not catch errors thrown inside async handlers, so every
// handler is wrapped and any error goes to the central error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const TOPICS = ['ANXIETY', 'DEPRESSION', 'GRIEF', 'STRESS', 'RELATIONSHIPS', 'SUBSTANCE_USE', 'OTHER']

const groupInclude = {
  facilitator: { select: { fullName: true, type: true } },
  _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeGroup(group) {
  return {
    id: group.id,
    title: group.title,
    topic: group.topic,
    description: group.description,
    rules: group.rules,
    maxMembers: group.maxMembers,
    status: group.status,
    memberCount: group._count?.memberships ?? 0,
    facilitatorName: group.facilitator?.fullName ?? null,
    facilitatorType: group.facilitator?.type ?? null,
    createdAt: group.createdAt,
  }
}

function authorLabelFor(message) {
  if (message.authoredByFacilitator) return 'Facilitator'
  if (!message.membership || message.membership.userId === null) return 'Former member'
  return message.membership.pseudonym
}

// What a member sees. Never includes a user id or a real name.
function serializeForMember(message, viewerUserId) {
  return {
    id: message.id,
    authorLabel: authorLabelFor(message),
    isFacilitator: message.authoredByFacilitator,
    mine: !message.authoredByFacilitator && message.membership?.userId === viewerUserId,
    hidden: message.hidden,
    content: message.hidden ? null : message.content,
    createdAt: message.createdAt,
  }
}

// What the facilitator sees: real names, flags, and open report counts.
function serializeForFacilitator(message) {
  return {
    id: message.id,
    authorLabel: authorLabelFor(message),
    authorRealName: message.authoredByFacilitator
      ? null
      : (message.membership?.user?.fullName ?? 'Former member'),
    isFacilitator: message.authoredByFacilitator,
    hidden: message.hidden,
    flagged: message.flagged,
    openReports: message._count?.reports ?? 0,
    content: message.content,
    createdAt: message.createdAt,
  }
}

// The caller must be a verified professional on the current agreement.
async function checkFacilitator(req, res) {
  const professional = await prisma.professional.findUnique({
    where: { id: req.auth.id },
    select: { verified: true, agreementVersion: true },
  })
  if (!professional?.verified) {
    res.status(403).json({ error: 'Only verified professionals can run support groups.' })
    return false
  }
  if (professional.agreementVersion !== CURRENT_AGREEMENT_VERSION) {
    res.status(403).json({ error: 'Please accept the current professional agreement first.' })
    return false
  }
  return true
}

// Loads a group only if the caller is its verified facilitator. Sends the
// error response itself and returns null when the check fails.
async function getOwnedGroup(req, res, groupId) {
  if (!(await checkFacilitator(req, res))) return null
  const group = await prisma.supportGroup.findUnique({ where: { id: groupId } })
  if (!group || group.facilitatorId !== req.auth.id) {
    res.status(404).json({ error: 'Group not found.' })
    return null
  }
  return group
}

function findMembership(groupId, userId) {
  return prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
}

async function createMembershipWithPseudonym(groupId, userId, now) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await prisma.groupMembership.create({
        data: {
          groupId,
          userId,
          pseudonym: generatePseudonym(),
          status: 'PENDING',
          consentAcceptedAt: now,
          consentVersion: CURRENT_GROUP_CONSENT_VERSION,
        },
      })
    } catch (err) {
      if (err.code !== 'P2002') throw err // only retry unique-constraint clashes
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Browsing (patients)
// ---------------------------------------------------------------------------

groupRouter.get('/', requireAuth, requireRole('user'), wrap(async (req, res) => {
  const groups = await prisma.supportGroup.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] }, facilitator: { verified: true } },
    orderBy: { createdAt: 'desc' },
    include: groupInclude,
  })

  const mine = await prisma.groupMembership.findMany({
    where: { userId: req.auth.id },
    select: { groupId: true, status: true },
  })
  const statusByGroup = new Map(mine.map((m) => [m.groupId, m.status]))

  res.json(groups.map((group) => ({ ...serializeGroup(group), myStatus: statusByGroup.get(group.id) ?? null })))
}))

// ---------------------------------------------------------------------------
// Facilitator: list and create (static paths must come before /:groupId)
// ---------------------------------------------------------------------------

groupRouter.get('/facilitating', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const groups = await prisma.supportGroup.findMany({
    where: { facilitatorId: req.auth.id },
    orderBy: { createdAt: 'desc' },
    include: groupInclude,
  })

  const [pending, flagged, reports] = await Promise.all([
    prisma.groupMembership.groupBy({
      by: ['groupId'],
      where: { status: 'PENDING', group: { facilitatorId: req.auth.id } },
      _count: { _all: true },
    }),
    prisma.groupMessage.groupBy({
      by: ['groupId'],
      where: { flagged: true, group: { facilitatorId: req.auth.id } },
      _count: { _all: true },
    }),
    prisma.groupReport.findMany({
      where: { status: 'OPEN', message: { group: { facilitatorId: req.auth.id } } },
      select: { message: { select: { groupId: true } } },
    }),
  ])

  const toMap = (rows) => new Map(rows.map((row) => [row.groupId, row._count._all]))
  const pendingByGroup = toMap(pending)
  const flaggedByGroup = toMap(flagged)
  const reportsByGroup = new Map()
  for (const report of reports) {
    const groupId = report.message.groupId
    reportsByGroup.set(groupId, (reportsByGroup.get(groupId) ?? 0) + 1)
  }

  res.json(
    groups.map((group) => ({
      ...serializeGroup(group),
      pendingCount: pendingByGroup.get(group.id) ?? 0,
      flaggedCount: flaggedByGroup.get(group.id) ?? 0,
      openReports: reportsByGroup.get(group.id) ?? 0,
    }))
  )
}))

const createGroupSchema = z.object({
  title: z.string().trim().min(3).max(80),
  topic: z.enum(TOPICS),
  description: z.string().trim().min(10).max(600),
  rules: z.string().trim().max(1000).optional(),
  maxMembers: z.number().int().min(5).max(20).default(12),
})

groupRouter.post('/', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  if (!(await checkFacilitator(req, res))) return

  const { title, topic, description, maxMembers } = parsed.data
  let rules = parsed.data.rules || null
  if (!rules && topic === 'SUBSTANCE_USE') rules = SUBSTANCE_USE_DEFAULT_RULES

  const group = await prisma.supportGroup.create({
    data: { facilitatorId: req.auth.id, title, topic, description, rules, maxMembers },
    include: groupInclude,
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.create',
    resourceType: 'support_group',
    resourceId: group.id,
  })

  res.status(201).json(serializeGroup(group))
}))

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

groupRouter.get('/:groupId', requireAuth, requireRole('user', 'professional'), wrap(async (req, res) => {
  const group = await prisma.supportGroup.findUnique({
    where: { id: req.params.groupId },
    include: groupInclude,
  })
  if (!group) return res.status(404).json({ error: 'Group not found.' })

  if (req.auth.role === 'professional') {
    if (group.facilitatorId !== req.auth.id) return res.status(404).json({ error: 'Group not found.' })
    return res.json({ group: serializeGroup(group), isFacilitator: true, myMembership: null })
  }

  const membership = await findMembership(group.id, req.auth.id)
  if (group.status === 'ARCHIVED' && !membership) {
    return res.status(404).json({ error: 'Group not found.' })
  }

  res.json({
    group: serializeGroup(group),
    isFacilitator: false,
    myMembership: membership ? { status: membership.status, pseudonym: membership.pseudonym } : null,
  })
}))

const updateGroupSchema = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  description: z.string().trim().min(10).max(600).optional(),
  rules: z.string().trim().max(1000).optional(),
  maxMembers: z.number().int().min(5).max(20).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
})

groupRouter.patch('/:groupId', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const parsed = updateGroupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const group = await getOwnedGroup(req, res, req.params.groupId)
  if (!group) return

  if (parsed.data.maxMembers !== undefined) {
    const activeCount = await prisma.groupMembership.count({
      where: { groupId: group.id, status: 'ACTIVE' },
    })
    if (parsed.data.maxMembers < activeCount) {
      return res.status(400).json({
        error: `This group already has ${activeCount} members, so the limit cannot be lower than that.`,
      })
    }
  }

  const updated = await prisma.supportGroup.update({
    where: { id: group.id },
    data: parsed.data,
    include: groupInclude,
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.update',
    resourceType: 'support_group',
    resourceId: group.id,
    metadata: { fields: Object.keys(parsed.data) },
  })

  res.json(serializeGroup(updated))
}))

// ---------------------------------------------------------------------------
// Joining and leaving (patients)
// ---------------------------------------------------------------------------

const joinSchema = z.object({
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm that you are 18 or over.' }),
  }),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the group guidelines to join.' }),
  }),
})

groupRouter.post('/:groupId/join', requireAuth, requireRole('user'), wrap(async (req, res) => {
  const parsed = joinSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const group = await prisma.supportGroup.findUnique({
    where: { id: req.params.groupId },
    include: {
      facilitator: { select: { verified: true } },
      _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
    },
  })
  if (!group || !group.facilitator.verified) return res.status(404).json({ error: 'Group not found.' })
  if (group.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'This group is not accepting new members right now.' })
  }

  const existing = await findMembership(group.id, req.auth.id)
  if (existing?.status === 'PENDING') {
    return res.status(409).json({ error: 'You have already asked to join this group.' })
  }
  if (existing?.status === 'ACTIVE') {
    return res.status(409).json({ error: 'You are already a member of this group.' })
  }
  if (existing?.status === 'REMOVED') {
    return res.status(403).json({ error: 'You can no longer join this group.' })
  }
  if (group._count.memberships >= group.maxMembers) {
    return res.status(409).json({ error: 'This group is full.' })
  }

  const now = new Date()
  let membership
  if (existing) {
    // Someone who left is asking again: same pseudonym, fresh consent.
    membership = await prisma.groupMembership.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        consentAcceptedAt: now,
        consentVersion: CURRENT_GROUP_CONSENT_VERSION,
        joinedAt: null,
      },
    })
  } else {
    membership = await createMembershipWithPseudonym(group.id, req.auth.id, now)
    if (!membership) return res.status(409).json({ error: 'Could not send your request. Please try again.' })
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'group.join_request',
    resourceType: 'group_membership',
    resourceId: membership.id,
  })

  res.status(201).json({ status: membership.status, pseudonym: membership.pseudonym })
}))

groupRouter.delete('/:groupId/membership', requireAuth, requireRole('user'), wrap(async (req, res) => {
  const membership = await findMembership(req.params.groupId, req.auth.id)
  if (!membership || !['PENDING', 'ACTIVE'].includes(membership.status)) {
    return res.status(404).json({ error: 'You are not in this group.' })
  }

  await prisma.groupMembership.update({ where: { id: membership.id }, data: { status: 'LEFT' } })

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'group.leave',
    resourceType: 'group_membership',
    resourceId: membership.id,
  })

  res.json({ left: true })
}))

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

groupRouter.get('/:groupId/messages', requireAuth, requireRole('user', 'professional'), wrap(async (req, res) => {
  const { groupId } = req.params

  if (req.auth.role === 'professional') {
    const group = await getOwnedGroup(req, res, groupId)
    if (!group) return

    const messages = await prisma.groupMessage.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        membership: { select: { pseudonym: true, userId: true, user: { select: { fullName: true } } } },
        _count: { select: { reports: { where: { status: 'OPEN' } } } },
      },
    })
    return res.json(messages.reverse().map(serializeForFacilitator))
  }

  const membership = await findMembership(groupId, req.auth.id)
  if (!membership || membership.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'You are not a member of this group.' })
  }

  const messages = await prisma.groupMessage.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { membership: { select: { pseudonym: true, userId: true } } },
  })
  res.json(messages.reverse().map((message) => serializeForMember(message, req.auth.id)))
}))

const postSchema = z.object({
  content: z.string().trim().min(1).max(MAX_GROUP_MESSAGE_LENGTH),
})

groupRouter.post('/:groupId/messages', requireAuth, requireRole('user', 'professional'), wrap(async (req, res) => {
  const parsed = postSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { groupId } = req.params
  const { content } = parsed.data

  let group
  let membership = null
  if (req.auth.role === 'professional') {
    group = await getOwnedGroup(req, res, groupId)
    if (!group) return
  } else {
    membership = await findMembership(groupId, req.auth.id)
    if (!membership || membership.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'You are not a member of this group.' })
    }
    group = await prisma.supportGroup.findUnique({ where: { id: groupId } })
    if (!group) return res.status(404).json({ error: 'Group not found.' })
  }

  if (group.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Posting is turned off for this group right now.' })
  }

  if (containsContactDetails(content)) {
    return res.status(400).json({
      error:
        "For everyone's privacy, please don't share phone numbers, emails, or links in the group. If you'd like to talk one-to-one, you can book a session with a professional.",
    })
  }

  // The crisis check never blocks a post. Silencing someone in distress is
  // worse than a false alarm.
  const crisis = membership ? containsCrisisLanguage(content) : false

  const message = await prisma.groupMessage.create({
    data: {
      groupId,
      membershipId: membership?.id ?? null,
      authoredByFacilitator: !membership,
      content,
      flagged: crisis,
    },
    include: { membership: { select: { pseudonym: true, userId: true } } },
  })

  if (crisis) {
    await prisma.safetyAlert.create({
      data: {
        userId: req.auth.id,
        groupMessageId: message.id,
        riskLevel: 'HIGH',
        note: `Possible crisis language in support group "${group.title}" (member ${membership.pseudonym}). Post excerpt: "${content.slice(0, 300)}"`,
      },
    })
    await audit({
      actorType: 'user',
      actorId: req.auth.id,
      action: 'group.message.flagged',
      resourceType: 'group_message',
      resourceId: message.id,
    })
  }

  res.status(201).json({
    message:
      req.auth.role === 'professional'
        ? serializeForFacilitator(message)
        : serializeForMember(message, req.auth.id),
    crisis,
  })
}))

const reportSchema = z.object({ reason: z.string().trim().max(300).optional() })

groupRouter.post('/messages/:messageId/report', requireAuth, requireRole('user'), wrap(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const message = await prisma.groupMessage.findUnique({
    where: { id: req.params.messageId },
    include: { membership: { select: { userId: true } } },
  })
  if (!message) return res.status(404).json({ error: 'Message not found.' })

  const reporter = await findMembership(message.groupId, req.auth.id)
  if (!reporter || reporter.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'You are not a member of this group.' })
  }
  if (message.authoredByFacilitator) {
    return res.status(400).json({
      error: 'To raise a concern about the facilitator, please contact Mindora support.',
    })
  }
  if (message.membership?.userId === req.auth.id) {
    return res.status(400).json({ error: 'You cannot report your own message.' })
  }

  let report
  try {
    report = await prisma.groupReport.create({
      data: {
        messageId: message.id,
        reporterMembershipId: reporter.id,
        reason: parsed.data.reason || null,
      },
    })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'You have already reported this message.' })
    throw err
  }

  await audit({
    actorType: 'user',
    actorId: req.auth.id,
    action: 'group.message.reported',
    resourceType: 'group_report',
    resourceId: report.id,
  })

  res.status(201).json({ reported: true })
}))

// ---------------------------------------------------------------------------
// Facilitator: roster and membership decisions
// ---------------------------------------------------------------------------

groupRouter.get('/:groupId/roster', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const group = await getOwnedGroup(req, res, req.params.groupId)
  if (!group) return

  const memberships = await prisma.groupMembership.findMany({
    where: { groupId: group.id, status: { in: ['PENDING', 'ACTIVE'] } },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })

  res.json(
    memberships.map((membership) => ({
      id: membership.id,
      pseudonym: membership.pseudonym,
      status: membership.status,
      realName: membership.user?.fullName ?? 'Former member',
      requestedAt: membership.createdAt,
      joinedAt: membership.joinedAt,
    }))
  )
}))

async function loadMembershipInGroup(req, res) {
  const group = await getOwnedGroup(req, res, req.params.groupId)
  if (!group) return {}
  const membership = await prisma.groupMembership.findFirst({
    where: { id: req.params.membershipId, groupId: group.id },
  })
  if (!membership) {
    res.status(404).json({ error: 'Member not found.' })
    return {}
  }
  return { group, membership }
}

groupRouter.post('/:groupId/members/:membershipId/approve', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { group, membership } = await loadMembershipInGroup(req, res)
  if (!membership) return

  if (membership.status !== 'PENDING') {
    return res.status(400).json({ error: 'This request has already been handled.' })
  }

  const activeCount = await prisma.groupMembership.count({
    where: { groupId: group.id, status: 'ACTIVE' },
  })
  if (activeCount >= group.maxMembers) {
    return res.status(409).json({
      error: 'Your group is full. Raise the member limit or remove someone first.',
    })
  }

  await prisma.groupMembership.update({
    where: { id: membership.id },
    data: { status: 'ACTIVE', joinedAt: new Date() },
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.member.approved',
    resourceType: 'group_membership',
    resourceId: membership.id,
  })

  res.json({ approved: true })
}))

// Declining deletes the pending request, so the person can ask again later.
groupRouter.post('/:groupId/members/:membershipId/decline', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { membership } = await loadMembershipInGroup(req, res)
  if (!membership) return

  if (membership.status !== 'PENDING') {
    return res.status(400).json({ error: 'This request has already been handled.' })
  }

  await prisma.groupMembership.delete({ where: { id: membership.id } })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.member.declined',
    resourceType: 'group_membership',
    resourceId: membership.id,
  })

  res.json({ declined: true })
}))

groupRouter.post('/:groupId/members/:membershipId/remove', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { membership } = await loadMembershipInGroup(req, res)
  if (!membership) return

  if (membership.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Only active members can be removed.' })
  }

  await prisma.groupMembership.update({ where: { id: membership.id }, data: { status: 'REMOVED' } })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.member.removed',
    resourceType: 'group_membership',
    resourceId: membership.id,
  })

  res.json({ removed: true })
}))

// ---------------------------------------------------------------------------
// Facilitator: moderating messages and reports
// ---------------------------------------------------------------------------

async function loadMessageInGroup(req, res) {
  const group = await getOwnedGroup(req, res, req.params.groupId)
  if (!group) return {}
  const message = await prisma.groupMessage.findFirst({
    where: { id: req.params.messageId, groupId: group.id },
  })
  if (!message) {
    res.status(404).json({ error: 'Message not found.' })
    return {}
  }
  return { group, message }
}

// Hiding keeps the message for audit but removes its content from members.
// It also closes any open reports on that message.
groupRouter.post('/:groupId/messages/:messageId/hide', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { message } = await loadMessageInGroup(req, res)
  if (!message) return

  const now = new Date()
  await prisma.groupMessage.update({ where: { id: message.id }, data: { hidden: true, hiddenAt: now } })
  await prisma.groupReport.updateMany({
    where: { messageId: message.id, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: now },
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.message.hidden',
    resourceType: 'group_message',
    resourceId: message.id,
  })

  res.json({ hidden: true })
}))

groupRouter.post('/:groupId/messages/:messageId/unhide', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { message } = await loadMessageInGroup(req, res)
  if (!message) return

  await prisma.groupMessage.update({ where: { id: message.id }, data: { hidden: false, hiddenAt: null } })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.message.unhidden',
    resourceType: 'group_message',
    resourceId: message.id,
  })

  res.json({ hidden: false })
}))

// The facilitator has reviewed a flagged post and is satisfied.
groupRouter.post('/:groupId/messages/:messageId/clear-flag', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const { message } = await loadMessageInGroup(req, res)
  if (!message) return

  await prisma.groupMessage.update({ where: { id: message.id }, data: { flagged: false } })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.message.flag_cleared',
    resourceType: 'group_message',
    resourceId: message.id,
  })

  res.json({ flagged: false })
}))

groupRouter.get('/:groupId/reports', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  const group = await getOwnedGroup(req, res, req.params.groupId)
  if (!group) return

  const reports = await prisma.groupReport.findMany({
    where: { status: 'OPEN', message: { groupId: group.id } },
    include: {
      reporter: { select: { pseudonym: true } },
      message: {
        include: {
          membership: { select: { pseudonym: true, userId: true, user: { select: { fullName: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  res.json(
    reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      createdAt: report.createdAt,
      reporterPseudonym: report.reporter.pseudonym,
      message: {
        id: report.message.id,
        content: report.message.content,
        hidden: report.message.hidden,
        authorLabel: authorLabelFor(report.message),
        authorRealName: report.message.membership?.user?.fullName ?? 'Former member',
        createdAt: report.message.createdAt,
      },
    }))
  )
}))

groupRouter.post('/reports/:reportId/resolve', requireAuth, requireRole('professional'), wrap(async (req, res) => {
  if (!(await checkFacilitator(req, res))) return

  const report = await prisma.groupReport.findUnique({
    where: { id: req.params.reportId },
    include: { message: { include: { group: { select: { facilitatorId: true } } } } },
  })
  if (!report || report.message.group.facilitatorId !== req.auth.id) {
    return res.status(404).json({ error: 'Report not found.' })
  }

  await prisma.groupReport.update({
    where: { id: report.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  })

  await audit({
    actorType: 'professional',
    actorId: req.auth.id,
    action: 'group.report.resolved',
    resourceType: 'group_report',
    resourceId: report.id,
  })

  res.json({ resolved: true })
}))