const STATUS_COLORS = {
  BOOKED: 'badge-blue',
  COMPLETED: 'badge-green',
  CANCELLED: 'badge-red',
  NO_SHOW: 'badge-gray',
};

const URGENCY_COLORS = { Low: 'badge-green', Medium: 'badge-amber', High: 'badge-red' };

export default function AppointmentCard({ appointment, children }) {
  const when = new Date(appointment.slotStart).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="card appointment-card">
      <div className="appointment-card-header">
        <div>
          <div className="appointment-when">{when}</div>
          {appointment.doctor && (
            <div className="appointment-sub">Dr. {appointment.doctor.user.name} · {appointment.doctor.specialisation}</div>
          )}
          {appointment.patient && <div className="appointment-sub">Patient: {appointment.patient.name}</div>}
        </div>
        <div className="appointment-badges">
          <span className={`badge ${STATUS_COLORS[appointment.status] || 'badge-gray'}`}>{appointment.status}</span>
          {appointment.urgency && (
            <span className={`badge ${URGENCY_COLORS[appointment.urgency] || 'badge-gray'}`}>{appointment.urgency} urgency</span>
          )}
        </div>
      </div>

      {appointment.symptoms && (
        <p className="appointment-field"><b>Symptoms:</b> {appointment.symptoms}</p>
      )}

      {appointment.preVisitSummary?.chiefComplaint && (
        <div className="appointment-summary-box">
          <div className="summary-title">Pre-visit summary (AI-generated)</div>
          <p><b>Chief complaint:</b> {appointment.preVisitSummary.chiefComplaint}</p>
          {appointment.preVisitSummary.suggestedQuestions?.length > 0 && (
            <ul>
              {appointment.preVisitSummary.suggestedQuestions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          )}
        </div>
      )}

      {appointment.postVisitSummary && (
        <div className="appointment-summary-box summary-box-green">
          <div className="summary-title">Visit summary</div>
          <p>{appointment.postVisitSummary}</p>
        </div>
      )}

      {children && <div className="appointment-actions">{children}</div>}
    </div>
  );
}
