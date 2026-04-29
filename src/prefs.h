#pragma once

#include <Arduino.h>
#include <stdint.h>

namespace prefs {

constexpr uint8_t kCutoffUnset = 0xFF;

void begin();

// Medication cutoff hour stored as 24-hour value (0..23). 0xFF = unset.
uint8_t load_cutoff_hour();
void save_cutoff_hour(uint8_t h);

String load_tz_posix();
void save_tz_posix(const String& tz);

uint32_t load_last_geo_lookup();
void save_last_geo_lookup(uint32_t epoch);

void wipe_all();

}  // namespace prefs
