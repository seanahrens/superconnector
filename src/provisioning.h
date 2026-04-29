#pragma once

#include <stdint.h>

namespace provisioning {

// Returns true if WiFi credentials are present in NVS.
bool has_credentials();

// Block until WiFi is connected, running BLE provisioning if needed.
// Drives the LED via the led module.
void connect_or_provision(uint32_t timeout_ms);

// Hold the button for kFactoryResetHoldMs at boot to wipe NVS and reboot.
// Called once at the very top of setup() before any other init.
void check_factory_reset_at_boot();

}  // namespace provisioning
