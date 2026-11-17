#!/bin/bash
# Builds "DualSense Edge Studio.app" (universal: Apple Silicon + Intel) into ./build
#
# Signing: ad-hoc by default. Set SIGN_IDENTITY to a "Developer ID Application: …" identity
# (name or SHA-1) to sign for distribution with the hardened runtime and a secure timestamp,
# which notarization requires (see scripts/notarize.sh).
set -euo pipefail
cd "$(dirname "$0")"

APP="build/DualSense Edge Studio.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

clang -fobjc-arc -O2 -Wall -mmacosx-version-min=12.0 -arch arm64 -arch x86_64 \
  -framework Cocoa -framework WebKit -framework IOKit -framework UniformTypeIdentifiers -framework GameController -framework UserNotifications \
  src/main.m -o "$APP/Contents/MacOS/DualSenseEdgeStudio"

cp -R web "$APP/Contents/Resources/web"
[ -f assets/AppIcon.icns ] && cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>pt-BR</string>
  <key>CFBundleLocalizations</key>
  <array><string>pt-BR</string><string>en</string><string>es</string><string>fr</string><string>de</string><string>it</string><string>ru</string><string>zh-Hans</string><string>ja</string></array>
  <key>CFBundleAllowMixedLocalizations</key><true/>
  <key>CFBundleName</key><string>DualSense Edge Studio</string>
  <key>CFBundleDisplayName</key><string>DualSense Edge Studio</string>
  <key>CFBundleIdentifier</key><string>local.dualsense-edge-studio</string>
  <key>CFBundleExecutable</key><string>DualSenseEdgeStudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>DualSense Edge profile editor</string>
</dict>
</plist>
PLIST

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
else
  codesign --force --sign - "$APP" >/dev/null
fi

# The bundle is recreated on every build, so tell Finder / LaunchServices to drop the cached
# (blank) icon and read the new one.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "OK → $APP"
