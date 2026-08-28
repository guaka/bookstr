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
