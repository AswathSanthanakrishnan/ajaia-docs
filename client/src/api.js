const TOKEN_KEY = 'ajaiadocs_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Core HTTP request handler.
 * Attaches the Authorization header if a token exists in localStorage under 'ajaiadocs_token'.
 * Throws Error with the server message on non-2xx responses.
 */
async function request(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Set JSON Content-Type for request bodies that are not FormData
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  let data = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    if (data && typeof data === 'object' && data.error) {
      message = data.error;
    } else if (typeof data === 'string' && data.trim()) {
      message = data;
    }
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// POST /api/auth/login
export async function login(email, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

// GET /api/me
export async function getMe() {
  return request('/api/me');
}

// GET /api/docs
export async function getDocs() {
  return request('/api/docs');
}

// POST /api/docs
export async function createDoc(title) {
  return request('/api/docs', {
    method: 'POST',
    body: JSON.stringify({ title })
  });
}

// GET /api/docs/:id
export async function getDoc(id) {
  return request(`/api/docs/${encodeURIComponent(id)}`);
}

// PATCH /api/docs/:id
export async function updateDoc(id, payload) {
  return request(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// DELETE /api/docs/:id
export async function deleteDoc(id) {
  return request(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

// POST /api/docs/:id/share
export async function shareDoc(id, email, role) {
  return request(`/api/docs/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    body: JSON.stringify({ email, role })
  });
}

// GET /api/docs/:id/shares
export async function getDocShares(id) {
  return request(`/api/docs/${encodeURIComponent(id)}/shares`);
}

// DELETE /api/docs/:id/share/:userId
export async function deleteDocShare(id, userId) {
  return request(`/api/docs/${encodeURIComponent(id)}/share/${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });
}

// POST /api/upload
export async function uploadDoc(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/upload', {
    method: 'POST',
    body: formData
  });
}
