// Small fetch helpers. Parent calls send the grown-up session token.
async function call(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body || {}),
};

const TOKEN_KEY = 'ss.parentToken';
export const parentToken = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

const ph = () => ({ 'x-parent-token': parentToken.get() || '' });
export const parentApi = {
  get: (url) => call('GET', url, undefined, ph()),
  post: (url, body) => call('POST', url, body || {}, ph()),
  put: (url, body) => call('PUT', url, body || {}, ph()),
};

/** How the server finds a brief again (daily brief or built-in test brief). */
export const briefRef = (brief) =>
  brief.source === 'daily' ? { kind: 'daily', track: brief.track } : { kind: 'sample', id: brief.id };
