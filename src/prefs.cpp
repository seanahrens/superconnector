#include "prefs.h"

#include <Preferences.h>

namespace {

constexpr const char* kNs = "sleepmed";
constexpr const char* kKeyBreakpoint = "bp";
constexpr const char* kKeyTz = "tz";
constexpr const char* kKeyGeoEpoch = "geo";

Preferences nvs;

}  // namespace

namespace prefs {

void begin() {
    nvs.begin(kNs, false);
}

uint8_t load_breakpoint_hour() {
    return nvs.getUChar(kKeyBreakpoint, kBreakpointUnset);
}

void save_breakpoint_hour(uint8_t h) {
    nvs.putUChar(kKeyBreakpoint, h);
}

String load_tz_posix() {
    return nvs.getString(kKeyTz, "UTC0");
}

void save_tz_posix(const String& tz) {
    nvs.putString(kKeyTz, tz);
}

uint32_t load_last_geo_lookup() {
    return nvs.getUInt(kKeyGeoEpoch, 0);
}

void save_last_geo_lookup(uint32_t epoch) {
    nvs.putUInt(kKeyGeoEpoch, epoch);
}

void wipe_all() {
    nvs.clear();
}

}  // namespace prefs
