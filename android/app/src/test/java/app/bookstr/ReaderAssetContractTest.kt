package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class ReaderAssetContractTest {
    private val generatedReaderAssets = File("build/generated/reader-assets")
    private val sharedReaderAssets = File("../../shared/reader")

    @Test
    fun readerSupportsStreamedBookUrlsAndVisibleErrors() {
        val html = generatedAsset("reader.html").readText()

        assertTrue(generatedAsset("jszip.min.js").isFile)
        assertTrue(html.indexOf("jszip.min.js") < html.indexOf("epub.min.js"))
        assertTrue(html.contains("window.loadBookUrl"))
        assertTrue(html.contains("response.arrayBuffer()"))
        assertTrue(html.contains("EPUB reader timed out"))
        assertTrue(html.contains("installSwipeNavigation"))
        assertTrue(html.contains("manager: \"continuous\""))
        assertTrue(html.contains("flow: \"scrolled-doc\""))
        assertTrue(html.contains("book.locations.generate(100)"))
        assertTrue(html.contains("book.locations.percentageFromCfi(start.cfi)"))
        assertTrue(html.contains("sectionCount: book && book.spine"))
        assertTrue(html.contains("reportLocation(rendition.currentLocation())"))
        assertTrue(html.contains("rendition.themes.register(\"night\""))
        assertTrue(html.contains("color: \"#e8e4dc !important\""))
        assertTrue(html.contains("\"width\": \"100% !important\""))
        assertTrue(html.contains("\"padding-left\": \"0.12rem !important\""))
        assertTrue(html.contains("moveViewportPage(1)"))
        assertTrue(html.contains("pageTransitioning"))
        assertTrue(html.contains("translate3d("))
        assertTrue(html.contains("behavior: \"auto\""))
        assertTrue(html.contains("container.clientHeight"))
        assertTrue(html.contains("rendition.themes.fontSize(readerFontPercent + \"%\")"))
        assertTrue(html.contains("dampedRatio"))
        assertTrue(html.contains("bookstr-reader-font-percent"))
        assertTrue(html.contains("createPinchAnchor(target"))
        assertTrue(html.contains("caretRangeAtPoint"))
        assertTrue(html.contains("pinchAnchor.clientY = pinchClientY(target, centroid.y)"))
        assertTrue(html.contains("anchor.offsetY = anchor.clientY - top"))
        assertTrue(html.contains("restorePinchAnchor(pinchAnchor)"))
        assertTrue(html.contains("top - desiredTop"))
        assertTrue(html.contains("rendition.on(\"selected\""))
        assertTrue(html.contains("showDictionary(selection, language"))
        assertTrue(html.contains("AndroidBridge.onLookupDictionary"))
        assertTrue(html.contains("window.receiveDictionaryResult"))
        assertTrue(html.contains("bookstr-highlights:"))
        assertTrue(html.contains("window.setKnownWords"))
        assertTrue(html.contains("window.setReaderTypography"))
        assertTrue(html.contains("<script src=\"reader-typography.js\"></script>"))
        assertTrue(html.contains("CSS.highlights.set(\"bookstr-known-word\""))
        assertTrue(html.contains("ranges.length < 5000"))
        assertTrue(html.contains("AndroidBridge.onKnownWordTapped"))
        assertTrue(html.contains("AndroidBridge.onReaderInteracted"))
        assertTrue(html.contains("stabilizeCoverPage(section, contentDocument)"))
        assertFalse(html.contains("section.index === 0 || href.includes(\"cover\")"))
        assertTrue(html.contains("bookstr-cover-layout"))
        assertTrue(html.contains("renderContext(contextNode"))
        assertTrue(html.contains("pt.wiktionary.org"))
        assertTrue(html.contains("max-height\": \"88vh !important\""))
        assertTrue(html.contains("gestureAxis !== \"horizontal\""))
        assertTrue(html.contains("Math.abs(dx) < 72"))
        assertTrue(html.contains("installImageZoom(contentDocument)"))
        assertTrue(html.contains("positionReferenceBelowTop()"))
        assertTrue(html.contains("window.displaySection"))
        assertTrue(html.contains("AndroidBridge.onReaderError"))
        assertTrue(html.contains("AndroidBridge.onReaderReady"))
        assertTrue(html.contains("window.requestSpeechText"))
        assertTrue(html.contains("window.persistSpeechLocation"))
        assertTrue(html.contains("window.setSpeechResumeCfi"))
        assertTrue(html.contains("locatorSkipDecision"))
        assertTrue(html.contains("payload.source = \"speech\""))
        assertTrue(html.contains("AndroidBridge.onSpeechText"))
        assertTrue(html.contains("document.documentElement.lang"))
        assertTrue(html.contains("window.showSpeechProgress"))
        assertTrue(html.contains("bookstr-speaking"))
        assertTrue(html.contains("bookstr-speaking-word"))
        assertTrue(html.contains("speechTextMap"))
        assertTrue(html.contains("notifyNative !== false"))
        assertTrue(html.contains("reportLocation(rendition.currentLocation())"))
        assertTrue(html.contains("installReaderContextMenu(contentDocument)"))
        assertTrue(html.contains("AndroidBridge.onReaderLongPress(selection)"))
        assertTrue(html.contains("window.searchBook = async function(query)"))
        assertTrue(html.contains("section.find(needle)"))
        assertTrue(html.contains("AndroidBridge.onSearchResults(JSON.stringify(results))"))
        assertTrue(html.contains("window.displaySearchResult = function(cfi)"))
        assertTrue(html.contains("window.adjustReaderFont = function(delta)"))
        assertTrue(html.contains("needle.length < 2"))
        assertTrue(html.contains("results.length < 100"))
        assertTrue(html.contains("section.unload()"))
        assertTrue(html.contains("if (media) return"))
        assertTrue(html.contains("event.preventDefault()"))
        assertFalse(html.contains("book = ePub(base64ToArrayBuffer(base64))"))
    }

    @Test
    fun packagedReaderUsesCanonicalSpeechPlanner() {
        val html = generatedAsset("reader.html").readText()
        val sharedSpeech = File("../../web/reader-speech.js")
        val sharedTypography = File("../../web/reader-typography.js")
        val scriptTag = "<script src=\"reader-speech.js\"></script>"
        val typographyTag = "<script src=\"reader-typography.js\"></script>"

        assertTrue(sharedSpeech.isFile)
        assertTrue(sharedTypography.isFile)
        assertTrue(generatedAsset("reader-speech.js").readBytes().contentEquals(sharedSpeech.readBytes()))
        assertTrue(generatedAsset("reader-typography.js").readBytes().contentEquals(sharedTypography.readBytes()))
        assertTrue(html.contains(scriptTag))
        assertEquals(1, Regex(Regex.escape(scriptTag)).findAll(html).count())
        assertTrue(html.contains(typographyTag))
        assertTrue(html.contains("window.BookstrSpeech.buildPlan(parts)"))
        assertTrue(html.contains("window.setReaderTypography"))
        assertTrue(html.contains("BookstrTypography.css"))
        assertTrue(html.contains("Arial, Helvetica, sans-serif"))
        assertTrue(sharedSpeech.readText().contains("paragraphPauseMs: PARAGRAPH_PAUSE_MS"))
    }

    @Test
    fun readerAppliesSavedFontAndAlignmentWhenOpeningAnEpub() {
        val readerSource = File("src/main/java/app/bookstr/ReaderActivity.kt").readText()
        val settingsSource = File("src/main/java/app/bookstr/ui/SettingsScreen.kt").readText()
        assertTrue(readerSource.contains("setReaderTypography(\$fontJs, \$alignmentJs)"))
        assertTrue(readerSource.contains("readerFont = app.settingsRepository.readerFont"))
        assertTrue(settingsSource.contains("onReaderFontChange"))
        assertTrue(readerSource.contains("fun speechRequestScript"))
        assertTrue(readerSource.contains("requestSpeechText("))
        assertTrue(readerSource.contains("fromSpeech"))
        assertTrue(readerSource.contains("persistSpeechLocation"))
    }

    @Test
    fun generatedAssetsMatchTheCanonicalMobileReaderAndLockedVendorHashes() {
        listOf("reader.html", "epub.min.js", "jszip.min.js").forEach { name ->
            val canonical = File(sharedReaderAssets, name)
            val generated = generatedAsset(name)
            assertTrue("Missing canonical reader asset: $name", canonical.isFile)
            assertTrue("Missing generated reader asset: $name", generated.isFile)
            assertTrue("Generated $name differs from its canonical source", generated.readBytes().contentEquals(canonical.readBytes()))
        }

        assertEquals(
            "06eae15745107b4aa508c95538275251f69bfb9f1175621fc458d9f42ed082d4",
            sha256(generatedAsset("epub.min.js")),
        )
        assertEquals(
            "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e",
            sha256(generatedAsset("jszip.min.js")),
        )
    }

    private fun generatedAsset(name: String) = File(generatedReaderAssets, name)

    private fun sha256(file: File): String = MessageDigest.getInstance("SHA-256")
        .digest(file.readBytes())
        .joinToString("") { byte -> "%02x".format(byte) }
}
