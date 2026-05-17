# Chorus2 for Samsung Tizen TV

[![Build Chorus2 Tizen](https://github.com/PatrickSt1991/chorus2-tizen/actions/workflows/build-tizen.yml/badge.svg?branch=tizen)](https://github.com/PatrickSt1991/chorus2-tizen/actions/workflows/build-tizen.yml)
[![Latest release](https://img.shields.io/github/v/release/PatrickSt1991/chorus2-tizen?include_prereleases&label=release)](https://github.com/PatrickSt1991/chorus2-tizen/releases)
[![License: GPL-2.0](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE)

Wraps the [Chorus2](https://github.com/xbmc/chorus2) Kodi web interface in a
Samsung Tizen `.wgt` and swaps the HTML5 `<video>` element for **Tizen
AVPlay**, so video playback gets hardware decoding (HEVC, AC3, etc.) on the
TV's native pipeline instead of being limited by the WebView.

The app talks JSON-RPC to a Kodi instance on your LAN and gives you a
native-feeling TV client for browsing and controlling your library.

> **This is not a port of Kodi.** It's a remote/streaming client that
> packages Chorus2 as a TV app. See [What works](#what-works) below for the
> capability ceiling.

---

## Install

1. **Download the latest `.wgt`** from the
   [Releases page](https://github.com/PatrickSt1991/chorus2-tizen/releases).
   Each push to the `tizen` branch produces a signed prerelease build.

2. **Enable Developer Mode** on your Samsung TV
   ([Samsung's instructions](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html))
   and put your dev-machine's IP into the TV's "Host PC IP" field.

3. **Sideload the `.wgt`**. Either:

   - via Tizen Studio's Device Manager → Permit to install → Drag-drop the file, or
   - from the command line:
     ```bash
     sdb connect <tv-ip>
     sdb install Chorus2-Tizen.wgt
     ```

4. **Launch** the app on your TV. On first run you'll see a setup screen.

5. **Enter your Kodi server details** — host/IP, port (default 8080),
   username, password — and press **Connect**. The app pings Kodi with the
   entered credentials and only proceeds if it gets a valid `pong` response,
   so bad config is caught up-front rather than stalling the UI.

---

## What works

- **Browse** your Kodi library — movies, TV shows, music, artists, albums
- **Play direct files** from the library (music + video) — video goes through
  Tizen AVPlay for hardware-accelerated decoding
- **Remote-control** a running Kodi instance (Chorus2's "Kodi" mode)
- **Settings, search, now-playing**
- **TV remote**:
  - Arrow keys + OK navigate (manual spatial navigation — Tizen 5 doesn't
    ship one)
  - Play / Pause / Track-prev / Track-next map to Chorus2's player controls
  - Back exits the current view; from root, exits the app
- **Authentication** via HTTP Basic — credentials are stored in
  `localStorage` and injected into XHR/fetch/WebSocket and the AVPlay
  streaming URL automatically
- **Cross-origin images** — a Service Worker intercepts `<img>` and CSS
  `url()` loads to Kodi and adds the auth header, since those don't go
  through the XHR/fetch patches

## What doesn't work

These are structural limits of Kodi's architecture or the JSON-RPC API —
they aren't fixable from a remote client. Use a different solution if you
need any of them:

- **Kodi addons** (`plugin://` URIs) — resolved server-side inside Kodi's
  Python interpreter; no playable stream URL is ever exposed via JSON-RPC
- **InputStream Adaptive** (DASH/HLS+DRM addons) — same reason
- **PVR / Live TV** backends
- **DRM-protected content**
- **DLNA / casting** to other devices

If you need addons or PVR, look at running Jellyfin + the
[jellyfin-tizen](https://github.com/jellyfin/jellyfin-tizen) client instead.

---

## Requirements

- Samsung TV with **Tizen 4.0 or later** (roughly 2018 and newer)
- A **Kodi v17+** server reachable on the same network as the TV
- Kodi's web interface enabled, with:
  - *Allow control of Kodi via HTTP* → on
  - *Allow remote control from applications on other systems* → on
  - HTTP Basic credentials configured (username + password)

---

## Build from source

The whole build runs through `tizen/build.sh`. We do **not** rebuild
Chorus2 itself from CoffeeScript source — we patch the prebuilt `dist/`
that upstream ships, then run `tizen build-web` + `tizen package`.

```bash
git clone https://github.com/PatrickSt1991/chorus2-tizen.git
cd chorus2-tizen

# Smoke-test the prepare pipeline without installing Tizen Studio:
bash tizen/build.sh --dry-run

# Full build (needs Tizen Studio CLI on PATH or in $TIZEN_BIN):
TIZEN_BIN=~/tizen-studio/tools/ide/bin/tizen \
TIZEN_PROFILE=Chorus2 \
  bash tizen/build.sh
# → release/Chorus2-Tizen.wgt
```

`build.sh` flags:

| Flag           | What it does                                                                   |
| -------------- | ------------------------------------------------------------------------------ |
| *(no flag)*    | Full pipeline: prepare + `tizen build-web` + `tizen package`                   |
| `--dry-run`    | Just the prepare steps (copy + sed-inject + icon resize). No Tizen CLI needed. |
| `--no-package` | Prepare + `tizen build-web`, but skip the interactive `tizen package`. CI use. |

### CI

`.github/workflows/build-tizen.yml` installs Tizen Studio 5.5 on
`ubuntu-latest`, creates a self-signed `Chorus2` cert + security profile,
runs `build.sh --no-package`, drives `tizen package` through an
expect-script (the CLI prompts for cert passwords interactively), then
uploads the signed `.wgt` as both a workflow artifact and a GitHub
prerelease. Every push to `tizen` produces a fresh build.

---

## How it works

The strategy is **"patch upstream's prebuilt `dist/`"** rather than
rebuilding Chorus2 from source:

```
chorus2-tizen/
├── dist/                            # upstream Chorus2 — DO NOT EDIT
├── src/                             # upstream Chorus2 source — DO NOT EDIT
├── tizen/
│   ├── wrapper/
│   │   ├── config.xml               # Tizen app manifest
│   │   ├── icon.png                 # app icon (resized to 117×117 at build time)
│   │   └── videoPlayer.html         # AVPlay-driven replacement for dist's
│   ├── extras/
│   │   ├── tizen-bootstrap.js       # patches: config + URL/auth/WebSocket
│   │   ├── tizen-sw.js              # image-auth Service Worker
│   │   ├── tizen.css                # AVPlay surface + TV focus styles
│   │   └── avplayVideoPlayer.js     # AVPlay reference (from jellyfin-tizen)
│   └── build.sh                     # prepare + tizen build-web + tizen package
└── .github/workflows/
    └── build-tizen.yml              # CI: produces a signed .wgt per push
```

At build time, `build.sh` copies `dist/*` into a build directory, layers
our wrapper and extras on top (overwriting `config.xml`, `videoPlayer.html`,
and the index entry point), sed-injects our bootstrap into `<head>`,
strips Chorus2's own `<script>` tag, then runs the Tizen CLI to web-build
and package.

`tizen-bootstrap.js` is the integration point. It:

- Shows a first-launch setup screen and pings Kodi with the entered creds
  before saving anything
- Patches `XMLHttpRequest`, `fetch`, and `WebSocket` so Chorus2's relative
  URLs land on the configured Kodi host with HTTP Basic auth
- Registers a Service Worker (`tizen-sw.js`) that catches `<img>` and CSS
  `url()` loads (which bypass XHR/fetch) and adds the auth header
- Registers Tizen media keys + implements spatial navigation for the
  arrow keys (Tizen 5 doesn't provide one)
- Dynamically loads `js/kodi-webinterface.js` only after config is verified

`videoPlayer.html` (our replacement for the upstream video.js one) drives
`webapis.avplay` directly: `open` → `setListener` → `SET_MODE_4K` →
`prepareAsync` → `setDisplayMethod(LETTER_BOX)` → `play`. Basic Auth is
embedded into the AVPlay URL as `http://user:pass@host:port/...` because
AVPlay's `open()` only takes a URL.

---

## Branches

- **`tizen`** — default branch. Everything in this README lives here.
- **`master`** — upstream Chorus2 tracking branch, kept clean so we can
  pull updates from
  [`xbmc/chorus2`](https://github.com/xbmc/chorus2) cleanly.

---

## Acknowledgments

- **[Chorus2](https://github.com/xbmc/chorus2)** by Jeremy Graham and the
  Kodi contributors — the web interface this app wraps. GPL-2.0.
- **[jellyfin-tizen-avplay](https://github.com/PatrickSt1991/tizen-jellyfin-avplay)** — the
  AVPlay shim was originally written there. GPL-2.0.
- The Tizen Web Application docs and AVPlay API reference at
  [docs.tizen.org](https://docs.tizen.org/).

## License

GPL-2.0, inherited from Chorus2. See [LICENSE](LICENSE).
