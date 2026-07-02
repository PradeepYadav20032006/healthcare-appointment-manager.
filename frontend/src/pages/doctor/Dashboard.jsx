import { useEffect, useState } from 'react';
import { doctorApi } from '../../api';
import AppointmentCard from '../../components/AppointmentCard';
import CompleteVisitForm from './CompleteVisitForm';

export default function Dashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await doctorApi.myAppointments();
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

  const handleConnectCalendar = async () => {
    try {
      const { url } = await doctorApi.googleAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  };

  const upcoming = appointments.filter((a) => a.status === 'BOOKED');
  const past = appointments.filter((a) => a.status !== 'BOOKED');

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>My appointments</h1>
        <button className="btn btn-ghost" onClick={handleConnectCalendar}>📅 Connect Google Calendar</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      <h2 className="section-heading">Upcoming</h2>
      <div className="stack">
        {upcoming.map((appt) => (
          <div key={appt.id}>
            <AppointmentCard appointment={appt}>
              <button className="btn btn-primary" onClick={() => setActiveId(activeId === appt.id ? null : appt.id)}>
                {activeId === appt.id ? 'Close' : 'Complete visit'}
              </button>
            </AppointmentCard>
            {activeId === appt.id && (
              <CompleteVisitForm
                appointmentId={appt.id}
                onDone={() => {
                  setActiveId(null);
                  load();
                }}
              />
            )}
          </div>
        ))}
        {!loading && upcoming.length === 0 && <p className="muted">No upcoming appointments.</p>}
      </div>

      <h2 className="section-heading">Past</h2>
      <div className="stack">
        {past.map((appt) => (
          <AppointmentCard key={appt.id} appointment={appt} />
        ))}
      </div>
    </div>
  );
}
