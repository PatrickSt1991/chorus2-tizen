/*
 * tizen-sw.js — Service Worker for Chorus2 on Tizen.
 *
 * Catches network requests whose host matches the configured Kodi host
 * and re-fetches them with an Authorization: Basic header. This covers
 * the loads that bypass the bootstrap's XHR/fetch patches — chiefly
 * <img src> and CSS background-image url() — because Kodi's web server
 * requires auth on every endpoint including /image/*.
 *
 * The bootstrap posts the Kodi host + auth via postMessage on register.
 * We claim clients immediately so the very first page load is intercepted.
 *
 * Phase 1 of chorus2-tizen-build-plan.md.
 */

var KODI_HOST = null; // e.g. "http://192.168.1.50:8080"
var KODI_AUTH = null; // e.g. "Basic <base64>"

self.addEventListener('install', function (e) {
  // Take over on next paint instead of waiting for clients to navigate away.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (e) {
  var data = e.data || {};
  if (data.type === 'tizen-config' && data.host && data.auth) {
    KODI_HOST = data.host;
    KODI_AUTH = data.auth;
  }
});

self.addEventListener('fetch', function (event) {
  // Until config arrives, pass through. Brief uncovered window on first
  // install — Chorus2 re-fetches images as the user navigates anyway.
  if (!KODI_HOST || !KODI_AUTH) return;

  var url = event.request.url;
  if (url.indexOf(KODI_HOST + '/') !== 0) return;

  // Don't re-handle requests that already carry Authorization (the XHR
  // patch did its job).
  if (event.request.headers.get('Authorization')) return;

  event.respondWith(reFetchWithAuth(event.request));
});

function reFetchWithAuth(req) {
  // Build a new Request with Authorization injected. Most image loads
  // come in as GETs with no body; this preserves method, headers,
  // credentials, and cache mode.
  var headers = new Headers(req.headers);
  headers.set('Authorization', KODI_AUTH);

  // <img> and CSS loads arrive as mode 'no-cors'. Re-issuing them as
  // 'cors' would trigger a preflight; Kodi doesn't speak CORS. Keep the
  // original mode and rely on Tizen's <access origin="*"/> whitelist to
  // permit the cross-origin request.
  var init = {
    method: req.method,
    headers: headers,
    mode: req.mode === 'navigate' ? 'same-origin' : req.mode,
    credentials: req.credentials,
    cache: req.cache,
    redirect: req.redirect,
    referrer: req.referrer,
    integrity: req.integrity
  };

  // GET/HEAD have no body; everything else, pass it through.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.clone().body;
  }

  return fetch(req.url, init).catch(function (err) {
    // Surface in the SW console for diagnostics. Returning a 502
    // response lets Chorus2's image fallback logic kick in instead of a
    // generic broken-image icon.
    console.warn('[tizen-sw] auth fetch failed for', req.url, err);
    return new Response('upstream fetch failed', {
      status: 502,
      statusText: 'tizen-sw: upstream fetch failed'
    });
  });
}
