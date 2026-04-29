#include "geo_tz.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>

namespace {

struct Entry {
    const char* iana;
    const char* posix;
};

// ~30 common zones with full DST rules. Sourced from the IANA tzdata
// equivalents; adjust if a region needs more granularity.
constexpr Entry kZones[] = {
    {"UTC", "UTC0"},
    {"Etc/UTC", "UTC0"},
    {"America/New_York", "EST5EDT,M3.2.0,M11.1.0"},
    {"America/Chicago", "CST6CDT,M3.2.0,M11.1.0"},
    {"America/Denver", "MST7MDT,M3.2.0,M11.1.0"},
    {"America/Phoenix", "MST7"},
    {"America/Los_Angeles", "PST8PDT,M3.2.0,M11.1.0"},
    {"America/Anchorage", "AKST9AKDT,M3.2.0,M11.1.0"},
    {"America/Halifax", "AST4ADT,M3.2.0,M11.1.0"},
    {"America/St_Johns", "NST3:30NDT,M3.2.0,M11.1.0"},
    {"America/Toronto", "EST5EDT,M3.2.0,M11.1.0"},
    {"America/Vancouver", "PST8PDT,M3.2.0,M11.1.0"},
    {"America/Mexico_City", "CST6"},
    {"America/Sao_Paulo", "BRT3"},
    {"Europe/London", "GMT0BST,M3.5.0/1,M10.5.0"},
    {"Europe/Dublin", "GMT0IST,M3.5.0/1,M10.5.0"},
    {"Europe/Paris", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Berlin", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Madrid", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Rome", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Amsterdam", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"Europe/Athens", "EET-2EEST,M3.5.0/3,M10.5.0/4"},
    {"Europe/Moscow", "MSK-3"},
    {"Africa/Johannesburg", "SAST-2"},
    {"Asia/Dubai", "GST-4"},
    {"Asia/Kolkata", "IST-5:30"},
    {"Asia/Bangkok", "ICT-7"},
    {"Asia/Shanghai", "CST-8"},
    {"Asia/Singapore", "SGT-8"},
    {"Asia/Tokyo", "JST-9"},
    {"Asia/Seoul", "KST-9"},
    {"Australia/Sydney", "AEST-10AEDT,M10.1.0,M4.1.0/3"},
    {"Australia/Melbourne", "AEST-10AEDT,M10.1.0,M4.1.0/3"},
    {"Australia/Perth", "AWST-8"},
    {"Pacific/Auckland", "NZST-12NZDT,M9.5.0,M4.1.0/3"},
    {"Pacific/Honolulu", "HST10"},
};

}  // namespace

namespace geo_tz {

String iana_to_posix(const String& iana) {
    for (const auto& e : kZones) {
        if (iana == e.iana) return String(e.posix);
    }
    return String("");
}

String fetch_posix_tz() {
    HTTPClient http;
    http.setTimeout(5000);
    if (!http.begin("http://ip-api.com/json/?fields=status,timezone")) {
        return String("");
    }

    const int code = http.GET();
    if (code != 200) {
        http.end();
        return String("");
    }

    const String body = http.getString();
    http.end();

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, body)) return String("");

    const char* status = doc["status"] | "";
    if (String(status) != "success") return String("");

    const char* tz = doc["timezone"] | "";
    return iana_to_posix(String(tz));
}

}  // namespace geo_tz
