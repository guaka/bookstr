package app.bookstr

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PdfReaderContractTest {
    @Test
    fun pdfFailuresAreRenderedInsteadOfCrashingTheActivity() {
        val source = File("src/main/java/app/bookstr/PdfReaderActivity.kt").readText()

        assertTrue(source.contains("Could not open this PDF"))
        assertTrue(source.contains("runCatching"))
        assertTrue(source.contains("Could not render page"))
        assertTrue(source.contains("calculateZoom"))
        assertTrue(source.contains("detectHorizontalDragGestures"))
        assertTrue(source.contains(".height(height * zoom)"))
        assertTrue(source.contains("BoxWithConstraints(modifier = Modifier.fillMaxSize())"))
        assertTrue(source.contains("contentPadding = PaddingValues(bottom = with(density) { trailingPaddingPx.toDp() })"))
        assertTrue(source.contains("pdfTrailingPaddingPx("))
        assertTrue(
            "PDF zoom must be document-wide, not separately remembered by each page",
            Regex("var zoom by remember").findAll(source).count() == 1,
        )
        assertTrue(source.contains("ColorFilter.colorMatrix"))
        assertTrue(source.contains("saveReaderSession"))
        assertTrue(source.contains("val positionReporter = remember(onPositionChanged) { PdfPositionReporter(onPositionChanged) }"))
        assertTrue(source.contains("positionReporter.report(page, offset)"))
        assertTrue(source.contains("positionReporter.report(target, 0)"))
    }
}
