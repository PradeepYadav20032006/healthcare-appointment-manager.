import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { patientApi } from '../../api';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function BookAppointment() {
  const { doctorId } = useParams();
  const navigate = useNavigate();

  const [date, setDate] = useState(todayISO());
  const [slotsData, setSlotsData] = useState({ slots: [], onLeave: false });
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [symptoms, setSymptoms] = useState('');
  const [step, setStep] = useState('pick-slot'); // pick-slot | symptoms | confirmed
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSlots = async (d) => {
    setError('');
    try {
      const data = await patientApi.getSlots(doctorId, d);
      setSlotsData(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadSlots(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const handlePickSlot = async (slot) => {
    setError('');
    setBusy(true);
    try {
      const hold = await patientApi.holdSlot(doctorId, slot.slotStart);
      setSelectedSlot(slot);
      setHoldExpiresAt(hold.expiresAt);
      setStep('symptoms');
    } catch (err) {
      setError(err.message);
      loadSlots(date);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await patientApi.confirmBooking(doctorId, selectedSlot.slotStart, symptoms);
      setResult(data);
      setStep('confirmed');
    } catch (err) {
      setError(err.message);
      setStep('pick-slot');
      loadSlots(date);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'confirmed' && result) {
    return (
      <div className="page">
        <div className="card confirm-card">
          <h1>✅ Appointment confirmed</h1>
          <p>
            {new Date(result.appointment.slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
          <div className="appointment-summary-box">
            <div className="summary-title">Pre-visit summary shared with your doctor</div>
            <p><b>Urgency:</b> {result.preVisitSummary.urgency}</p>
            <p><b>Chief complaint:</b> {result.preVisitSummary.chiefComplaint}</p>
          </div>
          <p className="muted small">A confirmation email and calendar invite have been sent (if configured).</p>
          <button className="btn btn-primary" onClick={() => navigate('/patient/appointments')}>
            View my appointments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Book an appointment</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {step === 'pick-slot' && (
        <>
          <label>Date</label>
          <input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />

          {slotsData.onLeave && (
            <div className="alert alert-warning">The doctor is on leave this day{slotsData.reason ? `: ${slotsData.reason}` : '.'}</div>
          )}

          <div className="slot-grid">
            {slotsData.slots.map((slot) => (
              <button
                key={slot.slotStart}
                className="btn btn-slot"
                disabled={busy}
                onClick={() => handlePickSlot(slot)}
              >
                {new Date(slot.slotStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </button>
            ))}
          </div>
          {!slotsData.onLeave && slotsData.slots.length === 0 && (
            <p className="muted">No slots available on this date. Try another date.</p>
          )}
        </>
      )}

      {step === 'symptoms' && selectedSlot && (
        <form className="card" onSubmit={handleConfirm}>
          <h3>
            Slot held: {new Date(selectedSlot.slotStart).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </h3>
          <p className="muted small">
            This slot is reserved for you until {new Date(holdExpiresAt).toLocaleTimeString('en-IN')}. Please complete the form before it expires.
          </p>

          <label>Describe your symptoms</label>
          <textarea
            required
            rows={5}
            placeholder="e.g. Fever for 2 days, mild headache, sore throat..."
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
          />

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setStep('pick-slot'); loadSlots(date); }}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Confirming...' : 'Confirm booking'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
