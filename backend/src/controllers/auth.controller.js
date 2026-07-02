const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/apiError');

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  // Only PATIENT can self-register. Doctor/Admin accounts are created by an admin.
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function toPublicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

async function register(req, res) {
  const parsed = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new ApiError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(parsed.password, 10);
  const user = await prisma.user.create({
    data: {
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      passwordHash,
      role: 'PATIENT',
    },
  });

  const token = signToken(user);
  res.status(201).json({ token, user: toPublicUser(user) });
}

async function login(req, res) {
  const parsed = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(parsed.password, user.passwordHash);
  if (!valid) throw new ApiError(401, 'Invalid email or password');

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { doctorProfile: true },
  });
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ user: toPublicUser(user) });
}

module.exports = { register, login, me, signToken, toPublicUser };
