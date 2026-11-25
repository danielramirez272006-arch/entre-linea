import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { evaluatePasswordPolicy } from '../utils/diaryMeta.js';
import { TextField } from '../components/ui/TextField.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const checks = evaluatePasswordPolicy(password);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setFieldErrors({});
    setSubmitting(true);

    try {
      await register({ name, email, password });
      navigate('/diario', { replace: true });
    } catch (err) {
      if (err.details?.fieldErrors) {
        setFieldErrors(err.details.fieldErrors);
      }
      setError(err.message || 'No se pudo crear la cuenta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="paper-card paper-card-narrow anim-view" aria-labelledby="register-heading">
      <h1 id="register-heading" style={{ fontSize: 'var(--text-2xl)' }}>
        Crear cuenta
      </h1>
      <p className="field-hint" style={{ marginBottom: 'var(--space-5)' }}>
        Tu cuenta se crea con permisos estándar de diario personal.
      </p>

      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Nombre"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
          maxLength={120}
          error={fieldErrors.name}
        />

        <TextField
          label="Correo electrónico"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          error={fieldErrors.email}
        />

        <TextField
          label="Contraseña"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          allowPasswordToggle
          error={fieldErrors.password}
        />

        <ul className="policy-list" aria-label="Requisitos de contraseña">
          {checks.map((item) => (
            <li key={item.id} className={`policy-item ${item.ok ? 'is-ok' : ''}`}>
              {item.ok ? '✓' : '○'} {item.label}
            </li>
          ))}
        </ul>

        <div className="stack-sm">
          <Button type="submit" variant="primary" loading={submitting}>
            Registrarme
          </Button>
          <p style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
            ¿Ya tienes cuenta? <Link to="/iniciar-sesion">Inicia sesión</Link>
          </p>
        </div>
      </form>
    </section>
  );
}
