import { useEffect, useState } from 'react';
import { patientApi } from '../../api';
import AppointmentCard from '../../components/AppointmentCard';

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await patientApi.myAppointments();
      setAppointments(data.appointments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async (id) => {
    if (!confirm('Cancel this appointment?')) return;
    setBusyId(id);
    try {
      await patientApi.cancelAppointment(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleConnectCalendar = async () => {
    try {
      const { url } = await patientApi.googleAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>My appointments</h1>
        <button className="btn btn-ghost" onClick={handleConnectCalendar}>📅 Connect Google Calendar</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      <div className="stack">
        {appointments.map((appt) => (
          <AppointmentCard key={appt.id} appointment={appt}>
            {appt.status === 'BOOKED' && (
              <button className="btn btn-danger" disabled={busyId === appt.id} onClick={() => handleCancel(appt.id)}>
                {busyId === appt.id ? 'Cancelling...' : 'Cancel appointment'}
              </button>
            )}
          </AppointmentCard>
        ))}
        {!loading && appointments.length === 0 && <p className="muted">You have no appointments yet.</p>}
      </div>
    </div>
  );
}
