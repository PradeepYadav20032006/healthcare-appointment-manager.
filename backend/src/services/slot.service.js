const prisma = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/apiError');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function activeSlotKeyFor(doctorId, slotStart) {
  return `${doctorId}|${slotStart.toISOString()}`;
}

/**
 * Generates candidate slot start times for a doctor on a given date,
 * based on their workingHours JSON and slotDurationMinutes, then filters
 * out slots that are already booked, currently held by someone else, or
 * fall on a leave day.
 */
async function getAvailableSlots(doctorId, dateStr) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const dayKey = DAY_KEYS[date.getUTCDay()];
  const ranges = (doctor.workingHours || {})[dayKey] || [];

  if (ranges.length === 0) return { slots: [], onLeave: false };

  const leave = await prisma.leaveDay.findUnique({
    where: { doctorId_date: { doctorId, date } },
  });
  if (leave) return { slots: [], onLeave: true, reason: leave.reason };

  const candidateSlots = [];
  for (const range of ranges) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    let cursor = new Date(date);
    cursor.setUTCHours(startH, startM, 0, 0);
    const end = new Date(date);
    end.setUTCHours(endH, endM, 0, 0);

    while (cursor.getTime() + doctor.slotDurationMinutes * 60000 <= end.getTime()) {
      candidateSlots.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + doctor.slotDurationMinutes * 60000);
    }
  }

  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const [booked, holds] = await Promise.all([
    prisma.appointment.findMany({
      where: { doctorId, status: 'BOOKED', slotStart: { gte: date, lte: dayEnd } },
      select: { slotStart: true },
    }),
    prisma.slotHold.findMany({
      where: { doctorId, slotStart: { gte: date, lte: dayEnd }, expiresAt: { gt: new Date() } },
      select: { slotStart: true },
    }),
  ]);

  const takenTimes = new Set([
    ...booked.map((b) => b.slotStart.getTime()),
    ...holds.map((h) => h.slotStart.getTime()),
  ]);

  const now = new Date();
  const slots = candidateSlots
    .filter((s) => s.getTime() > now.getTime())
    .filter((s) => !takenTimes.has(s.getTime()))
    .map((s) => ({ slotStart: s.toISOString(), slotEnd: new Date(s.getTime() + doctor.slotDurationMinutes * 60000).toISOString() }));

  return { slots, onLeave: false, slotDurationMinutes: doctor.slotDurationMinutes };
}

/**
 * Step 1 of booking: place a short-lived hold on a slot while the patient
 * fills the symptom form. The unique (doctorId, slotStart) constraint on
 * SlotHold means a concurrent second patient cannot also hold the same
 * slot - the DB rejects the second insert.
 */
async function holdSlot(doctorId, slotStartISO, patientId) {
  const slotStart = new Date(slotStartISO);
  const expiresAt = new Date(Date.now() + env.slotHoldTtlMinutes * 60000);

  await releaseExpiredHolds();

  const existingBooking = await prisma.appointment.findFirst({
    where: { doctorId, slotStart, status: 'BOOKED' },
  });
  if (existingBooking) throw new ApiError(409, 'This slot has just been booked by someone else. Please choose another.');

  try {
    const hold = await prisma.slotHold.create({
      data: { doctorId, slotStart, patientId, expiresAt },
    });
    return hold;
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'This slot is currently being booked by another patient. Please choose another or try again shortly.');
    }
    throw err;
  }
}

async function releaseExpiredHolds() {
  await prisma.slotHold.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

/**
 * Step 2 of booking: convert a hold into a confirmed Appointment inside a
 * single DB transaction. The unique `activeSlotKey` column (doctorId +
 * slotStart, only set while status = BOOKED) is the real double-booking
 * guard: even if two requests race past the hold check, only one INSERT
 * with a given activeSlotKey can succeed. See SYSTEM_DESIGN.md.
 */
async function confirmBooking({ doctorId, patientId, slotStartISO, slotDurationMinutes, symptoms, preVisitSummary, urgency }) {
  const slotStart = new Date(slotStartISO);
  const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60000);
  const key = activeSlotKeyFor(doctorId, slotStart);

  return prisma.$transaction(async (tx) => {
    const hold = await tx.slotHold.findUnique({ where: { doctorId_slotStart: { doctorId, slotStart } } });
    if (!hold || hold.patientId !== patientId || hold.expiresAt < new Date()) {
      throw new ApiError(409, 'Your hold on this slot has expired. Please select the slot again.');
    }

    let appointment;
    try {
      appointment = await tx.appointment.create({
        data: {
          doctorId,
          patientId,
          slotStart,
          slotEnd,
          status: 'BOOKED',
          activeSlotKey: key,
          symptoms,
          preVisitSummary,
          urgency,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        throw new ApiError(409, 'This slot was just booked by someone else. Please choose another.');
      }
      throw err;
    }

    await tx.slotHold.delete({ where: { id: hold.id } });
    return appointment;
  });
}

async function cancelAppointment(appointmentId) {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED', activeSlotKey: null },
  });
}

module.exports = {
  getAvailableSlots,
  holdSlot,
  releaseExpiredHolds,
  confirmBooking,
  cancelAppointment,
  activeSlotKeyFor,
};
