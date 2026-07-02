import client from './client';

export const authApi = {
  register: (data) => client.post('/auth/register', data).then((r) => r.data),
  login: (data) => client.post('/auth/login', data).then((r) => r.data),
  me: () => client.get('/auth/me').then((r) => r.data),
};

export const patientApi = {
  searchDoctors: (q) => client.get('/patient/doctors', { params: { q } }).then((r) => r.data),
  getSlots: (doctorId, date) => client.get(`/patient/doctors/${doctorId}/slots`, { params: { date } }).then((r) => r.data),
  holdSlot: (doctorId, slotStart) => client.post('/patient/appointments/hold', { doctorId, slotStart }).then((r) => r.data),
  confirmBooking: (doctorId, slotStart, symptoms) =>
    client.post('/patient/appointments/confirm', { doctorId, slotStart, symptoms }).then((r) => r.data),
  myAppointments: () => client.get('/patient/appointments').then((r) => r.data),
  cancelAppointment: (id) => client.post(`/patient/appointments/${id}/cancel`).then((r) => r.data),
  googleAuthUrl: () => client.get('/patient/google/auth-url').then((r) => r.data),
};

export const doctorApi = {
  myProfile: () => client.get('/doctor/profile').then((r) => r.data),
  myAppointments: () => client.get('/doctor/appointments').then((r) => r.data),
  completeAppointment: (id, notes, prescription) =>
    client.post(`/doctor/appointments/${id}/complete`, { notes, prescription }).then((r) => r.data),
  googleAuthUrl: () => client.get('/doctor/google/auth-url').then((r) => r.data),
};

export const adminApi = {
  listDoctors: () => client.get('/admin/doctors').then((r) => r.data),
  createDoctor: (data) => client.post('/admin/doctors', data).then((r) => r.data),
  updateDoctor: (id, data) => client.put(`/admin/doctors/${id}`, data).then((r) => r.data),
  addLeave: (doctorId, date, reason) => client.post(`/admin/doctors/${doctorId}/leave`, { date, reason }).then((r) => r.data),
  removeLeave: (doctorId, leaveId) => client.delete(`/admin/doctors/${doctorId}/leave/${leaveId}`).then((r) => r.data),
  listAppointments: () => client.get('/admin/appointments').then((r) => r.data),
};
