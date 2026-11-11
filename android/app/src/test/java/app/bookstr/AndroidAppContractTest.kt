package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidAppContractTest {
    @Test fun epubAndPdfViewIntentsHaveLocalFileSchemesWithoutChangingCatalogRouting() {
        val xml = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/AndroidManifest.xml"))
        val activities = xml.getElementsByTagName("activity")
        val main = (0 until activities.length).map { activities.item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("android:name") == ".MainActivity" }
        assertEquals("singleTop", main.getAttribute("android:launchMode"))
        val filters = main.getElementsByTagName("intent-filter")
        val data = (0 until filters.length).map { filters.item(it) as org.w3c.dom.Element }
            .map { filter -> filter.getElementsByTagName("data").let { nodes ->
                (0 until nodes.length).map { nodes.item(it) as org.w3c.dom.Element }
            } }
        val books = data.single { nodes -> nodes.any { it.getAttribute("android:mimeType") == "application/pdf" } }
        assertEquals(setOf("application/pdf", "application/epub+zip"), books.map { it.getAttribute("android:mimeType") }.filter { it.isNotEmpty() }.toSet())
        assertEquals(setOf("content", "file"), books.map { it.getAttribute("android:scheme") }.filter { it.isNotEmpty() }.toSet())
        assertTrue(data.any { nodes -> nodes.any { it.getAttribute("android:scheme") == "bookstr" && it.getAttribute("android:host") == "catalog" } })
    }

    @Test fun screensaverIsDiscoverableAndProtectedByTheSystemDreamPermission() {
        val manifest = javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val services = manifest.getElementsByTagName("service")
        val dream = (0 until services.length).map { services.item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("android:name") == ".BookPagesDreamService" }
        assertEquals("true", dream.getAttribute("android:exported"))
        assertEquals("android.permission.BIND_DREAM_SERVICE", dream.getAttribute("android:permission"))
        val action = dream.getElementsByTagName("action").item(0) as org.w3c.dom.Element
        assertEquals("android.service.dreams.DreamService", action.getAttribute("android:name"))
        val metadata = dream.getElementsByTagName("meta-data").item(0) as org.w3c.dom.Element
        assertEquals("android.service.dream", metadata.getAttribute("android:name"))
        assertEquals("@xml/bookstr_dream", metadata.getAttribute("android:resource"))
        val descriptor = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/xml/bookstr_dream.xml")).documentElement
        assertEquals("dream", descriptor.tagName)
        assertEquals("@drawable/tv_banner", descriptor.getAttribute("android:previewImage"))
    }
    @Test fun televisionLauncherDoesNotExcludePhonesOrRequireTouch() {
        val manifest = javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val features = manifest.getElementsByTagName("uses-feature")
        for (name in listOf("android.hardware.touchscreen", "android.software.leanback", "android.hardware.usb.host")) {
            val feature = (0 until features.length).map { features.item(it) as org.w3c.dom.Element }
                .single { it.getAttribute("android:name") == name }
            assertEquals("false", feature.getAttribute("android:required"))
        }
        val activity = (0 until manifest.getElementsByTagName("activity").length)
            .map { manifest.getElementsByTagName("activity").item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("android:name") == ".MainActivity" }
        assertTrue(activity.textContent != null)
        val categories = activity.getElementsByTagName("category")
        assertTrue((0 until categories.length).any {
            (categories.item(it) as org.w3c.dom.Element).getAttribute("android:name") == "android.intent.category.LEANBACK_LAUNCHER"
        })
        val app = manifest.getElementsByTagName("application").item(0) as org.w3c.dom.Element
        assertEquals("@drawable/tv_banner", app.getAttribute("android:banner"))
        val banner = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/drawable/tv_banner.xml")).documentElement
        assertEquals("320", banner.getAttribute("android:viewportWidth"))
        assertEquals("180", banner.getAttribute("android:viewportHeight"))
        val bannerPaths = banner.getElementsByTagName("path")
        val launcherPaths = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/drawable/ic_launcher_foreground.xml")).getElementsByTagName("path")
        val bannerArtwork = (0 until bannerPaths.length).map { bannerPaths.item(it) as org.w3c.dom.Element }
            .map { it.getAttribute("android:pathData") }
        val launcherArtwork = (0 until launcherPaths.length).map { launcherPaths.item(it) as org.w3c.dom.Element }
            .map { it.getAttribute("android:pathData") }
        assertTrue(bannerArtwork.containsAll(launcherArtwork))
        assertTrue((0 until bannerPaths.length).map { bannerPaths.item(it) as org.w3c.dom.Element }
            .any { it.getAttribute("android:fillColor") == "#2F5D50" })
        assertTrue((0 until bannerPaths.length).map { bannerPaths.item(it) as org.w3c.dom.Element }
            .any { it.getAttribute("android:strokeColor") == "#FFFAF2" })
    }

    @Test
    fun appHasDiscoverableLauncherIdentity() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val strings = File("src/main/res/values/strings.xml").readText()

        assertTrue(manifest.contains("android:name=\".MainActivity\""))
        assertTrue(manifest.contains("android.intent.category.LAUNCHER"))
        assertTrue(manifest.contains("android:exported=\"true\""))
        assertTrue(manifest.contains("android:icon=\"@mipmap/ic_launcher\""))
        assertTrue(strings.contains("<string name=\"app_name\">bookstr</string>"))
    }

    @Test
    fun readerAndNarrationDeclareRequiredRuntimeCapabilities() {
        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(manifest.contains("android.permission.INTERNET"))
        assertTrue(manifest.contains("android.permission.WAKE_LOCK"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"))
        assertTrue(manifest.contains("android:showWhenLocked=\"true\""))
        assertTrue(manifest.contains("android:turnScreenOn=\"true\""))
    }

    @Test
    fun applicationIdAndNamespaceStayAligned() {
        val gradle = File("build.gradle.kts").readText()

        assertTrue(gradle.contains("namespace = \"app.bookstr\""))
        assertTrue(gradle.contains("applicationId = \"app.bookstr\""))
        assertTrue(gradle.contains("testInstrumentationRunner = \"app.bookstr.BookstrTestRunner\""))
    }
}
