import { formatEntryDate, getCategoryLabel, getMoodLabel } from '../../utils/diaryMeta.js';
import { Button } from '../ui/Button.jsx';

export function DiaryCard({ entry, onOpen }) {
  return (
    <article className={`notebook-sheet category-${entry.category} anim-card`}>
      <div className="diary-card-meta">
        <time dateTime={entry.entryDate}>{formatEntryDate(entry.entryDate)}</time>
        <span className="badge badge-sage">{getCategoryLabel(entry.category)}</span>
        <span className="badge badge-terracotta">{getMoodLabel(entry.mood)}</span>
      </div>

      <h3 className="diary-card-title">{entry.title}</h3>
      <p className="diary-card-excerpt">{entry.content}</p>

      <div className="diary-card-footer">
        <span className="field-hint">Una página de tu historia</span>
        <Button variant="secondary" size="sm" onClick={() => onOpen(entry)}>
          Abrir entrada
        </Button>
      </div>
    </article>
  );
}
