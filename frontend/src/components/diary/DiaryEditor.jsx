import { useEffect, useId, useRef, useState } from 'react';
import { CATEGORIES, MOODS, MAX_CONTENT_CHARS, getTodayIsoDate } from '../../utils/diaryMeta.js';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.js';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { StatusBanner } from '../ui/StatusBanner.jsx';

export function DiaryEditor({ entry, onSave, onDelete, onClose }) {
  const isEditing = Boolean(entry?.id);
  const initial = {
    title: entry?.title || '',
    entryDate: entry?.entryDate || getTodayIsoDate(),
    category: entry?.category || 'personal',
    mood: entry?.mood || 'tranquilo',
    content: entry?.content || '',
    version: entry?.version || 1,
  };

  const [form, setForm] = useState(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [conflictEntry, setConflictEntry] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const titleId = useId();
  const dateId = useId();
  const categoryId = useId();
  const moodId = useId();
  const contentId = useId();

  const isDirty =
    form.title !== savedSnapshot.title ||
    form.entryDate !== savedSnapshot.entryDate ||
    form.category !== savedSnapshot.category ||
    form.mood !== savedSnapshot.mood ||
    form.content !== savedSnapshot.content;

  const formRef = useRef(null);
  const { confirmIfDirty, markClean } = useUnsavedChanges(isDirty);

  // Atajo de teclado Ctrl+S / Cmd+S para guardar sin despegar las manos del teclado.
  useEffect(() => {
    function handleKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!submitting && !deleting && formRef.current) {
          formRef.current.requestSubmit();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting, deleting]);

  function handleFieldChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  }

  function requestClose() {
    confirmIfDirty(() => onClose());
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || deleting) return;

    setErrorMsg('');
    setFieldErrors({});
    setConflictEntry(null);
    setSubmitting(true);

    try {
      const payload = {
        title: form.title,
        entryDate: form.entryDate,
        category: form.category,
        mood: form.mood,
        content: form.content,
      };
      if (isEditing) {
        payload.version = form.version;
      }

      const saved = await onSave(payload, entry?.id || null);
      markClean();
      const nextSnapshot = {
        title: saved.title,
        entryDate: saved.entryDate,
        category: saved.category,
        mood: saved.mood,
        content: saved.content,
        version: saved.version,
      };
      setForm(nextSnapshot);
      setSavedSnapshot(nextSnapshot);
    } catch (err) {
      // Se conserva íntegramente el texto en el estado del formulario ante cualquier error.
      if (err.code === 'VERSION_CONFLICT' && err.details?.currentEntry) {
        setConflictEntry(err.details.currentEntry);
        setErrorMsg(err.message);
      } else if (err.details?.fieldErrors) {
        setFieldErrors(err.details.fieldErrors);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err.message || 'No se pudo guardar la entrada.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!isEditing || deleting || submitting) return;
    setDeleting(true);
    setErrorMsg('');
    try {
      await onDelete(entry.id);
      markClean();
      setConfirmDeleteOpen(false);
    } catch (err) {
      setConfirmDeleteOpen(false);
      setErrorMsg(err.message || 'No se pudo eliminar la entrada.');
    } finally {
      setDeleting(false);
    }
  }

  function handleLoadServerVersion() {
    if (!conflictEntry) return;
    const latest = {
      title: conflictEntry.title,
      entryDate: conflictEntry.entryDate,
      category: conflictEntry.category,
      mood: conflictEntry.mood,
      content: conflictEntry.content,
      version: conflictEntry.version,
    };
    setForm(latest);
    setSavedSnapshot(latest);
    setConflictEntry(null);
    setErrorMsg('');
  }

  function handleKeepMyTextWithLatestVersion() {
    if (!conflictEntry) return;
    setForm((prev) => ({ ...prev, version: conflictEntry.version }));
    setConflictEntry(null);
    setErrorMsg(
      'Se actualizó la versión base del documento. Revisa tu texto y pulsa "Guardar cambios" para confirmar.'
    );
  }

  const remaining = MAX_CONTENT_CHARS - form.content.length;

  return (
    <section className="paper-card anim-view" aria-label={isEditing ? 'Editar entrada' : 'Nueva entrada'}>
      <div className="row-wrap" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h2>{isEditing ? 'Editar entrada' : 'Nueva entrada'}</h2>
          <p className="field-hint" style={{ margin: 0 }}>
            {isEditing
              ? 'Vuelve a tus palabras. Siempre hay algo más que contar.'
              : 'Respira, haz una pausa y empieza por donde quieras.'}
          </p>
        </div>
        <Button variant="ghost" onClick={requestClose}>
          Volver al listado
        </Button>
      </div>

      {errorMsg && (
        <StatusBanner variant={conflictEntry ? 'warn' : 'error'} title={conflictEntry ? 'Conflicto de edición' : 'Error'}>
          <p style={{ margin: 0 }}>{errorMsg}</p>
          {conflictEntry && (
            <div className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
              <div className="paper-card" style={{ padding: 'var(--space-3)' }}>
                <strong>Versión más reciente en el servidor (v{conflictEntry.version}):</strong>
                <p style={{ margin: '0.35rem 0 0.25rem', fontWeight: 600 }}>{conflictEntry.title}</p>
                <p style={{ margin: 0, whiteSpace: 'pre-line', fontSize: 'var(--text-xs)' }}>
                  {conflictEntry.content.slice(0, 280)}
                  {conflictEntry.content.length > 280 ? '…' : ''}
                </p>
              </div>
              <div className="row-wrap">
                <Button variant="secondary" size="sm" onClick={handleLoadServerVersion}>
                  Cargar versión del servidor
                </Button>
                <Button variant="accent" size="sm" onClick={handleKeepMyTextWithLatestVersion}>
                  Mantener mi borrador sobre v{conflictEntry.version}
                </Button>
              </div>
            </div>
          )}
        </StatusBanner>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={titleId}>
            Título *
          </label>
          <input
            id={titleId}
            type="text"
            className="field-input"
            value={form.title}
            onChange={(e) => handleFieldChange('title', e.target.value)}
            maxLength={200}
            required
            placeholder="Un título breve para recordar este día…"
            aria-invalid={fieldErrors.title ? 'true' : undefined}
          />
          {fieldErrors.title && (
            <span className="field-error" role="alert">
              {fieldErrors.title}
            </span>
          )}
        </div>

        <div className="editor-meta-grid">
          <div className="field">
            <label className="field-label" htmlFor={dateId}>
              Fecha *
            </label>
            <input
              id={dateId}
              type="date"
              className="field-input"
              value={form.entryDate}
              onChange={(e) => handleFieldChange('entryDate', e.target.value)}
              required
              aria-invalid={fieldErrors.entryDate ? 'true' : undefined}
            />
            {fieldErrors.entryDate && (
              <span className="field-error" role="alert">
                {fieldErrors.entryDate}
              </span>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={categoryId}>
              Categoría *
            </label>
            <select
              id={categoryId}
              className="field-select"
              value={form.category}
              onChange={(e) => handleFieldChange('category', e.target.value)}
              aria-invalid={fieldErrors.category ? 'true' : undefined}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={moodId}>
              Estado de ánimo *
            </label>
            <select
              id={moodId}
              className="field-select"
              value={form.mood}
              onChange={(e) => handleFieldChange('mood', e.target.value)}
              aria-invalid={fieldErrors.mood ? 'true' : undefined}
            >
              {MOODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={contentId}>
            Contenido *
          </label>
          <textarea
            id={contentId}
            className="field-textarea"
            value={form.content}
            onChange={(e) => handleFieldChange('content', e.target.value)}
            maxLength={MAX_CONTENT_CHARS}
            required
            placeholder="¿Qué pasó hoy? ¿Qué deseas recordar entre líneas?"
            aria-invalid={fieldErrors.content ? 'true' : undefined}
          />
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            {fieldErrors.content ? (
              <span className="field-error" role="alert">
                {fieldErrors.content}
              </span>
            ) : (
              <span className="field-hint">
                {isDirty ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.'}
              </span>
            )}
            <span className={`char-counter ${remaining < 500 ? 'is-warn' : ''}`} aria-live="polite">
              {form.content.length.toLocaleString('es-ES')} / {MAX_CONTENT_CHARS.toLocaleString('es-ES')} caracteres
            </span>
          </div>
        </div>

        <div className="editor-toolbar">
          <div className="row-wrap">
            <Button type="submit" variant="primary" loading={submitting} disabled={deleting}>
              {isEditing ? 'Guardar cambios' : 'Guardar entrada'}
            </Button>
            <Button variant="secondary" onClick={requestClose} disabled={submitting || deleting}>
              Cancelar
            </Button>
          </div>

          {isEditing && (
            <Button
              variant="danger"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting || deleting}
            >
              Eliminar entrada
            </Button>
          )}
        </div>
      </form>

      <Dialog
        open={confirmDeleteOpen}
        title="Eliminar entrada"
        onClose={() => !deleting && setConfirmDeleteOpen(false)}
      >
        <p>
          ¿Seguro que deseas eliminar «{form.title || 'esta entrada'}»? Esta acción no se puede deshacer.
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)} disabled={deleting}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete} loading={deleting}>
            Sí, eliminar
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
