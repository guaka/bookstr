package app.bookstr

internal fun tabletFontMultiplier(smallestScreenWidthDp: Int): Float =
    if (smallestScreenWidthDp >= 600) 1.2f else 1f
