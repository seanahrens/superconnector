# sleep-med-timer

A one-button bedside device that tells you, in the dark, whether it's too
late to take a sleep med — without making you look at a clock. Press the
button, get a green or red LED for 3 seconds. That's it.

Built for the **M5Stack ATOM Lite** (recommended; LED only) or **ATOM
Echo** (LED + speaker).

## Daily use

Press the button once:

| LED for 3 seconds | Meaning                                       |
|-------------------|-----------------------------------------------|
| Solid green       | Before your medication cutoff — OK to take it |
| Solid red         | After your medication cutoff — too late       |
| Solid amber       | You haven't set a cutoff yet                  |

Green and red bands are 12 hours each. With a 1 am cutoff (a common
choice for "I want to be in bed before then"): green from 1 pm through
12:59 am; red from 1 am through 12:59 pm. Most users pick a cutoff
somewhere between 10 pm and 4 am.

### Button cheat-sheet

| Action                  | Effect                                 |
|-------------------------|----------------------------------------|
| Single press (<0.6 s)   | Show green/red/amber answer            |
| Hold 2–4 s              | Set medication cutoff time (24 h, 1–24)|
| Hold 4 s+               | Set wall-clock hour (24 h, 1–24)       |
| Hold 10 s during boot   | Factory reset (wipes WiFi + cutoff)    |

While holding, the LED flashes **cyan** at 2 s ("release for cutoff
mode") and **magenta** at 4 s ("release for clock mode"), so you know
which mode you'll enter when you let go.

### Setting the medication cutoff time

Hold for ~3 seconds, release after the cyan flash but before the magenta
flash. A warble plays and the LED breathes red↔green for 1 second.
Then tap N times where **N is the hour of your cutoff on a 24-hour
clock**. Most realistic cutoffs land between 10 pm and 4 am:

- 22 taps = 10 pm cutoff
- 23 taps = 11 pm cutoff
- 24 taps = midnight cutoff
- 1 tap  = 1 am cutoff
- 2 taps = 2 am cutoff
- 3 taps = 3 am cutoff
- 4 taps = 4 am cutoff

Any 1–24 value works (e.g. 13 taps = 1 pm), but the 12-hour-green/
12-hour-red logic is calibrated for the late-evening case.

Stop tapping. After 3 seconds of silence: two green blinks = saved; two
red blinks = invalid (>24 or 0 taps). You only do this once; the value
persists across reboots and power loss.

## Should you set up WiFi?

The device only knows what time it is from its internal clock, which is
not very accurate on its own — it drifts by about a minute per week.
WiFi solves this by syncing the clock to NTP every day. Without WiFi,
you'll need to set the clock manually now, and again every few weeks
when the drift gets noticeable.

**Set up WiFi if you can.** It's a one-time, ~3-minute setup with a phone
app, and after that the device is fully autonomous: it figures out its
own timezone (handles DST too) and the clock stays accurate forever.

**Skip WiFi if you'd rather not deal with it** — for instance, if you
keep the device somewhere with no internet, or you don't want it on your
network. The trade-off is the manual clock-setting routine described
below.

### How to set the clock without WiFi

The device's clock has an hour but no minute or second — when you set
the hour, it locks the minute and second to `:00`. The trick is to set
the hour right as the real-world time crosses to that hour.

1. Pick an upcoming hour on the actual clock — **early morning is
   easiest** because it requires the fewest button taps. 7 am only needs
   7 taps; 11 pm needs 23.
2. Set an alarm on your phone for the minute before that hour — for
   example, **6:59 am** if you're targeting 7 am.
3. When the alarm goes off, hold the button on the device for ~5 seconds
   (past both the cyan and magenta flashes), then release. A tone plays
   and the LED pulses fast white.
4. Tap the button N times where N is the upcoming hour on a 24-hour
   clock (7 taps for 7 am; 19 taps for 7 pm; 24 taps for midnight).
5. Stop tapping and wait. The device locks in the time about 3 seconds
   after your last tap — which lines up with the actual hour rolling
   over to N:00.

You'll need to repeat this every couple of weeks as the internal clock
drifts. A weekend morning ritual works well.

## What happens when the device is unplugged

The M5Stack ATOM has no battery — when you unplug it, the wall clock
**stops and is lost**. Two things to know:

**Your settings survive.** The medication cutoff time, WiFi credentials,
and timezone are stored in the ESP32's flash memory and persist across
power loss. You do *not* need to re-set the cutoff or re-provision WiFi
after unplugging.

**The wall clock does not.** When you plug back in:

- *With WiFi*: the device reconnects, pulls the time from NTP, and is
  back to working correctly within a few seconds of the boot-LED blinks.
  You won't notice the gap.
- *Without WiFi*: the clock will be wrong (typically reading some time
  in 1970). Pressing the button will give a misleading green/red answer
  until you re-run the manual clock-setting routine described above.
  The two short red blinks at boot are your reminder.

If you move the device or lose power often and don't want to re-set the
clock each time, set up WiFi.

## Quick start

You need an **M5Stack ATOM Lite**
([Amazon](https://www.amazon.com/s?k=m5stack+atom+lite) ·
[Google](https://www.google.com/search?q=m5stack+atom+lite))
or **ATOM Echo**
([Amazon](https://www.amazon.com/s?k=m5stack+atom+echo) ·
[Google](https://www.google.com/search?q=m5stack+atom+echo))
— ~$10–$15 — and a USB-C cable.

```
pip install platformio
git clone https://github.com/seanahrens/sleep-med-timer.git
cd sleep-med-timer
pio run -t upload
```

Plug the ATOM in via USB-C before the upload step. First build pulls
the ESP32 toolchain (5–10 min); after that, builds take seconds.

**Then on the device:**

1. **Provision WiFi** (recommended). On first boot the LED is solid
   blue. Install **ESP BLE Provisioning**
   ([iOS](https://apps.apple.com/us/app/esp-ble-provisioning/id1473590141) ·
   [Android](https://play.google.com/store/apps/details?id=com.espressif.provble)),
   pick `PROV_SLEEPMED`, enter the PoP `sleepmed`, choose your WiFi.
   Two green blinks = online.
2. **Set your cutoff**. Hold the button ~3 s, release after the cyan
   flash; tap N times where N is the cutoff hour on a 24 h clock
   (22 = 10 pm, 1 = 1 am). Wait 3 s for two green blinks.

Done — press once to get green/red.

If you skipped WiFi, also set the clock once: see [How to set the clock
without WiFi](#how-to-set-the-clock-without-wifi).

### Troubleshooting

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
