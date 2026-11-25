import { useEffect, useState } from 'react';
import { api } from '../services/apiClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { evaluatePasswordPolicy } from '../utils/diaryMeta.js';
import { TextField } from '../components/ui/TextField.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function Profile() {
  const { updateUserName } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Formulario de perfil
  const [name, setName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [modifyPhone, setModifyPhone] = useState(false);
  const [sensitiveNoteInput, setSensitiveNoteInput] = useState('');
  const [modifySensitiveNote, setModifySensitiveNote] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // Formulario de cambio de contraseña
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  useEffect(() => {
    let active = true;
    api.profile
      .get()
      .then((data) => {
        if (!active) return;
        setProfile(data.profile);
        setName(data.profile.name);
      })
      .catch((err) => {
        if (active) setLoadError(err.message || 'No se pudo cargar tu perfil.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleProfileSubmit(event) {
    event.preventDefault();
    if (savingProfile) return;
    setProfileMsg('');
    setProfileErr('');
    setSavingProfile(true);

    try {
      const payload = { name };
      if (modifyPhone) {
        payload.phone = phoneInput.trim();
      }
      if (modifySensitiveNote) {
        payload.sensitiveNote = sensitiveNoteInput.trim();
      }

      const data = await api.profile.update(payload);
      setProfile(data.profile);
      updateUserName(data.profile.name);
      setPhoneInput('');
      setModifyPhone(false);
      setSensitiveNoteInput('');
      setModifySensitiveNote(false);
      setProfileMsg('Perfil actualizado correctamente.');
    } catch (err) {
      setProfileErr(err.message || 'No se pudo actualizar el perfil.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    if (changingPwd) return;
    setPwdMsg('');
    setPwdErr('');
    setChangingPwd(true);

    try {
      const data = await api.auth.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwdMsg(data.message);
    } catch (err) {
      setPwdErr(err.message || 'No se pudo cambiar la contraseña.');
    } finally {
      setChangingPwd(false);
    }
  }

  if (loading) {
    return (
      <div className="paper-card anim-view" role="status" aria-live="polite">
        Cargando perfil…
      </div>
    );
  }

  if (loadError) {
    return <StatusBanner variant="error">{loadError}</StatusBanner>;
  }

  const pwdChecks = evaluatePasswordPolicy(newPassword);

  return (
    <div className="stack-md anim-view">
      <div>
        <p className="hero-eyebrow" style={{ marginBottom: '0.25rem' }}>
          Cuenta y privacidad
        </p>
        <h1>Mi perfil</h1>
      </div>

      <div className="profile-grid">
        <section className="paper-card" aria-labelledby="datos-perfil-heading">
          <h2 id="datos-perfil-heading" style={{ fontSize: 'var(--text-xl)' }}>
            Datos personales y campos cifrados
          </h2>

          {profileMsg && <StatusBanner variant="success">{profileMsg}</StatusBanner>}
          {profileErr && <StatusBanner variant="error">{profileErr}</StatusBanner>}

          <form onSubmit={handleProfileSubmit} noValidate>
            <TextField
              label="Nombre"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />

            <TextField
              label="Correo electrónico"
              name="email"
              value={profile.email}
              onChange={() => {}}
              readOnly
              hint="El correo identifica tu cuenta y no se modifica desde aquí."
            />

            <div className="field">
              <span className="field-label">Teléfono almacenado (enmascarado)</span>
              <div className="masked-box">
                {profile.hasPhone ? (
                  <>
                    {profile.phoneMasked}{' '}
                    <span className="badge badge-sage">AES-256-GCM · {profile.phoneKeyVersion}</span>
                  </>
                ) : (
                  'Sin teléfono registrado'
                )}
              </div>
              <label className="row-wrap" style={{ fontSize: 'var(--text-xs)', marginTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={modifyPhone}
                  onChange={(e) => setModifyPhone(e.target.checked)}
                />
                Actualizar o eliminar teléfono
              </label>
            </div>

            {modifyPhone && (
              <TextField
                label="Nuevo teléfono"
                name="phone"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+506 8888-0000"
                hint="Si dejas este campo vacío y guardas, el teléfono almacenado se eliminará de tu cuenta."
              />
            )}

            <div className="field">
              <span className="field-label">Dato sensible de prueba (cifrado y enmascarado)</span>
              <div className="masked-box">
                {profile.hasSensitiveNote ? (
                  <>
                    {profile.sensitiveNoteMasked}{' '}
                    <span className="badge badge-sage">
                      AES-256-GCM · {profile.sensitiveNoteKeyVersion}
                    </span>
                  </>
                ) : (
                  'Sin dato sensible de prueba guardado'
                )}
              </div>
              <span className="field-hint">
                Campo dedicado para demostrar cifrado autenticado en PostgreSQL y presentación enmascarada.
              </span>
              <label className="row-wrap" style={{ fontSize: 'var(--text-xs)', marginTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={modifySensitiveNote}
                  onChange={(e) => setModifySensitiveNote(e.target.checked)}
                />
                Actualizar o eliminar dato sensible de prueba
              </label>
            </div>

            {modifySensitiveNote && (
              <TextField
                label="Nuevo dato sensible de prueba"
                name="sensitiveNote"
                value={sensitiveNoteInput}
                onChange={(e) => setSensitiveNoteInput(e.target.value)}
                placeholder="Ej. Código de prueba 9842-AB"
                maxLength={200}
                hint="Si lo dejas vacío al guardar, el dato se eliminará."
              />
            )}

            <Button type="submit" variant="primary" loading={savingProfile}>
              Guardar perfil
            </Button>
          </form>
        </section>

        <section className="paper-card" aria-labelledby="seguridad-pwd-heading">
          <h2 id="seguridad-pwd-heading" style={{ fontSize: 'var(--text-xl)' }}>
            Cambiar contraseña
          </h2>
          <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
            Al actualizar tu contraseña se invalidan sesiones y enlaces de recuperación anteriores.
          </p>

          {pwdMsg && <StatusBanner variant="success">{pwdMsg}</StatusBanner>}
          {pwdErr && <StatusBanner variant="error">{pwdErr}</StatusBanner>}

          <form onSubmit={handlePasswordSubmit} noValidate>
            <TextField
              label="Contraseña actual"
              name="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              allowPasswordToggle
            />

            <TextField
              label="Nueva contraseña"
              name="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              allowPasswordToggle
            />

            <ul className="policy-list" aria-label="Requisitos de nueva contraseña">
              {pwdChecks.map((item) => (
                <li key={item.id} className={`policy-item ${item.ok ? 'is-ok' : ''}`}>
                  {item.ok ? '✓' : '○'} {item.label}
                </li>
              ))}
            </ul>

            <Button type="submit" variant="secondary" loading={changingPwd}>
              Actualizar contraseña
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
