#pragma once

#include <stdint.h>

namespace led {

enum class Effect : uint8_t {
    kOff,
    kSolidGreen3s,
    kSolidRed3s,
    kSolidAmber3s,
    kSolidBlue,
    kSolidRed1s,
    kSlowBluePulse,
    kFastWhitePulse,
    kBreathRedGreen,
    kBootGreenBlinks,
    kBootRedBlinks,
    kSuccessGreenDouble,
    kFailRedDouble,
    kFlashWhite80ms,
    kFlashCyan100ms,
    kFlashMagenta100ms,
    kFactoryResetBlinks,
};

void begin();
void set(Effect e);
void tick();             // call frequently from main loop
bool effect_done();      // true once a one-shot effect has finished

}  // namespace led
