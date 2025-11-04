const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

type ParamValue = string | number | boolean | undefined | null | Array<string | number | boolean>;

function buildUrl(path: string, params?: Record<string, ParamValue>) {
  const url = new URL(path, BACKEND_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          url.searchParams.append(k, String(item));
        }
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url;
}

async function handleResponse<T>(res: Response, url: URL, method: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text || text.trim() === "") {
    // Gracefully handle empty bodies (some endpoints may legitimately return no content)
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    // Provide a clearer error while avoiding the raw "Unexpected end of JSON input" crash
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(`Invalid JSON response from ${method} ${url}: ${err?.message || String(err)}. Body snippet: ${snippet}`);
  }
}

export async function apiGet<T>(path: string, params?: Record<string, ParamValue>) {
  const url = buildUrl(path, params);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  return handleResponse<T>(res, url, 'GET');
}

async function apiSend<T>(path: string, init: RequestInit & { params?: Record<string, ParamValue> }) {
  const { params, ...rest } = init;
  const url = buildUrl(path, params);
  const headers = new Headers(rest.headers);
  if (!headers.has('Content-Type') && rest.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (rest.method || 'GET').toUpperCase();
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    ...rest,
    headers,
  });
  return handleResponse<T>(res, url, method);
}

export async function apiPost<T>(path: string, body: unknown, params?: Record<string, string | number | boolean | undefined>) {
  return apiSend<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    params,
  });
}

// Meta-aware variants (returns headers and status along with parsed JSON)
async function apiSendWithMeta<T>(path: string, init: RequestInit & { params?: Record<string, ParamValue> }) {
  const { params, ...rest } = init;
  const url = buildUrl(path, params);
  const headers = new Headers(rest.headers);
  if (!headers.has('Content-Type') && rest.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (rest.method || 'GET').toUpperCase();
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    ...rest,
    headers,
  });
  const data = await handleResponse<T>(res, url, method);
  // Flatten headers into a simple record (lowercase keys)
  const metaHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    metaHeaders[key] = value;
  });
  return { data, headers: metaHeaders, status: res.status } as { data: T; headers: Record<string, string>; status: number };
}

export async function apiPostWithMeta<T>(path: string, body: unknown, params?: Record<string, string | number | boolean | undefined>) {
  return apiSendWithMeta<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    params,
  });
}

// Loose variant that does not throw on non-2xx; returns status and best-effort parsed body
export async function apiPostWithMetaLoose<T = unknown>(path: string, body: unknown, params?: Record<string, ParamValue>) {
  const url = buildUrl(path, params);
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = undefined;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const metaHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    metaHeaders[key] = value;
  });
  return { data: data as T, headers: metaHeaders, status: res.status } as { data: T; headers: Record<string, string>; status: number };
}

export async function apiPut<T>(path: string, body: unknown, params?: Record<string, string | number | boolean | undefined>) {
  return apiSend<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    params,
  });
}

export async function apiPatch<T>(path: string, body: unknown, params?: Record<string, string | number | boolean | undefined>) {
  return apiSend<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    params,
  });
}

export async function apiDelete(path: string, params?: Record<string, string | number | boolean | undefined>) {
  await apiSend<undefined>(path, {
    method: 'DELETE',
    params,
  });
}
