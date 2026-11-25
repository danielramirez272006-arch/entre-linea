import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="paper-card paper-card-narrow anim-view" style={{ textAlign: 'center' }}>
      <h1>Página no encontrada</h1>
      <p className="field-hint">La ruta que buscas no existe o fue movida.</p>
      <Link to="/" className="btn btn-primary">
        Volver al inicio
      </Link>
    </section>
  );
}
