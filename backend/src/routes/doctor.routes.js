const express = require('express');
const doctorController = require('../controllers/doctor.controller');
const calendarController = require('../controllers/calendar.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/roleCheck');

const router = express.Router();

// NOTE: Doctors also use /api/patient/google/callback as the OAuth
// redirect target (single registered redirect URI, shared controller).
// See .env.example for details.
router.get('/profile', authenticate, requireRole('DOCTOR'), doctorController.getMyProfile);
router.get('/appointments', authenticate, requireRole('DOCTOR'), doctorController.myAppointments);
router.post('/appointments/:id/complete', authenticate, requireRole('DOCTOR'), doctorController.completeAppointment);
router.get('/google/auth-url', authenticate, requireRole('DOCTOR'), calendarController.getAuthUrl);

module.exports = router;
