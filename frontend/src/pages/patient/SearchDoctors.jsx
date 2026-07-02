import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { patientApi } from '../../api';

export default function SearchDoctors() {
  const [query, setQuery] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (q) => {
    setLoading(true);
    setError('');
    try {
      const data = await patientApi.searchDoctors(q);
      setDoctors(data.doctors);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    load(query);
  };

  return (
    <div className="page">
      <h1>Find a doctor</h1>
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          placeholder="Search by specialisation (e.g. Cardiology, General Medicine)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading doctors...</p>}

      <div className="grid">
        {doctors.map((doc) => (
          <div key={doc.id} className="card doctor-card">
            <h3>Dr. {doc.user.name}</h3>
            <p className="muted">{doc.specialisation}</p>
            {doc.bio && <p className="small">{doc.bio}</p>}
            <p className="small muted">Slot length: {doc.slotDurationMinutes} min</p>
            <Link className="btn btn-primary" to={`/patient/book/${doc.id}`}>Book appointment</Link>
          </div>
        ))}
        {!loading && doctors.length === 0 && <p className="muted">No doctors found.</p>}
      </div>
    </div>
  );
}
