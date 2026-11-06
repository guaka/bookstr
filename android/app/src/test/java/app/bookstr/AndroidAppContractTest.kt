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

        assertEquals(2, Regex("app\\.bookstr").findAll(gradle).count())
        assertTrue(gradle.contains("namespace = \"app.bookstr\""))
        assertTrue(gradle.contains("applicationId = \"app.bookstr\""))
    }
}
