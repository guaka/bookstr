package app.bookstr

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReaderNavigationContractTest {
    @Test
    fun readerNavigationIntentsTargetMainTabsAndAuthorSearch() {
        val source = File("src/main/java/app/bookstr/ReaderNavigation.kt").readText()
        assertTrue(source.contains("EXTRA_SELECT_TAB, tab"))
        assertTrue(source.contains("EXTRA_SELECT_TAB, 3"))
        assertTrue(source.contains("EXTRA_SEARCH_QUERY, author"))
        assertTrue(source.contains("FLAG_ACTIVITY_REORDER_TO_FRONT"))
        assertTrue(source.contains("FLAG_ACTIVITY_SINGLE_TOP"))
        assertTrue(source.contains("MainActivity::class.java"))
    }
}
