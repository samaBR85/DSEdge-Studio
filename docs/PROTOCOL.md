# DualSense Edge USB protocol

A reference for what the app uses to read and write profiles. The implementation is in [`web/proto.js`](../web/proto.js) and, for the output report, [`web/hw.js`](../web/hw.js).

- Vendor ID `0x054C` (Sony), Product ID `0x0DF2` (DualSense Edge).
- Every report is 64 bytes; byte 0 is the report ID.
- Profiles can only be read and written over USB.

> **Validation**: with a real controller, reading a profile saved by the PS5 and encoding it again produces exactly the same bytes, with the same CRC. Writing a profile and reading it back also returns the same bytes.

## Slots

| Slot | Shortcut | Read (3 reports) | Write | Clear (`0x68`, byte 1) |
|---|---|---|---|---|
| △ Default | FN + △ | `0x70` `0x71` `0x72` | `0x63` (the app never writes it) | – |
| □ | FN + □ | `0x73` `0x74` `0x75` | `0x60` | `2` |
| ✕ | FN + ✕ | `0x76` `0x77` `0x78` | `0x61` | `3` |
| ○ | FN + ○ | `0x79` `0x7A` `0x7B` | `0x62` | `4` |

When writing, all 3 reports use the same ID (the slot selector) and are told apart by byte 1 (`0`, `1`, `2`).

## Profile layout

Offsets are relative to the start of each 64-byte report (byte 0 = ID).

### Part 0

| Bytes | Contents |
|---|---|
| 0 | Report ID |
| 1 | Part index (`0`). When reading, `16` means the slot is empty. |
| 2 | `1` |
| 6–59 | Profile name, UTF-16LE, up to 27 code units |
| 60–63 | Report CRC32 |

### Part 1

| Bytes | Contents |
|---|---|
| 1 | Part index (`1`) |
| 2–27 | Rest of the name, UTF-16LE, up to 13 code units (40 in total) |
| 28–43 | Profile ID (16 bytes) |
| 44 | Left stick curve modifier |
| 47–52 | Left stick curve (6 bytes) |
| 53 | Right stick curve modifier |
| 56–59 | Right stick curve, bytes 0–3 |
| 60–63 | Report CRC32 |

### Part 2

| Bytes | Contents |
|---|---|
| 1 | Part index (`2`) |
| 2–3 | Right stick curve, bytes 4–5 |
| 4, 5 | L2: start and end of travel |
| 6, 7 | R2: start and end of travel |
| 10–25 | Mapping of the 16 buttons |
| 30 | Left stick curve type (0–5) |
| 32 | Right stick curve type (0–5) |
| 34–39 | Save date/time, milliseconds as a 48-bit little-endian value |
| 56–59 | CRC32 of the whole profile (little-endian) |
| 60–63 | Report CRC32 |

Bytes not listed are preserved: when writing, the app starts from the bytes read from the controller (`profile.raw`).

### Button mapping

Each position in the table is a physical button; the value is the function it now performs (same index = original function).

| Index | Button | Index | Button |
|---|---|---|---|
| 0 | D-pad ↑ | 8 | R1 |
| 1 | D-pad → | 9 | R2 |
| 2 | D-pad ↓ | 10 | R3 |
| 3 | D-pad ← | 11 | L1 |
| 4 | ○ | 12 | L2 |
| 5 | ✕ | 13 | L3 |
| 6 | □ | 14 | Left paddle |
| 7 | △ | 15 | Right paddle |

### Stick curves

Each curve is 6 bytes (3 x/y points). The 6 PS5 types are generated from a starting value plus a modifier accumulated over the intensity index (0–10):

| ID | Name | Modifier |
|---|---|---|
| 0 | Default | 3 |
| 1 | Quick | 3 |
| 2 | Precise | 4 |
| 3 | Steady | 4 |
| 4 | Digital | 3 |
| 5 | Dynamic | 3 |

- **Dead zone**: when byte 1 of the curve is `0` and byte 0 is greater than zero, byte 0 holds the dead zone (`byte0 / 255`).
- An all-zero curve means "system default" and is shown as Default at intensity 5.
- The full table of values is `STICK_PRESETS` in `proto.js`.

## CRCs

Both are IEEE CRC32 (reflected polynomial `0xEDB88320`), stored little-endian.

- **Profile CRC** (part 2, bytes 56–59): computed over 170 bytes, the concatenation of part 0 bytes 2–59, part 1 bytes 2–59 and part 2 bytes 2–55.
- **Per-report CRC** (bytes 60–63 of each part): computed over the seed byte `0xA3` followed by the report's 64 bytes, with bytes 60–63 set to zero.

## Clearing a slot

Feature report `0x68` with byte 1 identifying the slot (`2` □, `3` ✕, `4` ○) and the rest zero. Afterwards, reading the slot returns `16` in byte 1 of part 0.

## Input report `0x01` (USB)

| Bytes | Contents |
|---|---|
| 1, 2 | Left stick X, Y |
| 3, 4 | Right stick X, Y |
| 5, 6 | L2, R2 (0–255) |
| 8 | Bits 0–3: D-pad (0 = ↑, clockwise, 8 = released); bit 4 □, 5 ✕, 6 ○, 7 △ |
| 9 | Bit 0 L1, 1 R1, 2 L2, 3 R2, 4 Create, 5 Options, 6 L3, 7 R3 |
| 10 | Bit 0 PS, 1 touchpad, 2 mute, 4 left FN, 5 right FN, 6 left paddle, 7 right paddle |
| 16–21 | Gyroscope (pitch, yaw, roll), int16 LE |
| 22–27 | Accelerometer (x, y, z), int16 LE, ~8192 = 1 g |
| 33–36, 37–40 | Touchpad contacts 1 and 2: bit 7 of the first byte = not touching, bits 0–6 = ID; X and Y as 12-bit values (1920 × 1080 grid) |
| 53 | Bits 0–3: battery level (`n × 10 + 5`%); bits 4–7: `0` discharging, `1` charging, `2` full |

## Output report `0x02` (USB)

Used by the Hardware tab and the confirmation buzz. Nothing here is stored on the controller.

| Bytes | Contents |
|---|---|
| 1 | Flags: `0x01` rumble, `0x02` haptics select, `0x04` right trigger, `0x08` left trigger |
| 2 | Flags: `0x01` mute LED, `0x02` power-save control, `0x04` light bar, `0x08` release LEDs, `0x10` player LEDs, `0x40` motor power |
| 3 | Right motor (weak/fast) |
| 4 | Left motor (strong/slow) |
| 9 | Mute LED: `0` off, `1` on, `2` pulsing |
| 10 | Power-save bits (`0` = everything awake) |
| 11–21 | Right trigger effect |
| 22–32 | Left trigger effect |
| 37 | Power reduction (high nibble: rumble, low nibble: triggers; `0` = full power) |
| 39 | Flags: `0x02` light-bar setup |
| 42 | Light-bar setup (`2` = fade out the default blue) |
| 43 | Player LED brightness: `0` high, `1` medium, `2` low |
| 44 | Player LEDs (bits 0–4) |
| 45–47 | Light-bar color (R, G, B) |

## Other feature reports read

| Report | Contents |
|---|---|
| `0x20` | Firmware build date/time (ASCII), hardware version (byte 24), firmware version (byte 28), update version (byte 44) |
| `0x09` | Controller Bluetooth address (bytes 1–6, little-endian) |

## Profile JSON format

The app uses the same format as [edge-config.com](https://edge-config.com), so libraries exported by one work in the other:

```json
{
  "id": "7,18,151,214,171,148,1,74,136,186,170,50,240,237,147,218",
  "label": "Shooter",
  "leftJoystick":  { "profileId": 1, "modifier": 3, "curveValues": [38, 38, 122, 139, 255, 255] },
  "rightJoystick": { "profileId": 2, "modifier": 4, "curveValues": [76, 50, 140, 102, 200, 162] },
  "leftTrigger":  { "min": 0, "max": 255 },
  "rightTrigger": { "min": 0, "max": 255 },
  "buttonMapping": { "buttons": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 4] },
  "profileButtonSelector": 96,
  "vibrationIntensity": 3,
  "triggerEffectIntensity": 3
}
```

`profileButtonSelector` is the slot selector in decimal (`96` = `0x60` □, `97` ✕, `98` ○, `99` △, `0` = none).
