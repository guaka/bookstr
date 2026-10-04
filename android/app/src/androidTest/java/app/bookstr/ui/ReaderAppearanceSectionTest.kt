package app.bookstr.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import app.bookstr.data.ReaderAlignment
import app.bookstr.data.ReaderFont
import app.bookstr.data.ReaderTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ReaderAppearanceSectionTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun showsFontAndAlignmentPreviewsAndKeepsChoicesInteractive() {
        var selectedFont = ReaderFont.Georgia
        var selectedAlignment = ReaderAlignment.Justified
        composeRule.setContent {
            MaterialTheme {
                ReaderAppearanceSection(
                    theme = ReaderTheme.Paper,
                    readerFont = selectedFont,
                    readerAlignment = selectedAlignment,
                    onThemeChange = {},
                    onReaderFontChange = { selectedFont = it },
                    onReaderAlignmentChange = { selectedAlignment = it },
                )
            }
        }

        composeRule.onNodeWithTag("settings.font-preview").assertExists()
        composeRule.onNodeWithTag("settings.alignment-preview-justified", useUnmergedTree = true).assertExists()
        composeRule.onNodeWithTag("settings.alignment-preview-left", useUnmergedTree = true).assertExists()
        listOf("justified", "left").forEach { alignment ->
            val layouts = mutableListOf<TextLayoutResult>()
            composeRule.onNodeWithTag(
                "settings.alignment-preview-$alignment",
                useUnmergedTree = true,
            ).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue("$alignment preview should show at least three lines", layouts.first().lineCount >= 3)
        }
        composeRule.onNodeWithTag("settings.alignment-left").performClick()
        composeRule.runOnIdle { assertEquals(ReaderAlignment.Left, selectedAlignment) }

        composeRule.onNodeWithText("Palatino").performClick()
        composeRule.runOnIdle { assertEquals(ReaderFont.Palatino, selectedFont) }

        composeRule.onNodeWithText("Roboto").performClick()
        composeRule.runOnIdle { assertEquals(ReaderFont.Roboto, selectedFont) }
        composeRule.onNodeWithText("Noto Serif").performClick()
        composeRule.runOnIdle { assertEquals(ReaderFont.NotoSerif, selectedFont) }
    }
}
