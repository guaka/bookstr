'use strict';

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { open, unlink } = require('node:fs/promises');

const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_SIZE = 8 * 1024 * 1024 * 1024;

function validateManifest(m) {
  if (!m || m.version !== 1 || m.chunkSize !== CHUNK_SIZE ||
      !/^[a-f0-9]{32}$/.test(m.transferId) || !/^[a-f0-9]{16}$/.test(m.noncePrefix) ||
      !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > MAX_SIZE) {
    throw new Error('Invalid encrypted transfer manifest');
  }
  return Math.ceil(m.size / CHUNK_SIZE);
}

function recordParameters(m, index) {
  const count = validateManifest(m);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Invalid record index');
  const nonce = Buffer.alloc(12);
  Buffer.from(m.noncePrefix, 'hex').copy(nonce);
  nonce.writeUInt32BE(index, 8);
  const aad = Buffer.from(`bookstr-transfer-v1\n${m.transferId}\n${m.size}\n${index}`, 'utf8');
  return { nonce, aad, size: Math.min(CHUNK_SIZE, m.size - index * CHUNK_SIZE) };
}

function sealRecord(plaintext, key, manifest, index) {
  const { nonce, aad, size } = recordParameters(manifest, index);
  if (plaintext.length !== size || key.length !== 32) throw new Error('Invalid record or key length');
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function openRecord(ciphertext, key, manifest, index) {
  const { nonce, aad, size } = recordParameters(manifest, index);
  if (ciphertext.length !== size + 16 || key.length !== 32) throw new Error('Invalid record or key length');
  const cipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  cipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([cipher.update(ciphertext.subarray(0, -16)), cipher.final()]);
}

async function readExactly(file, size, position) {
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(data, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error('Truncated transfer file');
    offset += bytesRead;
  }
  return data;
}

// The source must already be verified by the acquisition/import path. A new
// key/prefix pair is created for every invocation, never reused for a new file.
async function encryptFile(source, destination, expectedSHA256) {
  const input = await open(source, 'r');
  let output;
  try {
    const stat = await input.stat();
    const manifest = { version: 1, transferId: randomBytes(16).toString('hex'),
      chunkSize: CHUNK_SIZE, size: stat.size, sha256: expectedSHA256,
      noncePrefix: randomBytes(8).toString('hex') };
    const count = validateManifest(manifest);
    const key = randomBytes(32);
    output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    for (let index = 0; index < count; index++) {
      const { size } = recordParameters(manifest, index);
      const data = await readExactly(input, size, index * CHUNK_SIZE);
      hash.update(data);
      await output.writeFile(sealRecord(data, key, manifest, index));
    }
    if (hash.digest('hex') !== expectedSHA256 || (await input.stat()).size !== stat.size) {
      throw new Error('Source changed or failed verification');
    }
    await output.sync();
    return { manifest, key, ciphertextSize: manifest.size + count * 16 };
  } catch (error) {
    if (output) { await output.close(); output = null; await unlink(destination); }
    throw error;
  } finally {
    await input.close();
    if (output) await output.close();
  }
}

async function decryptFile(source, destination, manifest, key) {
  const count = validateManifest(manifest);
  const input = await open(source, 'r');
  let output;
  try {
    if ((await input.stat()).size !== manifest.size + count * 16) throw new Error('Invalid encrypted file size');
    output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    for (let index = 0; index < count; index++) {
      const { size } = recordParameters(manifest, index);
      const data = await readExactly(input, size + 16, index * (CHUNK_SIZE + 16));
      const plaintext = openRecord(data, key, manifest, index);
      hash.update(plaintext);
      await output.writeFile(plaintext);
    }
    if (hash.digest('hex') !== manifest.sha256) throw new Error('Plaintext checksum mismatch');
    await output.sync();
  } catch (error) {
    if (output) { await output.close(); output = null; await unlink(destination); }
    throw error;
  } finally {
    await input.close();
    if (output) await output.close();
  }
}

module.exports = { CHUNK_SIZE, validateManifest, sealRecord, openRecord, encryptFile, decryptFile, readExactly };
