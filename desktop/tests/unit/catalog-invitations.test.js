const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {nip19}=require('nostr-tools');
const {parseCatalogInvitation}=require('../../../web/catalog-invitation');
const {CatalogInvitations}=require('../../catalog-invitations');
const f=require('../../../shared/fixtures/catalog-invitation-v1.json');

test('catalog invitations validate identity, version, fields and relays',()=>{
 assert.deepEqual(parseCatalogInvitation(f.uri,nip19.decode),{...f,version:1});
 assert.equal(parseCatalogInvitation(f.uri+'&relay=wss%3A%2F%2Frelay.example',nip19.decode).relays.length,1);
 for(const value of [null,'x'.repeat(2049),'garbage',f.uri.replace('bookstr:','https:'),f.uri.replace('//catalog','//user@catalog'),f.uri+'#secret',f.uri.replace('//catalog','//catalog:9'),f.uri.replace('catalog?','catalog/path?'),f.uri+'&nsec=secret',f.uri+'&v=1',f.uri.replace('v=1','v=2'),f.uri.replace('name=My+Libcat','name='),f.uri.replace('name=My+Libcat','name=%00'),f.uri.replace('name=My+Libcat','name='+('a'.repeat(81))),f.uri.replace(f.npub,'nsec'+f.npub.slice(4)),f.uri.replace('relay=wss%3A%2F%2Frelay.example',''),f.uri+'&relay=wss://a&relay=wss://b&relay=wss://c']) {
  assert.throws(()=>parseCatalogInvitation(value,nip19.decode),String(value));
 }
 for(const relay of ['http://relay.example','wss://user:pass@relay.example','wss://relay.example/#x','wss://relay.example/?token=x','wss://relay.example/ bad','wss://relay.example/'+('a'.repeat(256))]) {
  const u=new URL(f.uri);u.searchParams.set('relay',relay);assert.throws(()=>parseCatalogInvitation(u.href,nip19.decode),relay);
 }
 assert.throws(()=>parseCatalogInvitation(f.uri,()=>({type:'nsec',data:f.pubkey})));
 assert.throws(()=>parseCatalogInvitation(f.uri,()=>({type:'npub',data:'bad'})));
 assert.throws(()=>parseCatalogInvitation(f.uri.replace(f.npub,f.npub.slice(0,-1)+'x'),nip19.decode));
});

function harness(){
 const app=new EventEmitter();const registrations=[];app.setAsDefaultProtocolClient=(...args)=>registrations.push(args);
 let saved={},response=0,reloads=0;const questions=[];
 const controller=new CatalogInvitations({app,dialog:{showMessageBox:async(_win,options)=>{questions.push(options);return{response}}},
 loadState:async()=>saved,saveState:async state=>{saved={...saved,...state}},decodeNPub:nip19.decode,
 getWindow:()=>({show(){},focus(){},reload(){reloads++}})});
 return {controller,app,questions,registrations,setResponse:v=>response=v,saved:()=>saved,reloads:()=>reloads};
}

test('cold launch cancellation confirmation persistence and duplicate invitations',async()=>{
 const h=harness();assert.equal(await h.controller.current(),null);
 await h.controller.receive(f.uri);await h.controller.start([], '/electron',false,'/app');
 assert.equal(h.questions.length,1);assert.equal(h.reloads(),0);assert.deepEqual(h.registrations,[['bookstr']]);
 h.setResponse(1);await h.controller.receive(f.uri);assert.equal(h.reloads(),1);assert.equal((await h.controller.current()).pubkey,f.pubkey);
 await h.controller.receive(f.uri);assert.equal(h.questions.length,2);assert.equal(h.reloads(),1);
 assert.equal(await h.controller.receive('bookstr://wrong'),false);
});

test('OS events and startup argv queue valid invitations only',async()=>{
 const h=harness();let prevented=false;
 h.app.emit('open-url',{preventDefault(){prevented=true}},f.uri);
 h.app.emit('second-instance',null,['/app',f.uri]);
 await h.controller.start(['/app',f.uri],'/electron',true,'/app');
 assert.equal(prevented,true);assert.equal(h.questions.length,3);assert.deepEqual(h.registrations,[['bookstr','/electron',['/app']]]);
 const cold=harness();for(let i=0;i<4;i++)assert.equal(await cold.controller.receive(f.uri),true);
 assert.equal(await cold.controller.receive(f.uri),false);
});

test('concurrent invitations never overlap confirmation dialogs',async()=>{
 let release;const gate=new Promise(r=>release=r);const h=harness();
 h.controller.dialog.showMessageBox=async()=>{await gate;return{response:0}};
 await h.controller.start([],'',false,'');
 const first=h.controller.receive(f.uri);await h.controller.receive(f.uri);release();await first;
 assert.equal(h.controller.pending.length,0);assert.equal(h.controller.running,false);
});
