package app.bookstr.contracts

import app.bookstr.data.BookRightsMetadata
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class BookRightsV1ContractTest {
    private val fixture = JSONObject(File("../../shared/fixtures/book-rights-v1.json").readText())

    @Test
    fun androidRightsAdapterConformsToEverySharedV1Case() {
        assertEquals(1, fixture.getInt("version"))
        val cases = fixture.getJSONArray("cases")
        repeat(cases.length()) { index ->
            val entry = cases.getJSONObject(index)
            val input = entry.getJSONObject("input")
            val expected = entry.getJSONObject("expected")
            val actual = BookRightsMetadata.normalize(
                status = input.nullableString("status"),
                license = input.nullableString("license"),
                licenseUrl = input.nullableString("license_url"),
                source = input.nullableString("rights_source"),
                copyright = input.opt("copyright").takeUnless { it == null || it == JSONObject.NULL } as? Boolean,
            )

            assertEquals(entry.getString("name"), expected.getString("rights_status"), actual.status)
            assertEquals(entry.getString("name"), expected.nullableString("license"), actual.license)
            assertEquals(entry.getString("name"), expected.nullableString("license_url"), actual.licenseUrl)
            assertEquals(entry.getString("name"), expected.nullableString("rights_source"), actual.source)
        }
    }

    private fun JSONObject.nullableString(name: String): String? =
        opt(name).takeUnless { it == null || it == JSONObject.NULL } as? String
}
