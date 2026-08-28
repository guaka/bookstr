// Generated from shared/catalog/provider-records.schema.json. Do not edit.
import Foundation

let catalogProviderRecordVersion = 1

struct CatalogProviderRightsV1: Codable, Equatable {
    let status: String
    let license: String?
    let licenseUrl: String?
    let source: String?
}

struct CatalogProviderAcquisitionV1: Codable, Equatable {
    let format: String
    let url: String
    let availability: String
}

struct CatalogProviderRecordV1: Codable, Equatable {
    let provider: String
    let recordId: String
    let publicationId: String
    let title: String
    let authors: [String]
    let languages: [String]
    let publishedYear: String?
    let rights: CatalogProviderRightsV1
    let acquisitions: [CatalogProviderAcquisitionV1]
}
