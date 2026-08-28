# Catalog provider record contract

`provider-records.json` is the first cross-client fixture for externally
catalogued publications. It describes one provider record, not a merged work;
clients may group equal works later without replacing provider identifiers.

Required record fields are `provider`, `recordId`, `publicationId`, `title`,
`authors`, `languages`, `rights`, and `acquisitions`.

- `publicationId` is exactly `<provider>:<recordId>` and is stable per provider.
- `rights.status` is one of `public_domain`, `open_license`, `copyrighted`, or
  `unknown`. The remaining rights fields are optional provider evidence.
- An acquisition has an `epub` or `pdf` format, an absolute HTTP(S) URL, and an
  availability of `open`, `borrow`, `buy`, `preview`, or `restricted`.

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
