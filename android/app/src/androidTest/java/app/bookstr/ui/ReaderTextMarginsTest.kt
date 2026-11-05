package app.bookstr.ui

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.ReaderActivity
import app.bookstr.data.ReaderTheme
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ReaderTextMarginsTest {
    @Test fun openingAndRecreatingReaderKeepsTextWithoutSideMargins() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "reader-text-margins-fixture"
        val epub = app.catalogRepository.epubFile(bookId)
        ZipOutputStream(epub.outputStream()).use { zip ->
            fun entry(name: String, value: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(value.toByteArray())
                zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("OEBPS/content.opf", """<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">margins-fixture</dc:identifier><dc:title>Margins fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            entry("OEBPS/chapter.xhtml", """<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Margins fixture</title><style>body { margin: 30px; padding: 40px; }</style></head><body><p id="fixture-text">Book text should use the full reader width.</p></body></html>""")
        }
        try {
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(app, bookId, "Margins fixture", null, null, null, ReaderTheme.Paper),
            ).use { scenario ->
                awaitTextWithoutMargins(scenario)
                scenario.recreate()
                awaitTextWithoutMargins(scenario)
            }
        } finally {
            epub.delete()
        }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findWebView(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }

    private fun awaitTextWithoutMargins(scenario: ActivityScenario<ReaderActivity>) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
        var result = ""
        while (System.nanoTime() < deadline) {
            val value = AtomicReference<String>()
            val done = CountDownLatch(1)
            scenario.onActivity { activity ->
                val web = findWebView(activity.findViewById(android.R.id.content))
                if (web == null) {
                    done.countDown()
                } else {
                    web.evaluateJavascript(
                        """(function() {
                            const doc = document.querySelector('#viewer iframe')?.contentDocument;
                            if (!doc?.getElementById('fixture-text')) return false;
                            const style = doc.defaultView.getComputedStyle(doc.body);
                            return ['paddingLeft', 'paddingRight', 'marginLeft', 'marginRight']
                                .every(key => style[key] === '0px');
                        })()""".trimIndent(),
                    ) { value.set(it); done.countDown() }
                }
            }
            assertTrue("Reader WebView evaluation timed out", done.await(5, TimeUnit.SECONDS))
            result = value.get().orEmpty()
            if (result == "true") return
            Thread.sleep(100)
        }
        assertTrue("Book text retained side margins or failed to load: $result", false)
    }
}
