# sleep-med-timer

A one-button bedside device that tells you, in the dark, whether it's too
late to take a sleep med — without making you look at a clock. Press the
button, get a green or red LED for 3 seconds.

Built for the **M5Stack ATOM Lite** (recommended; LED only) or **ATOM
Echo** (LED + speaker).

## Quick start

### 1. Plug it in

Buy an ATOM Lite ([Amazon](https://www.amazon.com/s?k=m5stack+atom+lite)
· [Google](https://www.google.com/search?q=m5stack+atom+lite))
or ATOM Echo ([Amazon](https://www.amazon.com/s?k=m5stack+atom+echo)
· [Google](https://www.google.com/search?q=m5stack+atom+echo))
— ~$10–$15. Plug it into your computer with a USB-C cable, then flash:

```
pip install platformio
git clone https://github.com/seanahrens/sleep-med-timer.git
cd sleep-med-timer
pio run -t upload
```

First build pulls the ESP32 toolchain (5–10 min). After flashing, the
device runs from any USB power source — a phone charger is fine.

### 2. Set the clock

The ATOM has no battery, so the time has to come from somewhere.

**Easiest right now** — manual. Drifts ~1 min/week, and resets every
time the device is unplugged:

Set a phone alarm for the minute before any upcoming hour (early-morning
hours need fewest taps). When it rings, hold the button ~5 seconds (past
both the cyan and magenta flashes), release, then tap N times where N
is the upcoming hour on a 24-hour clock (7 for 7 am, 22 for 10 pm).
Wait 3 seconds for the green confirm.

**Best long term** — WiFi. Auto-syncs daily, survives unplugging:

On first boot the LED is solid blue. On your phone install
**ESP BLE Provisioning**
([iOS](https://apps.apple.com/us/app/esp-ble-provisioning/id1473590141) ·
[Android](https://play.google.com/store/apps/details?id=com.espressif.provble)),
pick `PROV_SLEEPMED`, enter PoP `sleepmed`, choose your WiFi. Two short
green blinks = online.

### 3. Set the medication cutoff time

Hold the button ~3 seconds, release after the cyan flash but before the
magenta flash. Tap N times where N is your cutoff hour on a 24-hour
clock (22 = 10 pm, 24 = midnight, 1 = 1 am, 4 = 4 am). Wait 3 seconds
for two green blinks.

### 4. Test

Press the button. If it's within the 12 hours before your cutoff time,
you'll see green. Otherwise red.

## Reference

### LED answer (after a single press)

| LED for 3 seconds | Meaning                                       |
|-------------------|-----------------------------------------------|
| Solid green       | Before your medication cutoff — OK to take it |
| Solid red         | After your medication cutoff — too late       |
| Solid amber       | You haven't set a cutoff yet                  |

### Button gestures

| Action                | Effect                              |
|-----------------------|-------------------------------------|
| Single press (<0.6 s) | Show green/red/amber answer         |
| Hold 2–4 s            | Set medication cutoff time (1–24)   |
| Hold 4 s+             | Set wall-clock hour (1–24)          |
| Hold 10 s during boot | Factory reset (wipes WiFi + cutoff) |

While holding, the LED flashes **cyan** at 2 s and **magenta** at 4 s so
you can tell which mode you'll enter when you let go.

## What happens when the device is unplugged

The ATOM has no battery — when unplugged, the wall clock is lost. Your
settings (cutoff, WiFi credentials, timezone) are stored in flash and
survive.

When plugged back in:

- *With WiFi*: NTP restores the clock automatically; you won't notice
  the gap.
- *Without WiFi*: the clock is wrong. Two red boot blinks are the cue
  — re-set the clock using step 2 above.

## Troubleshooting

- **Windows can't see the device:** install the
  [CP210x driver from Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers).
- **Echo build with audio:** `pio run -e atom-echo -t upload`
- **Watch boot logs:** `pio device monitor` (Ctrl+T, Ctrl+C to exit).

## LED reference (full)

| Color / pattern              | Meaning                                    |
|------------------------------|--------------------------------------------|
| Off                          | Idle                                       |
| Solid blue                   | BLE provisioning (waiting for phone)       |
| Slow blue pulse              | Connecting to WiFi                         |
| 2 short green blinks (boot)  | Online                                     |
| 2 short red blinks (boot)    | Offline (will use internal clock)          |
| Cyan flash                   | 2-second hold mark — release = cutoff mode |
| Magenta flash                | 4-second hold mark — release = clock mode  |
| Breathing red↔green          | Cutoff-set window open                     |
| Fast white pulse             | Clock-set window open                      |
| 2 green blinks (post-set)    | Saved successfully                         |
| 2 red blinks (post-set)      | Invalid count, not saved                   |
| 3 red blinks (boot)          | Factory reset confirmed                    |

## Hacking on it

```
pio run                                          # atom-lite (default)
pio run -e atom-echo                             # ATOM Echo build with audio
g++ -std=c++17 -Isrc tests/test_cutoff.cpp src/app_state.cpp -o /tmp/test_cutoff && /tmp/test_cutoff
```

Source layout:

- `src/main.cpp` — boot sequence and main loop
- `src/button.cpp` — debounced FSM (single press / 2 s hold / 4 s hold)
- `src/app_state.cpp` — pure cutoff decision logic
- `src/led.cpp` — FastLED effects
- `src/audio.cpp` — I2S tones (no-op on Lite via `HAVE_SPEAKER=0`)
- `src/clock_sync.cpp` — NTP and daily resync task
- `src/geo_tz.cpp` — IP-geolocation → POSIX timezone string
- `src/provisioning.cpp` — BLE WiFi setup and factory reset
- `src/prefs.cpp` — NVS storage (cutoff, timezone)
