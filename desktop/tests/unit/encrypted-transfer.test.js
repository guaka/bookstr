const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { CHUNK_SIZE, validateManifest, sealRecord, openRecord, encryptFile, decryptFile, readExactly } = require('../../encrypted-transfer');
const hash = data => createHash('sha256').update(data).digest('hex');
const fixture = { version:1, transferId:'01'.repeat(16), noncePrefix:'02'.repeat(8), size:5, chunkSize:CHUNK_SIZE, sha256:hash(Buffer.from('hello')) };

test('records authenticate contents, metadata, order and key', () => {
 const data=Buffer.from('hello'),key=Buffer.alloc(32,3);
 const encrypted=sealRecord(data,key,fixture,0);
 assert.deepEqual(openRecord(encrypted,key,fixture,0),data);
 for (const invalid of [null, {...fixture,version:2}, {...fixture,chunkSize:1}, {...fixture,transferId:'bad'}, {...fixture,noncePrefix:'bad'}, {...fixture,sha256:'bad'}, {...fixture,size:0}, {...fixture,size:9*1024**3}, {...fixture,size:1.5}]) assert.throws(()=>validateManifest(invalid));
 for(const index of [-1,1,0.5]) assert.throws(()=>sealRecord(data,key,fixture,index));
 assert.throws(()=>sealRecord(data,Buffer.alloc(1),fixture,0));
 assert.throws(()=>sealRecord(Buffer.alloc(1),key,fixture,0));
 assert.throws(()=>openRecord(encrypted,Buffer.alloc(1),fixture,0));
 assert.throws(()=>openRecord(encrypted.subarray(1),key,fixture,0));
 assert.throws(()=>openRecord(encrypted,Buffer.alloc(32,4),fixture,0));
 assert.throws(()=>openRecord(encrypted,key,{...fixture,transferId:'04'.repeat(16)},0));
 encrypted[0]^=1;assert.throws(()=>openRecord(encrypted,key,fixture,0));
});

test('streamed file encryption is private, resumable and removes failed output',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bookstr-encrypted-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const src=join(dir,'source'),enc=join(dir,'ciphertext'),out=join(dir,'plain');
 const data=Buffer.alloc(CHUNK_SIZE+41,5);await writeFile(src,data);
 const transfer=await encryptFile(src,enc,hash(data));
 assert.equal((await stat(enc)).size, data.length+32);
 assert.equal((await stat(enc)).mode & 0o777,0o600);
 await decryptFile(enc,out,transfer.manifest,transfer.key);
 assert.deepEqual(await readFile(out),data);
 await assert.rejects(()=>encryptFile(src,enc,hash(data)),/EEXIST/);
 await assert.rejects(()=>decryptFile(enc,out,transfer.manifest,transfer.key),/EEXIST/);
 const wrong=join(dir,'wrong');
 await assert.rejects(()=>encryptFile(src,wrong,'00'.repeat(32)),/verification/);
 await assert.rejects(()=>stat(wrong),/ENOENT/);
 await assert.rejects(()=>encryptFile(src,wrong,'invalid'),/manifest/);
 const enc2=join(dir,'ciphertext2'),next=await encryptFile(src,enc2,hash(data));
 assert.notDeepEqual(next.key,transfer.key);assert.notEqual(next.manifest.noncePrefix,transfer.manifest.noncePrefix);
 const bytes=await readFile(enc);
 // Reordering authenticated records must fail even for equal-sized records.
 const multi={...fixture,size:CHUNK_SIZE*2};const key=Buffer.alloc(32,7),block=Buffer.alloc(CHUNK_SIZE);
 assert.throws(()=>openRecord(sealRecord(block,key,multi,0),key,multi,1));
 bytes[bytes.length-1]^=1;await writeFile(enc,bytes);
 await assert.rejects(()=>decryptFile(enc,wrong,transfer.manifest,transfer.key));
 await assert.rejects(()=>stat(wrong),/ENOENT/);
 await writeFile(enc,bytes.subarray(1));
 await assert.rejects(()=>decryptFile(enc,wrong,transfer.manifest,transfer.key),/size/);
 // Authenticated content can still disagree with an expected plaintext hash.
 const small=join(dir,'small');const badManifest={...fixture,sha256:'00'.repeat(32)};
 await writeFile(small,sealRecord(Buffer.from('hello'),key,badManifest,0));
 await assert.rejects(()=>decryptFile(small,wrong,badManifest,key),/checksum/);
});

test('short reads are accumulated and EOF fails closed',async()=>{
 const file={read:async(buffer,offset)=>{buffer[offset]=7;return {bytesRead:1}}};
 assert.deepEqual(await readExactly(file,3,0),Buffer.from([7,7,7]));
 await assert.rejects(()=>readExactly({read:async()=>({bytesRead:0})},2,0),/Truncated/);
});
