const RIGHTS_STATUSES = new Set(['public_domain', 'open_license', 'copyrighted', 'unknown']);
const ACQUISITION_FORMATS = new Set(['epub', 'pdf', 'fb2']);
const AVAILABILITY = new Set(['open', 'borrow', 'buy', 'preview', 'restricted']);
function error(path, message) {
    return `${path}: ${message}`;
}
function isHttpUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
export function validateProviderRecords(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return [error('$', 'must be an object')];
    const document = value;
    if (document.version !== 1)
        errors.push(error('version', 'must be 1'));
    if (!Array.isArray(document.records) || document.records.length === 0)
        return [...errors, error('records', 'must be a non-empty array')];
    const publicationIds = new Set();
    document.records.forEach((recordValue, index) => {
        const path = `records[${index}]`;
        if (!recordValue || typeof recordValue !== 'object' || Array.isArray(recordValue)) {
            errors.push(error(path, 'must be an object'));
            return;
        }
        const record = recordValue;
        for (const field of ['provider', 'recordId', 'publicationId', 'title']) {
            if (typeof record[field] !== 'string' || !record[field].trim())
                errors.push(error(`${path}.${field}`, 'must be a non-empty string'));
        }
        if (typeof record.provider === 'string' && typeof record.recordId === 'string' && record.publicationId !== `${record.provider}:${record.recordId}`) {
            errors.push(error(`${path}.publicationId`, 'must be provider:recordId'));
        }
        if (publicationIds.has(record.publicationId))
            errors.push(error(`${path}.publicationId`, 'must be unique'));
        publicationIds.add(record.publicationId);
        if (!Array.isArray(record.authors) || record.authors.some(author => typeof author !== 'string' || !author.trim()))
            errors.push(error(`${path}.authors`, 'must be an array of names'));
        if (!Array.isArray(record.languages) || record.languages.some(language => !/^[a-z]{2,3}$/i.test(language)))
            errors.push(error(`${path}.languages`, 'must be ISO language codes'));
        const rights = record.rights && typeof record.rights === 'object' ? record.rights : null;
        if (!rights || typeof rights.status !== 'string' || !RIGHTS_STATUSES.has(rights.status))
            errors.push(error(`${path}.rights.status`, 'must be a known status'));
        if (!Array.isArray(record.acquisitions) || record.acquisitions.length === 0) {
            errors.push(error(`${path}.acquisitions`, 'must be a non-empty array'));
            return;
        }
        record.acquisitions.forEach((acquisitionValue, acquisitionIndex) => {
            const acquisitionPath = `${path}.acquisitions[${acquisitionIndex}]`;
            if (!acquisitionValue || typeof acquisitionValue !== 'object' || Array.isArray(acquisitionValue)) {
                errors.push(error(acquisitionPath, 'must be an object'));
                return;
            }
            const acquisition = acquisitionValue;
            if (typeof acquisition.format !== 'string' || !ACQUISITION_FORMATS.has(acquisition.format))
                errors.push(error(`${acquisitionPath}.format`, 'must be epub, pdf, or fb2'));
            if (!isHttpUrl(acquisition.url))
                errors.push(error(`${acquisitionPath}.url`, 'must be an absolute HTTP(S) URL'));
            if (typeof acquisition.availability !== 'string' || !AVAILABILITY.has(acquisition.availability))
                errors.push(error(`${acquisitionPath}.availability`, 'must be a known availability'));
        });
    });
    return errors;
}
