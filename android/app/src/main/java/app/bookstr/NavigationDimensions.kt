package app.bookstr

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal fun navigationSizes(smallestScreenWidthDp: Int): Pair<Dp, Dp> =
    if (smallestScreenWidthDp >= 600) 32.dp to 64.dp else 24.dp to 56.dp
