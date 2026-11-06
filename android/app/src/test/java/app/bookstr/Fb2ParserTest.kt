package app.bookstr

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [28])
class Fb2ParserTest {
    @get:Rule val folder = TemporaryFolder()

    @Test
    fun parsesMetadataNestedSectionsAndBodyBlocksIntoReadableText() {
        val document = Fb2Parser.parse(ByteArrayInputStream(fixture.trimIndent().toByteArray()))

        assertEquals("The First Title", document.title)
        assertEquals("Ada M. Writer", document.author)
        assertEquals("en", document.language)
        assertEquals(listOf("body", "chapter-one", "chapter-one-1", "section-2"),
            document.flatSections().map { it.id })
        assertEquals("Chapter One", document.sections[1].title)
        assertEquals("Child section", document.sections[1].children.single().title)
        assertEquals(listOf("Opening paragraph", "CDATA passage", "A subtitle", "Verse one\nVerse two", "Top-level verse", "Opening quote", "Body heading", "A body title"),
            document.sections.first().paragraphs.map { it.text })
        assertEquals(listOf(
            "First chapter paragraph", "Chapter subtitle", "Chapter voice", "Chapter verse",
            "Chapter epigraph", "Chapter poem", "Another chapter paragraph",
        ),
            document.sections[1].paragraphs.map { it.text })
        assertEquals(listOf("Child paragraph"), document.sections[1].children.single().paragraphs.map { it.text })
        assertEquals(List(8) { "body" } + listOf(
            "chapter-one", "chapter-one", "chapter-one", "chapter-one", "chapter-one", "chapter-one", "chapter-one",
            "chapter-one-1", "section-2",
        ),
            document.allParagraphs().map { it.first })
    }

    @Test
    fun formattedAndCompactXmlProduceEquivalentDocumentsAndPreserveTextCharacters() {
        val compact = "<FictionBook><description><title-info><book-title>First Title</book-title></title-info></description>" +
            "<body><section id='first'><title><p>First chapter</p></title><p>First paragraph</p></section></body></FictionBook>"
        val formatted = """
            <FictionBook>
              <description>
                <title-info>
                  <book-title>First Title</book-title>
                </title-info>
              </description>
              <body>
                <section id="first">
                  <title><p>First chapter</p></title>
                  <p>First paragraph</p>
                </section>
              </body>
            </FictionBook>
        """.trimIndent()

        val compactDocument = Fb2Parser.parse(ByteArrayInputStream(compact.toByteArray()))
        val formattedDocument = Fb2Parser.parse(ByteArrayInputStream(formatted.toByteArray()))

        assertEquals(compactDocument, formattedDocument)
        assertEquals("First Title", formattedDocument.title)
        assertEquals("First paragraph", formattedDocument.sections.single().paragraphs.single().text)
    }

    @Test
    fun parsesFileAndTheSingleSafeFb2EntryFromZip() {
        val plain = folder.newFile("book.fb2").apply { writeText(minimalDocument) }
        val zipped = zip("book.fb2" to minimalDocument)

        assertEquals("Untitled", Fb2Parser.parse(plain).title)
        assertEquals("Only chapter", Fb2Parser.parse(zipped).sections.single().title)
    }

    @Test
    fun rejectsInvalidRootsBodiesDtdMalformedXmlAndUnsafeArchives() {
        assertThrows(IllegalArgumentException::class.java) {
            Fb2Parser.parse(ByteArrayInputStream("<html/>".toByteArray()))
        }
        assertThrows(IllegalArgumentException::class.java) {
            Fb2Parser.parse(ByteArrayInputStream("<FictionBook><body><p> </p></body></FictionBook>".toByteArray()))
        }
        assertThrows(IllegalArgumentException::class.java) {
            Fb2Parser.parse(ByteArrayInputStream("<!DOCTYPE FictionBook><FictionBook><body/></FictionBook>".toByteArray()))
        }
        assertThrows(Exception::class.java) {
            Fb2Parser.parse(ByteArrayInputStream("<FictionBook><body>".toByteArray()))
        }
        assertThrows(IllegalArgumentException::class.java) { Fb2Parser.parse(folder.newFile("empty.fb2")) }
        assertThrows(IllegalArgumentException::class.java) { Fb2Parser.parse(File(folder.root, "missing.fb2")) }

        val multiple = zip("one.fb2" to minimalDocument, "two.fb2" to minimalDocument)
        val traversal = zip("../book.fb2" to minimalDocument)
        val wrongExtension = zip("book.xml" to minimalDocument)
        try {
            for (archive in listOf(multiple, traversal, wrongExtension)) {
                assertThrows(IllegalArgumentException::class.java) { Fb2Parser.parse(archive) }
            }
        } finally {
            multiple.delete(); traversal.delete(); wrongExtension.delete()
        }
    }

    @Test
    fun rejectsInputStreamAndFileThatExceedTheParserByteLimit() {
        val oversizedInput = object : InputStream() {
            private var remaining = 50L * 1024L * 1024L + 1L
            override fun read(): Int {
                if (remaining == 0L) return -1
                remaining--
                return 0
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (remaining == 0L) return -1
                val count = minOf(remaining, length.toLong()).toInt()
                buffer.fill(0, offset, offset + count)
                remaining -= count
                return count
            }
        }
        assertThrows(IllegalArgumentException::class.java) { Fb2Parser.parse(oversizedInput) }

        val oversizedFile = folder.newFile("oversized.fb2")
        RandomAccessFile(oversizedFile, "rw").use { it.setLength(50L * 1024L * 1024L + 1L) }
        assertThrows(IllegalArgumentException::class.java) { Fb2Parser.parse(oversizedFile) }
    }

    @Test
    fun defaultsMissingMetadataAndSkipsBlankSectionsAndBlocks() {
        val document = Fb2Parser.parse(ByteArrayInputStream(
            "<FictionBook><body><section id='  '><title><p>   </p></title><p>  </p></section></body></FictionBook>".toByteArray(),
        ))

        assertEquals("Untitled", document.title)
        assertNull(document.author)
        assertNull(document.language)
        assertEquals("section-1", document.sections.single().id)
        assertEquals("", document.sections.single().title)
        assertEquals(emptyList<Fb2Paragraph>(), document.sections.single().paragraphs)
    }

    @Test
    fun blankMetadataAndEmptyParserScopesUseDefaultsWithoutDroppingTheDocument() {
        val xml = """
            <FictionBook>
              <description><title-info><book-title>   </book-title></title-info></description>
              <body><section id="empty"/></body>
            </FictionBook>
        """.trimIndent()

        val document = Fb2Parser.parse(ByteArrayInputStream(xml.toByteArray()))

        assertEquals("Untitled", document.title)
        assertEquals("empty", document.sections.single().id)
        assertEquals(emptyList<Fb2Paragraph>(), document.sections.single().paragraphs)
    }

    @Test
    fun rejectsEntityDeclarationsEvenWithoutADoctype() {
        val xml = "<FictionBook><description><title-info><book-title>&#65;</book-title></title-info></description>" +
            "<!ENTITY forbidden SYSTEM 'https://example.invalid/entity'><body><section/></body></FictionBook>"
        assertThrows(IllegalArgumentException::class.java) {
            Fb2Parser.parse(ByteArrayInputStream(xml.toByteArray()))
        }
    }

    private fun zip(vararg entries: Pair<String, String>): File {
        val target = folder.newFile("fixture-${entries.first().first.replace('/', '_')}.fb2.zip")
        ZipOutputStream(target.outputStream()).use { output ->
            entries.forEach { (name, content) ->
                output.putNextEntry(ZipEntry(name))
                output.write(content.toByteArray())
                output.closeEntry()
            }
        }
        return target
    }

    companion object {
        private const val minimalDocument = """
            <FictionBook><body><section><title><p>Only chapter</p></title><p>Text</p></section></body></FictionBook>
        """

        private const val fixture = """
            <?xml version="1.0" encoding="UTF-8"?>
            <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
              <description><title-info><book-title>The First Title</book-title><author>
                <first-name>Ada</first-name><middle-name>M.</middle-name><last-name>Writer</last-name>
              </author><lang>en</lang></title-info></description>
              <description><title-info><book-title>Ignored title</book-title><lang>fr</lang></title-info></description>
              <body>
                <p> Opening <em>paragraph</em> </p>
                <p><![CDATA[CDATA passage]]></p>
                <subtitle> A   subtitle </subtitle>
                <poem><v>Verse one</v><v>Verse two</v></poem>
                <v>Top-level verse</v>
                <epigraph>Opening quote</epigraph>
                <text-author>Body heading</text-author>
                <title>A body title</title>
                <section id=" chapter-one ">
                  <title><p>Chapter <em>One</em></p></title>
                  <p>First chapter paragraph</p>
                  <subtitle>Chapter subtitle</subtitle>
                  <text-author>Chapter voice</text-author>
                  <v>Chapter verse</v>
                  <epigraph>Chapter epigraph</epigraph>
                  <poem>Chapter poem</poem>
                  <p>Another chapter paragraph</p>
                  <section><title><p>Child section</p></title><p>Child paragraph</p></section>
                </section>
                <section id=" "><p>Fallback section</p></section>
              </body>
            </FictionBook>
        """
    }
}
