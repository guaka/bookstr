# Catalog provider record contract

`provider-records.json` is the first cross-client fixture for externally
catalogued publications. It describes one provider record, not a merged work;
clients may group equal works later without replacing provider identifiers.

Required record fields are `provider`, `recordId`, `publicationId`, `title`,
`authors`, `languages`, `rights`, and `acquisitions`.

- `publicationId` is exactly `<provider>:<recordId>` and is stable per provider.
- `rights.status` is one of `public_domain`, `open_license`, `copyrighted`, or
  `unknown`. The remaining rights fields are optional provider evidence.
- An acquisition has an `epub`, `pdf`, or `fb2` format, an absolute HTTP(S) URL, and an
  availability of `open`, `borrow`, `buy`, `preview`, or `restricted`.

`fb2` means a FictionBook 2 XML document (`application/x-fictionbook+xml` or
`application/fb2+xml`) or a ZIP containing exactly one `.fb2` file. Clients
retain the downloaded bytes and use the provider record's rights evidence;
they do not silently convert FictionBook editions to EPUB.

FB2 reading locations use `fb2:<section-id-or-ordinal>:<paragraph>:<offset>`.
Readers fall back to the section ordinal when an edition has no stable ID.

Adapters accept their provider's wire data, normalize it into this shape, and
leave network, storage, presentation, and download policy platform-owned.

`provider-records.schema.json` is the canonical versioned wire schema. The
deterministic generator commits matching JavaScript, Kotlin, and Swift DTOs so
native builds do not require Node. Persistence and UI models remain
platform-owned and map to these wire-only types at adapter boundaries.

Check the fixtures and committed generated files with:

```sh
node shared/catalog/validate-provider-records.mjs
node shared/catalog/generate-provider-record-dtos.mjs --check
```

## Public OPDS sources

Users may configure a public OPDS source as a display `name` and a
credential-free public `https://` feed URL. Private-network endpoints,
embedded credentials, and all credential fields are rejected and never
serialized. The portable Nostr representation is a
`["bookstr-opds-feed", name, url]` tag under the
`["bookstr-opds-feeds", "1"]` marker.

Adapters support OPDS 1 Atom acquisition feeds, OpenSearch discovery, and
OPDS 2 JSON publication feeds. They return only FB2 acquisitions and report a
feed-specific failure to the calling client; custom feed URLs are fetched by
the client and are never forwarded through Bookstr's public worker.

## v1 legal-source registry

`source-registry.mjs` is the shared policy index for built-in discovery:

- Propagate and Ebooks libres et gratuits expose native torrent delivery and
  source-asserted public-domain policy.
- Internet Archive exposes torrents, but each item still needs rights evidence.
- Project Gutenberg, Wikisource, OAPEN, DOAB, Open Textbook Library, Unglue.it,
  Global Digital Library, and the existing LitRes feed remain HTTPS/metadata
  sources. Wikisource records must retain the per-work license template;
  Russian and Chinese works are first-class language coverage.

Source descriptors do not grant redistribution by themselves. The rights v2
normalizer must return `redistribution: allowed` before an edition can be
publicly seeded. LibriVox is intentionally deferred until audio support exists,
and the 92 GB OAPEN collection torrent is not a Bookstr dependency.
