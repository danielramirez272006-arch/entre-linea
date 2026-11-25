import { useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useUnsavedChangesContext } from '../../context/UnsavedChangesContext.jsx';
import { Button } from '../ui/Button.jsx';
import { StatusBanner } from '../ui/StatusBanner.jsx';

export function AppShell({ children }) {
  const { user, logout, sessionExpired, dismissSessionExpired } = useAuth();
  const { confirmIfDirty } = useUnsavedChangesContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAuthPage = ['/iniciar-sesion', '/registro', '/recuperar', '/restablecer'].includes(pathname);

  async function executeLogout() {
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

  function handleLogout() {
    if (loggingOut) return;
    confirmIfDirty(() => {
      executeLogout();
    });
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
    <div className={`app-shell ${user ? 'is-member' : 'is-guest'} ${isAuthPage ? 'is-auth-page' : ''}`}>
      <a href="#contenido-principal" className="skip-link">
        Saltar al contenido principal
      </a>

      <header className="app-header">
        <div className="app-header-inner">
          <Link to={user ? '/diario' : '/'} className="brand-link" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              <Icon name="book" size={25}/>
            </span>
            <span>
              <span className="brand-title">Entre Líneas</span>
              <span className="brand-subtitle">UN ESPACIO PARA TI</span>
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
        {isAuthPage ? <div className="auth-layout"><aside className="auth-aside"><p className="hero-eyebrow">ENTRE LÍNEAS, TE ENCUENTRAS</p><Icon name="leaf" size={60}/><h2>Vuelve a ti.<br/><em>Una página<br/>a la vez.</em></h2><p>Un lugar para soltar el día,<br/>guardar lo bonito y escucharte.</p><span className="auth-aside-note"><Icon name="lock" size={16}/> Tus palabras, en tu espacio.</span></aside><div className="auth-form-panel"><span className="auth-form-eyebrow"><Icon name="book" size={18}/> TU LIBRETA PERSONAL</span>{children}</div></div> : children}
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span className="footer-brand">Entre Líneas <span>Diario Seguro</span></span>
          <span>Un espacio para escribir, un momento para ti.</span>
        </div>
      </footer>
    </div>
  );
}
