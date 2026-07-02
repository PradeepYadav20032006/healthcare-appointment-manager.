const nodemailer = require('nodemailer');
const env = require('../config/env');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 5;

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) {
    logger.warn('SMTP not configured - emails will be queued but marked FAILED until configured.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

/**
 * Every outbound email is first persisted as a Notification row (status
 * PENDING), then an immediate send is attempted. If the send fails
 * (SMTP down, transient network error, etc.) the row is marked FAILED
 * with the error message, and a background job (emailRetryJob) retries
 * it with backoff until MAX_ATTEMPTS is reached. This means a transient
 * email-provider outage can never silently lose a notification.
 */
async function queueAndSend({ appointmentId = null, recipientEmail, type, subject, body }) {
  const notification = await prisma.notification.create({
    data: { appointmentId, recipientEmail, type, subject, body, status: 'PENDING' },
  });

  await attemptSend(notification.id);
  return notification;
}

async function attemptSend(notificationId) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.status === 'SENT') return;

  const t = getTransporter();

  try {
    if (!t) throw new Error('SMTP transporter not configured');

    await t.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: notification.recipientEmail,
      subject: notification.subject,
      html: notification.body,
    });

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
    });
  } catch (err) {
    logger.warn(`Email send failed (attempt ${notification.attempts + 1}) for ${notification.recipientEmail}:`, err.message);
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: err.message,
      },
    });
  }
}

/**
 * Called periodically by the email retry cron job. Retries FAILED
 * notifications that haven't exhausted MAX_ATTEMPTS yet.
 */
async function retryFailedNotifications() {
  const failed = await prisma.notification.findMany({
    where: { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
    take: 50,
  });

  for (const n of failed) {
    // eslint-disable-next-line no-await-in-loop
    await attemptSend(n.id);
  }

  return failed.length;
}

// ---- Templated helpers used by controllers ----

function bookingConfirmationHtml({ recipientName, doctorName, patientName, slotStart, role }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  return `<p>Hi ${recipientName},</p>
    <p>${role === 'doctor' ? `A new appointment has been booked with you by <b>${patientName}</b>.` : `Your appointment with <b>Dr. ${doctorName}</b> is confirmed.`}</p>
    <p><b>When:</b> ${when}</p>
    <p>You will also see this on your Google Calendar. See you then!</p>`;
}

function cancellationHtml({ recipientName, doctorName, patientName, slotStart, role, reason }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  return `<p>Hi ${recipientName},</p>
    <p>${role === 'doctor' ? `Your appointment with ${patientName}` : `Your appointment with Dr. ${doctorName}`} on <b>${when}</b> has been cancelled.</p>
    ${reason ? `<p>Reason: ${reason}</p>` : ''}
    <p>Please book a new slot at your convenience.</p>`;
}

function reminderHtml({ recipientName, doctorName, slotStart }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  return `<p>Hi ${recipientName},</p>
    <p>This is a reminder of your upcoming appointment with Dr. ${doctorName} on <b>${when}</b>.</p>`;
}

function medicationReminderHtml({ recipientName, medicationName, dosage, time }) {
  return `<p>Hi ${recipientName},</p>
    <p>It's time to take your medication: <b>${medicationName}${dosage ? ` (${dosage})` : ''}</b> — scheduled for ${time}.</p>`;
}

module.exports = {
  queueAndSend,
  attemptSend,
  retryFailedNotifications,
  templates: {
    bookingConfirmationHtml,
    cancellationHtml,
    reminderHtml,
    medicationReminderHtml,
  },
  MAX_ATTEMPTS,
};
