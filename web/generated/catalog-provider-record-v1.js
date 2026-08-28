// Generated from shared/catalog/provider-records.schema.json. Do not edit.
export const CATALOG_PROVIDER_RECORD_VERSION = 1;

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function string(value, path) {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
  return value;
}

function strings(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

export function parseCatalogProviderRecordV1(value) {
  const record = object(value, 'record');
  const rights = object(record.rights, 'record.rights');
  if (!Array.isArray(record.acquisitions)) throw new TypeError('record.acquisitions must be an array');
  return {
    provider: string(record.provider, 'record.provider'),
    recordId: string(record.recordId, 'record.recordId'),
    publicationId: string(record.publicationId, 'record.publicationId'),
    title: string(record.title, 'record.title'),
    authors: strings(record.authors, 'record.authors'),
    languages: strings(record.languages, 'record.languages'),
    ...(record.publishedYear === undefined ? {} : { publishedYear: string(record.publishedYear, 'record.publishedYear') }),
    rights: {
      status: string(rights.status, 'record.rights.status'),
      ...(rights.license === undefined ? {} : { license: string(rights.license, 'record.rights.license') }),
      ...(rights.licenseUrl === undefined ? {} : { licenseUrl: string(rights.licenseUrl, 'record.rights.licenseUrl') }),
      ...(rights.source === undefined ? {} : { source: string(rights.source, 'record.rights.source') }),
    },
    acquisitions: record.acquisitions.map((item, index) => {
      const acquisition = object(item, `record.acquisitions[${index}]`);
      return {
        format: string(acquisition.format, `record.acquisitions[${index}].format`),
        url: string(acquisition.url, `record.acquisitions[${index}].url`),
        availability: string(acquisition.availability, `record.acquisitions[${index}].availability`),
      };
    }),
  };
}

export function serializeCatalogProviderRecordV1(record) {
  return JSON.stringify(parseCatalogProviderRecordV1(record));
}
