#pragma once

#include <Arduino.h>
#include <stdint.h>

namespace prefs {

constexpr uint8_t kBreakpointUnset = 0xFF;

void begin();

uint8_t load_breakpoint_hour();
void save_breakpoint_hour(uint8_t h);

String load_tz_posix();
void save_tz_posix(const String& tz);

uint32_t load_last_geo_lookup();
void save_last_geo_lookup(uint32_t epoch);

void wipe_all();

}  // namespace prefs
