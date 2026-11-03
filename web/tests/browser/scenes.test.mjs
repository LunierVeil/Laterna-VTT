import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken, stageListenerCount } from './fixture.mjs';


test('B01/B02: live player renders fog events and the correct snapshot when GM changes scene',{timeout:90000},async()=>{
  const p=await pageFor(player,{observeLifecycle:true});const frames=p.received;
  const tok=(await command('token.add',{x:105,y:105,name:'Fog sentinel'})).payload.token;
  await until(()=>stageToken(p,tok.id),'player renders token');
  await command('fog.cover',{x:0,y:0,w:300,h:300});
  await until(async()=>!(await stageToken(p,tok.id)),'fog removes rendered enemy');
  assert.ok(frames.some(m=>m.name==='fog.updated'&&m.payload.remove_tokens.includes(tok.id)));
  await command('fog.clear');await until(()=>stageToken(p,tok.id),'reveal restores rendered enemy');
  const next=(await command('scene.create',{name:'Player destination'})).payload.id;
  const prep=await pageFor(gm);await probe(prep,next);
  const hidden=(await command('token.add',{x:105,y:105,name:'Hidden destination'},prep)).payload.token;
  const visible=(await command('token.add',{x:805,y:105,name:'Visible destination'},prep)).payload.token;
  await command('fog.cover',{x:0,y:0,w:300,h:300},prep);
  await p.evaluate(id=>{
    const stage=window.observedStage;stage.select(id);
    window.stageBeforeSwitch={stage,canvas:stage.app.canvas,root:stage.app.stage,ticker:stage.app.ticker};
    window.holdNextStageMount=true;
  },tok.id);
  assert.equal(await stageListenerCount(p,'window.stageBeforeSwitch.stage','window.stageBeforeSwitch.canvas'),5,'observe real stage listeners before switching');
  await command('scene.activate',{id:next});
  await until(()=>p.evaluate(()=>!!window.heldSceneStage&&window.stageMountGates.length===1),'destination mount held before init');
  await until(()=>frames.some(m=>m.type==='snapshot'&&m.scene.id===next),'early destination snapshot');
  const back=frames.length;await command('scene.activate',{id:sceneId});
  await until(()=>frames.slice(back).some(m=>m.type==='snapshot'&&m.scene.id===sceneId),'return snapshot while destination mount is pending');
  await until(()=>p.evaluate(()=>window.observedStage?.isAlive&&window.observedStage!==window.stageBeforeSwitch.stage),'current replacement renderer');
  await until(()=>stageToken(p,tok.id),'current scene restored before late cancelled mount');
  // Build and then rebuild real Graphics while A is live, before releasing stale B.
  await command('fog.cover',{x:1005,y:1005,w:140,h:140});
  await until(()=>p.evaluate(()=>window.observedStage.fog.length>0),'current fog Graphics delivered');
  await p.evaluate(()=>window.observedStage.app.render());
  await command('fog.clear');await until(()=>p.evaluate(()=>window.observedStage.fog.length===0),'current fog Graphics cleared');
  await p.evaluate(()=>window.observedStage.app.render());
  await p.evaluate(()=>window.stageMountGates.splice(0).forEach(release=>release()));
  await until(()=>p.evaluate(()=>!window.heldSceneStage.isAlive),'cancelled late mount destroyed');
  await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.deepEqual(await p.evaluate(()=>{
    const old=window.stageBeforeSwitch,late=window.heldSceneStage,resources=window.observedMountResources.find(r=>r.stage===late);
    return {oldAlive:old.stage.isAlive,oldCanvas:old.canvas.isConnected,oldRootDestroyed:old.root.destroyed,oldObserver:old.stage.resizeObserver,oldRenderer:old.stage.app.renderer,oldTickerStopped:!old.ticker.started,lateCanvas:resources.canvas.isConnected,lateRootDestroyed:resources.root.destroyed,lateObserver:late.resizeObserver,lateRenderer:late.app.renderer,lateTickerStopped:!resources.ticker.started,liveStages:window.observedStages.filter(s=>s.isAlive&&s.app.canvas.isConnected).length,canvases:document.querySelectorAll('.scene canvas').length};
  }),{oldAlive:false,oldCanvas:false,oldRootDestroyed:true,oldObserver:null,oldRenderer:null,oldTickerStopped:true,lateCanvas:false,lateRootDestroyed:true,lateObserver:null,lateRenderer:null,lateTickerStopped:true,liveStages:1,canvases:1});
  assert.equal(await stageListenerCount(p,'window.stageBeforeSwitch.stage','window.stageBeforeSwitch.canvas'),0,'old stage listeners removed');
  assert.equal(await stageListenerCount(p,'window.heldSceneStage','window.observedMountResources.find(r=>r.stage===window.heldSceneStage).canvas'),0,'cancelled stage listeners removed');
  assert.equal(await p.evaluate(async()=>(await import('/src/state/store.ts')).useUi.getState().selected),null,'selection reset on scene switch');
  const beforeGraphics=await p.locator('canvas').screenshot();
  await command('token.move',{id:tok.id,x:175,y:105});
  await until(async()=>(await stageToken(p,tok.id))?.data.x===175,'late cancelled stage cannot steal stageRef');
  await until(async()=>!beforeGraphics.equals(await p.locator('canvas').screenshot()),'live Graphics continue drawing after late destroy');
  const destination=frames.length;await command('scene.activate',{id:next});
  await until(()=>frames.slice(destination).some(m=>m.type==='snapshot'&&m.scene.id===next),'destination snapshot');
  await until(()=>stageToken(p,visible.id),'destination visible token');
  assert.equal(await stageToken(p,hidden.id),null);assert.equal(await stageToken(p,tok.id),null);
  assert.ok(frames.some(m=>m.type==='snapshot'&&m.scene.id===next&&m.scene.fog.length));
  await command('scene.activate',{id:sceneId});await until(()=>stageToken(p,tok.id),'return to first scene');
  assert.equal(await p.evaluate(()=>window.observedStages.filter(s=>s.isAlive&&s.app.canvas.isConnected).length),1);
  assert.equal(await stageListenerCount(p,'window.observedStage','window.observedStage.app.canvas'),5,'current stage has exactly its own listeners after repeated switches');
  await command('scene.delete',{id:next});await prep.close();await p.close();
});

test('Fog images: repeated reveal restores sprite pixels without rebuilding stage or leaking hidden tokens',{timeout:120000},async()=>{
 const master=await pageFor(gm),observer=await pageFor(player);await probe(observer,sceneId);
 const upload=async()=>{const r=await gm.request.post(`${api}/api/uploads`,{data:await master.locator('canvas').screenshot(),headers:{'Content-Type':'image/png'}});assert.equal(r.status(),200);return(await r.json()).url;};
 const portrait=await upload(),custom=await upload(),secretURL=await upload(),tokens=[];
 for(const system of ['dnd5e','mob']){
  const c=(await command('character.create',{name:`Fog ${system}`,system})).payload.character;
  await command('character.update',{id:c.id,set:{portrait,'hp.max':15}});
  for(const explicit of [false,true]){
   const t=(await command('token.add',{x:2905+tokens.length*70,y:1005,character_id:c.id,...(explicit?{image_url:custom}:{})})).payload.token;
   tokens.push({id:t.id,url:explicit?custom:portrait});
  }
 }
 const npc=(await command('token.add',{x:3255,y:1005,name:'NPC without sheet',image_url:custom})).payload.token;tokens.push({id:npc.id,url:custom});
 const mine=(await command('character.create',{name:'Own visible hero'},observer)).payload.character;
 await command('character.update',{id:mine.id,set:{portrait}},observer);
 const owned=(await command('token.add',{x:3325,y:1005,character_id:mine.id},observer)).payload.token;
 const secretStart=observer.received.length;
 const secret=(await command('token.add',{x:3395,y:1005,layer:'gm',image_url:secretURL})).payload.token;
 const image=async(p,id)=>p.evaluate(id=>{
  const s=window.observedStage,v=s?.tokens.get(id);if(!v||!v.image.visible||!v.image.texture.source||v.image.texture.width<=1)return null;
  const {pixels,width,height}=s.app.renderer.extract.pixels({target:v.image});
  let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619)>>>0;
  return {url:v.imageUrl,width,height,hash,bytes:pixels.length};
 },id);
 const before=new Map();
 for(const p of [master,observer])for(const t of [...tokens,{id:owned.id,url:portrait}]){
  const rendered=await until(async()=>{const v=await image(p,t.id);return v?.url===t.url&&v.bytes>0?v:null;},'initial rendered image');
  if(p===observer)before.set(t.id,rendered);
 }
 await observer.evaluate(id=>{window.fogStage=window.observedStage;window.fogRenderer=window.fogStage.app.renderer;window.ownNode=window.fogStage.tokens.get(id).node;},owned.id);
 const snapshotCount=observer.received.filter(m=>m.type==='snapshot').length,region={x:2800,y:900,w:650,h:400};
 for(let cycle=0;cycle<4;cycle++){
  const start=observer.received.length;await command('fog.cover',region);
  await until(()=>observer.received.slice(start).some(m=>m.name==='fog.updated'&&tokens.every(t=>m.payload.remove_tokens.includes(t.id))),'cover delivered');
  for(const t of tokens)assert.equal(await stageToken(observer,t.id),null);
  assert.deepEqual(await image(observer,owned.id),before.get(owned.id));
  const covered=observer.received.slice(start).find(m=>m.name==='fog.updated');assert.equal(covered.payload.add_tokens.length,0);
  for(const url of [portrait,custom,secretURL])assert.equal(JSON.stringify(covered).includes(url),false);
  const revealFrom=observer.received.length;await command('fog.reveal',region);
  const revealed=await until(()=>observer.received.slice(revealFrom).find(m=>m.name==='fog.updated'&&m.payload.add_tokens.length===tokens.length),'reveal delivered');
  for(const t of tokens){
   const packet=revealed.payload.add_tokens.find(v=>v.id===t.id);assert.equal(packet.image_url||packet.portrait_url,t.url,'complete image source');
   const restored=await until(()=>image(observer,t.id),'image restored');assert.deepEqual(restored,before.get(t.id),'sprite pixels match');
   assert.equal((await image(master,t.id)).url,t.url);
  }
  assert.equal(await observer.evaluate(id=>window.observedStage===window.fogStage&&window.observedStage.app.renderer===window.fogRenderer&&window.observedStage.tokens.get(id).node===window.ownNode,owned.id),true);
  assert.equal(observer.received.filter(m=>m.type==='snapshot').length,snapshotCount);
 }
 assert.equal(await stageToken(observer,secret.id),null);
 const disclosed=JSON.stringify(observer.received.slice(secretStart));assert.equal(disclosed.includes(secret.id),false);assert.equal(disclosed.includes(secretURL),false);
 assert.equal(observer.received.some(m=>m.type==='character'&&m.character.system==='mob'),false);
 await master.close();await observer.close();
});

test('v012 scenes: folder CRUD, menu/order/drag, private lazy previews and persistence without scene data loss',{timeout:120000},async()=>{
 const master=await pageFor(gm),observer=await pageFor(player);const originalRequests=[];
 master.on('request',r=>{if(r.url().includes('/uploads/'))originalRequests.push(r.url());});
 await master.getByRole('tab',{name:'Сцены',exact:true}).click();
 for(const name of ['v012 Dungeon','v012 Town']){
  await master.getByRole('textbox',{name:'Название новой папки'}).fill(name);await master.getByRole('button',{name:'+ Папка',exact:true}).click();
  await master.getByRole('button',{name:`▾ ${name} (0)`,exact:true}).waitFor();
 }
 const folders=await master.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().folders);
 const fid=folders.find(f=>f.name==='v012 Dungeon').id,other=folders.find(f=>f.name==='v012 Town').id;
 const a=(await command('scene.create',{name:'v012 Map'})).payload.id,b=(await command('scene.create',{name:'v012 Empty'})).payload.id;
 const card=id=>master.locator(`.scene-row[data-scene-id="${id}"]`),folder=id=>master.locator(`.scene-folder[data-folder-id="${id}"]`);
 await card(a).waitFor();await card(b).waitFor();assert.equal(await card(b).locator('img').count(),0);await card(b).getByRole('img',{name:'Сцена без превью'}).waitFor();
 const upload=await gm.request.post(`${api}/api/uploads`,{data:await master.locator('canvas').screenshot(),headers:{'Content-Type':'image/png'}});assert.equal(upload.status(),200);const url=(await upload.json()).url;
 await probe(master,a);await command('scene.update',{background_url:url},master);
 const preview=card(a).locator('img');await until(()=>preview.evaluate(e=>e.complete&&e.naturalWidth>0),'thumbnail decoded');
 const source=await preview.getAttribute('src');assert.match(source,new RegExp(`/api/scenes/${a}/preview`));assert.equal(originalRequests.some(r=>r.endsWith(url)),false,'no full map for inactive preview');
 const size=await preview.evaluate(e=>({w:e.naturalWidth,h:e.naturalHeight}));assert.ok(size.w<=480&&size.h<=300);
 assert.equal((await player.request.get(`${api}${source}`)).status(),403);
 const initial=await (await gm.request.get(`${api}/api/scenes/${a}`)).json();
 const move=async(id,target)=>{await card(id).getByRole('button',{name:/Действия сцены/}).click();await card(id).getByRole('combobox').selectOption(target);await folder(target).locator(`[data-scene-id="${id}"]`).waitFor();};
 await move(a,fid);await move(b,fid);
 await card(b).getByRole('button',{name:/Действия сцены/}).click();await card(b).getByRole('button',{name:'Выше',exact:true}).click();
 await until(async()=>JSON.stringify(await folder(fid).locator('.scene-row').evaluateAll(es=>es.map(e=>e.dataset.sceneId)))===JSON.stringify([b,a]),'persisted order');
 await card(a).dragTo(folder(other).locator('.scene-folder-heading'));await folder(other).locator(`[data-scene-id="${a}"]`).waitFor();
 await move(a,'');
 await master.getByRole('button',{name:'Переименовать папку v012 Dungeon'}).click();await master.getByRole('textbox',{name:'Новое название папки'}).fill('v012 Renamed');await master.getByRole('button',{name:'Сохранить',exact:true}).click();
 await master.getByRole('button',{name:'▾ v012 Renamed (1)',exact:true}).click();
 await master.reload();await master.locator('canvas').waitFor();await master.getByRole('tab',{name:'Сцены',exact:true}).click();
 assert.equal(await master.getByRole('button',{name:'▸ v012 Renamed (1)',exact:true}).getAttribute('aria-expanded'),'false');
 await master.getByRole('button',{name:'Удалить папку v012 Renamed'}).click();await master.getByRole('alertdialog').getByText('Сцены сохранятся и будут перемещены в «Без папки».',{exact:true}).waitFor();await master.getByRole('button',{name:'Удалить папку',exact:true}).click();
 await folder('').locator(`[data-scene-id="${b}"]`).waitFor();
 assert.deepEqual(await(await gm.request.get(`${api}/api/scenes/${a}`)).json(),initial);
 const received=JSON.stringify(observer.received);for(const value of [fid,other,a,b,url,source])assert.equal(received.includes(value),false,'private scene metadata');
 assert.equal(await observer.getByRole('tab',{name:'Сцены',exact:true}).count(),0);
 assert.equal((await player.request.get(`${api}/api/scenes/${a}`)).status(),404);
 if(process.env.BROWSER_RESULTS_DIR){await mkdir(process.env.BROWSER_RESULTS_DIR,{recursive:true});await master.screenshot({path:resolve(process.env.BROWSER_RESULTS_DIR,'v012-scenes.png')});}
 await command('scene.delete',{id:a});await command('scene.delete',{id:b});await command('folder.delete',{id:other});
 await master.close();await observer.close();
});

test('Final scenes: explicit current/active labels, one-tap preview, rename without switching and settings',{timeout:90000},async()=>{
 await control.evaluate(id=>localStorage.setItem('lanterna.gmScene',id),sceneId);
 const master=await pageFor(gm,{preserveSavedScene:true}),observer=await pageFor(player);assert.equal(await master.evaluate(()=>window.observedStages.length),1,'StrictMode must not initialize a discarded WebGL renderer');await master.getByRole('tab',{name:'Сцены',exact:true}).click();
 const created=(await command('scene.create',{name:'UX hidden card'})).payload.id;const card=()=>master.locator(`.scene-row[data-scene-id="${created}"]`);await card().waitFor();
 await card().getByRole('button',{name:'Действия сцены UX hidden card',exact:true}).click();await card().getByRole('button',{name:'Переименовать сцену',exact:true}).click();await card().getByRole('textbox',{name:'Новое название сцены'}).fill('UX renamed hidden');await card().getByRole('button',{name:'Сохранить название',exact:true}).click();await card().getByText('UX renamed hidden',{exact:true}).waitFor();
 assert.equal((await master.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().sceneName)).includes('UX renamed hidden'),false,'rename does not open scene');
 await card().getByRole('button',{name:'Открыть сцену UX renamed hidden',exact:true}).click();await until(()=>master.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().sceneName==='UX renamed hidden'),'preview opens scene');
 await card().getByText('Открыта у ГМ',{exact:true}).waitFor();assert.equal(await card().getByText('видят игроки',{exact:true}).count(),0);
 await master.getByRole('button',{name:'Настройки открытой сцены',exact:true}).click();assert.equal(await master.locator('details.scene-settings').getAttribute('open'),'');await master.getByRole('button',{name:'Загрузить карту',exact:true}).waitFor();
 await master.locator('details.scene-settings > summary').click();await card().getByRole('button',{name:'Действия сцены UX renamed hidden',exact:true}).click();await card().getByRole('button',{name:'Настройки сцены',exact:true}).click();assert.equal(await master.locator('details.scene-settings').getAttribute('open'),'');
 const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await gm.storageState()}),touch=await pageFor(touchContext);
 assert.equal(await touch.evaluate(()=>window.observedStages.length),1,'mobile StrictMode initializes one renderer');await touch.getByRole('button',{name:'Открыть панели',exact:true}).tap();await touch.getByRole('tab',{name:'Сцены',exact:true}).tap();await touch.getByRole('button',{name:'Открыть сцену UX renamed hidden',exact:true}).tap();await until(()=>touch.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().sceneName==='UX renamed hidden'),'touch scene opens');assert.equal(await touch.locator('.sidebar').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await touchContext.close();
 await master.reload();await master.locator('canvas').waitFor();
 await until(()=>master.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().sceneName==='UX renamed hidden'),'GM restores saved private scene after reload');
 assert.equal(await master.evaluate(()=>localStorage.getItem('lanterna.gmScene')),created);
 await master.getByRole('tab',{name:'Сцены',exact:true}).click();
 assert.equal(JSON.stringify(observer.received).includes('UX renamed hidden'),false);
 await card().getByRole('button',{name:'Показать',exact:true}).click();await until(()=>observer.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().sceneName==='UX renamed hidden'),'player active label');await card().getByText('видят игроки',{exact:true}).waitFor();
 await command('scene.activate',{id:sceneId});await command('scene.delete',{id:created});await master.close();await observer.close();
});
