#!/usr/bin/env bash
#
# tizen/build.sh — Build the Chorus2 Tizen .wgt package.
#
# Pipeline (mirrors §7 of chorus2-tizen-build-plan.md):
#   1. Copy upstream dist/ into build/
#   2. Drop in our wrapper (config.xml, icon.png) and extras
#      (tizen-bootstrap.js, tizen-sw.js, tizen.css, avplayVideoPlayer.js)
#   3. Inject our <link>/<script> into <head> of index.html and remove
#      Chorus2's <script src="js/kodi-webinterface.js"> (the bootstrap
#      loads it dynamically once config is present — see the first-launch
#      note in tizen-bootstrap.js).
#   4. Resize icon to 117x117 if ImageMagick is available.
#   5. Run `tizen build-web` + `tizen package -t wgt`.
#   6. Move .wgt to release/.
#
# Env vars:
#   TIZEN_BIN     Path to the tizen CLI. Defaults to ~/tizen-studio/tools/ide/bin/tizen.
#   TIZEN_PROFILE Tizen signing profile name. Defaults to "Chorus2".
#
# Flags:
#   --dry-run    Run only the prepare steps; no `tizen` CLI required.
#                Useful for verifying the build layout.
#   --no-package Run prepare + `tizen build-web` but skip `tizen package`.
#                CI uses this and drives `tizen package` separately via an
#                expect script (the packaging step prompts for cert
#                passwords). Local dev runs without flags for end-to-end.

set -euo pipefail

DRY_RUN=0
NO_PACKAGE=0
for arg in "$@"; do
    case "$arg" in
        --dry-run)    DRY_RUN=1 ;;
        --no-package) NO_PACKAGE=1 ;;
        *) echo "[build] unknown flag: $arg" >&2; exit 2 ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build"
WRAPPER="$ROOT/tizen/wrapper"
EXTRAS="$ROOT/tizen/extras"
RELEASE_DIR="$ROOT/release"

TIZEN_BIN="${TIZEN_BIN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
PROFILE_NAME="${TIZEN_PROFILE:-Chorus2}"

log() { printf "\033[1;34m[build]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[build]\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[1;31m[build]\033[0m %s\n" "$*" >&2; exit 1; }

# --- Sanity checks on inputs -------------------------------------------------

[[ -f "$ROOT/dist/index.html" ]] || fail "dist/index.html missing — is this the chorus2 repo root?"
[[ -f "$WRAPPER/config.xml"       ]] || fail "wrapper/config.xml missing"
[[ -f "$WRAPPER/icon.png"         ]] || fail "wrapper/icon.png missing"
[[ -f "$WRAPPER/videoPlayer.html" ]] || fail "wrapper/videoPlayer.html missing"
[[ -f "$EXTRAS/tizen-bootstrap.js" ]] || fail "extras/tizen-bootstrap.js missing"
[[ -f "$EXTRAS/tizen-sw.js"        ]] || fail "extras/tizen-sw.js missing"
[[ -f "$EXTRAS/tizen.css"          ]] || fail "extras/tizen.css missing"
[[ -f "$EXTRAS/avplayVideoPlayer.js" ]] || fail "extras/avplayVideoPlayer.js missing"

# --- Prepare build directory -------------------------------------------------

log "preparing $BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy Chorus2 prebuilt dist (including videoPlayer.html — Phase 3 patches it).
cp -r "$ROOT/dist/." "$BUILD_DIR/"

# Wrapper + extras override anything with the same name (config.xml and
# videoPlayer.html are the obvious cases — dist/ ships its own
# video.js-based videoPlayer.html which we replace with the AVPlay one).
# avplayVideoPlayer.js is intentionally NOT copied: we keep it in
# extras/ as a reference, but our videoPlayer.html does direct
# webapis.avplay calls so we never load it. Saves 25 KB in the .wgt.
cp "$WRAPPER/config.xml"       "$BUILD_DIR/config.xml"
cp "$WRAPPER/icon.png"         "$BUILD_DIR/icon.png"
cp "$WRAPPER/videoPlayer.html" "$BUILD_DIR/videoPlayer.html"
cp "$EXTRAS/tizen-bootstrap.js" "$BUILD_DIR/tizen-bootstrap.js"
cp "$EXTRAS/tizen-sw.js"        "$BUILD_DIR/tizen-sw.js"
cp "$EXTRAS/tizen.css"          "$BUILD_DIR/tizen.css"

# --- Strip dead weight from dist/ that the TV never uses --------------------
#
# Chorus2's dist/ targets a desktop browser. On a Tizen TV the .wgt
# unpacks to roughly 10 MB but ~5 MB of that is never loaded at runtime.
# The user's TV hit `download failed[116]` (insufficient storage) on
# install, so we trim everything that isn't reached at runtime.
#
# What's safe to remove:
#   - screenshots/                 — Chorus2's promo screenshots
#   - lib/video-js/                — replaced by our AVPlay videoPlayer.html
#   - themes/.../fonts/*.svg|.eot  — SVG-font + IE6 fallback formats; the
#                                    TV WebKit uses woff/woff2
#   - lang/<non-en>/               — keep only English; user can swap to
#                                    other languages by rebuilding
#   - addon.xml, manifest.json,
#     favicon.png, icon-NNN.png    — Kodi-addon / PWA / browser metadata
#                                    that Tizen ignores

log "trimming dist/ dead weight"
rm -rf "$BUILD_DIR/screenshots"
rm -rf "$BUILD_DIR/lib/video-js"
find "$BUILD_DIR/themes" -type f \( -name '*.svg' -o -name '*.eot' \) -delete 2>/dev/null || true
# Language files: keep _strings (registry) + en, drop the rest.
for d in "$BUILD_DIR/lang/"*/; do
    name=$(basename "$d")
    [[ "$name" == "_strings" || "$name" == "en" ]] && continue
    rm -rf "$d"
done
rm -f "$BUILD_DIR/addon.xml" \
      "$BUILD_DIR/manifest.json" \
      "$BUILD_DIR/favicon.png" \
      "$BUILD_DIR/icon-128.png" \
      "$BUILD_DIR/icon-144.png" \
      "$BUILD_DIR/icon-152.png" \
      "$BUILD_DIR/icon-192.png"

# --- Patch index.html --------------------------------------------------------

INDEX="$BUILD_DIR/index.html"

# 1) Inject our CSS + bootstrap script as the first children of <head>. The
#    bootstrap MUST run before any other Chorus2 script.
INJECT='<link rel="stylesheet" href="tizen.css">\n<script src="tizen-bootstrap.js"></script>'
# Match the literal <head> opening tag with optional whitespace; insert our
# tags on the next line.
sed -i "0,/<head>/{s|<head>|<head>\n${INJECT}|}" "$INDEX"

# 2) Strip Chorus2's own kodi-webinterface.js <script>. The bootstrap loads
#    it dynamically after config is verified, fixing the first-launch race
#    (see tizen-bootstrap.js loadChorus2).
sed -i '/<script[^>]*src=["'\'']js\/kodi-webinterface\.js["'\''][^>]*>[[:space:]]*<\/script>/d' "$INDEX"

# Sanity: confirm both edits landed.
grep -q "tizen-bootstrap.js" "$INDEX" || fail "bootstrap injection failed (no tizen-bootstrap.js in built index.html)"
if grep -q 'src="js/kodi-webinterface.js"' "$INDEX"; then
    fail "Chorus2 script tag removal failed (still present in built index.html)"
fi

# --- Resize icon to 117x117 if we have a tool that can do it ----------------

if command -v convert >/dev/null 2>&1; then
    log "resizing icon to 117x117 with ImageMagick"
    convert "$BUILD_DIR/icon.png" -resize 117x117 "$BUILD_DIR/icon.png"
elif command -v ffmpeg >/dev/null 2>&1; then
    log "resizing icon to 117x117 with ffmpeg"
    tmp="$BUILD_DIR/icon.tmp.png"
    ffmpeg -y -i "$BUILD_DIR/icon.png" -vf scale=117:117 "$tmp" >/dev/null 2>&1
    mv "$tmp" "$BUILD_DIR/icon.png"
else
    warn "no ImageMagick/ffmpeg found — shipping icon at its committed size; Tizen Studio will warn but accept"
fi

log "prepare complete: $(find "$BUILD_DIR" -type f | wc -l) files in $BUILD_DIR"

# --- Dry run exits here ------------------------------------------------------

if [[ $DRY_RUN -eq 1 ]]; then
    log "--dry-run: skipping tizen CLI invocations"
    exit 0
fi

# --- Build + package via Tizen Studio CLI -----------------------------------

if [[ ! -x "$TIZEN_BIN" ]]; then
    fail "Tizen CLI not found at $TIZEN_BIN.
  Install Tizen Studio (https://docs.tizen.org/application/tizen-studio/) and either
  put 'tizen' on PATH or set TIZEN_BIN to its absolute path.
  (To validate the build layout without Tizen Studio, run: bash tizen/build.sh --dry-run)"
fi

cd "$BUILD_DIR"
log "tizen build-web"
"$TIZEN_BIN" build-web -e ".*" -e "node_modules/*"

if [[ $NO_PACKAGE -eq 1 ]]; then
    log "--no-package: skipping tizen package (caller will run it via expect)"
    log "web build ready at $BUILD_DIR (.buildResult/ will be populated by the packaging step)"
    exit 0
fi

log "tizen package (profile: $PROFILE_NAME)"
"$TIZEN_BIN" package -t wgt -s "$PROFILE_NAME" -- "$BUILD_DIR/.buildResult"

# --- Move artifact -----------------------------------------------------------

mkdir -p "$RELEASE_DIR"
WGT="$(find "$BUILD_DIR/.buildResult" -maxdepth 1 -name '*.wgt' -print -quit)"
[[ -n "$WGT" ]] || fail "tizen package did not produce a .wgt under $BUILD_DIR/.buildResult"
mv "$WGT" "$RELEASE_DIR/Chorus2-Tizen.wgt"

log "built: $RELEASE_DIR/Chorus2-Tizen.wgt"
