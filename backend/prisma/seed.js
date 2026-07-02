/* eslint-disable no-console */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@clinic.example.com' },
    update: {},
    create: {
      name: 'Clinic Admin',
      email: 'admin@clinic.example.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
    },
  });
  console.log('Admin ready:', admin.email, '(password: Admin@123)');

  const docPassword = await bcrypt.hash('Doctor@123', 10);
  const doctorUser = await prisma.user.upsert({
    where: { email: 'dr.sharma@clinic.example.com' },
    update: {},
    create: {
      name: 'Dr. Anjali Sharma',
      email: 'dr.sharma@clinic.example.com',
      passwordHash: docPassword,
      role: 'DOCTOR',
    },
  });

  const doctorProfile = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      specialisation: 'General Medicine',
      slotDurationMinutes: 30,
      bio: 'MBBS, MD - 10 years of experience in general medicine.',
      workingHours: {
        mon: [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '20:00' }],
        tue: [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '20:00' }],
        wed: [{ start: '09:00', end: '13:00' }],
        thu: [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '20:00' }],
        fri: [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '20:00' }],
        sat: [{ start: '10:00', end: '14:00' }],
        sun: [],
      },
    },
  });
  console.log('Doctor ready:', doctorUser.email, '(password: Doctor@123)', '- profile id:', doctorProfile.id);

  const patientPassword = await bcrypt.hash('Patient@123', 10);
  const patient = await prisma.user.upsert({
    where: { email: 'patient@example.com' },
    update: {},
    create: {
      name: 'Rahul Verma',
      email: 'patient@example.com',
      passwordHash: patientPassword,
      role: 'PATIENT',
    },
  });
  console.log('Patient ready:', patient.email, '(password: Patient@123)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
