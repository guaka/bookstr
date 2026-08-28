package app.bookstr.data

import app.bookstr.nostr.NostrClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BookRightsMetadataTest {
    @Test
    fun normalizesOnlyExplicitRightsEvidence() {
        assertEquals(RIGHTS_PUBLIC_DOMAIN, BookRightsMetadata.normalize(license = "Public Domain Mark 1.0").status)
        assertEquals("CC0", BookRightsMetadata.normalize(license = "CC0 1.0").compactLabel)
        assertEquals("CC BY-SA 4.0", BookRightsMetadata.normalize(license = "CC BY-SA 4.0").compactLabel)
        assertEquals(RIGHTS_OPEN_LICENSE, BookRightsMetadata.normalize(license = "GNU Free Documentation License").status)
        assertEquals(RIGHTS_COPYRIGHTED, BookRightsMetadata.normalize(license = "All rights reserved").status)
        assertEquals(RIGHTS_UNKNOWN, BookRightsMetadata.normalize(source = "gutenberg").status)
        assertEquals("No open license identified", BookRightsMetadata.normalize().accessibleLabel)
    }

    @Test
    fun handlesGutendexSafeUrlsAndNonErasure() {
        val publicDomain = BookRightsMetadata.normalize(copyright = false, source = "gutendex")
        assertEquals("Public domain in the U.S.", publicDomain.license)
        assertEquals(RIGHTS_COPYRIGHTED, BookRightsMetadata.normalize(copyright = true).status)
        assertEquals(RIGHTS_UNKNOWN, BookRightsMetadata.normalize(copyright = null).status)
        assertNull(BookRightsMetadata.normalize(licenseUrl = "javascript:alert(1)").licenseUrl)
        val current = BookRightsMetadata.normalize(license = "CC BY 4.0", source = "catalog")
        assertEquals(current, BookRightsMetadata.preferred(current, BookRightsMetadata.normalize()))
    }

    @Test
    fun searchFavoritesAndProgressRoundTripRights() {
        val result = CatalogRepository.parseSearchResponse(
            """{"books":[{"id":"7","source":"gutenberg","title":"Open","copyright":false}]}""",
        ).single()
        assertEquals(RIGHTS_PUBLIC_DOMAIN, result.rightsStatus)
        assertEquals("gutendex", result.rightsSource)

        val serialized = NostrFavoritesRepository.serializeSharedFavoriteTags(
            listOf(
                SharedFavoriteRef(
                    bookstrId = "gutenberg:7",
                    title = "Open",
                    rightsStatus = RIGHTS_OPEN_LICENSE,
                    license = "CC BY 4.0",
                    licenseUrl = "https://creativecommons.org/licenses/by/4.0/",
                    rightsSource = "gutendex",
                ),
            ),
        )
        val tags = JSONArray(serialized)
        assertEquals("2", tags.getJSONArray(0).getString(1))
        assertEquals("CC BY 4.0", NostrFavoritesRepository.parseSharedFavoriteTags(serialized).single().license)

        val progress = JSONObject(
            NostrClient.progressContent(
                "gutenberg:7", 0.5, "epubcfi(/6/2)",
                rights = BookRights(RIGHTS_OPEN_LICENSE, "CC BY 4.0", null, "gutendex"),
            ),
        )
        assertEquals(2, progress.getInt("v"))
        assertEquals(RIGHTS_OPEN_LICENSE, progress.getString("rights_status"))
    }
}
