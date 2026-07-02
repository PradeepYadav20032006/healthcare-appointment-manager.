const express = require('express');
const adminController = require('../controllers/admin.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/roleCheck');

const router = express.Router();
router.use(authenticate, requireRole('ADMIN'));

router.post('/doctors', adminController.createDoctor);
router.get('/doctors', adminController.listDoctors);
router.put('/doctors/:id', adminController.updateDoctor);

router.post('/doctors/:id/leave', adminController.addLeaveDay);
router.delete('/doctors/:id/leave/:leaveId', adminController.removeLeaveDay);

router.get('/appointments', adminController.listAppointments);

module.exports = router;
