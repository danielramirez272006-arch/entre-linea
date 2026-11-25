import { useCallback, useEffect } from 'react';
import { useUnsavedChangesContext } from '../context/UnsavedChangesContext.jsx';

export function useUnsavedChanges(hasUnsavedChanges) {
  const { setDirty, confirmIfDirty } = useUnsavedChangesContext();

  useEffect(() => {
    setDirty(hasUnsavedChanges);
  }, [hasUnsavedChanges, setDirty]);

  useEffect(() => {
    return () => {
      setDirty(false);
    };
  }, [setDirty]);

  const markClean = useCallback(() => {
    setDirty(false);
  }, [setDirty]);

  return { confirmIfDirty, markClean };
}
