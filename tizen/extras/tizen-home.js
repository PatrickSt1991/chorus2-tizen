/*
 * tizen-home.js — Estuary-style home overlay.
 *
 * Phase 2 of the reskin: when the user is on the app's home route, we
 * paint a custom horizontal-menu home screen on top of Chorus2's
 * vertical-sidebar layout. As soon as they navigate into Movies / TV /
 * Music / etc., the overlay hides and Chorus2's normal (dark-skinned)
 * pages take over.
 *
 * This intentionally bypasses the "no DOM restructure" rule from the
 * original brief — the user explicitly chose to trade upstream-merge
 * cleanliness for an actual Estuary feel.
 */
(function () {
    'use strict';

    if (window.TIZEN_SKIP_INDEX_BOOT) return; // videoPlayer.html doesn't get a home

    // Routes corresponding to each menu tile. Chorus2's hash router
    // accepts these without further help. Order matches the mockup.
    var MENU = [
        { hash: 'movies/recent',  label: 'MOVIES',
          icon: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 5v14M17 5v14M3 9h4M3 14h4M17 9h4M17 14h4"/>' },
        { hash: 'tvshows',        label: 'TV SHOWS',
          icon: '<rect x="2" y="6" width="20" height="13" rx="1"/><path d="M8 22h8M12 19v3"/>' },
        { hash: 'music',          label: 'MUSIC',
          icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
        { hash: 'browser',        label: 'BROWSER',
          icon: '<path d="M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4 9-4M12 11v10"/>' },
        { hash: 'search',         label: 'SEARCH',
          icon: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.6-4.6"/>' },
        { hash: 'settings',       label: 'SYSTEM',
          icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' }
    ];

    var overlay = null;
    var clockTimer = null;

    function svg(d) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
               d + '</svg>';
    }

    function build() {
        var el = document.createElement('div');
        el.id = 'tz-home';
        el.className = 'tz-home';
        el.innerHTML =
            '<div class="tz-home-fanart" id="tz-home-fanart"></div>' +
            '<div class="tz-home-fanart-overlay"></div>' +

            '<header class="tz-home-topbar">' +
              '<div class="tz-home-logo">CHORUS<strong>2</strong></div>' +
              '<div class="tz-home-clock-wrap">' +
                '<div class="tz-home-clock" id="tz-home-clock">--:--</div>' +
                '<div class="tz-home-date"  id="tz-home-date"></div>' +
              '</div>' +
            '</header>' +

            '<div class="tz-home-hero">' +
              '<div class="tz-home-hero-label">Welcome</div>' +
              '<div class="tz-home-hero-title">Chorus2 for Tizen</div>' +
              '<div class="tz-home-hero-meta">' +
                '<span id="tz-home-hero-kodi">Connecting to Kodi…</span>' +
                '<span class="tz-home-dot">●</span>' +
                '<span>Pick a category below</span>' +
              '</div>' +
            '</div>' +

            '<nav class="tz-home-menu" id="tz-home-menu">' +
              MENU.map(function (m, i) {
                  return '<div class="tz-home-menu-item' + (i === 0 ? ' tz-focused' : '') +
                         '" data-hash="' + m.hash + '" tabindex="0">' +
                         svg(m.icon) +
                         '<span>' + m.label + '</span>' +
                         '</div>';
              }).join('') +
            '</nav>' +

            '<div class="tz-home-hint">' +
              '<div><span class="tz-home-key">◀ ▶</span> Navigate</div>' +
              '<div><span class="tz-home-key">OK</span> Open</div>' +
              '<div><span class="tz-home-key">Back</span> Exit</div>' +
            '</div>';
        return el;
    }

    function tickClock() {
        var d = new Date();
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var hh = pad(d.getHours());
        var mm = pad(d.getMinutes());
        var clock = document.getElementById('tz-home-clock');
        var date = document.getElementById('tz-home-date');
        if (clock) clock.textContent = hh + ':' + mm;
        if (date) {
            var days   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
            var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
            date.textContent = days[d.getDay()] + ' · ' + d.getDate() + ' ' + months[d.getMonth()];
        }
    }

    // Show on home routes, hide everywhere else. Chorus2's hash router
    // treats empty hash / '#' / '#home' as the landing screen.
    function isHomeRoute() {
        var h = location.hash || '';
        return h === '' || h === '#' || h === '#home';
    }

    function applyVisibility() {
        if (!overlay) return;
        var on = isHomeRoute();
        overlay.style.display = on ? 'flex' : 'none';
        document.documentElement.classList.toggle('tz-home-open', on);

        if (on) {
            // Chorus2 auto-focuses its search input on boot. If it stays
            // as document.activeElement while our overlay is on, every
            // arrow / OK press opens the TV's on-screen keyboard (because
            // the underlying input still receives the key). Blur it.
            try {
                var ae = document.activeElement;
                if (ae && ae !== document.body && ae.blur) ae.blur();
            } catch (_) {}

            // Bootstrap's virtual cursor sits on top via z-index, but
            // Tizen WebKit can pick paint order over z-index in some
            // sibling situations. Re-append the cursor so it's the
            // last child of <body> — guaranteed paint order on top.
            var c = document.getElementById('tz-cursor');
            if (c) document.body.appendChild(c);
        }
    }

    function navigate(hash) {
        // Chorus2 listens to hashchange; setting location.hash drives it.
        location.hash = '#' + hash;
        // applyVisibility() fires via hashchange listener; nothing else
        // to do.
    }

    function wireMenu() {
        var items = overlay.querySelectorAll('.tz-home-menu-item');
        items.forEach(function (it) {
            it.addEventListener('click', function () {
                navigate(it.getAttribute('data-hash'));
            });
            // Track focus visually — works with the virtual cursor's
            // mousemove dispatch as well as keyboard tab.
            it.addEventListener('mouseenter', function () { setFocus(it); });
            it.addEventListener('focus',      function () { setFocus(it); });
        });
    }

    function setFocus(el) {
        if (!overlay) return;
        var prev = overlay.querySelector('.tz-home-menu-item.tz-focused');
        if (prev) prev.classList.remove('tz-focused');
        if (el)   el.classList.add('tz-focused');
    }

    // Pull a Kodi version string for the "Connecting to Kodi…" line.
    // Uses the patched fetch so auth is automatic.
    function updateKodiInfo() {
        var line = document.getElementById('tz-home-hero-kodi');
        if (!line) return;
        try {
            fetch('/jsonrpc?Application.GetProperties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'Application.GetProperties',
                    params: [['version']],
                    id: 'tz-home-info'
                })
            }).then(function (r) { return r.json(); })
              .then(function (j) {
                  var v = j && j.result && j.result.version;
                  if (v) {
                      line.textContent = 'Kodi v' + v.major +
                                         (v.tag && v.tag !== 'stable' ? ' (' + v.tag + ')' : '');
                  }
              })
              .catch(function () { line.textContent = 'Kodi'; });
        } catch (_) { /* fetch unavailable; leave placeholder */ }
    }

    // Boot once Chorus2 has had a moment to mount. Chorus2 inserts its
    // own chrome on $(document).ready; we insert after, then keep
    // ourselves on top via z-index + body re-append on each render.
    function install() {
        if (overlay) return;
        overlay = build();
        document.body.appendChild(overlay);
        wireMenu();
        tickClock();
        clockTimer = setInterval(tickClock, 15000);
        applyVisibility();
        updateKodiInfo();

        // We deliberately do NOT install a MutationObserver to keep the
        // overlay as last child — it fights with the bootstrap's
        // virtual-cursor observer (both want to be last sibling) and
        // can put the cursor on the wrong side of the paint order on
        // Tizen WebKit. z-index: 100000 on the overlay is enough to
        // beat Chorus2's chrome; cursor at z-index 2147483647 sits on
        // top of us; applyVisibility() re-appends the cursor whenever
        // we show.
    }

    function start() {
        if (document.body) install();
        else document.addEventListener('DOMContentLoaded', install);
    }

    // Give Chorus2 a small head-start so our overlay layers cleanly
    // on top of whatever it renders first.
    setTimeout(start, 400);

    window.addEventListener('hashchange', applyVisibility);

    // Belt-and-braces: while the overlay is open, blur any input
    // that grabs focus. Chorus2 auto-focuses search on boot and again
    // on Marionette re-renders — without this, every arrow / OK press
    // wakes the TV's on-screen keyboard. Bubble phase, runs after
    // whatever code did the focusing.
    document.addEventListener('focusin', function (e) {
        if (!overlay || overlay.style.display === 'none') return;
        var t = e.target;
        if (!t || !t.tagName) return;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') {
            try { t.blur(); } catch (_) {}
        }
    });
})();
