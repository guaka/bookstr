const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const fixture=require('../../../shared/fixtures/catalog-invitation-v1.json');
const {parseCatalogInvitation}=require('../../../web/catalog-invitation');const {nip19}=require('nostr-tools');

async function launch(args=[]) {
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'bookstr-invitation-'));
 const app=await electron.launch({args:[path.resolve(__dirname,'../..'),`--user-data-dir=${userData}`,...args]});
 return {app,userData,close:async()=>{await app.close();fs.rmSync(userData,{recursive:true,force:true})}};
}

test('Electron receives invitation, cancels, confirms, persists and uses the catalog',async()=>{
 const session=await launch();const app=session.app;
 try {
  const page=await app.firstWindow();await expect(page).toHaveTitle('libstr');
  await app.evaluate(({dialog})=>{globalThis.invitationQuestions=[];dialog.showMessageBox=async(_window,options)=>{globalThis.invitationQuestions.push(options);return{response:0}}});
  await app.evaluate(({app},uri)=>app.emit('open-url',{preventDefault(){}},uri),fixture.uri);
  await expect.poll(()=>app.evaluate(()=>globalThis.invitationQuestions.length)).toBe(1);
  expect(await page.evaluate(()=>window.bookstrDesktop.catalog.get())).toBeNull();
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1})});
  await app.evaluate(({app},uri)=>app.emit('open-url',{preventDefault(){}},uri),fixture.uri);
  await expect.poll(()=>page.evaluate(()=>window.bookstrDesktop.catalog.get()).catch(()=>null)).toMatchObject({npub:fixture.npub,name:fixture.name,relays:fixture.relays});
  const saved=JSON.parse(fs.readFileSync(path.join(session.userData,'bookstr-desktop-state.json'),'utf8'));
  expect(saved.catalogInvitation.pubkey).toBe(fixture.pubkey);
  await app.evaluate(({app},uri)=>app.emit('open-url',{preventDefault(){}},uri),fixture.uri+'&nsec=secret');
  expect(await page.evaluate(()=>window.bookstrDesktop.catalog.get())).toMatchObject({npub:fixture.npub});
 } finally {await session.close()}
});

test('packaged protocol and cold-start invitation preserve saved connection',async()=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'bookstr-catalog-cold-'));
 fs.writeFileSync(path.join(userData,'bookstr-desktop-state.json'),JSON.stringify({catalogInvitation:parseCatalogInvitation(fixture.uri,nip19.decode)}));
 const app=await electron.launch({args:[path.resolve(__dirname,'../..'),`--user-data-dir=${userData}`,fixture.uri]});
 try {
  const page=await app.firstWindow();await expect(page).toHaveTitle('libstr');
  expect(await page.evaluate(()=>window.bookstrDesktop.catalog.get())).toMatchObject({pubkey:fixture.pubkey});
  const pkg=require('../../package.json');expect(pkg.build.protocols).toContainEqual({name:'Bookstr',schemes:['bookstr']});
 } finally {await app.close();fs.rmSync(userData,{recursive:true,force:true})}
});
