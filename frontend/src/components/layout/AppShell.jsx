import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '../ui/Button.jsx';
import { StatusBanner } from '../ui/StatusBanner.jsx';

export function AppShell({ children }) {
  const { user, logout, sessionExpired, dismissSessionExpired } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      setMenuOpen(false);
      navigate('/iniciar-sesion');
    } finally {
      setLoggingOut(false);
    }
  }

  function navClass({ isActive }) {
    return isActive ? 'nav-link is-active' : 'nav-link';
  }

  const navLinks = user ? (
    <>
      <NavLink to="/diario" className={navClass} onClick={() => setMenuOpen(false)}>
        Mi diario
      </NavLink>
      <NavLink to="/perfil" className={navClass} onClick={() => setMenuOpen(false)}>
        Perfil
      </NavLink>
      {user.role === 'admin' && (
        <NavLink to="/admin" className={navClass} onClick={() => setMenuOpen(false)}>
          Administración
        </NavLink>
      )}
      <Button variant="ghost" size="sm" onClick={handleLogout} loading={loggingOut}>
        Cerrar sesión
      </Button>
    </>
  ) : (
    <>
      <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
        Inicio
      </NavLink>
      <NavLink to="/iniciar-sesion" className={navClass} onClick={() => setMenuOpen(false)}>
        Iniciar sesión
      </NavLink>
      <Link to="/registro" className="btn btn-primary btn-sm" onClick={() => setMenuOpen(false)}>
        Crear cuenta
      </Link>
    </>
  );

  return (
    <div className="app-shell">
      <a href="#contenido-principal" className="skip-link">
        Saltar al contenido principal
      </a>

      <header className="app-header">
        <div className="app-header-inner">
          <Link to={user ? '/diario' : '/'} className="brand-link" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              EL
            </span>
            <span>
              <span className="brand-title">Entre Líneas</span>
              <span className="brand-subtitle">Diario Seguro</span>
            </span>
          </Link>

          <nav className="nav-desktop" aria-label="Navegación principal">
            {navLinks}
          </nav>

          <button
            type="button"
            className="nav-mobile-toggle"
            aria-expanded={menuOpen}
            aria-controls="menu-movil"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? 'Cerrar' : 'Menú'}
          </button>
        </div>

        {menuOpen && (
          <nav id="menu-movil" className="nav-mobile-drawer anim-drawer" aria-label="Navegación móvil">
            {navLinks}
          </nav>
        )}
      </header>

      <main id="contenido-principal" className="app-main" tabIndex={-1}>
        {sessionExpired && (
          <StatusBanner variant="warn" title="Tu sesión ha caducado">
            Por seguridad, tu sesión anterior expiró. Inicia sesión nuevamente para continuar.{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={dismissSessionExpired}
            >
              Entendido
            </button>
          </StatusBanner>
        )}
        {children}
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>Entre Líneas — Diario Seguro</span>
          <span>Cifrado AES-256-GCM en servidor · Sesiones HttpOnly en PostgreSQL</span>
        </div>
      </footer>
    </div>
  );
}
