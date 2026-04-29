#include "prefs.h"

#include <Preferences.h>

namespace {

constexpr const char* kNs = "sleepmed";
constexpr const char* kKeyCutoff = "cutoff";
constexpr const char* kKeyTz = "tz";
constexpr const char* kKeyGeoEpoch = "geo";

Preferences nvs;

}  // namespace

namespace prefs {

void begin() {
    nvs.begin(kNs, false);
}

uint8_t load_cutoff_hour() {
    return nvs.getUChar(kKeyCutoff, kCutoffUnset);
}

void save_cutoff_hour(uint8_t h) {
    nvs.putUChar(kKeyCutoff, h);
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
