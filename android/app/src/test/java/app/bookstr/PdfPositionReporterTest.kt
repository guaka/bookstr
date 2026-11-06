package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Test

class PdfPositionReporterTest {
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
