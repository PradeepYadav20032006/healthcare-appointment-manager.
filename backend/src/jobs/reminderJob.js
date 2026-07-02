const cron = require('node-cron');
const prisma = require('../config/db');
const emailService = require('../services/email.service');
const reminderService = require('../services/reminder.service');
const slotService = require('../services/slot.service');
const logger = require('../utils/logger');

/**
 * Sends a one-time appointment reminder email ~24h before each BOOKED
 * appointment. reminderSentAt guards against duplicate sends across
 * multiple cron ticks.
 */
async function sendUpcomingAppointmentReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60000);

  const due = await prisma.appointment.findMany({
    where: {
      status: 'BOOKED',
      slotStart: { gte: windowStart, lte: windowEnd },
      reminderSentAt: null,
    },
    include: { patient: true, doctor: { include: { user: true } } },
  });

  for (const appt of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await emailService.queueAndSend({
        appointmentId: appt.id,
        recipientEmail: appt.patient.email,
        type: 'REMINDER',
        subject: 'Appointment reminder',
        body: emailService.templates.reminderHtml({
          recipientName: appt.patient.name,
          doctorName: appt.doctor.user.name,
          slotStart: appt.slotStart,
        }),
      });
      // eslint-disable-next-line no-await-in-loop
      await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
    } catch (err) {
      logger.warn(`Failed to send reminder for appointment ${appt.id}:`, err.message);
    }
  }

  if (due.length) logger.info(`Sent ${due.length} appointment reminder(s).`);
}

function start() {
  // Every 15 minutes: appointment reminders + medication reminders.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await sendUpcomingAppointmentReminders();
      const medsSent = await reminderService.dispatchDueReminders();
      if (medsSent) logger.info(`Dispatched ${medsSent} medication reminder(s).`);
    } catch (err) {
      logger.error('reminderJob tick failed:', err.message);
    }
  });

  // Every minute: release expired slot holds so slots free up quickly.
  cron.schedule('* * * * *', async () => {
    try {
      await slotService.releaseExpiredHolds();
    } catch (err) {
      logger.error('slot hold cleanup failed:', err.message);
    }
  });

  logger.info('Reminder cron jobs started.');
}

module.exports = { start, sendUpcomingAppointmentReminders };
