package app.bookstr

import android.content.res.Configuration

internal fun isTelevision(uiMode: Int): Boolean =
    uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION

internal fun appFontMultiplier(uiMode: Int, smallestWidth: Int): Float =
    if (isTelevision(uiMode)) 1.5f else tabletFontMultiplier(smallestWidth)

internal fun shouldStartReaderNarration(uiMode: Int, externalRequest: Boolean, alreadyHandled: Boolean): Boolean =
    !alreadyHandled && (isTelevision(uiMode) || externalRequest)
