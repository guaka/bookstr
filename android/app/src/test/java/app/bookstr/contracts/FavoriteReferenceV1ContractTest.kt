package app.bookstr.contracts

import app.bookstr.data.NostrFavoritesRepository
import app.bookstr.data.SharedFavoriteRef
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class FavoriteReferenceV1ContractTest {
    private val fixture = JSONObject(File("../../shared/fixtures/favorite-reference-v1.json").readText())

    @Test
    fun androidCompactFavoriteParserConformsToEverySharedV1Case() {
        assertEquals(1, fixture.getInt("version"))
        val cases = fixture.getJSONArray("cases")
        repeat(cases.length()) { caseIndex ->
            val entry = cases.getJSONObject(caseIndex)
            val refs = NostrFavoritesRepository.parseSharedFavoriteTags(entry.getJSONArray("tags").toString())
            val actual = JSONArray(refs.map(::canonical))
            assertEquals(entry.getString("name"), entry.getJSONArray("expected").toString(), actual.toString())
        }
    }

    private fun canonical(ref: SharedFavoriteRef): JSONObject {
        val (type, identifier, locator) = when {
            ref.libvaultMd5 != null -> Triple("libvault", ref.libvaultMd5, ref.url)
            ref.bookstrId != null -> Triple("bookstr", ref.bookstrId, ref.url)
            ref.isbn != null -> Triple("isbn", ref.isbn, ref.url)
            ref.blossomSha256 != null -> Triple("blossom", ref.blossomSha256, ref.blossomUrl)
            else -> Triple("url", ref.url.orEmpty(), ref.url)
        }
        return JSONObject()
            .put("type", type)
            .put("identifier", identifier)
            .put("locator", locator.orEmpty())
            .put("addedAt", ref.addedAt ?: 0L)
    }
}
