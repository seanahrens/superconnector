#include "app_state.h"

namespace app {

namespace {
State g_state;
}

State& get() {
    return g_state;
}

bool is_before_cutoff(uint8_t current_hour_24, uint8_t cutoff_hour_24) {
    const uint8_t delta =
        static_cast<uint8_t>((current_hour_24 + 24 - cutoff_hour_24) % 24);
    return delta >= 12;  // 12..23 hours past cutoff = still in green band
}

}  // namespace app
