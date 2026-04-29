#include "led.h"

#include <Arduino.h>
#include <FastLED.h>

#include "pins.h"

namespace {

constexpr uint8_t kBrightness = 64;  // ~25% of full brightness
CRGB g_pixel[1];
led::Effect g_effect = led::Effect::kOff;
uint32_t g_started_ms = 0;
bool g_done = false;

void show(const CRGB& c) {
    g_pixel[0] = c;
    FastLED.show();
}

void render() {
    const uint32_t t = millis() - g_started_ms;
    using led::Effect;
    switch (g_effect) {
        case Effect::kOff:
            show(CRGB::Black);
            g_done = true;
            break;
        case Effect::kSolidGreen3s:
            show(CRGB::Green);
            if (t >= 3000) g_done = true;
            break;
        case Effect::kSolidRed3s:
            show(CRGB::Red);
            if (t >= 3000) g_done = true;
            break;
        case Effect::kSolidAmber3s:
            show(CRGB(255, 140, 0));
            if (t >= 3000) g_done = true;
            break;
        case Effect::kSolidBlue:
            show(CRGB::Blue);
            break;
        case Effect::kSolidRed1s:
            show(CRGB::Red);
            if (t >= 1000) g_done = true;
            break;
        case Effect::kSlowBluePulse: {
            const uint8_t v = (sin8((t / 8) & 0xFF));
            show(CRGB(0, 0, v));
            break;
        }
        case Effect::kFastWhitePulse: {
            const uint8_t phase = (t / 31) & 0x7;  // ~4 Hz
            const uint8_t v = (phase < 4) ? 255 : 30;
            show(CRGB(v, v, v));
            break;
        }
        case Effect::kBreathRedGreen: {
            const uint8_t mix = sin8((t / 4) & 0xFF);   // ~1 Hz
            show(CRGB(255 - mix, mix, 0));
            break;
        }
        case Effect::kBootGreenBlinks: {
            const uint8_t phase = t / 150;
            const bool on = (phase == 0 || phase == 2);
            show(on ? CRGB::Green : CRGB::Black);
            if (t >= 600) g_done = true;
            break;
        }
        case Effect::kBootRedBlinks: {
            const uint8_t phase = t / 150;
            const bool on = (phase == 0 || phase == 2);
            show(on ? CRGB::Red : CRGB::Black);
            if (t >= 600) g_done = true;
            break;
        }
        case Effect::kSuccessGreenDouble: {
            const uint8_t phase = t / 120;
            const bool on = (phase == 0 || phase == 2);
            show(on ? CRGB::Green : CRGB::Black);
            if (t >= 480) g_done = true;
            break;
        }
        case Effect::kFailRedDouble: {
            const uint8_t phase = t / 120;
            const bool on = (phase == 0 || phase == 2);
            show(on ? CRGB::Red : CRGB::Black);
            if (t >= 480) g_done = true;
            break;
        }
        case Effect::kFlashWhite80ms:
            show(t < 80 ? CRGB::White : CRGB::Black);
            if (t >= 80) g_done = true;
            break;
        case Effect::kFlashCyan100ms:
            show(t < 100 ? CRGB::Cyan : CRGB::Black);
            if (t >= 100) g_done = true;
            break;
        case Effect::kFlashMagenta100ms:
            show(t < 100 ? CRGB::Magenta : CRGB::Black);
            if (t >= 100) g_done = true;
            break;
        case Effect::kFactoryResetBlinks: {
            const uint8_t phase = t / 120;
            const bool on = (phase == 0 || phase == 2 || phase == 4);
            show(on ? CRGB::Red : CRGB::Black);
            if (t >= 720) g_done = true;
            break;
        }
    }
}

}  // namespace

namespace led {

void begin() {
    // M5Atom's onboard LED is an SK6812 RGB; WS2812B-compatible timing.
    FastLED.addLeds<WS2812B, pins::kLedData, GRB>(g_pixel, 1);
    FastLED.setBrightness(kBrightness);
    show(CRGB::Black);
    g_effect = Effect::kOff;
    g_done = true;
}

void set(Effect e) {
    g_effect = e;
    g_started_ms = millis();
    g_done = false;
    render();
}

void tick() {
    if (g_effect == Effect::kOff) return;
    render();
}

bool effect_done() {
    return g_done;
}

}  // namespace led
