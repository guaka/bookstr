import CryptoKit
import Foundation
import Darwin

struct EncryptedBookManifest: Codable {
    let version: Int
    let transferId: String
    let noncePrefix: String
    let chunkSize: Int
    let size: Int
    let sha256: String

    func validate() throws -> Int {
        guard version == 1, chunkSize == 4 * 1024 * 1024, size > 0,
              size <= 8 * 1024 * 1024 * 1024,
              Self.hex(transferId, bytes: 16) != nil,
              Self.hex(noncePrefix, bytes: 8) != nil,
              Self.hex(sha256, bytes: 32) != nil else { throw EncryptedBookTransfer.Failure.invalidManifest }
        return (size + chunkSize - 1) / chunkSize
    }

    static func hex(_ text: String, bytes: Int) -> Data? {
        guard text.utf8.count == bytes * 2,
              text.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return nil }
        let chars = Array(text)
        return Data(stride(from: 0, to: chars.count, by: 2).map {
            UInt8(String(chars[$0...($0 + 1)]), radix: 16)!
        })
    }
}

enum EncryptedBookTransfer {
    enum Failure: Error { case invalidManifest, invalidRecord, invalidSize, checksum, destinationExists }

    static func openRecord(_ ciphertext: Data, key: Data, manifest: EncryptedBookManifest, index: Int) throws -> Data {
        let count = try manifest.validate()
        guard index >= 0, index < count, key.count == 32 else { throw Failure.invalidRecord }
        let size = min(manifest.chunkSize, manifest.size - index * manifest.chunkSize)
        guard ciphertext.count == size + 16 else { throw Failure.invalidSize }
        var nonce = EncryptedBookManifest.hex(manifest.noncePrefix, bytes: 8)!
        var counter = UInt32(index).bigEndian
        withUnsafeBytes(of: &counter) { nonce.append(contentsOf: $0) }
        let aad = Data("bookstr-transfer-v1\n\(manifest.transferId)\n\(manifest.size)\n\(index)".utf8)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce),
                                      ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }

    // Call on a worker queue. The destination is a private staging file, never
    // the library's final path; only a verified result may be imported.
    static func decrypt(source: URL, destination: URL, manifest: EncryptedBookManifest, key: Data) throws {
        let count = try manifest.validate()
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        guard try input.seekToEnd() == UInt64(manifest.size + count * 16) else { throw Failure.invalidSize }
        try input.seek(toOffset: 0)
        // O_EXCL prevents accidentally replacing an existing book or following
        // a preexisting symlink. Foundation's createFile can overwrite files.
        let fd = destination.path.withCString { Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR) }
        guard fd >= 0 else { throw Failure.destinationExists }
        let output = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var complete = false
        defer {
            try? output.close()
            if !complete { try? FileManager.default.removeItem(at: destination) }
        }
        var hash = SHA256()
        for index in 0..<count {
            let size = min(manifest.chunkSize, manifest.size - index * manifest.chunkSize) + 16
            var record = Data()
            while record.count < size {
                guard let part = try input.read(upToCount: size - record.count), !part.isEmpty else { throw Failure.invalidSize }
                record.append(part)
            }
            let plaintext = try openRecord(record, key: key, manifest: manifest, index: index)
            hash.update(data: plaintext)
            try output.write(contentsOf: plaintext)
        }
        guard Data(hash.finalize()) == EncryptedBookManifest.hex(manifest.sha256, bytes: 32)! else { throw Failure.checksum }
        try output.synchronize()
        complete = true
    }
}
