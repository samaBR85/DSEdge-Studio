# Changelog

## 1.1 — 2026-11-17

- UI, menus, menu-bar item, notifications and error messages in 9 languages: English, Portuguese, Spanish, French, German, Italian, Russian, Simplified Chinese and Japanese.
- The app starts in the system language (English when the system language isn't one of these).
- Language picker in the top-right corner; the choice is saved and can go back to following the system.
- Dates and numbers follow the selected language's format.
- `scripts/i18n_check.py` checks that the translations are complete.
- README and documentation in English.
- Release builds are signed with a Developer ID and notarized by Apple; `scripts/notarize.sh` automates it and produces a notarized `.dmg`.

## 1.0 — 2026-11-17

First public release.

- Reads all 4 controller slots; writes and clears □ ✕ ○.
- Editors for buttons (16 buttons, including the paddles), sticks (the 6 PS5 curves, intensity, dead zone and free-form curve) and triggers.
- Presets by category, random preset and applying another profile's settings.
- Live monitor: buttons, sticks, triggers, gyroscope with a 3D controller, touchpad and raw report.
- Hardware tab: light bar, player LEDs, mute LED, rumble motors and adaptive triggers.
- Diagnostics: drift, circularity, L2/R2 range, USB rate and firmware info.
- Local library with import/export compatible with edge-config.com.
- Full slot backup and automatic history with undo.
- Side-by-side profile comparison.
- Menu-bar icon with battery, active profile and low-battery alerts.
