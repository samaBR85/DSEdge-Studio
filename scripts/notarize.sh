#!/bin/bash
# Builds, signs with Developer ID, notarizes and staples "DualSense Edge Studio.app",
# then writes the distributable zip to build/DualSense-Edge-Studio.zip.
#
# One-time setup (stores the notary credentials in your keychain):
#   xcrun notarytool store-credentials dsedge-notary --apple-id <apple-id> --team-id <team-id>
#
# Usage:
#   scripts/notarize.sh
# Environment:
#   SIGN_IDENTITY   signing identity (default: the first "Developer ID Application" in the keychain)
#   NOTARY_PROFILE  notarytool keychain profile (default: dsedge-notary)
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/DualSense Edge Studio.app"
ZIP="build/DualSense-Edge-Studio.zip"
PROFILE="${NOTARY_PROFILE:-dsedge-notary}"

if [ -z "${SIGN_IDENTITY:-}" ]; then
  SIGN_IDENTITY=$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ { print $2; exit }')
fi
if [ -z "$SIGN_IDENTITY" ]; then
  echo "No \"Developer ID Application\" certificate found in the keychain." >&2
  exit 1
fi
echo "→ Signing with: $SIGN_IDENTITY"
SIGN_IDENTITY="$SIGN_IDENTITY" ./build.sh

echo "→ Submitting to Apple's notary service (profile: $PROFILE)…"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
OUT=$(xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait --output-format json)
echo "$OUT"
STATUS=$(echo "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')
if [ "$STATUS" != "Accepted" ]; then
  ID=$(echo "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')
  echo "Notarization failed ($STATUS). Log:" >&2
  [ -n "$ID" ] && xcrun notarytool log "$ID" --keychain-profile "$PROFILE" >&2
  exit 1
fi

echo "→ Stapling the ticket…"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"

# Re-zip so the distributed archive contains the stapled app.
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
shasum -a 256 "$ZIP"
echo "OK → $ZIP"
