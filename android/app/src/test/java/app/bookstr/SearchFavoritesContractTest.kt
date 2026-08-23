package app.bookstr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SearchFavoritesContractTest {
    @Test
    fun everySearchResultOffersFavoriteControl() {
        val screen = File("src/main/java/app/bookstr/ui/SearchScreen.kt").readText()

        assertTrue(screen.contains("onClick = { onToggleFavorite(result) }"))
        assertFalse(screen.contains("enabled = book != null,\n                        onClick = { onToggleFavorite(result) }"))
    }

    @Test
    fun metadataOnlyResultsUseSerializableNostrReference() {
        val activity = File("src/main/java/app/bookstr/MainActivity.kt").readText()

        assertTrue(activity.contains("SharedFavoriteRef("))
        assertTrue(activity.contains("bookstrId = result.id"))
        assertTrue(activity.contains("favoritesRepository.addFavorite("))
    }
}
