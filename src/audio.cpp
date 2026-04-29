#include "audio.h"

#if HAVE_SPEAKER

#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>

#include "pins.h"

namespace {

constexpr i2s_port_t kPort = I2S_NUM_0;

void write_sine(uint16_t freq_hz, uint32_t duration_ms) {
    const uint32_t total_samples =
        (audio_cfg::kSampleRate * duration_ms) / 1000;
    constexpr size_t kChunk = 256;
    int16_t buf[kChunk];
    const float two_pi_f = 2.0f * 3.14159265f * static_cast<float>(freq_hz) /
                           static_cast<float>(audio_cfg::kSampleRate);
    uint32_t n = 0;
    while (n < total_samples) {
        const size_t this_chunk =
            (total_samples - n) < kChunk ? (total_samples - n) : kChunk;
        for (size_t i = 0; i < this_chunk; ++i) {
            const float s = sinf(two_pi_f * static_cast<float>(n + i));
            buf[i] = static_cast<int16_t>(s * audio_cfg::kVolumeScale);
        }
        size_t written = 0;
        i2s_write(kPort, buf, this_chunk * sizeof(int16_t), &written,
                  portMAX_DELAY);
        n += this_chunk;
    }
}

void write_silence(uint32_t duration_ms) {
    const uint32_t total_samples =
        (audio_cfg::kSampleRate * duration_ms) / 1000;
    constexpr size_t kChunk = 256;
    int16_t buf[kChunk] = {0};
    uint32_t n = 0;
    while (n < total_samples) {
        const size_t this_chunk =
            (total_samples - n) < kChunk ? (total_samples - n) : kChunk;
        size_t written = 0;
        i2s_write(kPort, buf, this_chunk * sizeof(int16_t), &written,
                  portMAX_DELAY);
        n += this_chunk;
    }
}

}  // namespace

namespace audio {

void begin() {
    i2s_config_t cfg = {};
    cfg.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
    cfg.sample_rate = audio_cfg::kSampleRate;
    cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    cfg.channel_format = I2S_CHANNEL_FMT_ONLY_RIGHT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count = 4;
    cfg.dma_buf_len = 256;
    cfg.use_apll = false;
    cfg.tx_desc_auto_clear = true;

    i2s_pin_config_t pin = {};
    pin.bck_io_num = pins::kI2sBclk;
    pin.ws_io_num = pins::kI2sLrck;
    pin.data_out_num = pins::kI2sData;
    pin.data_in_num = I2S_PIN_NO_CHANGE;

    i2s_driver_install(kPort, &cfg, 0, nullptr);
    i2s_set_pin(kPort, &pin);
    i2s_zero_dma_buffer(kPort);
}

void play_tone(uint16_t freq_hz, uint32_t duration_ms) {
    write_sine(freq_hz, duration_ms);
}

void boot_tick() {
    play_tone(1000, 80);
}

void mark_2s_beep() {
    play_tone(600, 120);
}

void mark_4s_beep() {
    play_tone(1200, 120);
}

void mode1_opening() {
    play_tone(880, 1000);
}

void mode2_opening() {
    // 660+440 Hz warble: alternate every 50 ms for 1000 ms total
    for (int i = 0; i < 10; ++i) {
        play_tone((i & 1) ? 440 : 660, 50);
    }
}

void chime_happy() {
    play_tone(523, 150);  // C5
    write_silence(20);
    play_tone(659, 150);  // E5
    write_silence(20);
    play_tone(784, 150);  // G5
}

void chime_sad() {
    play_tone(784, 150);  // G5
    write_silence(20);
    play_tone(659, 150);  // E5
    write_silence(20);
    play_tone(523, 150);  // C5
}

}  // namespace audio

#endif  // HAVE_SPEAKER
