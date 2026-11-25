import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/apiClient.js';
import { TextField } from '../components/ui/TextField.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setStatus('');
    setSubmitting(true);

    try {
      const data = await api.auth.forgotPassword({ email });
      setStatus(data.message);
    } catch (err) {
      setError(err.message || 'No se pudo procesar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="paper-card paper-card-narrow anim-view" aria-labelledby="forgot-heading">
      <h1 id="forgot-heading" style={{ fontSize: 'var(--text-2xl)' }}>
        Recuperar contraseña
      </h1>
      <p className="field-hint" style={{ marginBottom: 'var(--space-5)' }}>
        A veces hace falta un nuevo comienzo. Ingresa tu correo y, si tienes una cuenta, te enviaremos un enlace válido durante 15 minutos.
      </p>

      {status && <StatusBanner variant="success">{status}</StatusBanner>}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Correo electrónico"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <div className="stack-sm">
          <Button type="submit" variant="primary" loading={submitting}>
            Enviar enlace de recuperación
          </Button>
          <Link to="/iniciar-sesion" style={{ fontSize: 'var(--text-sm)' }}>
            Volver a iniciar sesión
          </Link>
        </div>
      </form>
    </section>
  );
}
