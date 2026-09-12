const { test }=require('node:test');
const assert=require('node:assert/strict');
const { once }=require('node:events');
const { mkdtemp, writeFile, readFile, rm }=require('node:fs/promises');
const { join }=require('node:path');
const { tmpdir }=require('node:os');
const { createHash }=require('node:crypto');
const { generateSecretKey, getPublicKey, finalizeEvent }=require('nostr-tools/pure');
const WebSocket=require('ws');
const { createFileRelay, byteRange }=require('../../file-relay');
const { RelayClient }=require('../../relay-client');
const { encryptFile,decryptFile }=require('../../encrypted-transfer');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(f){for(let n=0;n<100;n++){if(await f())return;await pause(20)}throw Error('Timed out')}

test('range parsing rejects multipart and malformed or unsafe ranges',()=>{
 assert.deepEqual(byteRange(undefined,20),{start:0,end:19,status:200});
 assert.deepEqual(byteRange('bytes=2-',20),{start:2,end:19,status:206});
 assert.deepEqual(byteRange('bytes=2-999',20),{start:2,end:19,status:206});
 for(const r of ['bytes=-2','bytes=9-2','bytes=21-','bytes=1-2,5-6','bytes=99999999999999999-']) assert.equal(byteRange(r,20),null);
 assert.throws(()=>createFileRelay());assert.throws(()=>createFileRelay({allowedPubkeys:['bad']}));
 assert.throws(()=>new RelayClient({url:'http://example.com/v1/connect'}));
 assert.throws(()=>new RelayClient({url:'wss://user:pass@example.com/v1/connect'}));
});

test('Electron encrypts, streams through relay, resumes and verifies original bytes',async t=>{
 const key=generateSecretKey(), pub=getPublicKey(key), relay=createFileRelay({allowedPubkeys:[pub]});
 relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
 const port=relay.server.address().port;
 const dir=await mkdtemp(join(tmpdir(),'bookstr-relay-'));
 const client=new RelayClient({url:`ws://127.0.0.1:${port}/v1/connect`,allowLoopback:true,signEvent:e=>finalizeEvent(e,key)});
 t.after(async()=>{await client.stop();await relay.close();await rm(dir,{recursive:true,force:true})});
 const plain=Buffer.alloc(200000,77),source=join(dir,'book'),encrypted=join(dir,'ciphertext');
 await writeFile(source,plain);
 const transfer=await encryptFile(source,encrypted,createHash('sha256').update(plain).digest('hex'));
 const capability='ab'.repeat(32),expires=Math.floor(Date.now()/1000)+60;
 await client.add({manifest:transfer.manifest,ciphertextPath:encrypted,capability,expires});
 await assert.rejects(()=>client.add({manifest:transfer.manifest,ciphertextPath:encrypted,capability,expires}),/already/);
 await assert.rejects(()=>client.add({manifest:transfer.manifest,ciphertextPath:encrypted,capability:'bad',expires}),/grant/);
 const base=`http://127.0.0.1:${port}`,url=`${base}/v1/files/${transfer.manifest.transferId}`;
 assert.equal((await fetch(url)).status,404);
 client.start();client.start();await waitFor(()=>client.ready);
 const headers={Authorization:`Bearer ${capability}`};
 await waitFor(async()=> (await fetch(url,{method:'HEAD',headers})).status===200);
 assert.equal((await fetch(`${base}/bad`)).status,404);
 assert.equal((await fetch(url,{method:'POST'})).status,404);
 assert.equal((await fetch(url,{headers:{...headers,Range:'bytes=9999999-'}})).status,416);
 const first=await fetch(url,{headers:{...headers,Range:'bytes=0-70000'}});
 assert.equal(first.status,206);assert.equal(first.headers.get('cache-control'),'no-store');
 const second=await fetch(url,{headers:{...headers,Range:'bytes=70001-'}});
 const received=Buffer.concat([Buffer.from(await first.arrayBuffer()),Buffer.from(await second.arrayBuffer())]);
 assert.deepEqual(received,await readFile(encrypted));assert.notDeepEqual(received.subarray(0,plain.length),plain);
 const receivedFile=join(dir,'received'),result=join(dir,'readable');await writeFile(receivedFile,received);
 await decryptFile(receivedFile,result,transfer.manifest,transfer.key);assert.deepEqual(await readFile(result),plain);
 const stale=await fetch(url,{headers:{...headers,Range:'bytes=0-1','If-Range':'"stale"'}});
 assert.equal(stale.status,200);await stale.arrayBuffer();
 // A disconnected computer produces a retryable response; registrations stay
 // available for the authenticated device to reconnect without changing bytes.
 client.socket.terminate();await waitFor(()=>!client.ready);
 await waitFor(async()=> (await fetch(url,{method:'HEAD',headers})).status===503);
 await waitFor(()=>client.ready);
 await waitFor(async()=> (await fetch(url,{method:'HEAD',headers})).status===200);
 await client.revoke(transfer.manifest.transferId);
 await waitFor(async()=> (await fetch(url,{headers})).status===404);
 await client.revoke('missing');
});

test('relay rejects unsigned clients and never grants access from an invalid capability',async t=>{
 const secret=generateSecretKey(),relay=createFileRelay({allowedPubkeys:[getPublicKey(secret)],requestTimeout:100});
 relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');t.after(()=>relay.close());
 const base=`ws://127.0.0.1:${relay.server.address().port}`;
 for(const payload of ['bad',JSON.stringify({type:'auth',event:{}}),Buffer.from('bad')]){
  const ws=new WebSocket(base+'/v1/connect');await once(ws,'message');ws.send(payload);await once(ws,'close');
 }
 const idle=new WebSocket(base+'/v1/connect');await once(idle,'close');
});
