#pragma once

#include <stdint.h>

namespace button {

enum class Event : uint8_t {
    kNone,
    kSinglePress,
    kEnterSetCutoff,      // released between 2 s and 4 s holds (mode-2)
    kEnterSetHour,        // released after 4 s hold (mode-1)
    kHit2sMark,           // crossed the 2 s boundary while still held
    kHit4sMark,           // crossed the 4 s boundary while still held
};

void begin();

// Call frequently (e.g. every 1 ms). Returns the next event, or kNone.
Event poll();

// True iff the button is currently down (debounced).
bool is_down();

// Time in ms since the current press began, or 0 if not pressed.
uint32_t held_ms();

}  // namespace button
