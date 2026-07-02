import { useState } from 'react';
import { doctorApi } from '../../api';

const emptyMed = () => ({ name: '', dosage: '', frequencyPerDay: 1, durationDays: 5 });

export default function CompleteVisitForm({ appointmentId, onDone }) {
  const [notes, setNotes] = useState('');
  const [meds, setMeds] = useState([emptyMed()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateMed = (idx, field, value) => {
    setMeds((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const addMed = () => setMeds((prev) => [...prev, emptyMed()]);
  const removeMed = (idx) => setMeds((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const prescription = meds
        .filter((m) => m.name.trim())
        .map((m) => ({
          ...m,
          frequencyPerDay: Number(m.frequencyPerDay) || 1,
          durationDays: Number(m.durationDays) || 5,
        }));
      await doctorApi.completeAppointment(appointmentId, notes, prescription);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card complete-visit-form" onSubmit={handleSubmit}>
      <h3>Post-visit notes</h3>
      {error && <div className="alert alert-error">{error}</div>}

      <label>Clinical notes</label>
      <textarea
        required
        rows={4}
        placeholder="Diagnosis, observations, advice given..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <label>Prescription</label>
      {meds.map((m, idx) => (
        <div key={idx} className="med-row">
          <input placeholder="Medicine name" value={m.name} onChange={(e) => updateMed(idx, 'name', e.target.value)} />
          <input placeholder="Dosage (e.g. 500mg)" value={m.dosage} onChange={(e) => updateMed(idx, 'dosage', e.target.value)} />
          <input
            type="number"
            min={1}
            max={6}
            placeholder="Times/day"
            value={m.frequencyPerDay}
            onChange={(e) => updateMed(idx, 'frequencyPerDay', e.target.value)}
          />
          <input
            type="number"
            min={1}
            placeholder="Days"
            value={m.durationDays}
            onChange={(e) => updateMed(idx, 'durationDays', e.target.value)}
          />
          {meds.length > 1 && (
            <button type="button" className="btn btn-ghost small" onClick={() => removeMed(idx)}>✕</button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-ghost small" onClick={addMed}>+ Add medicine</button>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Generating summary...' : 'Complete visit & notify patient'}
        </button>
      </div>
    </form>
  );
}
