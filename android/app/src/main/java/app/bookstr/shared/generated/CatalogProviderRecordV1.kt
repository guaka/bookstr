// Generated from shared/catalog/provider-records.schema.json. Do not edit.
package app.bookstr.shared.generated

import org.json.JSONArray
import org.json.JSONObject

const val CATALOG_PROVIDER_RECORD_VERSION = 1

data class CatalogProviderRightsV1(
    val status: String,
    val license: String? = null,
    val licenseUrl: String? = null,
    val source: String? = null,
)

data class CatalogProviderAcquisitionV1(
    val format: String,
    val url: String,
    val availability: String,
)

data class CatalogProviderRecordV1(
    val provider: String,
    val recordId: String,
    val publicationId: String,
    val title: String,
    val authors: List<String>,
    val languages: List<String>,
    val publishedYear: String? = null,
    val rights: CatalogProviderRightsV1,
    val acquisitions: List<CatalogProviderAcquisitionV1>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("provider", provider)
        .put("recordId", recordId)
        .put("publicationId", publicationId)
        .put("title", title)
        .put("authors", JSONArray(authors))
        .put("languages", JSONArray(languages))
        .apply { if (publishedYear != null) put("publishedYear", publishedYear) }
        .put("rights", JSONObject()
            .put("status", rights.status)
            .apply {
                if (rights.license != null) put("license", rights.license)
                if (rights.licenseUrl != null) put("licenseUrl", rights.licenseUrl)
                if (rights.source != null) put("source", rights.source)
            })
        .put("acquisitions", JSONArray(acquisitions.map { acquisition -> JSONObject()
            .put("format", acquisition.format)
            .put("url", acquisition.url)
            .put("availability", acquisition.availability)
        }))

    companion object {
        fun fromJson(json: JSONObject): CatalogProviderRecordV1 {
            val rights = json.getJSONObject("rights")
            return CatalogProviderRecordV1(
                provider = json.getString("provider"),
                recordId = json.getString("recordId"),
                publicationId = json.getString("publicationId"),
                title = json.getString("title"),
                authors = json.getJSONArray("authors").strings(),
                languages = json.getJSONArray("languages").strings(),
                publishedYear = json.optString("publishedYear").ifBlank { null },
                rights = CatalogProviderRightsV1(
                    status = rights.getString("status"),
                    license = rights.optString("license").ifBlank { null },
                    licenseUrl = rights.optString("licenseUrl").ifBlank { null },
                    source = rights.optString("source").ifBlank { null },
                ),
                acquisitions = json.getJSONArray("acquisitions").objects().map { acquisition ->
                    CatalogProviderAcquisitionV1(
                        format = acquisition.getString("format"),
                        url = acquisition.getString("url"),
                        availability = acquisition.getString("availability"),
                    )
                },
            )
        }
    }
}

private fun JSONArray.strings(): List<String> = (0 until length()).map(::getString)
private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
