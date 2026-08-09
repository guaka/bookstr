## Purpose

Allow optional continued reading over the Android lock screen without unlocking the device.

## ADDED Requirements

### Requirement: Optional lock-screen reading
When enabled, `ReaderActivity` SHALL call `setShowWhenLocked(true)` and `setInheritShowWhenLocked(true)` (API 33+) and keep the screen on while reading. It SHALL NOT dismiss the keyguard for this mode.

#### Scenario: Lock while reading with toggle on
- **GIVEN** lock-screen reading is enabled
- **WHEN** the user locks the device while in the reader
- **THEN** the reader remains visible and paginable over the keyguard

#### Scenario: Toggle off
- **GIVEN** lock-screen reading is disabled
- **WHEN** the user locks the device
- **THEN** the normal keyguard is shown without the reader
