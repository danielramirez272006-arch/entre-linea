import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Nota: las rutas protegidas controlan la navegación en la interfaz;
// la autorización real de sesión, rol y propiedad se aplica siempre en el servidor.
export function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="paper-card anim-view" role="status" aria-live="polite">
        Verificando tu sesión…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/iniciar-sesion" state={{ from: location.pathname }} replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/diario" replace />;
  }

  return children;
}
