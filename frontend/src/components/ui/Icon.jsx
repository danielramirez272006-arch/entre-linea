const paths = {
  book: 'M4 4h6a3 3 0 0 1 3 3v14a5 5 0 0 0-5-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a5 5 0 0 1 5-3h2V4Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
  pen: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  leaf: 'M20 3C8 2 2 8 5 15s16 5 15-12ZM4 21 16 8',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};
export function Icon({ name = 'book', size = 22, className = '' }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.book}/></svg>;
}
