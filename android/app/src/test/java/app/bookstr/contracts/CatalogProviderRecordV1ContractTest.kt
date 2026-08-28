package app.bookstr.contracts

import app.bookstr.shared.generated.CATALOG_PROVIDER_RECORD_VERSION
import app.bookstr.shared.generated.CatalogProviderAcquisitionV1
import app.bookstr.shared.generated.CatalogProviderRecordV1
import app.bookstr.shared.generated.CatalogProviderRightsV1
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class CatalogProviderRecordV1ContractTest {
    private val fixture = JSONObject(File("../../shared/catalog/provider-records.json").readText())

    @Test
    fun generatedDtoRoundTripsEveryCanonicalProviderFixture() {
        assertEquals(CATALOG_PROVIDER_RECORD_VERSION, fixture.getInt("version"))
        val records = fixture.getJSONArray("records")
        repeat(records.length()) { index ->
            val source = records.getJSONObject(index)
            val decoded = CatalogProviderRecordV1.fromJson(source)
            val encoded = decoded.toJson()

            assertEquals(source.getString("publicationId"), decoded.publicationId)
            assertEquals(source.getJSONArray("authors").toString(), encoded.getJSONArray("authors").toString())
            assertEquals(source.getJSONArray("languages").toString(), encoded.getJSONArray("languages").toString())
            assertEquals(source.getJSONArray("acquisitions").toString(), encoded.getJSONArray("acquisitions").toString())
            assertEquals(source.getJSONObject("rights").toString(), encoded.getJSONObject("rights").toString())
            assertEquals(source.optString("publishedYear"), encoded.optString("publishedYear"))
        }
    }

    @Test
    fun generatedDtoPreservesOptionalRightsAndPdfAcquisition() {
        val json = JSONObject(
            """{
              "provider":"fixture","recordId":"pdf","publicationId":"fixture:pdf","title":"PDF",
              "authors":[],"languages":[],"publishedYear":"2026",
              "rights":{"status":"open_license","license":"CC BY","licenseUrl":"https://example.test/license","source":"fixture"},
              "acquisitions":[{"format":"pdf","url":"https://example.test/book.pdf","availability":"preview"}]
            }""".trimIndent(),
        )
        val decoded = CatalogProviderRecordV1.fromJson(json)

        assertEquals("2026", decoded.publishedYear)
        assertEquals("CC BY", decoded.rights.license)
        assertEquals("https://example.test/license", decoded.rights.licenseUrl)
        assertEquals("fixture", decoded.rights.source)
        assertEquals("pdf", decoded.acquisitions.single().format)
        assertTrue(decoded.toJson().has("publishedYear"))
    }

    @Test
    fun generatedDtoOmitsAbsentOptionalFields() {
        val decoded = CatalogProviderRecordV1.fromJson(fixture.getJSONArray("records").getJSONObject(0))
        val encoded = decoded.toJson()

        assertFalse(encoded.getJSONObject("rights").has("license"))
        assertFalse(encoded.getJSONObject("rights").has("licenseUrl"))
        assertEquals("gutendex", encoded.getJSONObject("rights").getString("source"))
    }

    @Test
    fun generatedDtoDefaultsRemainUsableByPlatformAdapters() {
        val rights = CatalogProviderRightsV1(status = "unknown")
        val acquisition = CatalogProviderAcquisitionV1("epub", "https://example.test/book.epub", "restricted")
        val record = CatalogProviderRecordV1(
            provider = "fixture",
            recordId = "defaults",
            publicationId = "fixture:defaults",
            title = "Defaults",
            authors = emptyList(),
            languages = emptyList(),
            rights = rights,
            acquisitions = listOf(acquisition),
        )

        assertEquals(rights, rights.copy())
        assertEquals(acquisition, acquisition.copy())
        assertEquals(record, record.copy())
        assertEquals(rights.hashCode(), rights.copy().hashCode())
        assertEquals(acquisition.hashCode(), acquisition.copy().hashCode())
        assertEquals(record.hashCode(), record.copy().hashCode())
        assertTrue(rights.toString().contains("unknown"))
        assertTrue(acquisition.toString().contains("epub"))
        assertTrue(record.toString().contains("fixture:defaults"))
        assertFalse(record.toJson().has("publishedYear"))
    }
}
