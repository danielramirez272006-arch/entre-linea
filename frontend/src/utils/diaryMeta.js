export const CATEGORIES = [
  { value: 'personal', label: 'Personal' },
  { value: 'gratitud', label: 'Gratitud' },
  { value: 'metas', label: 'Metas' },
  { value: 'recuerdos', label: 'Recuerdos' },
];

export const MOODS = [
  { value: 'bien', label: 'Bien' },
  { value: 'tranquilo', label: 'Tranquilo' },
  { value: 'normal', label: 'Normal' },
  { value: 'triste', label: 'Triste' },
  { value: 'agotado', label: 'Agotado' },
];

export const MAX_CONTENT_CHARS = 10000;

export function getCategoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function getMoodLabel(value) {
  return MOODS.find((m) => m.value === value)?.label || value;
}

export function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatEntryDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const dt = new Date(isoString);
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(dt);
}

export function evaluatePasswordPolicy(password) {
  return [
    { id: 'len', label: 'Entre 12 y 128 caracteres', ok: password.length >= 12 && password.length <= 128 },
    { id: 'upper', label: 'Al menos una mayúscula (A–Z)', ok: /[A-Z]/.test(password) },
    { id: 'lower', label: 'Al menos una minúscula (a–z)', ok: /[a-z]/.test(password) },
    { id: 'num', label: 'Al menos un número (0–9)', ok: /[0-9]/.test(password) },
    { id: 'sym', label: 'Al menos un símbolo (!@#...)', ok: /[^A-Za-z0-9\s]/.test(password) },
  ];
}
