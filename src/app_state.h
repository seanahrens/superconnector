#pragma once

#include <stdint.h>

namespace app {

enum class Mode : uint8_t {
    kIdle,
    kAnswering,           // showing green/red/amber for 3 s
    kSetCutoffWindow,     // mode-2: collecting taps for 3 s
    kSetHourWindow,       // mode-1: collecting taps for 3 s
    kBootProvisioning,
    kBootConnecting,
    kBootDone,
};

struct State {
    Mode mode = Mode::kIdle;
    // Medication cutoff hour, 0..23 (0 = midnight, 13 = 1pm, etc.).
    // 0xFF means the user hasn't set it yet.
    uint8_t cutoff_hour_24 = 0xFF;
    bool wifi_online = false;
};

State& get();

// Returns true if `current_hour_24` is within the 12-hour green band before
// the medication-cutoff hour. False means the 12-hour red band at/after.
// Both arguments are 0..23 (0 = midnight, 13 = 1pm, 23 = 11pm).
bool is_before_cutoff(uint8_t current_hour_24, uint8_t cutoff_hour_24);

}  // namespace app
