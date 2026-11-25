import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setCsrfToken, clearCsrfToken, onSessionExpired } from '../services/apiClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const data = await api.auth.me();
      if (data.authenticated && data.user) {
        setUser(data.user);
        setCsrfToken(data.csrfToken);
        setSessionExpired(false);
      } else {
        setUser(null);
        clearCsrfToken();
        if (data.sessionExpired) {
          setSessionExpired(true);
        }
      }
    } catch {
      setUser(null);
      clearCsrfToken();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    onSessionExpired((expired) => {
      setUser(null);
      clearCsrfToken();
      setSessionExpired(Boolean(expired));
    });
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (credentials) => {
    const data = await api.auth.login(credentials);
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setSessionExpired(false);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.auth.register(payload);
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setSessionExpired(false);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
      clearCsrfToken();
      setSessionExpired(false);
    }
  }, []);

  const updateUserName = useCallback((name) => {
    setUser((prev) => (prev ? { ...prev, name } : prev));
  }, []);

  const dismissSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        sessionExpired,
        login,
        register,
        logout,
        refreshSession,
        updateUserName,
        dismissSessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }
  return ctx;
}
