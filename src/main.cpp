#include <Arduino.h>
#include <WiFi.h>

#include "app_state.h"
#include "audio.h"
#include "button.h"
#include "clock_sync.h"
#include "led.h"
#include "pins.h"
#include "prefs.h"
#include "provisioning.h"

namespace {

// Run a one-shot LED effect to completion (blocking, but short).
void play_led_blocking(led::Effect e) {
    led::set(e);
    while (!led::effect_done()) {
        led::tick();
        delay(5);
    }
    led::set(led::Effect::kOff);
}

// Drive an LED effect for `duration_ms` and ignore button activity.
void hold_led(led::Effect e, uint32_t duration_ms) {
    led::set(e);
    const uint32_t start = millis();
    while (millis() - start < duration_ms) {
        led::tick();
        delay(5);
    }
}

// Show the single-press answer for kAnswerDisplayMs.
void show_answer() {
    auto& s = app::get();
    led::Effect eff;
    if (s.cutoff_hour_24 == prefs::kCutoffUnset) {
        eff = led::Effect::kSolidAmber3s;
        audio::chime_sad();
    } else if (app::is_before_cutoff(clock_sync::local_hour(),
                                     s.cutoff_hour_24)) {
        eff = led::Effect::kSolidGreen3s;
        audio::chime_happy();
    } else {
        eff = led::Effect::kSolidRed3s;
        audio::chime_sad();
    }
    play_led_blocking(eff);
}

// Run a set-window: count short presses for kSetWindowInactivityMs of
// inactivity after the opening beep ends. Returns the press count.
uint32_t run_set_window(led::Effect window_effect, void (*opening_beep)()) {
    led::set(window_effect);

    // Opening beep — counting begins after it ends.
    const uint32_t beep_start = millis();
    opening_beep();
    while (millis() - beep_start < timings::kOpeningBeepMs) {
        led::tick();
        delay(5);
    }

    uint32_t count = 0;
    uint32_t last_activity = millis();

    while (millis() - last_activity < timings::kSetWindowInactivityMs) {
        led::tick();
        const button::Event ev = button::poll();
        if (ev == button::Event::kSinglePress) {
            count++;
            last_activity = millis();
        }
        delay(1);
    }

    led::set(led::Effect::kOff);
    return count;
}

void handle_set_cutoff() {
    // Same 24-hour press convention as SET_HOUR: 1..23 -> that hour,
    // 24 -> midnight (00), 0 or >24 -> invalid.
    const uint32_t presses = run_set_window(led::Effect::kBreathRedGreen,
                                            audio::mode2_opening);
    if (presses == 0 || presses > 24) {
        audio::chime_sad();
        play_led_blocking(led::Effect::kFailRedDouble);
        return;
    }
    const uint8_t hour_24 = (presses == 24) ? 0 : static_cast<uint8_t>(presses);
    prefs::save_cutoff_hour(hour_24);
    app::get().cutoff_hour_24 = hour_24;
    audio::chime_happy();
    play_led_blocking(led::Effect::kSuccessGreenDouble);
}

void handle_set_hour() {
    const uint32_t presses = run_set_window(led::Effect::kFastWhitePulse,
                                            audio::mode1_opening);
    if (presses == 0 || presses > 24) {
        audio::chime_sad();
        play_led_blocking(led::Effect::kFailRedDouble);
        return;
    }
    const uint8_t hour_24 = (presses == 24) ? 0 : static_cast<uint8_t>(presses);
    clock_sync::set_hour_from_user(hour_24);
    audio::chime_happy();
    play_led_blocking(led::Effect::kSuccessGreenDouble);
}

}  // namespace

void setup() {
    Serial.begin(115200);

    // Factory reset must run before anything else touches NVS / LED state.
    provisioning::check_factory_reset_at_boot();

    led::begin();
    button::begin();
    prefs::begin();
    audio::begin();

    // Boot tick.
    audio::boot_tick();
    play_led_blocking(led::Effect::kFlashWhite80ms);

    auto& s = app::get();
    s.cutoff_hour_24 = prefs::load_cutoff_hour();

    // Try WiFi for up to 60 s; if it fails we still operate on RTC drift.
    provisioning::connect_or_provision(60000);
    s.wifi_online = (WiFi.status() == WL_CONNECTED);

    if (s.wifi_online) {
        clock_sync::sync_now();
        clock_sync::start_daily_task();
        play_led_blocking(led::Effect::kBootGreenBlinks);
    } else {
        play_led_blocking(led::Effect::kBootRedBlinks);
    }

    s.mode = app::Mode::kIdle;
    led::set(led::Effect::kOff);
}

void loop() {
    led::tick();
    const button::Event ev = button::poll();

    switch (ev) {
        case button::Event::kSinglePress:
            show_answer();
            break;
        case button::Event::kHit2sMark:
            hold_led(led::Effect::kFlashCyan100ms, 100);
            audio::mark_2s_beep();
            led::set(led::Effect::kOff);
            break;
        case button::Event::kHit4sMark:
            hold_led(led::Effect::kFlashMagenta100ms, 100);
            audio::mark_4s_beep();
            led::set(led::Effect::kOff);
            break;
        case button::Event::kEnterSetCutoff:
            handle_set_cutoff();
            break;
        case button::Event::kEnterSetHour:
            handle_set_hour();
            break;
        case button::Event::kNone:
        default:
            break;
    }

    delay(timings::kPollIntervalMs);
}
