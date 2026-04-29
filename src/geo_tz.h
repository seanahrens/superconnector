#pragma once

#include <Arduino.h>

namespace geo_tz {

// Map IANA tz (e.g. "America/New_York") to a POSIX TZ string.
// Returns "" if not found.
String iana_to_posix(const String& iana);

// HTTP GET ip-api.com, parse, return POSIX TZ on success or "" on failure.
String fetch_posix_tz();

}  // namespace geo_tz
