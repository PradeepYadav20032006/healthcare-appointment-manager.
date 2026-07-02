const prisma = require('../config/db');
const emailService = require('./email.service');
const logger = require('../utils/logger');

/**
 * Called once, right after the doctor submits a prescription. Creates one
 * MedicationReminder row per prescribed medication, storing its daily
 * schedule times so the background job (reminderJob) can pick it up.
 */
async function createRemindersForPrescription(appointmentId, prescription) {
  if (!Array.isArray(prescription) || prescription.length === 0) return [];

  const startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);

  const created = [];
  for (const item of prescription) {
    const durationDays = Number(item.durationDays) || 5;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60000);
    const times = Array.isArray(item.times) && item.times.length > 0
      ? item.times
      : defaultTimesForFrequency(Number(item.frequencyPerDay) || 1);

    // eslint-disable-next-line no-await-in-loop
    const reminder = await prisma.medicationReminder.create({
      data: {
        appointmentId,
        medicationName: item.name,
        dosage: item.dosage || null,
        scheduleTimes: times,
        startDate,
        endDate,
      },
    });
    created.push(reminder);
  }
  return created;
}

function defaultTimesForFrequency(n) {
  if (n <= 1) return ['09:00'];
  if (n === 2) return ['09:00', '21:00'];
  if (n === 3) return ['08:00', '14:00', '21:00'];
  return ['08:00', '12:00', '16:00', '21:00'];
}

/**
 * Runs on every cron tick (see jobs/reminderJob.js). For each active
 * reminder whose schedule includes a time matching "now" (within the
 * job's polling window) and that hasn't already been sent today, queue a
 * medication reminder email. lastSentDate prevents duplicate sends within
 * the same day even if the job runs more than once.
 */
async function dispatchDueReminders() {
  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setUTCHours(0, 0, 0, 0);
  const currentHHMM = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

  const reminders = await prisma.medicationReminder.findMany({
    where: {
      active: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: { appointment: { include: { patient: true } } },
  });

  let sent = 0;
  for (const reminder of reminders) {
    const alreadySentToday = reminder.lastSentDate && reminder.lastSentDate.getTime() === todayMidnight.getTime();
    if (alreadySentToday) continue;

    const times = reminder.scheduleTimes || [];
    const isDue = times.some((t) => withinWindow(t, currentHHMM, 15));
    if (!isDue) continue;

    const patient = reminder.appointment.patient;
    try {
      // eslint-disable-next-line no-await-in-loop
      await emailService.queueAndSend({
        appointmentId: reminder.appointmentId,
        recipientEmail: patient.email,
        type: 'MEDICATION_REMINDER',
        subject: `Medication reminder: ${reminder.medicationName}`,
        body: emailService.templates.medicationReminderHtml({
          recipientName: patient.name,
          medicationName: reminder.medicationName,
          dosage: reminder.dosage,
          time: times.find((t) => withinWindow(t, currentHHMM, 15)),
        }),
      });
      // eslint-disable-next-line no-await-in-loop
      await prisma.medicationReminder.update({
        where: { id: reminder.id },
        data: { lastSentDate: todayMidnight },
      });
      sent += 1;
    } catch (err) {
      logger.warn(`Failed to dispatch medication reminder ${reminder.id}:`, err.message);
    }
  }
  return sent;
}

function withinWindow(scheduledHHMM, currentHHMM, windowMinutes) {
  const [sh, sm] = scheduledHHMM.split(':').map(Number);
  const [ch, cm] = currentHHMM.split(':').map(Number);
  const scheduledMinutes = sh * 60 + sm;
  const currentMinutes = ch * 60 + cm;
  return Math.abs(currentMinutes - scheduledMinutes) <= windowMinutes;
}

module.exports = { createRemindersForPrescription, dispatchDueReminders };
