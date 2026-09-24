import { prisma } from '../lib/prisma.js'
import { sendAppointmentReminderEmail } from '../lib/email.js'

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // every 10 minutes
const REMINDER_WINDOW_HOURS = 24

// Finds SCHEDULED appointments entering their 24-hour reminder window that
// haven't already been reminded, and emails each patient once. Runs inside
// the same process rather than a separate job queue — appropriate for this
// stage (single server instance, no deployed infrastructure for a real job
// runner yet). Revisit this if/when the backend runs on multiple instances,
// since two instances would each try to send the same reminders.
async function checkAndSendReminders() {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000)

  const dueAppointments = await prisma.appointment.findMany({
    where: {
      status: 'SCHEDULED',
      reminderSentAt: null,
      scheduledFor: { gt: now, lte: windowEnd },
    },
    include: { user: true, professional: true },
  })

  for (const appt of dueAppointments) {
    try {
      await sendAppointmentReminderEmail(appt.user.email, {
        professionalName: appt.professional.fullName,
        scheduledFor: appt.scheduledFor,
        type: appt.type,
        meetingUrl: appt.meetingUrl,
      })
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      })
      console.log(`[reminders] sent for appointment ${appt.id}`)
    } catch (err) {
      // One failed email shouldn't stop the rest from sending — log and
      // move on; reminderSentAt stays null so it'll be retried next check.
      console.error(`[reminders] failed for appointment ${appt.id}:`, err)
    }
  }
}

export function startAppointmentReminderJob() {
  // Run once shortly after startup, then on the regular interval.
  setTimeout(checkAndSendReminders, 10 * 1000)
  setInterval(checkAndSendReminders, CHECK_INTERVAL_MS)
  console.log('[reminders] appointment reminder job started')
}