import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { TextField } from '../components/ui/TextField.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || '/diario';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);

    try {
      await login({ email, password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="paper-card paper-card-narrow anim-view" aria-labelledby="login-heading">
      <h1 id="login-heading" style={{ fontSize: 'var(--text-2xl)' }}>
        Iniciar sesión
      </h1>
      <p className="field-hint" style={{ marginBottom: 'var(--space-5)' }}>
        Qué bueno tenerte de vuelta. Tu historia te está esperando.
      </p>

      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Correo electrónico"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          placeholder="tu@correo.com"
        />

        <TextField
          label="Contraseña"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          allowPasswordToggle
        />

        <div className="stack-sm">
          <Button type="submit" variant="primary" loading={submitting}>
            Entrar a mi diario
          </Button>
          <div className="row-wrap" style={{ justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
            <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
            <Link to="/registro">Crear una cuenta nueva</Link>
          </div>
        </div>
      </form>
    </section>
  );
}
