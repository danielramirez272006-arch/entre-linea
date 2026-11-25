// Cliente HTTP centralizado: mantiene el token CSRF únicamente en memoria (nunca en localStorage).

let csrfTokenMemory = null;
let sessionExpiredListener = null;

export function setCsrfToken(token) {
  csrfTokenMemory = token || null;
}

export function clearCsrfToken() {
  csrfTokenMemory = null;
}

export function onSessionExpired(callback) {
  sessionExpiredListener = callback;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', details = null, isNetworkError = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isNetworkError = isNetworkError;
  }
}

async function request(path, { method = 'GET', body = undefined, skipExpiredNotify = false } = {}) {
  const headers = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (method !== 'GET' && method !== 'HEAD' && csrfTokenMemory) {
    headers['X-CSRF-Token'] = csrfTokenMemory;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      'No se pudo contactar al servidor. Si estabas guardando o eliminando datos, el resultado de la operación podría haber quedado incierto; verifica tu conexión antes de reintentar.',
      { status: 0, code: 'NETWORK_ERROR', isNetworkError: true }
    );
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorCode = data?.error?.code || 'HTTP_ERROR';
    const message = data?.error?.message || 'Ocurrió un error al comunicarse con el servidor.';

    if (response.status === 401 && !skipExpiredNotify && sessionExpiredListener) {
      clearCsrfToken();
      sessionExpiredListener(errorCode === 'SESSION_EXPIRED');
    }

    throw new ApiError(message, {
      status: response.status,
      code: errorCode,
      details: data?.error?.details || null,
    });
  }

  if (data?.csrfToken) {
    setCsrfToken(data.csrfToken);
  }

  return data;
}

export const api = {
  auth: {
    me: () => request('/api/auth/me', { skipExpiredNotify: true }),
    register: (payload) => request('/api/auth/register', { method: 'POST', body: payload, skipExpiredNotify: true }),
    login: (payload) => request('/api/auth/login', { method: 'POST', body: payload, skipExpiredNotify: true }),
    logout: () => request('/api/auth/logout', { method: 'POST', skipExpiredNotify: true }),
    forgotPassword: (payload) =>
      request('/api/auth/forgot-password', { method: 'POST', body: payload, skipExpiredNotify: true }),
    resetPassword: (payload) =>
      request('/api/auth/reset-password', { method: 'POST', body: payload, skipExpiredNotify: true }),
    changePassword: (payload) => request('/api/auth/change-password', { method: 'POST', body: payload }),
  },
  diary: {
    list: ({ search = '', category = '', mood = '' } = {}) => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (category) params.set('category', category);
      if (mood) params.set('mood', mood);
      const qs = params.toString();
      return request(`/api/diary${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/diary/${encodeURIComponent(id)}`),
    create: (payload) => request('/api/diary', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/diary/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
    remove: (id) => request(`/api/diary/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  profile: {
    get: () => request('/api/profile'),
    update: (payload) => request('/api/profile', { method: 'PUT', body: payload }),
  },
  admin: {
    listUsers: () => request('/api/admin/users'),
    updateRole: (userId, payload) =>
      request(`/api/admin/users/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: payload }),
    listAuditLogs: (limit = 100) => request(`/api/admin/audit-logs?limit=${encodeURIComponent(limit)}`),
  },
};
