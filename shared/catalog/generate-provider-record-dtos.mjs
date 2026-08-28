#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUTS = {
  'web/generated/catalog-provider-record-v1.js': renderJavaScript,
  'android/app/src/main/java/app/bookstr/shared/generated/CatalogProviderRecordV1.kt': renderKotlin,
  'ios/BookstrIOS/Sources/Shared/Generated/CatalogProviderRecordV1.swift': renderSwift,
};

export function validateSchema(schema) {
  const record = schema?.$defs?.providerRecord;
  const rights = schema?.$defs?.rights;
  const acquisition = schema?.$defs?.acquisition;
  if (schema?.properties?.version?.const !== 1) throw new Error('Provider schema version must be 1');
  if (!Array.isArray(record?.required) || !record.required.includes('publicationId')) {
    throw new Error('Provider schema must require publicationId');
  }
  if (!Array.isArray(rights?.properties?.status?.enum) || rights.properties.status.enum.length === 0) {
    throw new Error('Provider schema must define rights statuses');
  }
  if (!Array.isArray(acquisition?.properties?.format?.enum) || acquisition.properties.format.enum.length === 0) {
    throw new Error('Provider schema must define acquisition formats');
  }
  return schema;
}

function header(comment) {
  return `${comment} Generated from shared/catalog/provider-records.schema.json. Do not edit.\n`;
}

export function renderJavaScript(schema) {
  validateSchema(schema);
  return `${header('//')}export const CATALOG_PROVIDER_RECORD_VERSION = 1;

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(\`${'${path}'} must be an object\`);
  return value;
}

function string(value, path) {
  if (typeof value !== 'string') throw new TypeError(\`${'${path}'} must be a string\`);
  return value;
}

function strings(value, path) {
  if (!Array.isArray(value)) throw new TypeError(\`${'${path}'} must be an array\`);
  return value.map((item, index) => string(item, \`${'${path}'}[${'${index}'}]\`));
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
      const acquisition = object(item, \`record.acquisitions[${'${index}'}]\`);
      return {
        format: string(acquisition.format, \`record.acquisitions[${'${index}'}].format\`),
        url: string(acquisition.url, \`record.acquisitions[${'${index}'}].url\`),
        availability: string(acquisition.availability, \`record.acquisitions[${'${index}'}].availability\`),
      };
    }),
  };
}

export function serializeCatalogProviderRecordV1(record) {
  return JSON.stringify(parseCatalogProviderRecordV1(record));
}
`;
}

export function renderKotlin(schema) {
  validateSchema(schema);
  return `${header('//')}package app.bookstr.shared.generated

import org.json.JSONArray
import org.json.JSONObject

const val CATALOG_PROVIDER_RECORD_VERSION = 1

data class CatalogProviderRightsV1(
    val status: String,
    val license: String? = null,
    val licenseUrl: String? = null,
    val source: String? = null,
)

data class CatalogProviderAcquisitionV1(
    val format: String,
    val url: String,
    val availability: String,
)

data class CatalogProviderRecordV1(
    val provider: String,
    val recordId: String,
    val publicationId: String,
    val title: String,
    val authors: List<String>,
    val languages: List<String>,
    val publishedYear: String? = null,
    val rights: CatalogProviderRightsV1,
    val acquisitions: List<CatalogProviderAcquisitionV1>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("provider", provider)
        .put("recordId", recordId)
        .put("publicationId", publicationId)
        .put("title", title)
        .put("authors", JSONArray(authors))
        .put("languages", JSONArray(languages))
        .apply { if (publishedYear != null) put("publishedYear", publishedYear) }
        .put("rights", JSONObject()
            .put("status", rights.status)
            .apply {
                if (rights.license != null) put("license", rights.license)
                if (rights.licenseUrl != null) put("licenseUrl", rights.licenseUrl)
                if (rights.source != null) put("source", rights.source)
            })
        .put("acquisitions", JSONArray(acquisitions.map { acquisition -> JSONObject()
            .put("format", acquisition.format)
            .put("url", acquisition.url)
            .put("availability", acquisition.availability)
        }))

    companion object {
        fun fromJson(json: JSONObject): CatalogProviderRecordV1 {
            val rights = json.getJSONObject("rights")
            return CatalogProviderRecordV1(
                provider = json.getString("provider"),
                recordId = json.getString("recordId"),
                publicationId = json.getString("publicationId"),
                title = json.getString("title"),
                authors = json.getJSONArray("authors").strings(),
                languages = json.getJSONArray("languages").strings(),
                publishedYear = json.optString("publishedYear").ifBlank { null },
                rights = CatalogProviderRightsV1(
                    status = rights.getString("status"),
                    license = rights.optString("license").ifBlank { null },
                    licenseUrl = rights.optString("licenseUrl").ifBlank { null },
                    source = rights.optString("source").ifBlank { null },
                ),
                acquisitions = json.getJSONArray("acquisitions").objects().map { acquisition ->
                    CatalogProviderAcquisitionV1(
                        format = acquisition.getString("format"),
                        url = acquisition.getString("url"),
                        availability = acquisition.getString("availability"),
                    )
                },
            )
        }
    }
}

private fun JSONArray.strings(): List<String> = (0 until length()).map(::getString)
private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
`;
}

export function renderSwift(schema) {
  validateSchema(schema);
  return `${header('//')}import Foundation

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
`;
}

export function parseArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === '--check') return { check: true };
  throw new Error(`Unknown arguments: ${args.join(' ')}`);
}

export async function run(args, io = { readFile, writeFile, mkdir }, cwd = process.cwd()) {
  const { check } = parseArgs(args);
  const schema = validateSchema(JSON.parse(await io.readFile(resolve(cwd, 'shared/catalog/provider-records.schema.json'), 'utf8')));
  for (const [relativePath, render] of Object.entries(OUTPUTS)) {
    const output = resolve(cwd, relativePath);
    const generated = render(schema);
    if (check) {
      const current = await io.readFile(output, 'utf8').catch(() => '');
      if (current !== generated) throw new Error(`${relativePath} is stale; regenerate it`);
    } else {
      await io.mkdir(dirname(output), { recursive: true });
      await io.writeFile(output, generated);
    }
  }
  return check ? 'checked' : 'generated';
}

export async function cli(args, services = {}) {
  const execute = services.run || run;
  const writeError = services.writeError || ((message) => process.stderr.write(message));
  const fail = services.fail || (() => { process.exitCode = 1; });
  try {
    return await execute(args);
  } catch (error) {
    writeError(`${error.message}\n`);
    fail();
    return 'failed';
  }
}

export function invokeIfMain(moduleUrl, argv, action = cli) {
  const invokedPath = argv[1] ? pathToFileURL(resolve(argv[1])).href : '';
  return moduleUrl === invokedPath ? action(argv.slice(2)) : Promise.resolve('imported');
}

await invokeIfMain(import.meta.url, process.argv);
