const { z } = require('zod');
const prisma = require('../config/db');
const ApiError = require('../utils/apiError');
const slotService = require('../services/slot.service');
const llmService = require('../services/llm.service');
const emailService = require('../services/email.service');
const calendarService = require('../services/calendar.service');

async function searchDoctors(req, res) {
  const { specialisation, q } = req.query;
  const doctors = await prisma.doctorProfile.findMany({
    where: specialisation || q
      ? { specialisation: { contains: (specialisation || q), mode: 'insensitive' } }
      : undefined,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json({ doctors });
}

async function getDoctorSlots(req, res) {
  const { doctorId } = req.params;
  const { date } = req.query;
  if (!date) throw new ApiError(400, 'Query param "date" (YYYY-MM-DD) is required');

  const result = await slotService.getAvailableSlots(doctorId, date);
  res.json(result);
}

const holdSchema = z.object({
  doctorId: z.string(),
  slotStart: z.string(),
});

async function holdSlot(req, res) {
  const parsed = holdSchema.parse(req.body);
  const hold = await slotService.holdSlot(parsed.doctorId, parsed.slotStart, req.user.id);
  res.status(201).json({ holdId: hold.id, expiresAt: hold.expiresAt });
}

const confirmSchema = z.object({
  doctorId: z.string(),
  slotStart: z.string(),
  symptoms: z.string().min(3),
});

/**
 * Full booking confirmation flow:
 * 1. Generate pre-visit LLM summary from symptoms (never blocks on failure).
 * 2. Atomically convert the hold into a BOOKED appointment (double-booking safe).
 * 3. Best-effort: create Google Calendar events for patient & doctor.
 * 4. Best-effort: queue confirmation emails for patient & doctor (retried on failure).
 */
async function confirmBooking(req, res) {
  const parsed = confirmSchema.parse(req.body);

  const doctor = await prisma.doctorProfile.findUnique({ where: { id: parsed.doctorId }, include: { user: true } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const preVisitSummary = await llmService.generatePreVisitSummary(parsed.symptoms);

  const appointment = await slotService.confirmBooking({
    doctorId: parsed.doctorId,
    patientId: req.user.id,
    slotStartISO: parsed.slotStart,
    slotDurationMinutes: doctor.slotDurationMinutes,
    symptoms: parsed.symptoms,
    preVisitSummary,
    urgency: preVisitSummary.urgency,
  });

  const patient = await prisma.user.findUnique({ where: { id: req.user.id } });

  // Best-effort Google Calendar sync (never blocks the booking response).
  const [patientEventId, doctorEventId] = await Promise.all([
    calendarService.createEvent(patient.id, {
      summary: `Appointment with Dr. ${doctor.user.name}`,
      description: `Specialisation: ${doctor.specialisation}`,
      startISO: appointment.slotStart.toISOString(),
      endISO: appointment.slotEnd.toISOString(),
      attendeeEmail: doctor.user.email,
    }),
    calendarService.createEvent(doctor.userId, {
      summary: `Appointment with ${patient.name}`,
      description: `Chief complaint: ${preVisitSummary.chiefComplaint}`,
      startISO: appointment.slotStart.toISOString(),
      endISO: appointment.slotEnd.toISOString(),
      attendeeEmail: patient.email,
    }),
  ]);

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { googleEventIdPatient: patientEventId, googleEventIdDoctor: doctorEventId },
  });

  // Best-effort emails (queued + retried by email.service if they fail).
  await Promise.all([
    emailService.queueAndSend({
      appointmentId: appointment.id,
      recipientEmail: patient.email,
      type: 'BOOKING_CONFIRMATION',
      subject: 'Appointment confirmed',
      body: emailService.templates.bookingConfirmationHtml({
        recipientName: patient.name,
        doctorName: doctor.user.name,
        patientName: patient.name,
        slotStart: appointment.slotStart,
        role: 'patient',
      }),
    }),
    emailService.queueAndSend({
      appointmentId: appointment.id,
      recipientEmail: doctor.user.email,
      type: 'BOOKING_CONFIRMATION',
      subject: 'New appointment booked',
      body: emailService.templates.bookingConfirmationHtml({
        recipientName: doctor.user.name,
        doctorName: doctor.user.name,
        patientName: patient.name,
        slotStart: appointment.slotStart,
        role: 'doctor',
      }),
    }),
  ]);

  res.status(201).json({ appointment: updated, preVisitSummary });
}

async function myAppointments(req, res) {
  const appointments = await prisma.appointment.findMany({
    where: { patientId: req.user.id },
    include: { doctor: { include: { user: true } } },
    orderBy: { slotStart: 'desc' },
  });
  res.json({ appointments });
}

async function cancelAppointment(req, res) {
  const { id } = req.params;
  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { doctor: { include: { user: true } }, patient: true } });
  if (!appointment || appointment.patientId !== req.user.id) throw new ApiError(404, 'Appointment not found');
  if (appointment.status !== 'BOOKED') throw new ApiError(400, 'Only booked appointments can be cancelled');

  const updated = await slotService.cancelAppointment(id);

  await Promise.all([
    calendarService.deleteEvent(appointment.patientId, appointment.googleEventIdPatient),
    calendarService.deleteEvent(appointment.doctor.userId, appointment.googleEventIdDoctor),
  ]);

  await Promise.all([
    emailService.queueAndSend({
      appointmentId: id,
      recipientEmail: appointment.patient.email,
      type: 'CANCELLATION',
      subject: 'Appointment cancelled',
      body: emailService.templates.cancellationHtml({
        recipientName: appointment.patient.name,
        doctorName: appointment.doctor.user.name,
        patientName: appointment.patient.name,
        slotStart: appointment.slotStart,
        role: 'patient',
      }),
    }),
    emailService.queueAndSend({
      appointmentId: id,
      recipientEmail: appointment.doctor.user.email,
      type: 'CANCELLATION',
      subject: 'Appointment cancelled by patient',
      body: emailService.templates.cancellationHtml({
        recipientName: appointment.doctor.user.name,
        doctorName: appointment.doctor.user.name,
        patientName: appointment.patient.name,
        slotStart: appointment.slotStart,
        role: 'doctor',
      }),
    }),
  ]);

  res.json({ appointment: updated });
}

module.exports = {
  searchDoctors,
  getDoctorSlots,
  holdSlot,
  confirmBooking,
  myAppointments,
  cancelAppointment,
};
