import { useEffect, useState } from 'react';
import { adminApi } from '../../api';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function emptyWorkingHours() {
  return DAYS.reduce((acc, d) => ({ ...acc, [d.key]: [] }), {});
}

function CreateDoctorForm({ onCreated }) {
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', specialisation: '', slotDurationMinutes: 30, bio: '',
  });
  const [hours, setHours] = useState(emptyWorkingHours());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleDay = (dayKey) => {
    setHours((prev) => ({
      ...prev,
      [dayKey]: prev[dayKey].length ? [] : [{ start: '09:00', end: '17:00' }],
    }));
  };

  const updateRange = (dayKey, field, value) => {
    setHours((prev) => ({
      ...prev,
      [dayKey]: [{ ...prev[dayKey][0], [field]: value }],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await adminApi.createDoctor({
        ...form,
        slotDurationMinutes: Number(form.slotDurationMinutes),
        workingHours: hours,
      });
      setForm({ name: '', email: '', password: '', phone: '', specialisation: '', slotDurationMinutes: 30, bio: '' });
      setHours(emptyWorkingHours());
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h3>Add a doctor</h3>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-grid-2">
        <div>
          <label>Full name</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label>Specialisation</label>
          <input required value={form.specialisation} onChange={(e) => setForm({ ...form, specialisation: e.target.value })} />
        </div>
        <div>
          <label>Email</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label>Temporary password</label>
          <input type="text" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div>
          <label>Phone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label>Slot duration (minutes)</label>
          <input type="number" min={10} step={5} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: e.target.value })} />
        </div>
      </div>

      <label>Bio</label>
      <textarea rows={2} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />

      <label>Working hours</label>
      <div className="working-hours-grid">
        {DAYS.map((d) => (
          <div key={d.key} className="working-hours-row">
            <label className="checkbox-label">
              <input type="checkbox" checked={hours[d.key].length > 0} onChange={() => toggleDay(d.key)} />
              {d.label}
            </label>
            {hours[d.key].length > 0 && (
              <>
                <input type="time" value={hours[d.key][0].start} onChange={(e) => updateRange(d.key, 'start', e.target.value)} />
                <span>to</span>
                <input type="time" value={hours[d.key][0].end} onChange={(e) => updateRange(d.key, 'end', e.target.value)} />
              </>
            )}
          </div>
        ))}
      </div>

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Creating...' : 'Create doctor account'}
      </button>
    </form>
  );
}

function LeaveManager({ doctor, onChanged }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await adminApi.addLeave(doctor.id, date, reason);
      if (res.cancelledAppointments > 0) {
        alert(`${res.cancelledAppointments} existing appointment(s) were cancelled and affected patients notified by email.`);
      }
      setDate('');
      setReason('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (leaveId) => {
    await adminApi.removeLeave(doctor.id, leaveId);
    onChanged();
  };

  return (
    <div className="leave-manager">
      <div className="leave-list">
        {doctor.leaveDays?.map((l) => (
          <span key={l.id} className="badge badge-gray leave-chip">
            {new Date(l.date).toLocaleDateString('en-IN')}
            {l.reason ? ` - ${l.reason}` : ''}
            <button className="chip-remove" onClick={() => handleRemove(l.id)}>✕</button>
          </span>
        ))}
        {(!doctor.leaveDays || doctor.leaveDays.length === 0) && <span className="muted small">No leave days recorded</span>}
      </div>
      <form className="leave-form" onSubmit={handleAdd}>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-ghost small" type="submit" disabled={busy}>{busy ? 'Adding...' : 'Mark on leave'}</button>
      </form>
      {error && <div className="alert alert-error small">{error}</div>}
    </div>
  );
}

export default function ManageDoctors() {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listDoctors();
      setDoctors(data.doctors);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <h1>Manage doctors</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <CreateDoctorForm onCreated={load} />

      <h2 className="section-heading">Doctors</h2>
      {loading && <p className="muted">Loading...</p>}
      <div className="stack">
        {doctors.map((doc) => (
          <div key={doc.id} className="card">
            <h3>Dr. {doc.user.name}</h3>
            <p className="muted">{doc.specialisation} · {doc.slotDurationMinutes} min slots · {doc.user.email}</p>
            <LeaveManager doctor={doc} onChanged={load} />
          </div>
        ))}
      </div>
    </div>
  );
}
