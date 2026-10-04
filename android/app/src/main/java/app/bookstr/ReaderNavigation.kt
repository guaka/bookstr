package app.bookstr

import android.content.Intent
import androidx.activity.ComponentActivity

internal fun ComponentActivity.openMainTab(tab: Int) {
    startActivity(
        Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_SELECT_TAB, tab)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP),
    )
}

internal fun ComponentActivity.searchReaderAuthor(author: String) {
    startActivity(
        Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_SELECT_TAB, 3)
            .putExtra(MainActivity.EXTRA_SEARCH_QUERY, author)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP),
    )
}
