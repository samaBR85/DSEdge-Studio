# Architecture

The app has two layers:

```
┌──────────────────────────── DualSense Edge Studio.app ────────────────────────────┐
│                                                                                    │
│  src/main.m (Objective-C, AppKit)            web/ (HTML + CSS + JS, no build)      │
│  ┌──────────────────────────────┐            ┌──────────────────────────────────┐  │
│  │ EdgeHID (IOKit HID)          │   events   │ native.js  (bridge)              │  │
│  │  • matches VID 054C/PID 0DF2 │ ─────────▶ │ app.js     (state, tabs)         │  │
│  │  • input report 0x01         │            │ proto.js   (profiles ↔ bytes)    │  │
│  │  • feature/output reports    │ ◀───────── │ hw.js, diag.js, backup.js, …     │  │
│  ├──────────────────────────────┤  commands  └──────────────────────────────────┘  │
│  │ AppDelegate                  │                       ▲                          │
│  │  • window + WKWebView        │                       │ WKWebView                │
│  │  • menu bar / battery        │───────────────────────┘                          │
│  │  • files (Application        │                                                  │
│  │    Support), open/save       │                                                  │
│  │  • GameController (triggers) │                                                  │
│  └──────────────────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
                         │ USB (IOKit HID)
                         ▼
                  DualSense Edge
```

- **Native layer (`src/main.m`)**: opens the controller with IOKit HID, forwards input reports to the UI, performs feature report reads and writes, and handles the window, the menu bar, battery notifications and files.
- **UI (`web/`)**: all the profile, protocol and screen logic. It's loaded in a `WKWebView` from `Contents/Resources/web`. There's no bundler and no external dependencies.

## JS ↔ native bridge

### Commands (JS → native)

The UI calls `Native.call(cmd, args)`, which becomes `window.webkit.messageHandlers.hid.postMessage({cmd, ...args})`. The native side uses `WKScriptMessageHandlerWithReply`, so every call returns a `Promise` with the result or an error message.

| Command | Arguments | Result |
|---|---|---|
| `status` | – | `{type:"status", connected, transport, bluetoothOnly, serial}` |
| `setLang` | `lang` (a code, or `""` to follow the system) | Saves the choice, translates the native menus and prepares the next page load. The page reloads right after. |
| `menuInfo` | `profile` | Updates the active profile shown in the menu bar. |
| `resetYaw` | – | Resets the integrated yaw. |
| `log` | `text` | Writes to the system log (debugging). |
| `loadFile` | `name` (`library`, `state`, `history`) | The JSON file's contents, or `""`. |
| `saveFile` | `name`, `text` | Writes the file to Application Support. |
| `exportJSON` | `text`, `filename` | Opens the Save panel and writes the chosen file. |
| `importJSON` | – | Opens the Open panel and returns the file's text, or `null`. |
| `readProfiles` | – | 12 arrays of 64 bytes (feature reports `0x70`–`0x7B`). |
| `readFeature` | `id` | One feature report (the Diagnostics tab uses `0x20` for firmware/hardware and `0x09` for the Bluetooth address). |
| `writeFeatures` | `reports` | Writes a list of feature reports. **Only `0x60`–`0x63` and `0x68` are accepted.** |
| `rumble` | `strength` (0–255), `ms` | A short buzz on both motors (output `0x02`), used as confirmation. |
| `output` | `bytes` | Sends an output report. **Only `0x02` is accepted**, at most 64 bytes. |
| `gc` | `light`, `player`, `trigger` | Light, player LED and adaptive trigger effects through the GameController framework (resistance, weapon, vibration). |

Any other command returns an "Unknown command" error.

### Events (native → JS)

The native side calls `window.EdgeNative.onEvent(evt)`. Event types:

| `type` | When | Contents |
|---|---|---|
| `status` | Connect/disconnect, transport change | `connected`, `transport` (`USB`/`Bluetooth`), `bluetoothOnly`, … |
| `input` | Input report `0x01` (throttled so the UI isn't flooded) | `data` (bytes), `yaw` (integrated degrees), `rate` (USB rate statistics) |
| `error` | The device failed to open | `code`, `message` (e.g. missing Input Monitoring permission) |
| `gc` | The GameController framework found or lost the controller | `available` |

### Simulator

When `web/index.html` is opened in a regular browser (no `window.webkit.messageHandlers`), `native.js` replaces the bridge with a simulator: it returns sample slots, generates synthetic input reports and stores files in `localStorage`. This lets you develop and test the UI without the controller. See [DEVELOPMENT.md](DEVELOPMENT.md#run-the-ui-in-a-browser).

## Languages

The source language is Portuguese. Every visible string goes through a translation, and the Portuguese text itself is the key:

- **JavaScript**: `T("Gravar no slot {g}", { g })`. The function lives in `web/i18n.js`; `{placeholders}` are replaced with the values.
- **Static HTML**: the `data-i18n` (text), `data-i18n-html`, `data-i18n-title` and `data-i18n-ph` (placeholder) attributes, applied by `I18N.applyDom()` before the UI renders.
- **Objective-C**: `L(@"…")` and `Lf(@"…", @{…})` in `src/main.m`.

Translations live in `web/i18n/<code>.js`, in the form `I18N.add("en", { "texto em português": "translation", … })`. The native side reads the same files (it takes the JSON object between the first `{` and the last `}`), so there's a single source of translations.

**Language selection**, in this order:

1. the choice saved by the picker (`NSUserDefaults`, key `lang`; in a browser, `localStorage`);
2. the first language in `NSLocale.preferredLanguages` that the app supports;
3. English.

The native side injects `window.EdgeLang = { saved, system }` at the start of every page load (`WKUserScript`), and `i18n.js` picks the language before any other script runs. The language is fixed for the lifetime of the page: switching reloads the page, which lets modules call `T()` at load time (button names, presets, curves).

## Read and write flow

1. `readProfiles` reads `0x70`–`0x7B` and `Proto.parseAll` turns the 12 reports into 4 profiles (△ □ ✕ ○). The original bytes are kept in `profile.raw`.
2. The UI edits a copy (the draft) in the edge-config.com JSON format.
3. When writing, `Backup.record` saves the slot's current contents to the history.
4. `Proto.encode(profile, selector)` builds 3 reports starting from `raw` (preserving unknown fields), applies the changes, stamps the date/time and computes the CRCs.
5. `writeFeatures` sends the 3 reports. The UI reads the slots back to confirm.

Clearing a slot follows the same path with `Proto.clearReport(selector)` (feature `0x68`).

## Saved files

Folder: `~/Library/Application Support/DualSense Edge Studio/`

| File | Contents |
|---|---|
| `library.json` | Library profiles (edge-config.com format). |
| `state.json` | Last active slot, monitor axis inversion and Hardware tab settings. |
| `history.json` | Copies of slots before each write, clear or restore (up to 60). Each entry's reason is stored in the language in use at the time. |

Menu-bar preferences (keep running when the window closes, battery alerts) and the language choice are stored in `NSUserDefaults` under the `local.dualsense-edge-studio` domain (keys `quitOnClose`, `noBatteryWarning` and `lang`).

## UI modules

| File | Responsibility |
|---|---|
| `i18n.js` | Languages: `T()`, detection, `applyDom()` and the picker at the top. Loaded before everything else, followed by `i18n/*.js`. |
| `app.js` | Global state, sidebar, the Buttons/Sticks/Triggers/Presets/Monitor tabs, library, writing. Defines the helpers used by the other modules (`$`, `$$`, `call`, `toast`, `confirmDialog`, …). |
| `proto.js` | Protocol (no dependencies): slots, buttons, curves, CRC32, `parseAll`, `encode`, `clearReport`, `parseInput`. |
| `native.js` | Bridge to the app, or the simulator. |
| `controller.js` | Controller SVG and button glyphs. |
| `model3d.js` | 3D controller for the gyro monitor. |
| `presets.js` | Preset list by category. |
| `hw.js` | Hardware tab and building output report `0x02`. |
| `diag.js` | Diagnostics tab (drift, circularity, triggers, USB rate, controller info). |
| `compare.js` | Side-by-side comparison and Copy B → A. |
| `backup.js` | Full backup and history. |

`index.html` loads the scripts in order as classic scripts; each module exposes a global object (`Proto`, `Native`, `HW`, `Backup`, …).
