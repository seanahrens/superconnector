# sleep-med-timer

A one-button bedside device that tells you, in the dark, whether it's too
late to take a sleep med — without making you look at a clock. Press the
button, get a green or red LED for 3 seconds. That's it.

Built for the **M5Stack ATOM Lite** (recommended; LED only) or **ATOM
Echo** (LED + speaker).

## Daily use

Press the button once:

| LED for 3 seconds | Meaning                            |
|-------------------|------------------------------------|
| Solid green       | Before your cutoff — OK to take it |
| Solid red         | After your cutoff — too late       |
| Solid amber       | You haven't set a cutoff yet       |

Green/red bands are 12 hours each. With a 10 pm cutoff: green from 10 am
through 9:59 pm; red from 10 pm through 9:59 am.

### Button cheat-sheet

| Action                  | Effect                              |
|-------------------------|-------------------------------------|
| Single press (<0.6 s)   | Show green/red/amber answer         |
| Hold 2–4 s              | Set bedtime cutoff (PM hour, 1–12)  |
| Hold 4 s+               | Set wall-clock hour (24 h, 1–24)    |
| Hold 10 s during boot   | Factory reset (wipes WiFi + cutoff) |

While holding, the LED flashes **cyan** at 2 s ("release for cutoff mode")
and **magenta** at 4 s ("release for hour mode") so you know which mode
you'll enter.

### Setting the cutoff

Hold for ~3 seconds, release after the cyan flash but before the magenta
flash. A warble plays and the LED breathes red↔green. Then tap N times
where N is the PM hour of your cutoff:

- 9 taps = 9 pm cutoff
- 10 taps = 10 pm cutoff
- 11 taps = 11 pm cutoff
- 12 taps = midnight cutoff

Stop tapping. After 3 seconds of silence: two green blinks = saved; two
red blinks = invalid (>12 or 0 taps). You only do this once; it persists
across reboots.

### Setting the hour (only if you skipped WiFi)

Hold for ~5 seconds (past both flashes), release. A 1-second tone plays
and the LED pulses fast white. Tap in 24-hour format:

- 1 tap = 1 am
- 13 taps = 1 pm
- 23 taps = 11 pm
- 24 taps = midnight

If WiFi is set up, NTP handles this automatically — skip this step.

## First-time setup (step-by-step)

### What you need

- An **M5Stack ATOM Lite** or **ATOM Echo** ($10–$15 from m5stack.com or Amazon)
- A USB-C cable
- A computer with Python 3
- A phone for one-time WiFi setup (optional)

### 1. Install PlatformIO

The easiest path is the VS Code extension:

1. Install [Visual Studio Code](https://code.visualstudio.com/)
2. Open VS Code → Extensions sidebar
3. Search for **PlatformIO IDE**, install. Wait for first-time setup (a few minutes).

Or via the command line:

```
pip install platformio
```

### 2. Clone this repo

```
git clone https://github.com/seanahrens/sleep-med-timer.git
cd sleep-med-timer
```

### 3. Plug in the M5Atom

Connect the ATOM to your computer with a USB-C cable.

- **macOS / Linux:** usually no driver needed.
- **Windows:** if the device isn't detected, install the [CP210x driver from Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers).

### 4. Build and flash

From the `sleep-med-timer/` directory:

```
pio run -t upload
```

The first build downloads the ESP32 toolchain and libraries (5–10 minutes).
Subsequent builds take seconds. PlatformIO auto-detects the serial port.

When you see `[SUCCESS] Took N seconds`, the device is running.

For the Echo (with audio) instead of the Lite:

```
pio run -e atom-echo -t upload
```

### 5. Watch the serial log (optional)

```
pio device monitor
```

Boot messages stream at 115200 baud. Press `Ctrl+T` then `Ctrl+C` to exit.

### 6. Set up WiFi (optional but recommended)

WiFi lets the device sync its clock daily over NTP and look up your
timezone via IP geolocation. Without it the internal clock drifts a
minute or so per week and you have to set the hour manually.

1. On first boot, the LED turns **solid blue** — it's broadcasting a BLE
   provisioning service.
2. On your phone, install **ESP BLE Provisioning**
   ([iOS](https://apps.apple.com/us/app/esp-ble-provisioning/id1473590141) /
   [Android](https://play.google.com/store/apps/details?id=com.espressif.provble)).
3. Open the app → *Provision New Device* → *I don't have a QR code* →
   choose `PROV_SLEEPMED`.
4. Enter the proof-of-possession code: `sleepmed`
5. Pick your WiFi network and enter the password.
6. Two short green blinks = online.

### 7. Set your bedtime cutoff

See [Setting the cutoff](#setting-the-cutoff) above. Until you do this,
every press gives an **amber** "set me up first" light.

### 8. Done

Place the device on your nightstand plugged into a USB-C charger. Press
the button whenever you wake up wondering if it's too late.

## LED reference (full)

| Color / pattern              | Meaning                                   |
|------------------------------|-------------------------------------------|
| Off                          | Idle                                      |
| Solid blue                   | BLE provisioning (waiting for phone)      |
| Slow blue pulse              | Connecting to WiFi                        |
| 2 short green blinks (boot)  | Online                                    |
| 2 short red blinks (boot)    | Offline (will use internal clock)         |
| Cyan flash                   | 2-second hold mark — release = cutoff mode |
| Magenta flash                | 4-second hold mark — release = hour mode  |
| Breathing red↔green          | Cutoff-set window open                    |
| Fast white pulse             | Hour-set window open                      |
| 2 green blinks (post-set)    | Saved successfully                        |
| 2 red blinks (post-set)      | Invalid count, not saved                  |
| 3 red blinks (boot)          | Factory reset confirmed                   |

## Hacking on it

### Build only (no flash)

```
pio run                  # atom-lite (default, LED-only)
pio run -e atom-echo     # ATOM Echo build with audio
```

### Host-side tests

The cutoff decision logic is pure C++ and can be tested without hardware:

```
g++ -std=c++17 -Isrc tests/test_cutoff.cpp src/app_state.cpp -o /tmp/test_cutoff
/tmp/test_cutoff
```

Expected output: `OK: all cutoff-logic tests passed`

### Source layout

- `src/main.cpp` — boot sequence and main loop
- `src/button.cpp` — debounced FSM (single press / 2 s hold / 4 s hold)
- `src/app_state.cpp` — pure cutoff decision logic
- `src/led.cpp` — FastLED effects
- `src/audio.cpp` — I2S tones (no-op on Lite via `HAVE_SPEAKER=0`)
- `src/clock_sync.cpp` — NTP and daily resync task
- `src/geo_tz.cpp` — IP-geolocation → POSIX timezone string
- `src/provisioning.cpp` — BLE WiFi setup and factory reset
- `src/prefs.cpp` — NVS storage (cutoff, timezone)
