#!/usr/bin/env bash
# Notarize and staple a Sidestream .dmg.
#
# Tauri 2 notarizes the .app inside the DMG but doesn't notarize the DMG itself,
# so users who double-click the DMG would hit Gatekeeper as "Unnotarized
# Developer ID". Run this after `npm run tauri build` to close that gap.
#
# Usage:
#   APPLE_ID=...  APPLE_PASSWORD=...  APPLE_TEAM_ID=...  scripts/notarize-dmg.sh [path/to/file.dmg]
#
# If no path is given, the most recent .dmg under src-tauri/target/**/bundle/dmg/
# is used.

set -euo pipefail

: "${APPLE_ID:?APPLE_ID env var required (Apple ID email)}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD env var required (app-specific password from appleid.apple.com)}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID env var required (10-char Team ID)}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ge 1 ]]; then
    dmg="$1"
else
    dmg="$(/usr/bin/find "$repo_root/src-tauri/target" -type f -name '*.dmg' -print0 2>/dev/null \
        | xargs -0 ls -t 2>/dev/null | head -n1)"
    if [[ -z "${dmg:-}" ]]; then
        echo "error: no .dmg found under src-tauri/target — pass the path explicitly" >&2
        exit 1
    fi
    echo "auto-detected: $dmg"
fi

if [[ ! -f "$dmg" ]]; then
    echo "error: not a file: $dmg" >&2
    exit 1
fi

echo "==> Submitting to Apple notary service (this typically takes 1-3 min)"
xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_PASSWORD" \
    --wait

echo "==> Stapling ticket to DMG"
xcrun stapler staple "$dmg"

echo "==> Validating staple"
xcrun stapler validate "$dmg"

echo "==> Gatekeeper assessment"
spctl -a -vvv -t open --context context:primary-signature "$dmg"

echo
echo "Done: $dmg"
shasum -a 256 "$dmg"
