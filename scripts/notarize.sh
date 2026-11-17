#!/bin/bash
# Builds, signs with Developer ID, notarizes and staples "DualSense Edge Studio.app", then packs it
# into a signed, notarized and stapled disk image: build/DualSense-Edge-Studio.dmg
# (the app plus a shortcut to Applications, for drag-and-drop install).
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
ZIP="build/DualSense-Edge-Studio.zip"   # only used to submit the app
DMG="build/DualSense-Edge-Studio.dmg"
VOLNAME="DualSense Edge Studio"
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

# notarize <file>: submits to Apple, waits, and prints the log if it isn't accepted
notarize() {
  echo "→ Submitting $1 to Apple's notary service (profile: $PROFILE)…"
  local out status id
  out=$(xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait --output-format json)
  echo "$out"
  status=$(echo "$out" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')
  if [ "$status" != "Accepted" ]; then
    id=$(echo "$out" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')
    echo "Notarization failed ($status). Log:" >&2
    [ -n "$id" ] && xcrun notarytool log "$id" --keychain-profile "$PROFILE" >&2
    exit 1
  fi
}

# 1) the app itself, so it carries its own ticket once copied out of the disk image
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
notarize "$ZIP"
rm -f "$ZIP"
echo "→ Stapling the ticket…"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"


# 2) the disk image: stapled app + Applications shortcut, signed, notarized and stapled
echo "→ Creating the disk image…"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/$(basename "$APP")"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

shasum -a 256 "$DMG"
echo "OK → $DMG"
