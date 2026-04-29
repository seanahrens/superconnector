#include "provisioning.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiProv.h>
#include <esp_wifi.h>

#include "led.h"
#include "pins.h"
#include "prefs.h"

namespace {

constexpr const char* kPopToken = "sleepmed";
constexpr const char* kServiceName = "PROV_SLEEPMED";

void on_prov_event(arduino_event_t* sys_event) {
    switch (sys_event->event_id) {
        case ARDUINO_EVENT_PROV_START:
            led::set(led::Effect::kSolidBlue);
            break;
        case ARDUINO_EVENT_PROV_CRED_RECV:
            // creds received; will continue with WiFi connect events
            break;
        case ARDUINO_EVENT_PROV_CRED_FAIL:
            led::set(led::Effect::kSolidRed1s);
            break;
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            led::set(led::Effect::kSlowBluePulse);
            break;
        default:
            break;
    }
}

}  // namespace

namespace provisioning {

bool has_credentials() {
    wifi_config_t cfg;
    if (esp_wifi_get_config(WIFI_IF_STA, &cfg) != ESP_OK) return false;
    return cfg.sta.ssid[0] != 0;
}

void connect_or_provision(uint32_t timeout_ms) {
    WiFi.onEvent(on_prov_event);

    if (has_credentials()) {
        led::set(led::Effect::kSlowBluePulse);
        WiFi.mode(WIFI_STA);
        WiFi.begin();
    } else {
        WiFiProv.beginProvision(WIFI_PROV_SCHEME_BLE,
                                WIFI_PROV_SCHEME_HANDLER_FREE_BTDM,
                                WIFI_PROV_SECURITY_1, kPopToken,
                                kServiceName);
    }

    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           (millis() - start) < timeout_ms) {
        led::tick();
        delay(50);
    }
}

void check_factory_reset_at_boot() {
    pinMode(pins::kButton, INPUT);
    if (digitalRead(pins::kButton) != LOW) return;  // not pressed

    const uint32_t start = millis();
    while (digitalRead(pins::kButton) == LOW) {
        if (millis() - start >= timings::kFactoryResetHoldMs) {
            led::begin();
            led::set(led::Effect::kFactoryResetBlinks);
            while (!led::effect_done()) {
                led::tick();
                delay(10);
            }
            prefs::begin();
            prefs::wipe_all();
            WiFi.disconnect(true, true);
            delay(200);
            ESP.restart();
        }
        delay(20);
    }
}

}  // namespace provisioning
