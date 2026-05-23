#!/usr/bin/env bash
# Build a styled, signed, notarized, stapled Sidestream .dmg.
#
# WHY THIS EXISTS
# Tauri's bundled create-dmg (bundle_dmg.sh) styles the disk image with
# Finder/AppleScript. When the build runs from a non-GUI/background process
# (e.g. an IDE agent or CI without a GUI session), Finder never registers the
# freshly-mounted volume, so the AppleScript fails with:
#     Finder got an error: Can't get disk "...". (-1728)
# and `tauri build` aborts before producing the .dmg (the .app is already built,
# signed, notarized, and stapled by that point). This script rebuilds just the
# .dmg using dmgbuild, which writes the .DS_Store layout directly — no Finder.
#
# USAGE
#   # 1) Build the app (notarizes + staples the .app; the DMG step will fail — that's expected):
#   APPLE_ID=... APPLE_PASSWORD=... APPLE_TEAM_ID=... \
#     npm run tauri build -- --target aarch64-apple-darwin || true
#   # 2) Build the styled DMG around the notarized app:
#   APPLE_ID=... APPLE_PASSWORD=... APPLE_TEAM_ID=... scripts/make-dmg.sh
#
# Optional env:
#   TARGET            rust target triple (default: aarch64-apple-darwin)
#   SIGNING_IDENTITY  codesign identity (default: Developer ID Application: Eric Brandon (RQNSYLZWSM))

set -euo pipefail

: "${APPLE_ID:?APPLE_ID env var required}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD env var required (app-specific password)}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID env var required}"

TARGET="${TARGET:-aarch64-apple-darwin}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: Eric Brandon (RQNSYLZWSM)}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Version from tauri.conf.json (single source of truth for the bundle name).
version="$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"

bundle_dir="src-tauri/target/${TARGET}/release/bundle"
app="${repo_root}/${bundle_dir}/macos/Sidestream.app"
out="${repo_root}/${bundle_dir}/dmg/Sidestream_${version}_aarch64.dmg"
vol_icon="${repo_root}/src-tauri/icons/icon.icns"
bg_image="${repo_root}/scripts/dmg-background.tiff"   # HiDPI background w/ drag arrow
[[ -f "$bg_image" ]] || { echo "warning: $bg_image missing — DMG will have no background" >&2; bg_image=""; }

if [[ ! -d "$app" ]]; then
    echo "error: app not found at $app — run 'npm run tauri build -- --target $TARGET' first" >&2
    exit 1
fi

echo "==> Verifying the .app is notarized + stapled"
if ! xcrun stapler validate "$app" >/dev/null 2>&1; then
    echo "error: $app is not notarized/stapled." >&2
    echo "       Run the full 'npm run tauri build' (with APPLE_* env) first so Tauri" >&2
    echo "       notarizes and staples the .app before this script packages it." >&2
    exit 1
fi

echo "==> Ensuring dmgbuild venv"
venv="${repo_root}/.dmgbuild-venv"
if [[ ! -x "${venv}/bin/dmgbuild" ]]; then
    python3 -m venv "$venv"
    "${venv}/bin/pip" install --quiet --upgrade pip
    "${venv}/bin/pip" install --quiet dmgbuild
fi

echo "==> Building styled DMG: $(basename "$out")"
mkdir -p "$(dirname "$out")"
rm -f "$out"
APP_PATH="$app" VOL_ICON="$vol_icon" DMG_BACKGROUND="$bg_image" \
    "${venv}/bin/dmgbuild" -s "${repo_root}/scripts/dmg-settings.py" "Sidestream" "$out"

echo "==> Signing DMG"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$out"

echo "==> Notarizing + stapling DMG"
"${repo_root}/scripts/notarize-dmg.sh" "$out"

echo
echo "Done: $out"
