package app.bookstr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SearchFavoritesContractTest {
    @Test
    fun searchResultsDoNotOfferFavoriteControlsOrBadges() {
        val screen = File("src/main/java/app/bookstr/ui/SearchScreen.kt").readText()
        assertFalse(screen.contains("onClick = { onToggleFavorite(result) }"))
        assertFalse(screen.contains("♥ Favorite"))
        assertFalse(screen.contains("Icons.Default.Favorite"))
    }

    @Test
    fun metadataOnlyResultsUseSerializableNostrReference() {
        val activity = File("src/main/java/app/bookstr/MainActivity.kt").readText()

        assertTrue(activity.contains("SharedFavoriteRef("))
        assertTrue(activity.contains("bookstrId = result.id"))
        assertTrue(activity.contains("favoritesRepository.addFavorite("))
    }
}
