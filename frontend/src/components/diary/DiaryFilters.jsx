import { useId } from 'react';
import { CATEGORIES, MOODS } from '../../utils/diaryMeta.js';
import { Button } from '../ui/Button.jsx';

export function DiaryFilters({ search, category, mood, onChange, onClear }) {
  const searchId = useId();
  const catId = useId();
  const moodId = useId();

  const hasActiveFilters = Boolean(search.trim() || category || mood);

  return (
    <section className="diary-filters" aria-label="Buscar y filtrar entradas">
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field-label" htmlFor={searchId}>
          Buscar en tu diario
        </label>
        <input
          id={searchId}
          type="search"
          className="field-input"
          placeholder="Título o palabra clave…"
          value={search}
          onChange={(e) => onChange({ search: e.target.value, category, mood })}
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field-label" htmlFor={catId}>
          Categoría
        </label>
        <select
          id={catId}
          className="field-select"
          value={category}
          onChange={(e) => onChange({ search, category: e.target.value, mood })}
        >
          <option value="">Todas</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field-label" htmlFor={moodId}>
          Estado de ánimo
        </label>
        <select
          id={moodId}
          className="field-select"
          value={mood}
          onChange={(e) => onChange({ search, category, mood: e.target.value })}
        >
          <option value="">Todos</option>
          {MOODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Button variant="secondary" size="sm" onClick={onClear} disabled={!hasActiveFilters}>
          Limpiar filtros
        </Button>
      </div>
    </section>
  );
}
