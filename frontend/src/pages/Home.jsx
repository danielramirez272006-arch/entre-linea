import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function Home() {
  const { user } = useAuth();

  return (
    <div className="hero-grid anim-view">
      <section>
        <p className="hero-eyebrow">Diario personal privado</p>
        <h1>Un lugar sereno para escribir sin prisas, protegido por diseño.</h1>
        <p className="hero-lead">
          Entre Líneas te ofrece una libreta digital privada para registrar pensamientos, gratitud,
          metas y recuerdos, con controles de seguridad aplicados en cada capa del servidor.
        </p>

        <div className="hero-actions">
          {user ? (
            <Link to="/diario" className="btn btn-primary">
              Ir a mi diario
            </Link>
          ) : (
            <>
              <Link to="/registro" className="btn btn-primary">
                Crear mi diario
              </Link>
              <Link to="/iniciar-sesion" className="btn btn-secondary">
                Iniciar sesión
              </Link>
            </>
          )}
        </div>
      </section>

      <aside className="privacy-panel" aria-labelledby="privacidad-titulo">
        <h2 id="privacidad-titulo" style={{ fontSize: 'var(--text-xl)' }}>
          Privacidad honesta y transparente
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-secondary)' }}>
          No prometemos cifrado de extremo a extremo: el servidor cifra tus entradas y datos
          sensibles con <strong>AES-256-GCM</strong> antes de guardarlos en PostgreSQL y los descifra
          únicamente cuando presentas una sesión autenticada válida.
        </p>
        <ul className="privacy-list">
          <li>Contraseñas protegidas con Argon2id (nunca almacenadas en texto claro).</li>
          <li>Sesiones del servidor en PostgreSQL con cookies HttpOnly y protección CSRF.</li>
          <li>Aislamiento estricto por propietario en cada consulta del backend.</li>
          <li>Los administradores gestionan cuentas y bitácora, nunca leen diarios ajenos.</li>
        </ul>
      </aside>
    </div>
  );
}
