#include "button.h"

#include <Arduino.h>

#include "pins.h"

namespace {

bool g_raw_last = false;
bool g_stable = false;            // debounced state (true = down)
uint32_t g_last_change_ms = 0;
uint32_t g_press_start_ms = 0;
bool g_emitted_2s = false;
bool g_emitted_4s = false;

bool read_button_down() {
    // Active-low (external pull-up). HIGH = idle, LOW = pressed.
    return digitalRead(pins::kButton) == LOW;
}

}  // namespace

namespace button {

void begin() {
    pinMode(pins::kButton, INPUT);
    g_raw_last = read_button_down();
    g_stable = g_raw_last;
    g_last_change_ms = millis();
}

Event poll() {
    const uint32_t now = millis();
    const bool raw = read_button_down();

    if (raw != g_raw_last) {
        g_raw_last = raw;
        g_last_change_ms = now;
        return Event::kNone;
    }

    if ((now - g_last_change_ms) < timings::kDebounceMs) return Event::kNone;

    if (raw != g_stable) {
        g_stable = raw;
        if (g_stable) {
            // press start
            g_press_start_ms = now;
            g_emitted_2s = false;
            g_emitted_4s = false;
            return Event::kNone;
        } else {
            // release
            const uint32_t held = now - g_press_start_ms;
            g_press_start_ms = 0;
            if (held < timings::kSinglePressMaxMs) return Event::kSinglePress;
            if (held >= timings::kHold4sMs) return Event::kEnterSetHour;
            if (held >= timings::kHold2sMs) return Event::kEnterSetBreakpoint;
            return Event::kNone;  // released between 600 ms and 2 s = ignored
        }
    }

    // No state change — but we may need to emit hold-mark events.
    if (g_stable && g_press_start_ms != 0) {
        const uint32_t held = now - g_press_start_ms;
        if (!g_emitted_2s && held >= timings::kHold2sMs) {
            g_emitted_2s = true;
            return Event::kHit2sMark;
        }
        if (!g_emitted_4s && held >= timings::kHold4sMs) {
            g_emitted_4s = true;
            return Event::kHit4sMark;
        }
    }

    return Event::kNone;
}

bool is_down() {
    return g_stable;
}

uint32_t held_ms() {
    if (!g_stable || g_press_start_ms == 0) return 0;
    return millis() - g_press_start_ms;
}

}  // namespace button
