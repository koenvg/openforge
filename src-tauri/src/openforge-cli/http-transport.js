const DEFAULT_OPENFORGE_HTTP_PORT = '17422';
const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? DEFAULT_OPENFORGE_HTTP_PORT;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

export async function requestJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`OpenForge HTTP ${res.status}: ${detail}`);
  }

  return body;
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
