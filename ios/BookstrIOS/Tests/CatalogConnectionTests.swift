import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class CatalogConnectionTests: XCTestCase {
    struct Fixture: Decodable { let uri:String; let npub:String; let pubkey:String; let name:String; let relays:[String] }
    func fixture() throws -> Fixture {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:root.appendingPathComponent("shared/fixtures/catalog-invitation-v1.json")))
    }
    func testInvitationAndPersistence() throws {
        let f=try fixture()
        let connection=try XCTUnwrap(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{$0 == f.npub ? f.pubkey : nil}))
        XCTAssertEqual(connection.name,f.name);XCTAssertEqual(connection.relays,f.relays);XCTAssertEqual(connection.id,f.uri)
        let suite="catalog-invitation-\(UUID().uuidString)";let defaults=UserDefaults(suiteName:suite)!
        defer{defaults.removePersistentDomain(forName:suite)}
        let settings=SettingsRepository(defaults:defaults)
        XCTAssertNil(settings.catalogConnection)
        let relays=settings.relays
        settings.catalogConnection=connection
        XCTAssertEqual(SettingsRepository(defaults:defaults).catalogConnection,connection)
        XCTAssertEqual(settings.relays,relays)
        settings.catalogConnection=nil;XCTAssertNil(settings.catalogConnection)
        defaults.set(Data("invalid".utf8),forKey:"catalog_connection_v1");XCTAssertNil(settings.catalogConnection)
        let duplicate=try XCTUnwrap(CatalogConnection(url:URL(string:f.uri+"&relay=wss%3A%2F%2Frelay.example")!,decodeNPub:{_ in f.pubkey}))
        XCTAssertEqual(duplicate.relays,f.relays)
    }
    func testInvalidInvitationsDoNotProduceSettings() throws {
        let f=try fixture()
        let invalid=["bookstr://catalog",f.uri.replacingOccurrences(of:"bookstr:",with:"https:"),f.uri.replacingOccurrences(of:"catalog?",with:"catalog/path?"),f.uri+"#fragment",f.uri+"&nsec=secret",f.uri+"&v=1",f.uri.replacingOccurrences(of:"v=1",with:"v=2"),f.uri.replacingOccurrences(of:"My+Libcat",with:""),f.uri.replacingOccurrences(of:"My+Libcat",with:"%00"),f.uri.replacingOccurrences(of:"My+Libcat",with:String(repeating:"a",count:81)),f.uri.replacingOccurrences(of:"relay=wss%3A%2F%2Frelay.example",with:""),f.uri+"&relay=wss://a&relay=wss://b&relay=wss://c",f.uri+String(repeating:"a",count:2048),f.uri.replacingOccurrences(of:f.npub,with:"bad"),f.uri.replacingOccurrences(of:"//catalog",with:"//user:pass@catalog"),f.uri.replacingOccurrences(of:"//catalog",with:"//catalog:9")]
        for value in invalid {XCTAssertNil(CatalogConnection(url:URL(string:value)!,decodeNPub:{_ in f.pubkey}),value)}
        for address in ["http://relay.example","wss://user:pass@relay.example","wss://relay.example/#x","wss://relay.example/?token=x","wss://relay.example/space here","wss://","wss://relay.example/"+String(repeating:"a",count:256)] {
            var components=URLComponents(string:f.uri)!;components.queryItems=components.queryItems!.filter{$0.name != "relay"}+[URLQueryItem(name:"relay",value:address)]
            XCTAssertNil(CatalogConnection(url:components.url!,decodeNPub:{_ in f.pubkey}),address)
        }
        XCTAssertNil(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{_ in nil}))
        XCTAssertNil(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{_ in "bad"}))
    }
}
