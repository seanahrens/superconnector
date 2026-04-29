#include "app_state.h"

namespace app {

namespace {
State g_state;
}

State& get() {
    return g_state;
}

uint8_t breakpoint_to_cutoff_24h(uint8_t bp) {
    if (bp == 12) return 0;
    return static_cast<uint8_t>(bp + 12);
}

bool is_before_cutoff(uint8_t current_hour_24, uint8_t bp) {
    const uint8_t cutoff = breakpoint_to_cutoff_24h(bp);
    const uint8_t delta =
        static_cast<uint8_t>((current_hour_24 + 24 - cutoff) % 24);
    return delta >= 12;  // 12..23 hours past last cutoff = still in green band
}

}  // namespace app
