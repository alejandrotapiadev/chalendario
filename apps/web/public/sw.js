// Service worker: permite abrir la aplicación y consultar lo ya visto sin conexión.
//
// - La aplicación (HTML, JS, CSS): primero red y, si falla, lo guardado; los ficheros con hash
//   de /assets/ nunca cambian, así que van primero desde la caché.
// - Datos de la API (solo lectura): primero red y, si no hay conexión o el servidor falla, la
//   última respuesta guardada, marcada con `x-from-cache` para que la aplicación avise.
// - Nada que no sea un GET se guarda: sin conexión no se puede escribir.
//
// Privacidad: la caché de datos está por navegador, no por cuenta. Por eso la aplicación pide
// vaciarla (mensaje `clear-api-cache`) al cerrar sesión, al caducar la sesión y al entrar.

const SHELL_CACHE = 'shell-v1';
const API_CACHE = 'api-v1';
const NETWORK_TIMEOUT_MS = 4000;

/** Lecturas que se guardan. Sin export/feed/miembros ni avisos (dependen de la hora). */
const CACHEABLE_API = /^\/api\/(events(\/.*)?|calendars|categories|invitations|auth\/me)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL_CACHE && key !== API_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api-cache') event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.test(url.pathname)) event.respondWith(apiNetworkFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetCacheFirst(request));
  }
});

function fetchWithTimeout(request, ms) {
  return fetch(request, { signal: AbortSignal.timeout(ms) });
}

async function apiNetworkFirst(request) {
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    // Un fallo del servidor (5xx) no es una respuesta que valga: se usa lo guardado.
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    if (response.ok) {
      const copy = response.clone();
      caches.open(API_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { cacheName: API_CACHE });
    if (!cached) throw err;
    const headers = new Headers(cached.headers);
    headers.set('x-from-cache', '1');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
}

async function navigate(request) {
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
    }
    return response;
  } catch (err) {
    const cached = await caches.match('/', { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw err;
  }
}

async function assetCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
