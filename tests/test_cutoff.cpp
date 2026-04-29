// Host-side unit test for the pure cutoff logic in app_state.cpp.
// Compile: g++ -std=c++17 -Isrc tests/test_cutoff.cpp src/app_state.cpp -o /tmp/test_cutoff
//
// No Arduino headers required — app_state.h is pure C++ stdint.

#include "app_state.h"

#include <cstdio>
#include <cstdint>

namespace {

int g_failures = 0;

void check(uint8_t cutoff, uint8_t hour, bool expected_green,
           const char* label) {
    const bool got = app::is_before_cutoff(hour, cutoff);
    if (got != expected_green) {
        std::fprintf(stderr,
                     "FAIL [%s]: cutoff=%u hour=%u -> %s, expected %s\n",
                     label, cutoff, hour, got ? "GREEN" : "red",
                     expected_green ? "GREEN" : "red");
        g_failures++;
    }
}

}  // namespace

int main() {
    // ---- cutoff = 22:00 (10 pm). Green 10am..21:59, red 22:00..09:59 ----
    check(22, 10, true,  "cutoff=22 10am edge-green");
    check(22, 11, true,  "cutoff=22 11am");
    check(22, 14, true,  "cutoff=22 2pm");
    check(22, 21, true,  "cutoff=22 9pm last-green");
    check(22, 22, false, "cutoff=22 10pm cutoff");
    check(22, 23, false, "cutoff=22 11pm");
    check(22,  0, false, "cutoff=22 midnight");
    check(22,  2, false, "cutoff=22 2am");
    check(22,  9, false, "cutoff=22 9am last-red");

    // ---- cutoff = 0 (midnight). Green noon..23:59, red 00:00..11:59 ----
    check(0, 12, true,  "cutoff=0 noon edge-green");
    check(0, 18, true,  "cutoff=0 6pm");
    check(0, 23, true,  "cutoff=0 11pm last-green");
    check(0,  0, false, "cutoff=0 midnight cutoff");
    check(0,  6, false, "cutoff=0 6am");
    check(0, 11, false, "cutoff=0 11am last-red");

    // ---- cutoff = 23 (11 pm). Green 11am..22:59, red 23:00..10:59 ----
    check(23, 11, true,  "cutoff=23 11am edge-green");
    check(23, 22, true,  "cutoff=23 10pm last-green");
    check(23, 23, false, "cutoff=23 11pm cutoff");
    check(23, 10, false, "cutoff=23 10am last-red");

    // ---- cutoff = 13 (1 pm). Green 1am..12:59, red 13:00..00:59 ----
    check(13,  1, true,  "cutoff=13 1am edge-green");
    check(13, 12, true,  "cutoff=13 noon last-green");
    check(13, 13, false, "cutoff=13 1pm cutoff");
    check(13,  0, false, "cutoff=13 midnight last-red");

    // ---- cutoff = 9 (9 am — unusual but valid). Green 9pm..08:59,
    //      red 9am..20:59 ----
    check(9, 21, true,  "cutoff=9 9pm edge-green");
    check(9,  8, true,  "cutoff=9 8am last-green");
    check(9,  9, false, "cutoff=9 9am cutoff");
    check(9, 20, false, "cutoff=9 8pm last-red");

    // ---- exhaustive: every (cutoff, hour) pair must have a definite answer
    //      and the band sizes must be exactly 12+12 ----
    for (uint8_t c = 0; c < 24; ++c) {
        int green_count = 0, red_count = 0;
        for (uint8_t h = 0; h < 24; ++h) {
            (app::is_before_cutoff(h, c) ? green_count : red_count)++;
        }
        if (green_count != 12 || red_count != 12) {
            std::fprintf(stderr,
                         "FAIL: cutoff=%u green=%d red=%d (expected 12+12)\n",
                         c, green_count, red_count);
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
