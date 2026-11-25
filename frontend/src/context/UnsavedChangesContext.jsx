import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Dialog } from '../components/ui/Dialog.jsx';
import { Button } from '../components/ui/Button.jsx';

const UnsavedChangesContext = createContext(null);

/**
 * Protege borradores sin guardar en memoria (nunca usa localStorage) frente a:
 * - Navegación interna de React Router (enlaces, Inicio, Perfil, Admin)
 * - Botones Atrás / Adelante del navegador (useBlocker)
 * - Cierre del editor y cierre de sesión (confirmIfDirty)
 * - Recarga o cierre de pestaña (beforeunload)
 */
export function UnsavedChangesProvider({ children }) {
  const [isDirty, setIsDirtyState] = useState(false);
  const isDirtyRef = useRef(false);
  const [pendingAction, setPendingAction] = useState(null);

  const setDirty = useCallback((nextValue) => {
    const boolVal = Boolean(nextValue);
    isDirtyRef.current = boolVal;
    setIsDirtyState(boolVal);
  }, []);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirtyRef.current &&
        (currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search),
      []
    )
  );

  // Protección del navegador ante recarga o cierre de pestaña.
  useEffect(() => {
    if (!isDirty) return undefined;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const confirmIfDirty = useCallback((actionFn) => {
    if (!isDirtyRef.current) {
      actionFn();
      return;
    }
    setPendingAction(() => actionFn);
  }, []);

  const isDialogOpen = blocker.state === 'blocked' || Boolean(pendingAction);

  const handleKeepEditing = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
    setPendingAction(null);
  }, [blocker]);

  const handleDiscardChanges = useCallback(() => {
    const actionToRun = pendingAction;
    setDirty(false);
    setPendingAction(null);

    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
    if (typeof actionToRun === 'function') {
      actionToRun();
    }
  }, [blocker, pendingAction, setDirty]);

  return (
    <UnsavedChangesContext.Provider
      value={{
        isDirty,
        setDirty,
        confirmIfDirty,
      }}
    >
      {children}

      <Dialog open={isDialogOpen} title="Cambios sin guardar" onClose={handleKeepEditing}>
        <p>Tienes cambios sin guardar en tu borrador. Si sales ahora, se perderán.</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={handleKeepEditing}>
            Seguir editando
          </Button>
          <Button variant="danger" onClick={handleDiscardChanges}>
            Descartar cambios
          </Button>
        </div>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesContext() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error('useUnsavedChangesContext debe usarse dentro de UnsavedChangesProvider.');
  }
  return ctx;
}
