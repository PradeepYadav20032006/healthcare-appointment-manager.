import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const homeLink = !user
    ? '/login'
    : user.role === 'PATIENT'
    ? '/patient'
    : user.role === 'DOCTOR'
    ? '/doctor'
    : '/admin';

  return (
    <header className="navbar">
      <Link to={homeLink} className="brand">
        🏥 City Clinic
      </Link>
      <nav className="nav-links">
        {user?.role === 'PATIENT' && (
          <>
            <Link to="/patient">Find a Doctor</Link>
            <Link to="/patient/appointments">My Appointments</Link>
          </>
        )}
        {user?.role === 'DOCTOR' && <Link to="/doctor">My Appointments</Link>}
        {user?.role === 'ADMIN' && (
          <>
            <Link to="/admin">Doctors</Link>
            <Link to="/admin/appointments">All Appointments</Link>
          </>
        )}
      </nav>
      <div className="nav-user">
        {user ? (
          <>
            <span className="user-chip">{user.name} · {user.role.toLowerCase()}</span>
            <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <Link to="/login" className="btn btn-ghost">Log in</Link>
        )}
      </div>
    </header>
  );
}
