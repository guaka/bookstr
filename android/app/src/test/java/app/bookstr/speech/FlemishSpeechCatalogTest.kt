package app.bookstr.speech

import java.io.File
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FlemishSpeechCatalogTest {
    private val catalog = JSONArray(File("src/main/assets/speech-models.json").readText())

    @Test fun belgianDutchVoicesAreSelectableUnderExistingDutchLanguageTag() {
        val voices = listOf("piper_nl_be_nathalie", "piper_nl_be_rdh").map(::voice)

        assertEquals(listOf("nl", "nl"), voices.map { it.getString("language") })
        assertEquals(listOf("Nathalie · Nederlands (nl-BE)", "RDH · Nederlands (nl-BE)"), voices.map { it.getString("label") })
        assertEquals("nl", SpeechLanguages.tag("nl-BE"))
    }

    @Test fun voicesUsePinnedModelAndTokenArtifactsAndCompleteDutchPronunciationData() {
        val expected = mapOf(
            "piper_nl_be_nathalie" to listOf("1356793b677b4effa325817d758902c88d775709", "63201420", "921", "d6901ce5548dc4ca2d7f42fd5e53647fdd790b5b6a4350aa8b4e24adc3e903dc", "87c8ef66eae5473ed0cc0366b3964c736ca6c5f676c979522ea31234e47430b9"),
            "piper_nl_be_rdh" to listOf("6e4aa36cc18a29bd5b72786dc52eee9fb49bc26a", "63104652", "763", "45260062e54e44270d6e3b57c082b3d0d7085e4b542fa2909cf212ffad4b73a0", "42d1a69ed2b91a51928a711aa228ed9f3dc021c6d359a3e9c4f37eb1d20f80bd"),
        )
        for ((id, values) in expected) {
            val model = voice(id)
            assertEquals(values[0], model.getString("revision"))
            val files = model.getJSONArray("files")
            val modelFile = (0 until files.length()).map(files::getJSONObject).single { it.getString("path") == model.getString("model") }
            val tokens = (0 until files.length()).map(files::getJSONObject).single { it.getString("path") == "tokens.txt" }
            assertEquals(values[1].toLong(), modelFile.getLong("bytes"))
            assertEquals(values[2].toLong(), tokens.getLong("bytes"))
            assertEquals(values[3], modelFile.getString("sha256"))
            assertEquals(values[4], tokens.getString("sha256"))
            assertTrue((0 until files.length()).map(files::getJSONObject).any { it.getString("path") == "espeak-ng-data/nl_dict" })
            for (i in 0 until files.length()) {
                val file = files.getJSONObject(i)
                if (file.getString("path").startsWith("espeak-ng-data/")) {
                    val expectedUrl = if (file.getString("path") == "espeak-ng-data/it_dict") {
                        "https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_0/resolve/f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b/espeak-ng-data/it_dict"
                    } else {
                        "https://huggingface.co/csukuangfj/vits-piper-nl_NL-dii-high/resolve/12169a38e0f40f3ffc429273346f6d0700387cdf/${file.getString("path")}"
                    }
                    assertEquals(expectedUrl, file.optString("url").takeIf(String::isNotBlank))
                }
            }
        }
    }

    @Test fun catalogContainsExactlyTheTwoBelgianDutchAdditions() {
        val additions = (0 until catalog.length()).map(catalog::getJSONObject)
            .filter { it.getString("id").startsWith("piper_nl_be_") }
        assertEquals(setOf("piper_nl_be_nathalie", "piper_nl_be_rdh"), additions.map { it.getString("id") }.toSet())
        assertFalse(additions.any { it.getString("language") != "nl" })
    }

    @Test fun documentationMatchesCatalogPinsAndLicenseEvidence() {
        val documentation = File("../../docs/android-flemish-voices.md").readText()

        for (id in listOf("piper_nl_be_nathalie", "piper_nl_be_rdh")) {
            val model = voice(id)
            assertTrue(documentation.contains(id))
            assertTrue(documentation.contains(model.getString("revision")))
            assertTrue(documentation.contains(model.getString("repository")))
        }
        assertTrue(documentation.contains("CC0 1.0 Universal"))
        assertTrue(documentation.contains("do not separately state a license for the trained ONNX weights"))
        assertTrue(documentation.contains("dataset-voice-nathalie"))
        assertTrue(documentation.contains("dutch-vl-tts"))
    }

    private fun voice(id: String) = (0 until catalog.length()).map(catalog::getJSONObject).single { it.getString("id") == id }
}
