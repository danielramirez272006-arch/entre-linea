export function StatusBanner({ variant = 'info', title, children, urgent = false }) {
  if (!children && !title) return null;

  const isAlert = urgent || variant === 'error';

  return (
    <div
      className={`status-banner is-${variant} anim-banner`}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}
