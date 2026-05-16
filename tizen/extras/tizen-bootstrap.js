/*
 * tizen-bootstrap.js
 *
 * Runs before Chorus2's app code. Responsibilities:
 *   1. Storage + first-launch setup screen for Kodi host/credentials.
 *   2. Patch XMLHttpRequest and fetch so relative Chorus2 URLs go to the
 *      configured Kodi host with Basic Auth.
 *   3. Patch WebSocket constructor so notifications use the configured host
 *      (Kodi's port 9090 channel is unauthenticated — only host/port needs
 *      rewriting).
 *   4. Register tizen-sw.js and hand it the Kodi host + auth so image and
 *      media loads (which don't go through XHR/fetch) get an Authorization
 *      header injected at the network layer.
 *   5. Expose TIZEN_KODI_HOST / TIZEN_KODI_AUTH / TIZEN_RESOLVE_URL globals
 *      for later phases (AVPlay swap will need them).
 *
 * Phase 1 of chorus2-tizen-build-plan.md.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'chorus2-tizen-config';

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // Setup form rendered when no config is stored. Plain DOM, large text +
  // visible focus rings so it works with the TV remote out of the box.
  function showSetupScreen(existing) {
    document.documentElement.style.background = '#101418';
    document.body.innerHTML = '';
    document.body.style.cssText =
      'margin:0;padding:0;background:#101418;color:#e6e6e6;' +
      'font:18px system-ui,Arial,sans-serif;min-height:100vh;';

    var wrap = document.createElement('div');
    wrap.style.cssText =
      'max-width:560px;margin:6vh auto;padding:32px 40px;' +
      'background:#1a1f24;border-radius:10px;box-shadow:0 2px 24px rgba(0,0,0,.4);';

    wrap.innerHTML =
      '<h1 style="margin:0 0 8px;font-size:28px;font-weight:600">Chorus2 for Tizen</h1>' +
      '<p style="margin:0 0 24px;color:#9aa4ae">Connect to your Kodi server.</p>' +
      '<form id="tz-setup">' +
      field('host', 'Kodi host or IP', existing && existing.host || '', 'text', 'e.g. 192.168.1.50') +
      field('port', 'HTTP port', existing && existing.port || '8080', 'number', '8080') +
      field('username', 'Username', existing && existing.username || 'kodi', 'text', 'kodi') +
      field('password', 'Password', existing && existing.password || '', 'password', '') +
      '<div style="display:flex;gap:12px;margin-top:8px">' +
        button('save', 'Save and connect', true) +
        button('reset', 'Reset', false) +
      '</div>' +
      '<p id="tz-err" style="color:#ff6b6b;min-height:1.4em;margin:12px 0 0"></p>' +
      '</form>';
    document.body.appendChild(wrap);

    var form = document.getElementById('tz-setup');
    form.host.focus();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cfg = {
        host: form.host.value.trim(),
        port: form.port.value.trim() || '8080',
        username: form.username.value,
        password: form.password.value
      };
      if (!cfg.host) {
        document.getElementById('tz-err').textContent = 'Host is required.';
        return;
      }
      saveConfig(cfg);
      location.reload();
    });

    document.getElementById('tz-reset').addEventListener('click', function (e) {
      e.preventDefault();
      clearConfig();
      location.reload();
    });
  }

  function field(name, label, value, type, placeholder) {
    var v = String(value).replace(/"/g, '&quot;');
    var p = String(placeholder).replace(/"/g, '&quot;');
    return (
      '<label style="display:block;margin:0 0 18px">' +
        '<span style="display:block;margin:0 0 6px;color:#9aa4ae;font-size:14px">' + label + '</span>' +
        '<input name="' + name + '" type="' + type + '" value="' + v + '" placeholder="' + p + '" ' +
        'style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:18px;' +
        'background:#0d1115;border:2px solid #2a323a;border-radius:6px;color:#e6e6e6;outline:none">' +
      '</label>'
    );
  }

  function button(id, label, primary) {
    var bg = primary ? '#2e7dd7' : '#2a323a';
    return (
      '<button id="tz-' + id + '" type="' + (primary ? 'submit' : 'button') + '" ' +
      'style="padding:12px 20px;font-size:16px;border:0;border-radius:6px;cursor:pointer;' +
      'background:' + bg + ';color:#fff">' + label + '</button>'
    );
  }

  // Inject a focus-ring style early so the setup form is remote-navigable.
  (function injectFocusCss() {
    var s = document.createElement('style');
    s.textContent = '#tz-setup input:focus,#tz-setup button:focus{outline:3px solid #6ab0ff;outline-offset:2px;border-color:#6ab0ff}';
    document.head.appendChild(s);
  })();

  // Chorus2's bundle is NOT in <script> tags in our packaged index.html
  // (build.sh strips it). The bootstrap loads it dynamically only when
  // config is present, so the setup screen never has to compete with
  // Chorus2's own DOM mutations on first launch.
  function loadChorus2() {
    var s = document.createElement('script');
    s.src = 'js/kodi-webinterface.js';
    document.body.appendChild(s);
  }

  var cfg = loadConfig();
  if (!cfg || !cfg.host) {
    // Defer until DOM is ready so document.body exists.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        showSetupScreen(cfg);
      });
    } else {
      showSetupScreen(cfg);
    }
    return; // Chorus2 does not load until the user provides config.
  }

  // --- Config is present: wire everything up before Chorus2 loads. ---

  var KODI_HOST = 'http://' + cfg.host + ':' + cfg.port;
  var KODI_AUTH = 'Basic ' + btoa(cfg.username + ':' + cfg.password);

  window.TIZEN_KODI_HOST = KODI_HOST;
  window.TIZEN_KODI_AUTH = KODI_AUTH;
  window.TIZEN_KODI_USER = cfg.username;
  window.TIZEN_KODI_PASS = cfg.password;
  window.TIZEN_USE_AVPLAY = true; // Phase 3 reads this flag.

  // True when a URL string is same-origin (or root-relative).
  // We treat anything that isn't absolute with a different host as
  // "for Kodi" — Chorus2 has no other backend.
  function isLocalish(url) {
    if (!url) return false;
    if (/^[a-z]+:\/\//i.test(url)) return false; // absolute, different host
    return true;
  }

  // Resolve a Chorus2-relative path to an absolute Kodi URL, preserving
  // query strings. Used by both XHR/fetch patches and exposed for late
  // patches (e.g. Api.Files::downloadPath in Phase 3).
  function resolveUrl(path) {
    if (!path) return path;
    if (/^[a-z]+:\/\//i.test(path)) return path;
    if (/^image:\/\//i.test(path)) {
      // Kodi internal — wrap through /image/<encoded>.
      return KODI_HOST + '/image/' + encodeURIComponent(path);
    }
    return KODI_HOST + (path.charAt(0) === '/' ? path : '/' + path);
  }
  window.TIZEN_RESOLVE_URL = resolveUrl;

  // --- XHR patch ---
  var OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    var xhr = new OrigXHR();
    var origOpen = xhr.open;
    xhr.open = function (method, url) {
      if (isLocalish(url)) url = resolveUrl(url);
      var args = [method, url].concat(Array.prototype.slice.call(arguments, 2));
      var ret = origOpen.apply(this, args);
      try {
        this.setRequestHeader('Authorization', KODI_AUTH);
      } catch (e) { /* setRequestHeader can fail on certain states; ignore */ }
      return ret;
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // --- fetch patch ---
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      var headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) headers.set('Authorization', KODI_AUTH);
      init.headers = headers;
      if (typeof input === 'string' && isLocalish(input)) {
        input = resolveUrl(input);
      } else if (input && typeof input.url === 'string' && isLocalish(input.url)) {
        input = new Request(resolveUrl(input.url), input);
      }
      return origFetch(input, init);
    };
  }

  // --- WebSocket patch ---
  // Chorus2 builds ws URLs from config.socketsHost + ':' + socketsPort.
  // Kodi's port 9090 JSON-RPC channel is unauthenticated, so we only need
  // to rewrite host/port — no userinfo needed.
  if (typeof window.WebSocket === 'function') {
    var OrigWS = window.WebSocket;
    function PatchedWS(url, protocols) {
      try {
        var u = new URL(url, location.href);
        // Rewrite to the configured Kodi host on its WS port. Chorus2 also
        // exposes socketsPort in settings; default 9090.
        u.protocol = 'ws:';
        u.hostname = cfg.host;
        if (!u.port || u.port === '0') u.port = '9090';
        url = u.toString();
      } catch (e) { /* malformed URL — pass through */ }
      return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    }
    PatchedWS.prototype = OrigWS.prototype;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN = OrigWS.OPEN;
    PatchedWS.CLOSING = OrigWS.CLOSING;
    PatchedWS.CLOSED = OrigWS.CLOSED;
    window.WebSocket = PatchedWS;
  }

  // --- Service Worker registration for image/media auth ---
  // <img src> and CSS url() loads don't go through our XHR/fetch patches.
  // The SW intercepts those at the network layer and re-fetches with the
  // Authorization header.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('tizen-sw.js').then(function (reg) {
      // Send config to whichever worker is or will be active.
      function postCfg(worker) {
        if (worker) worker.postMessage({
          type: 'tizen-config',
          host: KODI_HOST,
          auth: KODI_AUTH
        });
      }
      postCfg(reg.active);
      postCfg(reg.waiting);
      postCfg(reg.installing);
      if (navigator.serviceWorker.controller) {
        postCfg(navigator.serviceWorker.controller);
      }
      reg.addEventListener('updatefound', function () {
        postCfg(reg.installing);
      });
    }).catch(function (err) {
      // Non-fatal — auth-protected images will fail but everything else
      // works. Surface in console for diagnosis.
      console.warn('[tizen-bootstrap] service worker registration failed:', err);
    });
  }

  // Late patches that depend on Chorus2's globals being available are
  // wired in Phase 3 (AVPlay swap touches Api.Files::downloadPath and
  // document.createElement('video')). Phase 1/2 leave them alone.

  // All patches are in place. Load Chorus2.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadChorus2);
  } else {
    loadChorus2();
  }
})();
