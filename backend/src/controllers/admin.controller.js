const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/db');
const ApiError = require('../utils/apiError');
const emailService = require('../services/email.service');
const calendarService = require('../services/calendar.service');

const workingHoursSchema = z.record(
  z.array(z.object({ start: z.string(), end: z.string() }))
); // e.g. { mon: [{start:"09:00", end:"13:00"}], ... }

const createDoctorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  specialisation: z.string().min(2),
  slotDurationMinutes: z.number().int().positive().default(30),
  workingHours: workingHoursSchema,
  bio: z.string().optional(),
});

const updateDoctorSchema = z.object({
  specialisation: z.string().min(2).optional(),
  slotDurationMinutes: z.number().int().positive().optional(),
  workingHours: workingHoursSchema.optional(),
  bio: z.string().optional(),
});

const leaveSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  reason: z.string().optional(),
});

async function createDoctor(req, res) {
  const parsed = createDoctorSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new ApiError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(parsed.password, 10);

  const doctorProfile = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        passwordHash,
        role: 'DOCTOR',
      },
    });
    return tx.doctorProfile.create({
      data: {
        userId: user.id,
        specialisation: parsed.specialisation,
        slotDurationMinutes: parsed.slotDurationMinutes,
        workingHours: parsed.workingHours,
        bio: parsed.bio,
      },
      include: { user: true },
    });
  });

  res.status(201).json({ doctor: doctorProfile });
}

async function listDoctors(req, res) {
  const doctors = await prisma.doctorProfile.findMany({
    include: { user: true, leaveDays: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ doctors });
}

async function updateDoctor(req, res) {
  const { id } = req.params;
  const parsed = updateDoctorSchema.parse(req.body);

  const doctor = await prisma.doctorProfile.findUnique({ where: { id } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const updated = await prisma.doctorProfile.update({
    where: { id },
    data: parsed,
    include: { user: true },
  });
  res.json({ doctor: updated });
}

/**
 * Marks a doctor on leave for a date. Any BOOKED appointments that day are
 * cancelled, their Google Calendar events removed, and both the patient and
 * doctor are notified by email - this is the "leave conflict" handling
 * called out in the assignment brief.
 */
async function addLeaveDay(req, res) {
  const { id } = req.params;
  const parsed = leaveSchema.parse(req.body);
  const date = new Date(`${parsed.date}T00:00:00.000Z`);

  const doctor = await prisma.doctorProfile.findUnique({ where: { id }, include: { user: true } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const existingLeave = await prisma.leaveDay.findUnique({ where: { doctorId_date: { doctorId: id, date } } });
  if (existingLeave) throw new ApiError(409, 'Leave already recorded for this date');

  const leave = await prisma.leaveDay.create({ data: { doctorId: id, date, reason: parsed.reason } });

  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const affected = await prisma.appointment.findMany({
    where: { doctorId: id, status: 'BOOKED', slotStart: { gte: date, lte: dayEnd } },
    include: { patient: true },
  });

  const notified = [];
  for (const appt of affected) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CANCELLED', activeSlotKey: null },
    });

    // eslint-disable-next-line no-await-in-loop
    await Promise.all([
      calendarService.deleteEvent(appt.patientId, appt.googleEventIdPatient),
      calendarService.deleteEvent(doctor.userId, appt.googleEventIdDoctor),
    ]);

    // eslint-disable-next-line no-await-in-loop
    await emailService.queueAndSend({
      appointmentId: appt.id,
      recipientEmail: appt.patient.email,
      type: 'LEAVE_CONFLICT',
      subject: 'Your appointment has been cancelled - doctor on leave',
      body: emailService.templates.cancellationHtml({
        recipientName: appt.patient.name,
        doctorName: doctor.user.name,
        patientName: appt.patient.name,
        slotStart: appt.slotStart,
        role: 'patient',
        reason: parsed.reason ? `Dr. ${doctor.user.name} is on leave (${parsed.reason}). Please rebook.` : `Dr. ${doctor.user.name} is on leave that day. Please rebook.`,
      }),
    });

    notified.push(appt.patient.email);
  }

  res.status(201).json({ leave, cancelledAppointments: affected.length, notifiedPatients: notified });
}

async function removeLeaveDay(req, res) {
  const { leaveId } = req.params;
  await prisma.leaveDay.delete({ where: { id: leaveId } });
  res.status(204).send();
}

async function listAppointments(req, res) {
  const appointments = await prisma.appointment.findMany({
    include: { patient: true, doctor: { include: { user: true } } },
    orderBy: { slotStart: 'desc' },
    take: 200,
  });
  res.json({ appointments });
}

module.exports = { createDoctor, listDoctors, updateDoctor, addLeaveDay, removeLeaveDay, listAppointments };
