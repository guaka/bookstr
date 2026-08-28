package app.bookstr

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import app.bookstr.data.BookFormat
import app.bookstr.data.BookRights
import app.bookstr.data.BookRightsMetadata
import app.bookstr.data.ReaderSession
import app.bookstr.ui.RightsMarker
import app.bookstr.ui.theme.BookstrThemeFromSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import android.util.Xml
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.charset.StandardCharsets

data class Fb2Paragraph(val text: String)

data class Fb2Section(
    val id: String,
    val title: String,
    val paragraphs: List<Fb2Paragraph>,
    val children: List<Fb2Section> = emptyList(),
)

data class Fb2Document(
    val title: String,
    val author: String?,
    val language: String?,
    val sections: List<Fb2Section>,
) {
    fun flatSections(): List<Fb2Section> = buildList {
        fun append(items: List<Fb2Section>) {
            items.forEach { section ->
                add(section)
                append(section.children)
            }
        }
        append(sections)
    }

    fun allParagraphs(): List<Pair<String, Fb2Paragraph>> = flatSections().flatMap { section ->
        section.paragraphs.map { section.id to it }
    }
}

/** Strict, local-only FictionBook parser. External entities and network resources are never read. */
object Fb2Parser {
    private const val MAX_BYTES = 50L * 1024L * 1024L

    fun parse(file: File): Fb2Document {
        require(file.isFile && file.length() in 1..MAX_BYTES) { "This FB2 file is empty or too large" }
        return CatalogRepository.withFb2Input(file) { parse(it) }
    }

    fun parse(input: InputStream): Fb2Document {
        val bytes = input.readAtMost(MAX_BYTES)
        val source = bytes.toString(StandardCharsets.UTF_8)
        require(!source.contains("<!DOCTYPE", ignoreCase = true) &&
            !source.contains("<!ENTITY", ignoreCase = true)) { "External entities are not allowed" }
        val parser = Xml.newPullParser().apply {
            setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
            runCatching { setFeature("http://xmlpull.org/v1/doc/features.html#process-docdecl", false) }
            setInput(bytes.inputStream(), "UTF-8")
        }
        var rootSeen = false
        var title: String? = null
        var author: String? = null
        var language: String? = null
        val sections = mutableListOf<Fb2Section>()
        var syntheticParagraphs = mutableListOf<Fb2Paragraph>()
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            when (parser.name.substringAfterLast(':')) {
                "FictionBook" -> rootSeen = true
                "description" -> readDescription(parser) { t, a, l ->
                    title = title ?: t
                    author = author ?: a
                    language = language ?: l
                }
                "body" -> {
                    val parsed = readBody(parser)
                    sections += parsed.sections
                    syntheticParagraphs += parsed.paragraphs
                }
            }
        }
        require(rootSeen) { "Not a FictionBook document" }
        if (syntheticParagraphs.isNotEmpty()) {
            sections.add(0, Fb2Section("body", "", syntheticParagraphs.toList()))
        }
        require(sections.isNotEmpty()) { "The FB2 document has no readable body" }
        return Fb2Document(title?.ifBlank { null } ?: "Untitled", author, language, sections)
    }

    private data class BodyResult(val sections: List<Fb2Section>, val paragraphs: List<Fb2Paragraph>)

    private fun readDescription(parser: XmlPullParser, receive: (String?, String?, String?) -> Unit) {
        val depth = parser.depth
        var title: String? = null
        var author: String? = null
        var language: String? = null
        while (parser.next() != XmlPullParser.END_DOCUMENT && parser.depth > depth) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            when (parser.name.substringAfterLast(':')) {
                "book-title" -> title = text(parser)
                "lang" -> language = text(parser)
                "first-name", "middle-name", "last-name" -> {
                    val part = text(parser)
                    author = listOfNotNull(author, part).joinToString(" ").trim()
                }
            }
        }
        receive(title, author, language)
    }

    private fun readBody(parser: XmlPullParser): BodyResult {
        val depth = parser.depth
        val sections = mutableListOf<Fb2Section>()
        val paragraphs = mutableListOf<Fb2Paragraph>()
        while (parser.next() != XmlPullParser.END_DOCUMENT && parser.depth > depth) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            when (parser.name.substringAfterLast(':')) {
                "section" -> sections += readSection(parser, "section-${sections.size + 1}")
                "p", "subtitle", "text-author", "v", "title", "epigraph", "poem" -> {
                    val value = blockText(parser)
                    if (value.isNotBlank()) paragraphs += Fb2Paragraph(value)
                }
            }
        }
        return BodyResult(sections, paragraphs)
    }

    private fun readSection(parser: XmlPullParser, fallbackId: String): Fb2Section {
        val depth = parser.depth
        val id = parser.getAttributeValue(null, "id")?.trim().orEmpty().ifBlank { fallbackId }
        var title = ""
        val paragraphs = mutableListOf<Fb2Paragraph>()
        val children = mutableListOf<Fb2Section>()
        while (parser.next() != XmlPullParser.END_DOCUMENT && parser.depth > depth) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            when (parser.name.substringAfterLast(':')) {
                "title" -> title = blockText(parser)
                "section" -> children += readSection(parser, "$id-${children.size + 1}")
                "p", "subtitle", "text-author", "v", "epigraph", "poem" -> {
                    blockText(parser).takeIf { it.isNotBlank() }?.let { paragraphs += Fb2Paragraph(it) }
                }
            }
        }
        return Fb2Section(id, title.trim(), paragraphs, children)
    }

    private fun blockText(parser: XmlPullParser): String {
        val depth = parser.depth
        val out = StringBuilder()
        while (parser.next() != XmlPullParser.END_DOCUMENT && parser.depth > depth) {
            when (parser.eventType) {
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> out.append(parser.text)
                XmlPullParser.START_TAG -> if (parser.name.substringAfterLast(':') == "v") {
                    val line = blockText(parser)
                    if (out.isNotEmpty()) out.append('\n')
                    out.append(line)
                }
            }
        }
        return out.toString()
            .replace(Regex("[ \\t\\r\\f]+"), " ")
            .replace(Regex("\\n\\s*"), "\\n")
            .trim()
    }

    private fun text(parser: XmlPullParser): String = blockText(parser)

    private fun InputStream.readAtMost(maxBytes: Long): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = read(buffer)
            if (count < 0) return output.toByteArray()
            require(output.size().toLong() + count <= maxBytes) { "This FB2 file is empty or too large" }
            output.write(buffer, 0, count)
        }
    }
}

class Fb2ReaderActivity : ComponentActivity() {
    private var bookId = ""
    private var bookTitle = ""
    private var bookAuthor: String? = null
    private var bookYear: String? = null
    private var rights = BookRights()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bookId = intent.getStringExtra(EXTRA_BOOK_ID) ?: return finish()
        bookTitle = intent.getStringExtra(EXTRA_BOOK_TITLE) ?: "FB2"
        bookAuthor = intent.getStringExtra(EXTRA_BOOK_AUTHOR)
        bookYear = intent.getStringExtra(EXTRA_BOOK_YEAR)
        rights = BookRightsMetadata.normalize(
            status = intent.getStringExtra(EXTRA_RIGHTS_STATUS),
            license = intent.getStringExtra(EXTRA_LICENSE),
            licenseUrl = intent.getStringExtra(EXTRA_LICENSE_URL),
            source = intent.getStringExtra(EXTRA_RIGHTS_SOURCE),
        )
        val app = application as BookstrApp
        app.settingsRepository.saveReaderSession(ReaderSession(
            bookId, bookTitle, BookFormat.Fb2, bookAuthor, bookYear,
            locator = intent.getStringExtra(EXTRA_LOCATOR), rightsStatus = rights.status,
            license = rights.license, licenseUrl = rights.licenseUrl, rightsSource = rights.source,
        ))
        applyLockScreenPolicy(app.settingsRepository.keepReadingOnLockScreen)
        val file = app.catalogRepository.publicationFile(bookId, BookFormat.Fb2)
        setContent {
            BookstrThemeFromSettings(readerTheme = app.settingsRepository.theme) {
                Fb2ReaderScreen(
                    title = bookTitle, author = bookAuthor, year = bookYear, rights = rights,
                    file = file, initialLocator = intent.getStringExtra(EXTRA_LOCATOR),
                    onProgress = { progression, locator ->
                        lifecycleScope.launch {
                            val saved = app.catalogRepository.saveProgress(bookId, progression, locator)
                            app.settingsRepository.saveReaderSession(
                                ReaderSession(
                                    bookId, bookTitle, BookFormat.Fb2, bookAuthor, bookYear,
                                    locator = locator, rightsStatus = rights.status,
                                    license = rights.license, licenseUrl = rights.licenseUrl,
                                    rightsSource = rights.source,
                                ),
                            )
                            app.nostrRepository.publishProgress(
                                bookId = bookId,
                                progression = progression,
                                cfi = locator,
                                furthestProgression = saved.furthestProgression,
                                title = bookTitle,
                                author = bookAuthor,
                                rights = rights,
                            )
                        }
                    }, onBack = { closeReader() },
                )
            }
        }
    }

    override fun onBackPressed() { closeReader() }

    private fun closeReader() { finish() }

    private fun applyLockScreenPolicy(enabled: Boolean) {
        if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(enabled); setTurnScreenOn(enabled)
        }
    }

    companion object {
        private const val EXTRA_BOOK_ID = "book_id"
        private const val EXTRA_BOOK_TITLE = "book_title"
        private const val EXTRA_BOOK_AUTHOR = "book_author"
        private const val EXTRA_BOOK_YEAR = "book_year"
        private const val EXTRA_LOCATOR = "locator"
        private const val EXTRA_RIGHTS_STATUS = "rights_status"
        private const val EXTRA_LICENSE = "license"
        private const val EXTRA_LICENSE_URL = "license_url"
        private const val EXTRA_RIGHTS_SOURCE = "rights_source"

        fun intent(context: Context, bookId: String, bookTitle: String, author: String?, year: String?,
                   locator: String? = null, rightsStatus: String? = null, license: String? = null,
                   licenseUrl: String? = null, rightsSource: String? = null): Intent =
            Intent(context, Fb2ReaderActivity::class.java).apply {
                putExtra(EXTRA_BOOK_ID, bookId); putExtra(EXTRA_BOOK_TITLE, bookTitle)
                putExtra(EXTRA_BOOK_AUTHOR, author); putExtra(EXTRA_BOOK_YEAR, year)
                putExtra(EXTRA_LOCATOR, locator); putExtra(EXTRA_RIGHTS_STATUS, rightsStatus)
                putExtra(EXTRA_LICENSE, license); putExtra(EXTRA_LICENSE_URL, licenseUrl)
                putExtra(EXTRA_RIGHTS_SOURCE, rightsSource)
            }
    }
}

@Composable
private fun Fb2ReaderScreen(title: String, author: String?, year: String?, rights: BookRights, file: File,
                            initialLocator: String?, onProgress: (Double, String) -> Unit, onBack: () -> Unit) {
    var document by remember { mutableStateOf<Fb2Document?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showContents by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val tts = remember(context) { android.speech.tts.TextToSpeech(context, null) }
    LaunchedEffect(file) {
        val result = withContext(Dispatchers.IO) { runCatching { Fb2Parser.parse(file) } }
        result.onSuccess { document = it }.onFailure { error = it.message ?: "Cannot open FB2" }
    }
    val doc = document
    val blocks = doc?.flatSections()?.flatMap { section ->
        section.paragraphs.mapIndexed { paragraphIndex, paragraph ->
            Fb2Block(section.id, paragraphIndex, section.title.takeIf { paragraphIndex == 0 }, paragraph.text)
        }
    }.orEmpty()
    LaunchedEffect(doc) {
        if (doc == null) return@LaunchedEffect
        val parts = initialLocator?.removePrefix("fb2:")?.split(':') ?: emptyList()
        val sectionID = parts.getOrNull(0)
        val paragraph = (parts.getOrNull(1)?.toIntOrNull() ?: 0).coerceAtLeast(0)
        val index = blocks.indexOfFirst { it.sectionID == sectionID && it.paragraphIndex == paragraph }
        if (index > 0) listState.scrollToItem(index)
    }
    LaunchedEffect(listState, doc) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect { index ->
            if (blocks.isNotEmpty()) {
                val block = blocks[index.coerceIn(0, blocks.lastIndex)]
                val progression = if (blocks.size > 1) index.toDouble() / blocks.lastIndex.toDouble() else 0.0
                onProgress(progression, "fb2:${block.sectionID}:${block.paragraphIndex}:0")
            }
        }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", Modifier.padding(8.dp).clickable(onClick = onBack), tint = MaterialTheme.colorScheme.onPrimary)
            Text(listOfNotNull(title, author, year).joinToString(" — "), Modifier.weight(1f).padding(4.dp), maxLines = 1, color = MaterialTheme.colorScheme.onPrimary, fontSize = 11.sp)
            RightsMarker(rights.status, rights.license, rights.licenseUrl, rights.source, Modifier.padding(horizontal = 4.dp))
            Icon(if (speaking) Icons.Filled.Stop else Icons.Filled.PlayArrow, if (speaking) "Stop reading aloud" else "Read aloud",
                Modifier.padding(8.dp).clickable {
                    if (speaking) { tts.stop(); speaking = false }
                    else { doc?.let { tts.speak(it.allParagraphs().joinToString(" ") { pair -> pair.second.text }, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "fb2") }; speaking = true }
                }, tint = MaterialTheme.colorScheme.onPrimary)
            Icon(Icons.Filled.List, "Table of contents", Modifier.padding(8.dp).clickable { showContents = true }, tint = MaterialTheme.colorScheme.onPrimary)
        }
        when {
            error != null -> Text(error ?: "Cannot open FB2", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp))
            doc == null -> CircularProgressIndicator(Modifier.padding(24.dp))
            else -> LazyColumn(state = listState, Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                itemsIndexed(blocks, key = { _, block -> "${block.sectionID}:${block.paragraphIndex}" }) { index, block ->
                    block.title?.let { title -> Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = if (index == 0) 18.dp else 28.dp, bottom = 8.dp)) }
                    Text(block.text, fontSize = 18.sp, modifier = Modifier.padding(vertical = 6.dp))
                }
            }
        }
    }
    if (showContents && doc != null) AlertDialog(onDismissRequest = { showContents = false }, title = { Text("Contents") },
        text = { LazyColumn { itemsIndexed(doc.flatSections()) { index, section -> Text(section.title.ifBlank { "Section ${index + 1}" }, Modifier.fillMaxWidth().clickable {
            showContents = false
            blocks.indexOfFirst { it.sectionID == section.id }.takeIf { it >= 0 }?.let { target -> scope.launch { listState.animateScrollToItem(target) } }
        }) } } },
        confirmButton = { TextButton({ showContents = false }) { Text("Close") } })
}

private data class Fb2Block(val sectionID: String, val paragraphIndex: Int, val title: String?, val text: String)
