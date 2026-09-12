import XCTest
import CryptoKit
import Foundation
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class EncryptedBookTransferTests: XCTestCase {
    struct Fixture: Decodable {
        let manifest: EncryptedBookManifest
        let key: Data
        let plaintext: Data
        let ciphertext: Data
    }
    func fixture() throws -> Fixture {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("shared/fixtures/encrypted-transfer-v1.json")))
    }
    func testElectronCiphertextDecryptsInSwift() throws {
        let f = try fixture()
        XCTAssertEqual(try EncryptedBookTransfer.openRecord(f.ciphertext, key: f.key, manifest: f.manifest, index: 0), f.plaintext)
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(f.ciphertext, key: Data(repeating: 4, count: 32), manifest: f.manifest, index: 0))
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(f.ciphertext, key: Data(), manifest: f.manifest, index: 0))
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(f.ciphertext, key: f.key, manifest: f.manifest, index: -1))
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(f.ciphertext, key: f.key, manifest: f.manifest, index: 1))
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(Data(), key: f.key, manifest: f.manifest, index: 0))
        var corrupt = f.ciphertext; corrupt[0] ^= 1
        XCTAssertThrowsError(try EncryptedBookTransfer.openRecord(corrupt, key: f.key, manifest: f.manifest, index: 0))
    }
    func testInvalidManifests() throws {
        let f = try fixture()
        let data = try JSONEncoder().encode(f.manifest)
        let base = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        for (field,value) in [("version",2 as Any),("chunkSize",1),("size",0),("size",9 * 1024 * 1024 * 1024),("transferId","bad"),("noncePrefix","xx"),("sha256",String(repeating:"A",count:64))] {
            var object = base; object[field] = value
            let manifest = try JSONDecoder().decode(EncryptedBookManifest.self, from: JSONSerialization.data(withJSONObject: object))
            XCTAssertThrowsError(try manifest.validate(), field)
        }
        XCTAssertNil(EncryptedBookManifest.hex(String(repeating:"z",count:16), bytes:8))
    }
    func testFileImportAndFailureCleanup() throws {
        let f = try fixture()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:dir)}
        let source=dir.appendingPathComponent("encrypted"), output=dir.appendingPathComponent("plain")
        try f.ciphertext.write(to:source)
        try EncryptedBookTransfer.decrypt(source:source,destination:output,manifest:f.manifest,key:f.key)
        XCTAssertEqual(try Data(contentsOf:output),f.plaintext)
        XCTAssertThrowsError(try EncryptedBookTransfer.decrypt(source:source,destination:output,manifest:f.manifest,key:f.key))
        try FileManager.default.removeItem(at:output)
        XCTAssertThrowsError(try EncryptedBookTransfer.decrypt(source:source,destination:output,manifest:f.manifest,key:Data(repeating:4,count:32)))
        XCTAssertFalse(FileManager.default.fileExists(atPath:output.path))
        let m=f.manifest
        let wrongHash=EncryptedBookManifest(version:1,transferId:m.transferId,noncePrefix:m.noncePrefix,chunkSize:m.chunkSize,size:m.size,sha256:String(repeating:"0",count:64))
        XCTAssertThrowsError(try EncryptedBookTransfer.decrypt(source:source,destination:output,manifest:wrongHash,key:f.key))
        XCTAssertFalse(FileManager.default.fileExists(atPath:output.path))
        try Data().write(to:source)
        XCTAssertThrowsError(try EncryptedBookTransfer.decrypt(source:source,destination:output,manifest:m,key:f.key))
    }
}
