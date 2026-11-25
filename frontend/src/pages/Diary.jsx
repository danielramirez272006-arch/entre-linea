import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/apiClient.js';
import { Button } from '../components/ui/Button.jsx';
import { StatusBanner } from '../components/ui/StatusBanner.jsx';
import { DiaryFilters } from '../components/diary/DiaryFilters.jsx';
import { DiaryCard } from '../components/diary/DiaryCard.jsx';
import { DiaryEditor } from '../components/diary/DiaryEditor.jsx';

export function Diary() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ search: '', category: '', mood: '' });
  const [entries, setEntries] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [maxEntries, setMaxEntries] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // mode: 'list' | 'create' | 'edit'
  const [mode, setMode] = useState('list');
  const [activeEntry, setActiveEntry] = useState(null);

  const loadEntries = useCallback(async (currentFilters) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.diary.list(currentFilters);
      setEntries(data.entries);
      setTotalCount(data.totalCount);
      setMaxEntries(data.maxEntries);
    } catch (err) {
      setError(err.message || 'No se pudieron cargar tus entradas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadEntries(filters);
    }, filters.search ? 200 : 0);
    return () => clearTimeout(timer);
  }, [filters, loadEntries]);

  async function handleSaveEntry(payload, entryId) {
    setNotice('');
    let saved;
    if (entryId) {
      const data = await api.diary.update(entryId, payload);
      saved = data.entry;
      setNotice('Cambios guardados y confirmados por el servidor.');
    } else {
      const data = await api.diary.create(payload);
      saved = data.entry;
      setNotice('Una nueva página de tu historia, guardada.');
    }

    await loadEntries(filters);
    setActiveEntry(null);
    setMode('list');
    return saved;
  }

  async function handleDeleteEntry(entryId) {
    setNotice('');
    await api.diary.remove(entryId);
    setNotice('Entrada eliminada correctamente.');
    setActiveEntry(null);
    setMode('list');
    await loadEntries(filters);
  }

  if (mode === 'create' || mode === 'edit') {
    return (
      <DiaryEditor
        key={activeEntry?.id || 'new'}
        entry={mode === 'edit' ? activeEntry : null}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
        onClose={() => {
          setActiveEntry(null);
          setMode('list');
        }}
      />
    );
  }

  const hasFilters = Boolean(filters.search.trim() || filters.category || filters.mood);
  const limitReached = totalCount >= maxEntries;

  return (
    <div className="anim-view">
      <div className="diary-topbar">
        <div>
          <p className="hero-eyebrow" style={{ marginBottom: '0.25rem' }}>
            Mi diario personal
          </p>
          <h1 style={{ marginBottom: '0.25rem' }}>Hola, {user?.name}</h1>
          <p className="field-hint" style={{ margin: 0 }}>
            {totalCount} de {maxEntries} entradas guardadas · Solo tú puedes leer tu diario.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => {
            setNotice('');
            setActiveEntry(null);
            setMode('create');
          }}
          disabled={limitReached}
          title={limitReached ? `Has alcanzado el límite de ${maxEntries} entradas.` : undefined}
        >
          + Nueva entrada
        </Button>
      </div>

      {notice && <StatusBanner variant="success">{notice}</StatusBanner>}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {limitReached && (
        <StatusBanner variant="warn">
          Has alcanzado el límite de {maxEntries} entradas. Elimina alguna entrada anterior si deseas crear una nueva.
        </StatusBanner>
      )}

      <DiaryFilters
        search={filters.search}
        category={filters.category}
        mood={filters.mood}
        onChange={setFilters}
        onClear={() => setFilters({ search: '', category: '', mood: '' })}
      />

      {!loading && hasFilters && entries.length > 0 && (
        <p className="field-hint" role="status" aria-live="polite" style={{ marginBottom: 'var(--space-3)' }}>
          Mostrando {entries.length} de {totalCount} entradas.
        </p>
      )}

      {loading ? (
        <div className="diary-grid" role="status" aria-live="polite" aria-label="Cargando entradas">
          <div className="skeleton-card anim-skeleton" />
          <div className="skeleton-card anim-skeleton" />
        </div>
      ) : entries.length === 0 ? (
        <section className="empty-state anim-view">
          <h2>{hasFilters ? 'No hay entradas con esos filtros' : 'Tu libreta está lista para empezar'}</h2>
          <p className="field-hint" style={{ maxWidth: '48ch', margin: '0 auto var(--space-5)' }}>
            {hasFilters
              ? 'Prueba limpiando los filtros o usando otra palabra clave.'
              : 'No hace falta un día extraordinario. Empieza por algo pequeño que quieras recordar.'}
          </p>
          {hasFilters ? (
            <Button variant="secondary" onClick={() => setFilters({ search: '', category: '', mood: '' })}>
              Ver todas mis entradas
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                setActiveEntry(null);
                setMode('create');
              }}
            >
              Escribir mi primera entrada
            </Button>
          )}
        </section>
      ) : (
        <section
          className="diary-grid"
          aria-label="Listado de entradas"
          key={`${filters.category}-${filters.mood}-${entries.length}`}
        >
          {entries.map((entry) => (
            <DiaryCard
              key={entry.id}
              entry={entry}
              onOpen={(item) => {
                setNotice('');
                setActiveEntry(item);
                setMode('edit');
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}
