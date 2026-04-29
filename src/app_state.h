#pragma once

#include <stdint.h>

namespace app {

enum class Mode : uint8_t {
    kIdle,
    kAnswering,           // showing green/red/amber for 3 s
    kSetBreakpointWindow, // mode-2: collecting taps for 3 s
    kSetHourWindow,       // mode-1: collecting taps for 3 s
    kBootProvisioning,
    kBootConnecting,
    kBootDone,
};

struct State {
    Mode mode = Mode::kIdle;
    uint8_t breakpoint_hour = 0xFF;  // 1..12, 0xFF = unset
    bool wifi_online = false;
};

State& get();

// Translate breakpoint (1..12, PM cutoff) to a 24h cutoff hour.
// 1 -> 13, ..., 11 -> 23, 12 -> 0.
uint8_t breakpoint_to_cutoff_24h(uint8_t bp);

// Returns true if the current local hour is within the 12-hour green band
// before the cutoff. False means the 12-hour red band at/after the cutoff.
bool is_before_cutoff(uint8_t current_hour_24, uint8_t bp);

}  // namespace app
