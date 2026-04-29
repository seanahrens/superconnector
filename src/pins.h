#pragma once

#include <stdint.h>

namespace pins {

constexpr uint8_t kButton = 39;
constexpr uint8_t kLedData = 27;

#if HAVE_SPEAKER
constexpr uint8_t kI2sBclk = 19;
constexpr uint8_t kI2sLrck = 33;
constexpr uint8_t kI2sData = 22;
#endif

}  // namespace pins

namespace timings {

constexpr uint32_t kPollIntervalMs = 1;
constexpr uint32_t kDebounceMs = 20;
constexpr uint32_t kSinglePressMaxMs = 600;
constexpr uint32_t kHold2sMs = 2000;
constexpr uint32_t kHold4sMs = 4000;
constexpr uint32_t kFactoryResetHoldMs = 10000;

constexpr uint32_t kOpeningBeepMs = 1000;
constexpr uint32_t kSetWindowInactivityMs = 3000;
constexpr uint32_t kAnswerDisplayMs = 3000;

constexpr uint32_t kDailyResyncMs = 24UL * 60UL * 60UL * 1000UL;

}  // namespace timings

namespace audio_cfg {

constexpr uint32_t kSampleRate = 16000;
constexpr int16_t kVolumeScale = 0x2000;  // ~25% of int16 max

}  // namespace audio_cfg
