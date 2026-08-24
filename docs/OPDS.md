# OPDS sources and normalization

## Purpose

This document describes how LibVault could use the Open Publication
Distribution System (OPDS) to discover books from external catalogs and, in
the other direction, expose its own catalog to compatible readers.

It is a design note only. It does not define an implementation plan or imply
that any external catalog should be imported, mirrored, or enabled by default.

The immediate opportunity is to give LibVault and Bookstr access to useful,
legitimate collections such as Project Gutenberg while retaining source
provenance, book-level rights, and the distinction between a remote book, a
locally cached file, and a Blossom replica.

## What OPDS provides

OPDS is a discovery and acquisition protocol, not a central book collection.
An OPDS catalog can provide:

- navigation and search;
- publication metadata;
- covers and other images;
- one or more acquisition links, such as EPUB or PDF downloads;
- pagination, facets, and groups;
- information about whether a publication is open access, borrowed, bought,
  previewed, or otherwise acquired.

The catalog operator supplies the actual metadata and files. The OPDS
Community maintains the specifications, registries, schemas, drafts, and a
small test catalog, but not a general-purpose library of books.

Two directions are possible and independent:

1. **OPDS ingestion:** LibVault consumes external catalogs and makes their
   publications discoverable alongside its existing sources.
2. **OPDS publishing:** LibVault exposes a standard catalog that Bookstr and
   third-party readers can browse.

Ingestion is the more direct route to populating Bookstr with useful books.
Publishing is primarily an interoperability feature.

## Candidate sources

Sources should be enabled deliberately. A working OPDS endpoint alone is not
enough: catalog stability, metadata quality, access conditions, download
rights, redistribution rights, and the provider's preferred delivery model all
matter.

### Project Gutenberg

Project Gutenberg is the strongest first source:

- a large multilingual catalog;
- an official OPDS 1.x feed;
- direct downloads in several formats;
- stable Gutenberg identifiers;
- no account required for normal access.

Its catalog entry point is:

```text
https://www.gutenberg.org/ebooks/search.opds/
```

Formatting and metadata quality vary between titles. Rights statements and
Project Gutenberg's terms must be retained. Public-domain status can also vary
by jurisdiction, so LibVault should not replace the source's rights information
with a blanket assertion that every title is unrestricted everywhere.

### Standard Ebooks

Standard Ebooks offers a smaller collection of carefully produced EPUBs with
excellent typography and metadata. Its feed supports OPDS 1.x and can return
OPDS 2.0 when requested with the appropriate HTTP `Accept` header.

```text
https://standardebooks.org/feeds/opds
```

Feed access may require patron credentials or approval for an eligible
open-source project. LibVault should seek permission or use the documented
access mechanism rather than scrape the service.

### OAPEN and DOAB

OAPEN and the Directory of Open Access Books (DOAB) are particularly valuable
for nonfiction and academic books.

- OAPEN hosts full-text open-access publications.
- DOAB aggregates metadata and links to publications hosted by publishers and
  other platforms.
- Their metadata feeds are available under CC0.
- Rights for the book files remain title-specific and must be preserved.

Their bulk JSON, OAI-PMH, and REST interfaces may be better ingestion sources
than OPDS. LibVault should treat OPDS as one possible adapter rather than a
requirement for every catalog provider.

### Foreign Relations of the United States

The United States Department of State Office of the Historian publishes a
documented OPDS catalog for the *Foreign Relations of the United States*
series:

```text
https://history.state.gov/api/v1/catalog
```

It requires no registration or API key and links to EPUB and PDF editions.
The provider asks clients to link to its files so readers receive the latest
versions. This is a useful example of a source for which direct delivery should
remain the default rather than automatic republication.

### Internet Archive and Open Library

Internet Archive and Open Library are potentially valuable later sources, but
their records can mix:

- unrestricted downloads;
- controlled borrowing;
- authentication requirements;
- scans, OCR derivatives, EPUBs, and PDFs;
- multiple manifestations of the same edition;
- incomplete or ambiguous rights information.

They should not be initial sources. Supporting them well requires explicit
borrowing and access-state models rather than treating every acquisition link
as a public download.

### Other public catalogs

Feedbooks, ManyBooks, public Calibre servers, and other catalog endpoints
should be evaluated individually before inclusion. LibVault should not depend
on an endpoint merely because it is publicly reachable.

## Normalized domain model

The current LibVault model is centered on a LibGen record whose MD5 identifies
a file. Aggregating several catalogs requires separating concepts that are
often collapsed into a single "book" object.

```text
Work
  A conceptual creation, for example Moby-Dick

Edition or publication
  A particular language, publisher, revision, and presentation

Source record
  A provider's description of that publication

Acquisition
  A way to obtain a particular format from that provider

Blob
  The exact downloaded bytes, identified by SHA-256
```

These layers allow two providers to describe the same work without assuming
that their EPUB files or even their editions are identical.

### Sources

A source represents an external catalog or existing LibVault backend. It may
contain:

- a stable internal source key;
- display name and homepage;
- catalog or API entry point;
- protocol and version, such as OPDS 1.x, OPDS 2.0, or a provider API;
- authentication requirements;
- refresh and rate-limit information;
- delivery, caching, and replication policies;
- attribution and terms URLs;
- enabled and health state.

Examples include `gutenberg`, `standard-ebooks`, `oapen`, `frus`, and
`libgen`.

### Source records

A source record preserves what a provider said about a publication. It should
include:

- source key and source-native record identifier;
- canonical record URL;
- the original metadata payload or a lossless representation of it;
- source creation and modification timestamps when available;
- first-seen, last-seen, and last-fetched timestamps;
- current availability or removal state;
- a link to the normalized publication.

Retaining the original payload makes normalization reversible and allows the
mapping to improve without re-fetching an entire catalog.

### Publications

A normalized publication contains fields that LibVault and Bookstr can use
consistently:

- title, subtitle, and sort title;
- authors and other contributors as structured people rather than one display
  string;
- description;
- language;
- publisher and publication date or year;
- series or collection and position;
- subjects and classification codes;
- identifiers such as ISBN, DOI, URI, Gutenberg ID, or LibGen ID;
- rights statement, license identifier, and license URL;
- cover candidates;
- links back to all contributing source records.

Empty values should not overwrite populated values from a better source.
Conflicting values should retain their provenance instead of being silently
resolved by whichever source ran last.

### Acquisitions

An acquisition describes one way to obtain a publication. It should include:

- source record;
- original URL;
- OPDS relation, such as open access, borrow, buy, preview, or subscribe;
- media type and normalized format;
- declared file size and checksum, when supplied;
- authentication or authorization requirements;
- availability and borrowing state;
- price information where relevant;
- provider-specific delivery policy;
- the resolved blob, once downloaded and verified.

A publication can have several acquisitions: EPUB and PDF from the same
provider, copies from multiple providers, or a public source plus a local
cached copy.

### Blobs

A blob represents exact file bytes. It should include:

- SHA-256 as the canonical content identity;
- MD5 where needed for LibGen compatibility;
- detected media type and format;
- byte size;
- validation status and timestamp;
- local cache state and path;
- the acquisition from which it was retrieved;
- original and final download URLs;
- optional Blossom publication state, hash, URL, and errors.

Blob records should only be created after LibVault has received and validated
the bytes. A remote URL or catalog identifier is not a content hash.

## Identity and deduplication

Different identifiers answer different questions:

- an OPDS entry ID identifies a provider's catalog record;
- a Gutenberg ID identifies a Gutenberg publication;
- ISBN and DOI are bibliographic identifiers;
- LibGen MD5 identifies a file in the LibGen ecosystem;
- SHA-256 identifies the exact bytes LibVault downloaded.

LibVault should therefore use these rules:

1. A source record is uniquely identified by `(source, source-native ID)`.
2. Exact matching SHA-256 values safely identify the same blob.
3. ISBN, DOI, and other identifiers can suggest that records describe the same
   edition, but conflicts and reused identifiers are possible.
4. Normalized title, contributor, language, and date similarity can suggest a
   shared work, but must not silently merge records.
5. Multiple file formats and revisions remain separate blobs even when they
   belong to the same publication.
6. Source records and provenance survive deduplication.

For example:

```text
source record: gutenberg:2701
title: Moby-Dick
author: Herman Melville
record URL: https://www.gutenberg.org/ebooks/2701
acquisition: a provider-hosted EPUB URL
blob SHA-256: unknown until the first successful download
```

Bookstr currently uses SHA-256 content hashes for verified local publications
and reading progress. A future normalized model may also need a stable
publication identifier so a corrected file revision does not appear to be a
completely unrelated book. Publication identity and content identity should
remain separate even if Bookstr initially continues to key local files by
SHA-256.

## Metadata normalization

Normalization should be deterministic, source-aware, and non-destructive.

### General rules

- Normalize whitespace and Unicode without changing meaningful text.
- Preserve original display strings even when structured values are derived.
- Normalize language values to BCP 47 where possible while retaining the
  source value.
- Store dates at the precision supplied by the source; do not invent months or
  days for year-only values.
- Normalize ISBN formatting and validate check digits, but keep invalid source
  values for diagnostics.
- Prefer declared media types, then verify them from the downloaded bytes.
- Map subjects into a display form without discarding source vocabularies or
  classification codes.
- Store rights and license information verbatim as well as in normalized
  fields.
- Resolve relative acquisition and image URLs against the feed that supplied
  them.
- Sanitize rich descriptions before rendering them.

### Selecting display metadata

LibVault may choose a preferred display value from several sources, but that
choice should be separate from stored provenance. Selection can consider:

- whether the value is non-empty and structurally valid;
- whether the provider is authoritative for that publication;
- source-specific metadata quality;
- freshness;
- completeness;
- explicit user corrections.

User corrections should not be overwritten by a later catalog refresh.

### Covers

Cover links should be stored as source-provided image candidates with their
dimensions and media types. LibVault can choose an appropriate display image
and cache it independently. Cover identity must not be inferred from the book
file identity.

## Discovery and download lifecycle

Catalog ingestion should not download every book.

### Catalog refresh

1. Fetch a catalog page or provider API response.
2. Validate and parse it with bounded size, time, and pagination limits.
3. Upsert source records and their acquisitions.
4. Normalize searchable metadata while preserving the original record.
5. Record records that disappeared without immediately deleting local data.
6. Download no publication files during ordinary metadata refresh.

### First acquisition

When a user asks to read or save a book:

1. Select an acquisition according to format preference, rights, availability,
   and source policy.
2. Download through LibVault or direct the client to the provider, depending on
   that policy.
3. Enforce file-size, timeout, redirect, and media-type limits.
4. Validate the format using both signature and container structure.
5. Compute SHA-256 and, where useful, MD5.
6. Reuse an existing matching blob or add the file to LibVault's local cache.
7. Attach the verified blob to the acquisition.
8. Return a stable LibVault reading or file URL when locally cached.

For Bookstr, EPUB should normally be preferred over PDF when both are suitable,
while retaining a user's explicit format choice.

## Delivery policy

Remote availability, local caching, and Blossom replication are separate
states:

```text
Available at source
        |
        v
Cached and verified by LibVault
        |
        v
Optionally replicated to Blossom
```

The user interface should make those states visible rather than presenting all
of them as simply "downloaded."

### Public HTTPS origins

A stable public HTTPS file does not need to be copied to Blossom by default.
The original URL should remain the canonical source and provenance link.

LibVault can still add value by downloading on first use:

- shared caching across Bookstr clients;
- validation and content hashing;
- consistent timeouts and error handling;
- resumable downloads;
- independence from browser CORS behavior;
- offline access after retrieval;
- detection of upstream file changes.

Whether LibVault proxies and caches a source or sends the reader directly to it
should be a source-level policy. A provider that explicitly requests direct
linking should normally receive direct traffic.

### Suggested source policies

A source can declare one of these conceptual policies:

- **cache on read:** LibVault may fetch and retain a local copy when requested;
- **redirect to origin:** readers download directly from the provider;
- **temporary proxy:** LibVault streams or temporarily caches without treating
  the file as a durable local publication;
- **replication allowed:** a verified local file may also be published to
  Blossom;
- **no republication:** the file must not be copied to Blossom even if it is
  cached locally for reading;
- **authenticated acquisition:** credentials or a borrowing workflow are
  required and must not be converted into a public link.

These policies must be derived from provider terms and book-level rights, not
guessed from the fact that a URL is publicly reachable.

## Blossom policy

Blossom is a resilient, content-addressed delivery option. It is not required
for every public book and should not become an automatic mirror of every
catalog LibVault can browse.

### Default

Do not automatically publish externally sourced books to Blossom.

### A Blossom replica may make sense when

- a user explicitly pins a publication for durable availability;
- the origin is unreliable or expected to disappear;
- several Bookstr devices need a stable content-addressed endpoint;
- the source and book-level license permit redistribution;
- attribution and license obligations can be preserved;
- storage and retention policies accept the file.

### A Blossom replica should not be made when

- the provider requests direct linking;
- access is based on borrowing, payment, authentication, or a temporary grant;
- the license permits reading but not redistribution;
- rights are missing or ambiguous;
- the source file changes frequently and the provider must remain authoritative;
- replication would bypass a provider's access controls or usage accounting.

Removing a catalog source should not automatically delete verified local blobs
or Blossom mappings. Retention and deletion need an explicit, separate policy.

## Rights, attribution, and trust

"Open access," "free to download," and "public domain" are not interchangeable.
LibVault should retain at least:

- the provider and source record URL;
- the source's rights statement;
- normalized license identifier and URL when available;
- required attribution;
- territorial or access caveats;
- the acquisition relation;
- the time at which the metadata and file were retrieved.

Metadata rights and publication rights must also remain distinct. A provider
may offer metadata under CC0 while each book uses a different Creative Commons
license.

LibVault should not infer redistribution permission from an HTTP 200 response.
Unknown rights should default to discovery and origin linking, not republication.

## OPDS versions

Many mature public catalogs and reader applications still use Atom-based OPDS
1.x. OPDS 2.0 uses JSON and aligns more closely with the Readium Web Publication
Manifest model.

For ingestion, supporting OPDS 1.2 is likely necessary for Project Gutenberg
and broad catalog compatibility. OPDS 2.0 remains useful for newer providers
and for a future LibVault publishing interface.

The formats should map into the same normalized domain model. Protocol-specific
XML or JSON structures should stop at the adapter boundary.

## Relationship with Bookstr

Bookstr should not need a custom integration for each provider. LibVault can
act as the catalog aggregator and acquisition coordinator while Bookstr
continues to focus on reading, verification, local storage, favorites, and
progress.

Possible future responsibilities are:

### LibVault

- source configuration and health;
- catalog ingestion and search;
- metadata normalization and provenance;
- acquisition selection;
- server-side download, validation, and caching;
- optional Blossom replication;
- a unified API or OPDS catalog for clients.

### Bookstr

- browse or search the unified catalog;
- show provider, rights, format, and availability;
- request acquisition;
- verify downloaded bytes;
- cache publications locally;
- read EPUB and PDF;
- synchronize favorites and reading progress.

The existing static `catalog.json` can remain useful for bundled seed books and
offline demos. It does not need to be removed merely because OPDS is added.

## User-facing states

A normalized publication can expose clear states such as:

- **Available from Gutenberg** — remote acquisition exists;
- **Fetching through LibVault** — a server-side download is running;
- **Cached in LibVault** — a verified local blob exists;
- **Downloaded on this device** — Bookstr has a verified local copy;
- **Replicated to Blossom** — a durable Blossom mapping exists;
- **Borrowing required** — acquisition needs an access workflow;
- **Unavailable at source** — the original acquisition no longer resolves.

The source name and rights information should remain visible even after a file
is cached or replicated.

## Evaluation order

If this design is pursued later, the suggested evaluation order is:

1. Project Gutenberg as the first OPDS ingestion case.
2. Source records, normalized publications, acquisitions, and blobs as separate
   concepts.
3. Metadata-only catalog refresh and cache-on-first-read behavior.
4. No automatic Blossom publication for public HTTPS sources.
5. Per-source delivery and replication policies.
6. OAPEN or DOAB as the first non-OPDS provider adapter.
7. Standard Ebooks after agreeing on feed access.
8. A LibVault OPDS publishing endpoint for Bookstr and third-party readers.
9. Borrowing and authentication sources such as Open Library only after their
   access semantics can be represented correctly.

This order is illustrative rather than an implementation commitment.

## Open questions

- Should LibVault initially expose every remote publication or only titles in
  configured and trusted sources?
- Should source catalogs be enabled globally by the server owner or selectable
  per user?
- Which rights values are sufficient for automatic local caching?
- Should explicit user pinning be required before publishing any external file
  to Blossom?
- How long should locally cached public-source files survive after last use?
- Should Bookstr favorites refer to a stable publication ID as well as the
  current SHA-256 blob?
- How should corrections and new file revisions migrate reading progress?
- Should the same work from Gutenberg and Standard Ebooks appear as separate
  editions or as format/source choices under one work?
- Which metadata source wins for display, and how can users override it?
- Should a future LibVault OPDS catalog contain the full searchable index or
  only currently acquirable and cached publications?

## References

- [OPDS project](https://opds.io/)
- [OPDS 1.2 specification](https://specs.opds.io/opds-1.2)
- [OPDS 2.0 specification](https://specs.opds.io/opds-2.0)
- [OPDS Community repositories](https://github.com/opds-community)
- [OPDS 2.0 test catalog](https://test.opds.io/2.0/home.json)
- [Project Gutenberg offline catalogs and OPDS](https://www.gutenberg.org/ebooks/offline_catalogs.html)
- [Standard Ebooks feeds](https://standardebooks.org/feeds)
- [OAPEN metadata and APIs](https://www.oapen.org/article/metadata)
- [DOAB metadata](https://www.doabooks.org/en/article/metadata)
- [Foreign Relations of the United States catalog API](https://history.state.gov/developer/catalog)
