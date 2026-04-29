// Host-side unit test for the pure cutoff logic in app_state.cpp.
// Compile: g++ -std=c++17 -Isrc tests/test_cutoff.cpp src/app_state.cpp -o /tmp/test_cutoff
//
// No Arduino headers required — app_state.h is pure C++ stdint.

#include "app_state.h"

#include <cstdio>
#include <cstdint>
#include <cstdlib>

namespace {

int g_failures = 0;

void check_cutoff_map(uint8_t bp, uint8_t expected) {
    const uint8_t got = app::breakpoint_to_cutoff_24h(bp);
    if (got != expected) {
        std::fprintf(stderr,
                     "FAIL: breakpoint_to_cutoff_24h(%u) -> %u, expected %u\n",
                     bp, got, expected);
        g_failures++;
    }
}

void check_band(uint8_t bp, uint8_t hour, bool expected_green,
                const char* label) {
    const bool got = app::is_before_cutoff(hour, bp);
    if (got != expected_green) {
        std::fprintf(stderr,
                     "FAIL [%s]: bp=%u hour=%u -> %s, expected %s\n",
                     label, bp, hour, got ? "GREEN" : "red",
                     expected_green ? "GREEN" : "red");
        g_failures++;
    }
}

}  // namespace

int main() {
    // ---- breakpoint_to_cutoff_24h: 1->13, 11->23, 12->0 ----
    check_cutoff_map(1, 13);
    check_cutoff_map(2, 14);
    check_cutoff_map(5, 17);
    check_cutoff_map(10, 22);
    check_cutoff_map(11, 23);
    check_cutoff_map(12, 0);

    // ---- breakpoint = 10 (cutoff 22:00). Spec: green 10am..21:59, red 22:00..09:59 ----
    // Green band:
    check_band(10, 10, true,  "bp=10 10am edge-green");
    check_band(10, 11, true,  "bp=10 11am");
    check_band(10, 14, true,  "bp=10 2pm");
    check_band(10, 21, true,  "bp=10 9pm last-green");
    // Red band:
    check_band(10, 22, false, "bp=10 10pm cutoff");
    check_band(10, 23, false, "bp=10 11pm");
    check_band(10,  0, false, "bp=10 midnight");
    check_band(10,  2, false, "bp=10 2am");
    check_band(10,  9, false, "bp=10 9am last-red");

    // ---- breakpoint = 12 (cutoff 00:00 = midnight). Green noon..23:59, red 00:00..11:59 ----
    check_band(12, 12, true,  "bp=12 noon edge-green");
    check_band(12, 18, true,  "bp=12 6pm");
    check_band(12, 23, true,  "bp=12 11pm last-green");
    check_band(12,  0, false, "bp=12 midnight cutoff");
    check_band(12,  6, false, "bp=12 6am");
    check_band(12, 11, false, "bp=12 11am last-red");

    // ---- breakpoint = 11 (cutoff 23:00). Green 11am..22:59, red 23:00..10:59 ----
    check_band(11, 11, true,  "bp=11 11am edge-green");
    check_band(11, 22, true,  "bp=11 10pm last-green");
    check_band(11, 23, false, "bp=11 11pm cutoff");
    check_band(11, 10, false, "bp=11 10am last-red");

    // ---- breakpoint = 1 (cutoff 13:00 = 1pm). Green 1am..12:59, red 13:00..00:59 ----
    check_band(1,  1, true,  "bp=1 1am edge-green");
    check_band(1, 12, true,  "bp=1 noon last-green");
    check_band(1, 13, false, "bp=1 1pm cutoff");
    check_band(1,  0, false, "bp=1 midnight last-red");

    // ---- exhaustive coverage: every (bp, hour) pair must have a definite answer
    //      and the band sizes must be exactly 12+12 ----
    for (uint8_t bp = 1; bp <= 12; ++bp) {
        int green_count = 0, red_count = 0;
        for (uint8_t h = 0; h < 24; ++h) {
            (app::is_before_cutoff(h, bp) ? green_count : red_count)++;
        }
        if (green_count != 12 || red_count != 12) {
            std::fprintf(stderr,
                         "FAIL: bp=%u green=%d red=%d (expected 12+12)\n",
                         bp, green_count, red_count);
            g_failures++;
        }
    }

    if (g_failures == 0) {
        std::printf("OK: all cutoff-logic tests passed\n");
        return 0;
    }
    std::fprintf(stderr, "FAILED: %d assertion(s)\n", g_failures);
    return 1;
}
