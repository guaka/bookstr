# Comic reader fixtures

`bookstr-test-comic.cbz` contains three generated portrait PNG pages plus a
`ComicInfo.xml` file declaring language `pt-BR`. It was produced with
ImageMagick (Apache-2.0) and Info-ZIP; no proprietary RAR software was used.

The page names are `page-001.png`, `page-002.png`, and `page-010.png` so tests
can verify numeric ordering.

`bobby-make-believe-public-domain.cbr` is a genuine RAR4 archive containing
four JPEG pages. It comes unchanged from the `v0.2` release of
[`clach04/sample_reading_media`](https://github.com/clach04/sample_reading_media),
which distributes the fixture under LGPL-2.1; the README there identifies the
comic artwork itself as public domain. The accompanying LGPL license is stored
in `LICENSE-LGPL-2.1.txt`. SHA-256:

`c877000bc59dc9747db7e57259d92e88f4f9a79926aa5f2f905dfb5a9361423e`

The CBR intentionally has no `ComicInfo.xml`; it tests native RAR extraction
and real-page display. The generated CBZ tests metadata and numeric ordering.
