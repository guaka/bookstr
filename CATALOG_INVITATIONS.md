# Catalog invitations

Libcat’s authenticated administration page provides an Open in Bookstr link and an iPhone QR code. Both contain the same `bookstr://catalog` URI with version `v=1`, the catalog `npub`, a display `name`, and one or more `relay` parameters. Set `LIBCAT_NAME` to customize the displayed name. The relay comes from `LIBCAT_RELAY`.

The invitation contains public routing information, never the service private key or administration password. Anyone receiving it can share it; knowing an npub is not an authentication boundary. QR generation happens locally on Libcat.

Bookstr asks before replacing its selected catalog. Desktop installations register the Bookstr URL scheme. iPhone users scan with Camera and open the installed Bookstr app. This connects a catalog; pairing an iPhone with Electron for book delivery is a separate step.

Electron uses the saved catalog for Libcat searches and book resolution. Native iOS currently validates and saves the invitation and displays it in Settings; native Libcat search still requires its separate integration.

The version 1 parser accepts only npub, name, relay and v fields, checks the npub checksum, and limits relay endpoints to wss URLs. Shared fixture: `shared/fixtures/catalog-invitation-v1.json`.
