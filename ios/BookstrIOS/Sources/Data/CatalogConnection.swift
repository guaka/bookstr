import Foundation

struct CatalogConnection: Codable, Identifiable, Equatable {
    let name: String
    let npub: String
    let pubkey: String
    let relays: [String]
    let uri: String
    var id: String { uri }

    // The native host supplies NostrCore's checksum-validating npub decoder.
    init?(url: URL, decodeNPub: (String) -> String?) {
        guard url.absoluteString.utf8.count <= 2048,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "bookstr", components.host == "catalog",
              components.user == nil, components.password == nil, components.port == nil,
              components.fragment == nil, ["", "/"].contains(components.path) else { return nil }
        // Go's form query encoder uses '+' for spaces; URLComponents doesn't.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%20")
        let items = components.queryItems ?? []
        guard items.allSatisfy({ ["v", "npub", "name", "relay"].contains($0.name) }),
              ["v", "npub", "name"].allSatisfy({ key in items.filter { $0.name == key }.count == 1 }),
              items.first(where: { $0.name == "v" })?.value == "1",
              let encoded = items.first(where: { $0.name == "npub" })?.value,
              encoded.range(of: "^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$", options: .regularExpression) != nil,
              let key = decodeNPub(encoded), key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let title = items.first(where: { $0.name == "name" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !title.isEmpty, title.utf8.count <= 80, title.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        let addresses = items.filter { $0.name == "relay" }
        guard !addresses.isEmpty, addresses.count <= 3 else { return nil }
        var unique: [String] = []
        for item in addresses {
            guard let address = item.value, address.utf8.count <= 256,
                  address.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
                  let endpoint = URLComponents(string: address), endpoint.scheme == "wss",
                  let host = endpoint.host, !host.isEmpty, endpoint.user == nil, endpoint.password == nil,
                  endpoint.fragment == nil, endpoint.query == nil else { return nil }
            if !unique.contains(address) { unique.append(address) }
        }
        name = title; npub = encoded; pubkey = key; relays = unique; uri = url.absoluteString
    }
}
