require('express-async-errors');
const express = require('express');
const cors = require('cors');
const { ZodError } = require('zod');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const patientRoutes = require('./routes/patient.routes');
const doctorRoutes = require('./routes/doctor.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const ApiError = require('./utils/apiError');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);

// Convert Zod validation errors into clean 400 responses.
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return next(new ApiError(400, 'Validation failed', err.issues));
  }
  return next(err);
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
