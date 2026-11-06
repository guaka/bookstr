package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Test
import app.bookstr.data.BookProgress
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertTrue

class PdfPositionReporterTest {
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun aSlowEarlierSaveCannotOverwriteTheNewPagePosition() = runTest {
        val saved = mutableListOf<BookProgress>()
        val recorder = PdfProgressRecorder { id, progression, cfi ->
            delay(if (cfi == "pdf:0:0") 100 else 1)
            BookProgress(id, progression, cfi, testScheduler.currentTime).also(saved::add)
        }
        val first = async { recorder.record("book", 0.0, "pdf:0:0") }
        runCurrent()
        val second = async { recorder.record("book", 0.5, "pdf:1:0") }
        runCurrent()
        assertTrue(saved.isEmpty())
        assertEquals("pdf:0:0", first.await().cfi)
        assertEquals("pdf:1:0", second.await().cfi)
        assertEquals(listOf("pdf:0:0", "pdf:1:0"), saved.map { it.cfi })
        assertEquals(101L, saved.last().updatedAt)
        assertEquals("pdf:0:0", recorder.record("book", 0.0, "pdf:0:0").cfi)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun aFailedSaveReleasesTheNextQueuedPosition() = runTest {
        var attempts = 0
        val recorder = PdfProgressRecorder { id, progression, cfi ->
            attempts += 1
            delay(100)
            check(attempts != 1) { "Database write failed" }
            BookProgress(id, progression, cfi, testScheduler.currentTime)
        }
        val first = async { runCatching { recorder.record("book", 0.0, "pdf:0:0") } }
        runCurrent()
        val second = async { recorder.record("book", 0.5, "pdf:1:0") }
        runCurrent()
        assertTrue(first.await().isFailure)
        assertEquals("pdf:1:0", second.await().cfi)
        assertEquals(2, attempts)
    }

    @Test
    fun trailingPaddingLetsShortLastPageAlignWithTheViewportTop() {
        assertEquals(40, pdfTrailingPaddingPx(viewportHeightPx = 640, pageWidthPx = 360, pageHeightRatio = 500f / 300f, zoom = 1f))
    }

    @Test
    fun trailingPaddingIsZeroForTallPagesAndZoomedPages() {
        assertEquals(0, pdfTrailingPaddingPx(viewportHeightPx = 640, pageWidthPx = 360, pageHeightRatio = 3f, zoom = 1f))
        assertEquals(0, pdfTrailingPaddingPx(viewportHeightPx = 640, pageWidthPx = 360, pageHeightRatio = 500f / 300f, zoom = 2f))
    }

    @Test
    fun reportsPositionChangesOnceAndAllowsLaterReturnToAnEarlierPosition() {
        val reported = mutableListOf<Pair<Int, Int>>()
        val reporter = PdfPositionReporter { page, offset -> reported.add(page to offset) }

        reporter.report(0, 0)
        reporter.report(0, 0)
        reporter.report(1, 0)
        reporter.report(1, 0)
        reporter.report(1, 24)
        reporter.report(1, 0)

        assertEquals(listOf(0 to 0, 1 to 0, 1 to 24, 1 to 0), reported)
    }
}
