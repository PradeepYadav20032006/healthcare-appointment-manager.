import { useEffect, useState } from 'react';
import { adminApi } from '../../api';
import AppointmentCard from '../../components/AppointmentCard';

export default function AllAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi
      .listAppointments()
      .then((data) => setAppointments(data.appointments))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <h1>All appointments</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}
      <div className="stack">
        {appointments.map((appt) => (
          <AppointmentCard key={appt.id} appointment={appt} />
        ))}
        {!loading && appointments.length === 0 && <p className="muted">No appointments yet.</p>}
      </div>
    </div>
  );
}
