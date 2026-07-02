const express = require('express');
const patientController = require('../controllers/patient.controller');
const calendarController = require('../controllers/calendar.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/roleCheck');

const router = express.Router();

// Doctor search & slot lookup are useful while logged in as a patient.
router.get('/doctors', authenticate, requireRole('PATIENT'), patientController.searchDoctors);
router.get('/doctors/:doctorId/slots', authenticate, requireRole('PATIENT'), patientController.getDoctorSlots);

router.post('/appointments/hold', authenticate, requireRole('PATIENT'), patientController.holdSlot);
router.post('/appointments/confirm', authenticate, requireRole('PATIENT'), patientController.confirmBooking);
router.get('/appointments', authenticate, requireRole('PATIENT'), patientController.myAppointments);
router.post('/appointments/:id/cancel', authenticate, requireRole('PATIENT'), patientController.cancelAppointment);

router.get('/google/auth-url', authenticate, requireRole('PATIENT'), calendarController.getAuthUrl);
// No auth middleware: Google redirects the browser here directly (state carries the userId).
router.get('/google/callback', calendarController.callback);

module.exports = router;
