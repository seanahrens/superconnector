#pragma once

#include <stdint.h>

namespace clock_sync {

// Apply NTP using the POSIX TZ already in NVS, and (if more than 24 h have
// passed) refresh the IP-geo timezone. Idempotent; safe to call any time
// WiFi is up.
void sync_now();

// Spawn a FreeRTOS task that calls sync_now() once per 24 h.
void start_daily_task();

// Manually set the wall clock. Used by SET_HOUR.
void set_hour_from_user(uint8_t hour_24);

// Get the local hour (0..23) from the system clock. Returns 0 if the clock
// has never been set.
uint8_t local_hour();

}  // namespace clock_sync
