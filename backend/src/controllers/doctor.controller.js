const { z } = require('zod');
const prisma = require('../config/db');
const ApiError = require('../utils/apiError');
const llmService = require('../services/llm.service');
const emailService = require('../services/email.service');
const reminderService = require('../services/reminder.service');

async function getMyProfile(req, res) {
  const profile = await prisma.doctorProfile.findUnique({
    where: { userId: req.user.id },
    include: { user: true, leaveDays: true },
  });
  if (!profile) throw new ApiError(404, 'Doctor profile not found');
  res.json({ doctor: profile });
}

async function myAppointments(req, res) {
  const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) throw new ApiError(404, 'Doctor profile not found');

  const appointments = await prisma.appointment.findMany({
    where: { doctorId: profile.id },
    include: { patient: true },
    orderBy: { slotStart: 'desc' },
  });
  res.json({ appointments });
}

const prescriptionItemSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().optional(),
  frequencyPerDay: z.number().int().positive().default(1),
  durationDays: z.number().int().positive().default(5),
  times: z.array(z.string()).optional(),
});

const completeSchema = z.object({
  notes: z.string().min(3),
  prescription: z.array(prescriptionItemSchema).default([]),
});

/**
 * Doctor submits post-visit notes + prescription. Generates a
 * patient-friendly LLM summary (gracefully falls back on LLM failure),
 * creates medication reminders, marks the appointment COMPLETED, and
 * emails the patient their summary.
 */
async function completeAppointment(req, res) {
  const { id } = req.params;
  const parsed = completeSchema.parse(req.body);

  const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) throw new ApiError(404, 'Doctor profile not found');

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { patient: true } });
  if (!appointment || appointment.doctorId !== profile.id) throw new ApiError(404, 'Appointment not found');
  if (appointment.status !== 'BOOKED') throw new ApiError(400, 'Only booked appointments can be completed');

  const postVisitSummary = await llmService.generatePostVisitSummary(parsed.notes, parsed.prescription);

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      doctorNotes: parsed.notes,
      prescription: parsed.prescription,
      postVisitSummary: postVisitSummary.text,
      activeSlotKey: null,
    },
  });

  await reminderService.createRemindersForPrescription(id, parsed.prescription);

  await emailService.queueAndSend({
    appointmentId: id,
    recipientEmail: appointment.patient.email,
    type: 'BOOKING_CONFIRMATION',
    subject: 'Your visit summary is ready',
    body: `<p>Hi ${appointment.patient.name},</p><p>${postVisitSummary.text.replace(/\n/g, '<br/>')}</p>`,
  });

  res.json({ appointment: updated, postVisitSummary });
}

module.exports = { getMyProfile, myAppointments, completeAppointment };
