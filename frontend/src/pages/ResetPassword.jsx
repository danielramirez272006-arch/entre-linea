import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/apiClient.js';
import { evaluatePasswordPolicy } from '../utils/diaryMeta.js';
import { TextField } from '../components/ui/TextField.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get('token') || '';

  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const checks = evaluatePasswordPolicy(newPassword);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setStatus('');
    setFieldErrors({});
    setSubmitting(true);

    try {
      const data = await api.auth.resetPassword({ token: token.trim(), newPassword });
      setStatus(data.message);
      setNewPassword('');
    } catch (err) {
      if (err.details?.fieldErrors) {
        setFieldErrors(err.details.fieldErrors);
      }
      setError(err.message || 'No se pudo restablecer la contraseña.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="paper-card paper-card-narrow anim-view" aria-labelledby="reset-heading">
      <h1 id="reset-heading" style={{ fontSize: 'var(--text-2xl)' }}>
        Establecer nueva contraseña
      </h1>
      <p className="field-hint" style={{ marginBottom: 'var(--space-5)' }}>
        Al guardar tu nueva contraseña se cerrarán todas las sesiones activas anteriores.
      </p>

      {status && (
        <StatusBanner variant="success">
          <p style={{ margin: '0 0 var(--space-2)' }}>{status}</p>
          <Link to="/iniciar-sesion" className="btn btn-primary btn-sm">
            Ir a iniciar sesión
          </Link>
        </StatusBanner>
      )}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      <form onSubmit={handleSubmit} noValidate>
        {!initialToken && (
          <TextField
            label="Token de recuperación"
            name="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            error={fieldErrors.token}
            hint="Pega el código del enlace recibido en tu correo de recuperación."
          />
        )}

        <TextField
          label="Nueva contraseña"
          name="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          allowPasswordToggle
          error={fieldErrors.newPassword}
        />

        <ul className="policy-list" aria-label="Requisitos de contraseña">
          {checks.map((item) => (
            <li key={item.id} className={`policy-item ${item.ok ? 'is-ok' : ''}`}>
              {item.ok ? '✓' : '○'} {item.label}
            </li>
          ))}
        </ul>

        <Button type="submit" variant="primary" loading={submitting}>
          Guardar nueva contraseña
        </Button>
      </form>
    </section>
  );
}
