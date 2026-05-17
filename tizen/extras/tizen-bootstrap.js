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

  // Setup form rendered when no config is stored. The submit handler runs
  // a JSONRPC.Ping pre-flight against the entered server before saving —
  // turns the post-submit Chorus2 loading-screen hang into an actionable
  // diagnostic when host/auth is wrong.
  function showSetupScreen(existing) {
    // Chorus2's base.css sets body{display:table-cell;padding:15px} which
    // breaks our centred layout (no horizontal space left for `margin:auto`
    // to distribute). It also styles #loading-page and various other
    // elements. Disable it entirely while the setup screen is up — the
    // page reloads after submit so the stylesheet comes back online for
    // Chorus2 to use.
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.indexOf('themes/') >= 0 || href.indexOf('base.css') >= 0) {
        links[i].disabled = true;
      }
    }

    document.documentElement.style.cssText =
      'background:#0a0e13;' +
      'background:#0a0e13 radial-gradient(ellipse at top, #1a2336 0%, #0a0e13 60%);';
    document.body.innerHTML = '';
    document.body.style.cssText =
      'margin:0;padding:0;color:#f0f4fa;' +
      'font:20px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
      'min-height:100vh;background:transparent;' +
      // Override base.css `body{display:table-cell;padding:15px}` which
      // collapses the body to its content width and breaks `margin:auto`.
      'display:block;width:100%;box-sizing:border-box;';

    var wrap = document.createElement('div');
    wrap.style.cssText =
      'max-width:680px;margin:5vh auto;padding:40px 48px 36px;' +
      'background:#141a26;border:1px solid #232c3d;border-radius:14px;' +
      'box-shadow:0 12px 48px rgba(0,0,0,.55),0 2px 0 rgba(255,255,255,.03) inset;';

    // The logo is the same icon.png the .wgt ships at root. The gradient
    // tile behind it remains visible if the <img> ever fails to load —
    // no inline onerror attribute needed (Tizen's WAS rejects inline
    // event handlers, which was causing install to abort silently).
    wrap.innerHTML =
      // Header — logo + title side by side (no CSS gap; margin-left does it)
      '<div style="display:flex;align-items:center;margin:0 0 4px">' +
        '<div style="width:48px;height:48px;border-radius:11px;overflow:hidden;' +
        'background:linear-gradient(135deg,#4ea1ff,#2563eb);' +
        'display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 3px 10px rgba(78,161,255,.22)">' +
          '<img src="icon.png" alt="" id="tz-logo" ' +
          'style="width:48px;height:48px;display:block">' +
        '</div>' +
        '<h1 style="margin:0 0 0 18px;font-size:30px;font-weight:700;' +
        'color:#ffffff;letter-spacing:-.01em;line-height:1.1">Chorus2 <span style="font-weight:400;color:#9aa6b8">for Tizen</span></h1>' +
      '</div>' +
      '<p style="margin:6px 0 24px 66px;color:#c8d2dd;font-size:16px">' +
        'Point this app at your Kodi server to get started.' +
      '</p>' +
      '<div style="height:1px;background:#232c3d;margin:0 0 24px"></div>' +

      '<form id="tz-setup" autocomplete="off">' +
        // Server section
        section('Server') +
        field('host',     'Kodi host or IP', existing && existing.host || '',          'text',   'e.g. 192.168.1.50') +
        field('port',     'HTTP port',       existing && existing.port || '8080',      'number', '8080') +

        // Auth section
        section('Authentication', '32px') +
        field('username', 'Username',        existing && existing.username || 'kodi', 'text',     'kodi') +
        field('password', 'Password',        existing && existing.password || '',     'password', 'Your Kodi password') +

        // Actions — no CSS gap; margin-left on the second button instead
        '<div style="display:flex;margin-top:32px">' +
          button('save',  'Connect',  true) +
          '<span style="display:inline-block;width:14px"></span>' +
          button('reset', 'Reset',    false) +
        '</div>' +

        // Status line — no CSS gap; margin-right on the dot instead
        '<div id="tz-status" style="margin:22px 0 0;padding:16px 18px;' +
            'background:#0d1218;border:1px solid #232c3d;border-radius:10px;' +
            'color:#c8d2dd;font-size:16px;min-height:1.3em;display:flex;align-items:center">' +
          '<span id="tz-status-dot" style="width:10px;height:10px;border-radius:50%;background:#4a5566;flex:none;margin-right:12px"></span>' +
          '<span id="tz-status-text">Ready. Enter your Kodi details and press Connect.</span>' +
        '</div>' +

        // Hint
        '<p style="color:#9aa6b8;font-size:14px;margin:18px 0 0;text-align:center">' +
          'Use <kbd style="padding:1px 6px;background:#232c3d;border-radius:4px;color:#d0d8e3;font:inherit">↑</kbd> ' +
          '<kbd style="padding:1px 6px;background:#232c3d;border-radius:4px;color:#d0d8e3;font:inherit">↓</kbd> ' +
          'or <kbd style="padding:1px 8px;background:#232c3d;border-radius:4px;color:#d0d8e3;font:inherit">OK</kbd> ' +
          'to move between fields. <kbd style="padding:1px 8px;background:#232c3d;border-radius:4px;color:#d0d8e3;font:inherit">Back</kbd> exits.' +
        '</p>' +
      '</form>';
    document.body.appendChild(wrap);

    // Hide the logo via JS if it ever fails to load — same effect as the
    // old inline onerror attribute but no CSP violation. (Tizen WAS
    // rejects inline event handlers; that's what caused the silent
    // install failure in commit 9f44b16.)
    var logo = document.getElementById('tz-logo');
    if (logo) {
      logo.addEventListener('error', function () { logo.style.display = 'none'; });
    }

    var form = document.getElementById('tz-setup');
    form.host.focus();

    function focusables() {
      return [form.host, form.port, form.username, form.password,
              document.getElementById('tz-save'),
              document.getElementById('tz-reset')];
    }

    function shiftFocus(delta) {
      var list = focusables();
      var idx = list.indexOf(document.activeElement);
      if (idx < 0) idx = 0;
      var next = Math.max(0, Math.min(list.length - 1, idx + delta));
      list[next].focus();
      if (list[next].select) try { list[next].select(); } catch (_) {}
    }

    form.addEventListener('keydown', function (e) {
      var list = focusables();
      var idx = list.indexOf(document.activeElement);
      var isInput = document.activeElement &&
                    document.activeElement.tagName === 'INPUT';
      switch (e.keyCode) {
        case 38: shiftFocus(-1); e.preventDefault(); break; // Up
        case 40: shiftFocus(+1); e.preventDefault(); break; // Down
        case 13: // OK / Enter — advance from early input, fall through on password/buttons
          if (isInput && idx < list.length - 3) {
            shiftFocus(+1);
            e.preventDefault();
          }
          break;
        case 10009: // Tizen Back
          try { tizen.application.getCurrentApplication().exit(); } catch (_) {}
          e.preventDefault();
          break;
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cfg = readForm(form);
      if (!cfg.host) {
        setStatus('error', 'Host is required.');
        form.host.focus();
        return;
      }
      runConnectionTest(cfg);
    });

    document.getElementById('tz-reset').addEventListener('click', function (e) {
      e.preventDefault();
      clearConfig();
      location.reload();
    });

    // Pre-flight: ping Kodi's JSON-RPC with the entered creds. Five-second
    // timeout. On success, save + reload (Chorus2 boots with verified
    // creds). On failure, show what specifically went wrong.
    function runConnectionTest(cfg) {
      setBusy(true);
      setStatus('busy', 'Connecting to ' + cfg.host + ':' + cfg.port + '…');

      var url = 'http://' + cfg.host + ':' + cfg.port + '/jsonrpc';
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timeoutId = setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, 5000);

      // Use the original XHR via fetch directly — the patches haven't
      // been installed yet (we're in the no-config branch), so this hits
      // Kodi exactly the way a vanilla fetch would.
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa(cfg.username + ':' + cfg.password)
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'JSONRPC.Ping', id: 1 }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        clearTimeout(timeoutId);
        if (res.status === 200) {
          return res.json().then(function (body) {
            if (body && body.result === 'pong') {
              setStatus('ok', 'Connected. Loading Chorus2…');
              saveConfig(cfg);
              setTimeout(function () { location.reload(); }, 350);
            } else {
              setBusy(false);
              setStatus('error', 'Reached the server, but it does not look like Kodi (no pong).');
            }
          }, function () {
            setBusy(false);
            setStatus('error', 'Reached the server, but it returned a non-JSON response.');
          });
        }
        setBusy(false);
        if (res.status === 401) {
          setStatus('error', 'Authentication failed (401). Check the username and password.');
          form.username.focus();
        } else if (res.status === 403) {
          setStatus('error', 'Forbidden (403). Enable "Allow remote control via HTTP" in Kodi.');
        } else if (res.status === 404) {
          setStatus('error', 'Got 404 from /jsonrpc. Is this really a Kodi web server?');
        } else {
          setStatus('error', 'HTTP ' + res.status + ' from Kodi.');
        }
      }).catch(function (err) {
        clearTimeout(timeoutId);
        setBusy(false);
        var msg = String(err && err.message || err);
        if (msg.indexOf('aborted') >= 0 || msg.indexOf('timeout') >= 0) {
          setStatus('error', 'Timed out after 5s. Is the host reachable and Kodi running?');
        } else {
          setStatus('error', 'Network error: ' + msg);
        }
      });
    }

    function setBusy(busy) {
      var btn = document.getElementById('tz-save');
      btn.disabled = busy;
      btn.style.opacity = busy ? '.6' : '1';
      btn.textContent = busy ? 'Connecting…' : 'Connect';
    }

    function setStatus(kind, msg) {
      var colors = { busy: '#4ea1ff', ok: '#4ade80', error: '#ff8080', idle: '#4a5566' };
      var textColors = { busy: '#a8b3c2', ok: '#bbf7d0', error: '#ffd0d0', idle: '#a8b3c2' };
      document.getElementById('tz-status-dot').style.background = colors[kind] || colors.idle;
      var t = document.getElementById('tz-status-text');
      t.textContent = msg;
      t.style.color = textColors[kind] || textColors.idle;
    }
  }

  function readForm(form) {
    return {
      host: form.host.value.trim(),
      port: form.port.value.trim() || '8080',
      username: form.username.value,
      password: form.password.value
    };
  }

  function section(title, topMargin) {
    return (
      '<div style="margin:' + (topMargin || '0') + ' 0 14px;font-size:12px;' +
      'letter-spacing:.12em;text-transform:uppercase;color:#7a8694;font-weight:600">' +
      title + '</div>'
    );
  }

  function field(name, label, value, type, placeholder) {
    var v = String(value).replace(/"/g, '&quot;');
    var p = String(placeholder).replace(/"/g, '&quot;');
    return (
      '<label style="display:block;margin:0 0 16px">' +
        '<span style="display:block;margin:0 0 7px;color:#d0d8e3;font-size:14px;font-weight:500">' + label + '</span>' +
        '<input name="' + name + '" type="' + type + '" value="' + v + '" placeholder="' + p + '" ' +
        'autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" ' +
        'style="width:100%;box-sizing:border-box;padding:14px 16px;font-size:20px;font-weight:500;' +
        'background:#0d1218;border:2px solid #2a3242;border-radius:10px;color:#ffffff;' +
        '-webkit-text-fill-color:#ffffff;caret-color:#4ea1ff;' +
        'outline:none;font-family:inherit;' +
        '-webkit-transition:border-color .15s,box-shadow .15s;transition:border-color .15s,box-shadow .15s">' +
      '</label>'
    );
  }

  function button(id, label, primary) {
    var bg, color, border, shadow;
    if (primary) {
      bg = 'linear-gradient(180deg,#4ea1ff 0%,#2e7dd7 100%)';
      color = '#fff';
      border = '#2e7dd7';
      shadow = '0 4px 12px rgba(78,161,255,.25)';
    } else {
      bg = '#1f2837';
      color = '#d0d8e3';
      border = '#2a3242';
      shadow = 'none';
    }
    return (
      '<button id="tz-' + id + '" type="' + (primary ? 'submit' : 'button') + '" ' +
      'style="padding:14px 32px;font-size:18px;font-weight:600;border:1px solid ' + border + ';' +
      'border-radius:10px;cursor:pointer;background:' + bg + ';color:' + color + ';' +
      'box-shadow:' + shadow + ';' +
      'font-family:inherit;-webkit-transition:transform .1s,box-shadow .15s;' +
      'transition:transform .1s,box-shadow .15s">' + label + '</button>'
    );
  }

  // Inject a focus-ring style early so the setup form is remote-navigable.
  // Multiple placeholder selectors for Tizen 5 WebKit compatibility.
  (function injectFocusCss() {
    var s = document.createElement('style');
    s.textContent = (
      // Focus indicator. Tizen 5 / Chromium 47 honours classic outline +
      // box-shadow. !important defeats any base style that may follow.
      '#tz-setup input:focus,#tz-setup button:focus{' +
        'outline:none !important;' +
        'border-color:#4ea1ff !important;' +
        'box-shadow:0 0 0 4px rgba(78,161,255,.35) !important' +
      '}' +
      // Placeholder color: vendor-prefixed for older WebKit (Tizen 4–5),
      // Mozilla-prefixed for completeness, plus the modern selector.
      '#tz-setup input::-webkit-input-placeholder{color:#c8d0db;opacity:1}' +
      '#tz-setup input:-ms-input-placeholder{color:#c8d0db;opacity:1}' +
      '#tz-setup input::-moz-placeholder{color:#c8d0db;opacity:1}' +
      '#tz-setup input::placeholder{color:#c8d0db;opacity:1}' +
      '#tz-setup button[disabled]{cursor:default;opacity:.65}' +
      // Press feedback
      '#tz-setup button:active{transform:translateY(1px)}'
    );
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

  // Headless mode: secondary pages (currently just videoPlayer.html) set
  // window.TIZEN_SKIP_INDEX_BOOT = true before loading this script. In
  // that mode we wire up the patches + URL helpers but skip the setup
  // screen and the dynamic Chorus2 load — those only belong on index.html.
  var SKIP_INDEX_BOOT = !!window.TIZEN_SKIP_INDEX_BOOT;

  var cfg = loadConfig();
  if (!cfg || !cfg.host) {
    if (SKIP_INDEX_BOOT) {
      // Secondary page reached without config — happens if the user
      // bookmarks videoPlayer.html, or if localStorage gets cleared
      // mid-session. Send them back to the entry point.
      console.warn('[tizen-bootstrap] no config in headless mode; navigating to index');
      location.replace('index.html');
      return;
    }
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

  // Headless mode: stop here. videoPlayer.html drives AVPlay itself,
  // including its own remote-key handling.
  if (SKIP_INDEX_BOOT) return;

  // --- TV remote keys + spatial navigation (Phase 4) --------------------
  // Tizen 5 does not provide built-in spatial navigation for web apps, so
  // we implement it manually. Arrow keys score every visible focusable
  // element by geometric distance in the requested direction + axis
  // alignment, and focus the best one. OK fires a click on the focused
  // element when it isn't a native activator (anchors and buttons handle
  // OK themselves; <div tabindex="0"> doesn't).
  //
  // We also expand the tabindex pass: most of Chorus2's clickable
  // surfaces (list items, control buttons, card tiles) are <div> or <li>
  // without tabindex.

  function registerTVKeys() {
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
    var keys = [
      'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind',
      'MediaTrackPrevious', 'MediaTrackNext'
    ];
    keys.forEach(function (k) {
      try { tizen.tvinputdevice.registerKey(k); }
      catch (e) { /* unsupported key on this firmware; ignore */ }
    });
  }
  registerTVKeys();

  function clickIfFound(selector) {
    var el = document.querySelector(selector);
    if (el) { el.click(); return true; }
    return false;
  }

  // --- Virtual mouse cursor ---------------------------------------------
  // Chorus2 was designed mouse-first — most clickable surfaces are <div>
  // or <li> with delegated jQuery click handlers, not focusable elements.
  // Spatial keyboard navigation on top of that was always a stretch.
  //
  // Instead we render a real mouse pointer that the TV remote drives:
  //   Arrow keys move the cursor 80px in that direction. When the cursor
  //   reaches the edge of the viewport we scroll the page instead.
  //   OK dispatches a full mousedown/mouseup/click sequence at the cursor
  //   position, picking up whatever Chorus2 has rendered there via
  //   document.elementFromPoint(). Same path the real mouse would take,
  //   so jQuery delegated handlers all fire normally.
  //
  // We listen in capture phase so Chorus2's `$(document).keydown`
  // (which would otherwise forward arrows to Kodi as remote-control
  // commands) never sees the event when we consume it.

  // Cursor step is acceleration-based, not fixed.
  //   BASE_STEP    — pixels for a single tap (fine selection)
  //   STREAK_INC   — extra pixels added per consecutive same-direction
  //                  keydown within REPEAT_WINDOW ms (so a held key ramps up)
  //   STREAK_CAP   — max number of streak increments (caps top speed)
  //   REPEAT_WINDOW — time since last arrow press that still counts as
  //                  "continuation" of a hold; longer than this resets to base.
  // First tap = 24px. Held tenth tap = 24 + 12*10 = 144px per step.
  var BASE_STEP     = 24;
  var STREAK_INC    = 12;
  var STREAK_CAP    = 10;
  var REPEAT_WINDOW = 250;    // ms
  var EDGE_PAD      = 12;     // pixels from viewport edge that triggers a page scroll

  var cursor = null;
  var cx = 0, cy = 0;
  var lastArrowKey = 0;
  var lastArrowTs = 0;
  var arrowStreak = 0;

  function getStep(key) {
    var now = Date.now();
    if (key === lastArrowKey && now - lastArrowTs < REPEAT_WINDOW) {
      arrowStreak = Math.min(arrowStreak + 1, STREAK_CAP);
    } else {
      // Different direction, or paused long enough — start fine again.
      arrowStreak = 0;
    }
    lastArrowKey = key;
    lastArrowTs = now;
    return BASE_STEP + arrowStreak * STREAK_INC;
  }

  function installCursor() {
    if (cursor) {
      // Already constructed but possibly detached — reuse it.
      attachCursor();
      return;
    }
    cursor = document.createElement('div');
    cursor.id = 'tz-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:28px;height:28px;' +
      'pointer-events:none;z-index:2147483647;' +
      '-webkit-transform:translate3d(-100px,-100px,0);' +
      'transform:translate3d(-100px,-100px,0);' +
      'will-change:transform';
    cursor.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" ' +
      'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">' +
      '<path d="M4 3 L24 14 L15 15 L11 24 Z" fill="#ffffff" stroke="#000000" ' +
      'stroke-width="1.5" stroke-linejoin="round"/></svg>';
    attachCursor();

    cx = Math.round(window.innerWidth / 2);
    cy = Math.round(window.innerHeight / 2);
    setCursor(cx, cy);

    // Chorus2's Marionette views wipe and rerender body content during
    // startup (Application.start, layout regions, fanart, etc.). Each
    // wipe pulls our cursor out of the DOM. Re-attach whenever the
    // body's children change and we discover the cursor isn't there.
    if (typeof MutationObserver === 'function') {
      var obs = new MutationObserver(function () {
        if (!cursor.parentNode) attachCursor();
      });
      obs.observe(document.body, { childList: true, subtree: false });
    }
  }

  function attachCursor() {
    // Always append last so the cursor is the latest sibling and wins
    // any z-index tie among elements at the body level.
    if (cursor.parentNode !== document.body) {
      document.body.appendChild(cursor);
    }
  }

  function setCursor(x, y) {
    cx = Math.max(0, Math.min(window.innerWidth  - 4, x));
    cy = Math.max(0, Math.min(window.innerHeight - 4, y));
    var t = 'translate3d(' + cx + 'px,' + cy + 'px,0)';
    cursor.style.transform = t;
    cursor.style.webkitTransform = t;
    // Dispatch mousemove so Chorus2's hover styles light up under the
    // cursor. The target is whatever sits beneath this exact pixel.
    var under = document.elementFromPoint(cx, cy);
    if (under) {
      under.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0
      }));
    }
  }

  function moveCursor(dx, dy) {
    var nx = cx + dx;
    var ny = cy + dy;
    // If we'd run off the edge, scroll the page instead so the user can
    // reach off-screen content without the cursor getting stuck.
    if (nx < EDGE_PAD)                           { window.scrollBy(dx, 0); nx = EDGE_PAD; }
    else if (nx > window.innerWidth  - EDGE_PAD) { window.scrollBy(dx, 0); nx = window.innerWidth  - EDGE_PAD; }
    if (ny < EDGE_PAD)                           { window.scrollBy(0, dy); ny = EDGE_PAD; }
    else if (ny > window.innerHeight - EDGE_PAD) { window.scrollBy(0, dy); ny = window.innerHeight - EDGE_PAD; }
    setCursor(nx, ny);
  }

  function clickAtCursor() {
    var target = document.elementFromPoint(cx, cy);
    if (!target) return;
    // Full mousedown/mouseup/click chain so jQuery delegated handlers
    // (Chorus2 uses jQuery + Marionette throughout) fire as if the user
    // had clicked with a real mouse.
    ['mousedown', 'mouseup', 'click'].forEach(function (type) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0,
        detail: type === 'click' ? 1 : 0
      }));
    });
  }

  // Install the cursor as soon as the body exists.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCursor);
  } else {
    installCursor();
  }

  // Capture-phase keydown so Chorus2's bubble-phase jQuery handler
  // never sees the arrows / OK / Back we consume.
  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case 37: // ArrowLeft
        e.preventDefault(); e.stopImmediatePropagation();
        moveCursor(-getStep(37), 0);
        break;
      case 38: // ArrowUp
        e.preventDefault(); e.stopImmediatePropagation();
        moveCursor(0, -getStep(38));
        break;
      case 39: // ArrowRight
        e.preventDefault(); e.stopImmediatePropagation();
        moveCursor(getStep(39), 0);
        break;
      case 40: // ArrowDown
        e.preventDefault(); e.stopImmediatePropagation();
        moveCursor(0, getStep(40));
        break;
      case 13: // OK / Enter — click whatever's under the cursor
        e.preventDefault(); e.stopImmediatePropagation();
        clickAtCursor();
        break;
      case 10009: // Tizen Back / Return
        e.preventDefault(); e.stopImmediatePropagation();
        if (location.hash && location.hash !== '#' && location.hash !== '#home') {
          history.back();
        } else {
          try {
            tizen.application.getCurrentApplication().exit();
          } catch (_) { /* not in Tizen WebView */ }
        }
        break;
      case 415:   // Tizen Play
      case 19:    // Tizen Pause
      case 10252: // Tizen PlayPause
      case 413:   // Tizen Stop
        if (clickIfFound('.control-play')) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      case 10232: // Tizen TrackPrevious
        if (clickIfFound('.control-prev')) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      case 10233: // Tizen TrackNext
        if (clickIfFound('.control-next')) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
    }
  }, true); // capture phase

  // All patches are in place. Load Chorus2.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadChorus2);
  } else {
    loadChorus2();
  }
})();
