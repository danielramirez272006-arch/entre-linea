import { useId, useState } from 'react';

export function TextField({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error = '',
  hint = '',
  required = false,
  autoComplete,
  placeholder = '',
  maxLength,
  disabled = false,
  readOnly = false,
  allowPasswordToggle = false,
}) {
  const id = useId();
  const [showPassword, setShowPassword] = useState(false);

  const isPasswordField = type === 'password' && allowPasswordToggle;
  const resolvedType = isPasswordField ? (showPassword ? 'text' : 'password') : type;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      <div className="field-input-wrap">
        <input
          id={id}
          name={name}
          type={resolvedType}
          className={`field-input ${isPasswordField ? 'has-toggle' : ''}`}
          value={value}
          onChange={onChange}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        {isPasswordField && (
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          >
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
      </div>
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
