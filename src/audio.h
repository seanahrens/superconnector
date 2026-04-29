#pragma once

#include <stdint.h>

namespace audio {

#if HAVE_SPEAKER

void begin();
void play_tone(uint16_t freq_hz, uint32_t duration_ms);
void boot_tick();
void mark_2s_beep();
void mark_4s_beep();
void mode1_opening();   // 880 Hz, 1000 ms
void mode2_opening();   // 660+440 Hz warble, 1000 ms
void chime_happy();     // C5-E5-G5
void chime_sad();       // G5-E5-C5

#else

inline void begin() {}
inline void play_tone(uint16_t, uint32_t) {}
inline void boot_tick() {}
inline void mark_2s_beep() {}
inline void mark_4s_beep() {}
inline void mode1_opening() {}
inline void mode2_opening() {}
inline void chime_happy() {}
inline void chime_sad() {}

#endif

}  // namespace audio
