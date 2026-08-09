## Purpose

Immersive, distraction-free reading that maximizes text on screen.

## ADDED Requirements

### Requirement: Hidden chrome by default
While reading, the UI SHALL NOT show persistent toolbars, FABs, or title bars. A center tap SHALL toggle a brief minimal overlay (back, progress, TOC, and Android lock-screen toggle).

#### Scenario: Enter reading
- **GIVEN** the user opens a book
- **WHEN** the reader is shown
- **THEN** almost the full viewport is text with chrome hidden

### Requirement: Smooth paging
The reader SHALL support edge tap and/or swipe page turns with smooth transitions. On Android, volume keys SHALL turn pages.

#### Scenario: Volume page turn
- **GIVEN** the Android reader is foreground
- **WHEN** the user presses volume down
- **THEN** the reader advances one page

### Requirement: Simple themes
The reader SHALL offer paper and night themes without busy in-reader chrome.
