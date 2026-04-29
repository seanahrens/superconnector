#include "clock_sync.h"

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <sys/time.h>

#include "geo_tz.h"
#include "pins.h"
#include "prefs.h"

namespace {

void apply_tz(const String& posix) {
    setenv("TZ", posix.c_str(), 1);
    tzset();
}

void configure_ntp(const String& posix) {
    apply_tz(posix);
    configTzTime(posix.c_str(), "pool.ntp.org", "time.google.com");
}

void daily_task(void*) {
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(timings::kDailyResyncMs));
        if (WiFi.status() == WL_CONNECTED) clock_sync::sync_now();
    }
}

}  // namespace

namespace clock_sync {

void sync_now() {
    if (WiFi.status() != WL_CONNECTED) return;

    String posix = prefs::load_tz_posix();
    const uint32_t now_epoch = static_cast<uint32_t>(time(nullptr));
    const uint32_t last = prefs::load_last_geo_lookup();

    if (now_epoch == 0 || (now_epoch - last) > 86400UL) {
        const String fresh = geo_tz::fetch_posix_tz();
        if (fresh.length() > 0) {
            posix = fresh;
            prefs::save_tz_posix(posix);
            prefs::save_last_geo_lookup(now_epoch ? now_epoch : 1);
        }
    }

    configure_ntp(posix);
}

void start_daily_task() {
    xTaskCreatePinnedToCore(daily_task, "daily_sync", 4096, nullptr, 1,
                            nullptr, 1);
}

void set_hour_from_user(uint8_t hour_24) {
    apply_tz(prefs::load_tz_posix());

    time_t now = time(nullptr);
    struct tm tm_local;
    if (now <= 0) {
        // No real clock yet; seed with a sane epoch so mktime works.
        now = 1700000000;  // 2023-11-14
    }
    localtime_r(&now, &tm_local);
    tm_local.tm_hour = hour_24;
    tm_local.tm_min = 0;
    tm_local.tm_sec = 0;
    const time_t target = mktime(&tm_local);

    struct timeval tv = {target, 0};
    settimeofday(&tv, nullptr);
}

uint8_t local_hour() {
    apply_tz(prefs::load_tz_posix());
    const time_t now = time(nullptr);
    if (now <= 0) return 0;
    struct tm tm_local;
    localtime_r(&now, &tm_local);
    return static_cast<uint8_t>(tm_local.tm_hour);
}

}  // namespace clock_sync
