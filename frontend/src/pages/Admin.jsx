import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/apiClient.js';
import { formatDateTime } from '../utils/diaryMeta.js';
import { Button } from '../components/ui/Button.jsx';
import { Dialog } from '../components/ui/Dialog.jsx';
import { TextField } from '../components/ui/TextField.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';

export function Admin() {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Estado del diálogo de cambio de rol con confirmación + reautenticación
  const [roleTarget, setRoleTarget] = useState(null);
  const [nextRole, setNextRole] = useState('user');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [roleError, setRoleError] = useState('');
  const [updatingRole, setUpdatingRole] = useState(false);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usersData, logsData] = await Promise.all([
        api.admin.listUsers(),
        api.admin.listAuditLogs(100),
      ]);
      setUsers(usersData.users);
      setLogs(logsData.logs);
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los datos administrativos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  function openRoleDialog(user) {
    setRoleTarget(user);
    setNextRole(user.role === 'admin' ? 'user' : 'admin');
    setConfirmChecked(false);
    setAdminPassword('');
    setRoleError('');
  }

  async function handleRoleSubmit(event) {
    event.preventDefault();
    if (!roleTarget || updatingRole) return;

    if (!confirmChecked) {
      setRoleError('Marca la casilla de confirmación antes de continuar.');
      return;
    }

    setUpdatingRole(true);
    setRoleError('');
    setNotice('');

    try {
      await api.admin.updateRole(roleTarget.id, {
        role: nextRole,
        currentPassword: adminPassword,
        confirmed: true,
      });
      setNotice(`Rol actualizado para ${roleTarget.email} (${nextRole}).`);
      setRoleTarget(null);
      setAdminPassword('');
      await loadAdminData();
    } catch (err) {
      setRoleError(err.message || 'No se pudo actualizar el rol.');
    } finally {
      setUpdatingRole(false);
    }
  }

  function severityBadge(severity) {
    if (severity === 'alert') return 'badge badge-danger';
    if (severity === 'warn') return 'badge badge-warn';
    return 'badge badge-sage';
  }

  return (
    <div className="stack-md anim-view">
      <div className="diary-topbar" style={{ marginBottom: 0 }}>
        <div>
          <p className="hero-eyebrow" style={{ marginBottom: '0.25rem' }}>
            Panel administrativo
          </p>
          <h1 style={{ marginBottom: '0.25rem' }}>Usuarios y bitácora de seguridad</h1>
          <p className="field-hint" style={{ margin: 0 }}>
            Por diseño, este panel nunca muestra contenido de diarios privados ajenos.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={loadAdminData} disabled={loading}>
          Actualizar datos
        </Button>
      </div>

      {notice && <StatusBanner variant="success">{notice}</StatusBanner>}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      {loading ? (
        <div className="paper-card" role="status" aria-live="polite">
          Cargando panel de administración…
        </div>
      ) : (
        <>
          <section aria-labelledby="usuarios-heading">
            <h2 id="usuarios-heading" style={{ fontSize: 'var(--text-xl)' }}>
              Cuentas registradas ({users.length})
            </h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Registro</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-terracotta' : 'badge-sage'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date()
                          ? `Bloqueada hasta ${formatDateTime(u.lockedUntil)}`
                          : 'Activa'}
                      </td>
                      <td>{formatDateTime(u.createdAt)}</td>
                      <td>
                        <Button variant="secondary" size="sm" onClick={() => openRoleDialog(u)}>
                          Cambiar rol
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="bitacora-heading">
            <h2 id="bitacora-heading" style={{ fontSize: 'var(--text-xl)' }}>
              Bitácora de seguridad y alertas ({logs.length})
            </h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Severidad</th>
                    <th>Evento</th>
                    <th>Actor / Objetivo</th>
                    <th>Ruta / IP</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Aún no hay eventos registrados.</td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.createdAt)}</td>
                        <td>
                          <span className={severityBadge(log.severity)}>{log.severity}</span>
                        </td>
                        <td>
                          <code>{log.eventType}</code>
                        </td>
                        <td>
                          {log.actorEmail || '—'}
                          {log.targetEmail && log.targetEmail !== log.actorEmail ? ` → ${log.targetEmail}` : ''}
                        </td>
                        <td>
                          <span>{log.requestPath || '—'}</span>
                          <br />
                          <span className="field-hint">{log.ipAddress || '—'}</span>
                        </td>
                        <td>
                          <code>{JSON.stringify(log.details || {})}</code>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Dialog
        open={Boolean(roleTarget)}
        title="Confirmar cambio de rol"
        onClose={() => !updatingRole && setRoleTarget(null)}
      >
        {roleTarget && (
          <form onSubmit={handleRoleSubmit} noValidate>
            <p>
              Vas a cambiar el rol de <strong>{roleTarget.email}</strong> de{' '}
              <strong>{roleTarget.role}</strong> a <strong>{nextRole}</strong>.
            </p>

            {roleError && <StatusBanner variant="error">{roleError}</StatusBanner>}

            <label className="row-wrap" style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
              />
              Confirmo que autorizo este cambio de privilegios.
            </label>

            <TextField
              label="Tu contraseña de administrador (reautenticación)"
              name="adminPassword"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              autoComplete="current-password"
              allowPasswordToggle
            />

            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setRoleTarget(null)} disabled={updatingRole}>
                Cancelar
              </Button>
              <Button type="submit" variant="accent" loading={updatingRole}>
                Confirmar cambio
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
