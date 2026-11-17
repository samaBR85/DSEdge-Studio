# Development

## Requirements

- macOS 12 or later.
- Apple's Command Line Tools (`clang`, `codesign`):

```bash
xcode-select --install
```

There are no external dependencies, no package manager and no build step for the UI.

## Build

```bash
./build.sh
```

The script:

1. compiles `src/main.m` with `clang` for `arm64` and `x86_64` (a universal binary), linking Cocoa, WebKit, IOKit, UniformTypeIdentifiers, GameController and UserNotifications;
2. copies `web/` into `Contents/Resources/web`, along with the `assets/AppIcon.icns` icon;
3. generates the `Info.plist` (bundle id `local.dualsense-edge-studio`, minimum macOS 12.0, the list of localizations);
4. signs the app locally (`codesign --sign -`);
5. asks LaunchServices to reload the icon.

The result is `build/DualSense Edge Studio.app`. The `build/` folder isn't tracked by Git.

Because the UI is copied into the app, **you have to run `./build.sh` again after changing any file in `web/`**.

## Run the UI in a browser

The UI works in a regular browser with a simulator (sample data, a synthetic input report and files stored in `localStorage`), which is handy for layout work without the controller:

```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:8766`. The connection indicator shows "USB (simulated)".

In Claude Code, the same setup is in `.claude/launch.json` (`ui-preview`).

The simulator doesn't replace testing with a real controller: reading/writing slots, macOS permissions, the menu bar and adaptive triggers can only be checked in the native app.

## Translations

The app has 9 languages. Portuguese is the source language, and the Portuguese text itself is the translation key (details in [ARCHITECTURE.md](ARCHITECTURE.md#languages)).

When you add or change a string:

1. Write the Portuguese text inside `T("…")` (JS), a `data-i18n*` attribute (HTML) or `L(@"…")` (Objective-C). The first argument must be a literal string in double quotes so the script can find it. Use `{name}` for variable parts and translate whole sentences instead of joining fragments.
2. Run the checker. For each language it lists missing keys, unused keys and translations whose `{placeholders}` or HTML tags differ:

   ```bash
   python3 scripts/i18n_check.py
   ```

3. Add the translation to each `web/i18n/<code>.js`. Unused keys can be removed.

To test a language in the browser, use the 🌐 picker, or run `localStorage.setItem("edge-lang", "de")` in the console and reload. In the app, to simulate another system language without changing macOS:

```bash
"build/DualSense Edge Studio.app/Contents/MacOS/DualSenseEdgeStudio" -AppleLanguages '(ja)'
```

(A choice made with the picker takes priority; pick **System language** to follow macOS again.)

To add a language: add its code to `LANGS` (`web/i18n.js`) and `kLangs()` (`src/main.m`), create `web/i18n/<code>.js`, add its `<script>` tag to `index.html` and the localization to `CFBundleLocalizations` in `build.sh`.

## Mockups

`mockups/index.html` collects UI layout studies (open it directly in a browser). They aren't part of the app.

## Debugging

- **UI inside the app**: build with `-DDEBUG` (add the flag to the `clang` line in `build.sh`) to make the `WKWebView` inspectable on macOS 13.3 or later. Turn on *Safari › Settings › Advanced › Show features for web developers* and open *Safari › Develop › (your Mac) › DualSense Edge Studio*.
- **Native logs**: the UI sends messages with `Native.call("log", {text})`, which show up as `[EdgeStudio]` in Console.app.
- **Raw report**: the Monitor tab shows input report `0x01` in hexadecimal.

## Safety rules for the code

When working on the native layer, keep these guarantees:

- `writeFeatures` only accepts feature reports `0x60`–`0x63` (profiles) and `0x68` (clear slot).
- `output` only accepts output report `0x02`, at most 64 bytes.
- The UI never writes or clears the △ slot (`0x63`).
- `Proto.encode` starts from the slot's original bytes so fields the app doesn't know about are kept.
- Every write, clear or restore records a copy in the history first (`Backup.record`).

## Testing a protocol change

1. Back up the slots (**Backup** button).
2. Read a slot saved by the PS5 and check that `Proto.encode(Proto.parseAll(...)[i], selector)` produces the same bytes that were read (except the date/time and the CRCs that depend on it).
3. Write to a test slot (□, ✕ or ○), read it back and compare.
4. If something goes wrong, restore from the history or the backup file.

## Style

- Objective-C with ARC, compiled with `-Wall`.
- Framework-free JavaScript in `"use strict"`, one module per file exposed as a global object.
- UI strings are written in Brazilian Portuguese and always go through `T()` / `L()`.

## Releasing a version

1. Update `CFBundleShortVersionString`/`CFBundleVersion` in `build.sh` and the [CHANGELOG](../CHANGELOG.md).
2. Run `./build.sh` and zip the app:

   ```bash
   ditto -c -k --keepParent "build/DualSense Edge Studio.app" "DualSense-Edge-Studio.zip"
   ```

3. Create a tag and a GitHub release with the `.zip`. Since the app isn't notarized, people who download it need to right-click › **Open** the first time.
