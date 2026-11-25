import { useEffect } from 'react';

export function useUnsavedChanges(hasUnsavedChanges) {
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
}
