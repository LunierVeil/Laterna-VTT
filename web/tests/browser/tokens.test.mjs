import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { observeTokenLink, tokenLinkClientState, matchingLinkUpdate, saveTokenLinkFailure } from './token-link-diagnostics.mjs';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


test('B04: GM button, player button and drag/drop place a linked token owned by the player',{timeout:90000},async () => {
  const owner = await pageFor(player), master = await pageFor(gm); await probe(owner,sceneId);
  const c = (await command('character.create',{name:'Place me'},owner)).payload.character;
  for(const p of [master,owner]) {
    await p.getByRole('tab',{name:'Персонажи',exact:true}).click();
    const row=p.locator('.sheet-row').filter({hasText:'Place me'}); await row.waitFor();
    const before=(await scene(p)).tokens.map(t=>t.id);
    await row.getByRole('button',{name:'На карту',exact:true}).click();
    const tok=await until(async()=> (await scene(p)).tokens.find(t=>!before.includes(t.id)&&t.character_id===c.id),'placed token');
    assert.equal(tok.owner_id,c.owner_id);
    assert.ok(await until(()=>p.received.some(m=>m.name==='token.added'&&m.payload.token.id===tok.id&&m.payload.token.owner_id===c.owner_id),`token.added for placed token ${tok.id}`));
  }
  const before=(await scene(master)).tokens.length;
  await master.locator('.sheet-row').filter({hasText:'Place me'}).dragTo(master.locator('.scene'),{targetPosition:{x:250,y:300}});
  const dropped=await until(async()=>{const tokens=(await scene(master)).tokens;return tokens.length===before+1?tokens.at(-1):null;},'native drop token');
  assert.ok(await until(()=>master.received.some(m=>m.name==='token.added'&&m.payload.token.id===dropped.id),`token.added for dropped token ${dropped.id}`));
  assert.equal(dropped.character_id,c.id);assert.equal(dropped.owner_id,c.owner_id);
  await owner.close();await master.close();
});

test('B08/B09: actual dragging keeps distance clear of token card and Alt disables snapping',{timeout:90000},async()=>{
  const p=await pageFor(gm);const c=(await command('character.create',{name:'Drag hero'})).payload.character;
  await command('character.update',{id:c.id,set:{'vitals.hp.current':20,'vitals.hp.max':20,'combat.ac':15}});
  // Place in the viewport centre, so the real DOM card participates in collisions.
  const point=await p.evaluate(()=>window.observedStage.freeCellNearCenter());
  const tok=(await command('token.add',{...point,character_id:c.id})).payload.token;
  await until(()=>stageToken(p,tok.id),'drag token rendered');
  for(const scale of [0.5,1,2]) {
    await command('token.move',{id:tok.id,...point});
    await until(async()=>{const t=await stageToken(p,tok.id);return t?.data.x===point.x&&t?.data.y===point.y;},'reset drag position');
    await p.evaluate(scale=>{const s=window.observedStage;s.zoomBy(scale/s.world.scale.x);},scale);
    const start=await atToken(p,tok.id);
    await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x+90*scale,start.y+70*scale,{steps:5});
    await p.locator('.token-card').waitFor({state:'visible'});
    const label=await p.evaluate(()=>{const s=window.observedStage,r=s.app.canvas.getBoundingClientRect(),b=s.measureLabel.getBounds();return {visible:s.measureLabel.visible,text:s.measureLabel.text,x:r.left+b.x,y:r.top+b.y,width:b.width,height:b.height};});
    assert.equal(label.visible,true);assert.match(label.text,/фт/);
    const card=await p.locator('.token-card').boundingBox();
    assert.ok(label.x+label.width<=card.x||card.x+card.width<=label.x||label.y+label.height<=card.y||card.y+card.height<=label.y,`overlap at zoom ${scale}`);
    assert.ok(label.x>=0&&label.y>=0,'distance is on screen');await p.mouse.up();
    await until(async()=>{const s=await scene(p);const t=s.tokens.find(t=>t.id===tok.id);return t.x!==(point.x)||t.y!==point.y;},'move ack');
    await p.waitForTimeout(400); // avoid interpreting the next drag as a double click
  }
  // Start at the actual current position and use an intentionally non-grid delta.
  const before=(await scene(p)).tokens.find(t=>t.id===tok.id),start=await atToken(p,tok.id);
  await p.keyboard.down('Alt');await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x+38,start.y+26,{steps:5});await p.mouse.up();await p.keyboard.up('Alt');
  const moved=await until(async()=>{const t=(await scene(p)).tokens.find(t=>t.id===tok.id);return t.x!==before.x||t.y!==before.y?t:null;},'free move ack');
  assert.ok(Math.abs(moved.x-(before.x+19))<1&&Math.abs(moved.y-(before.y+13))<1,JSON.stringify({before,moved}));
  assert.notEqual((moved.x-35)%70,0,'not snapped');await p.close();
});

test('B07: deleting a mob detaches the rendered tokens on both connected clients',{timeout:60000},async()=>{
  const master=await pageFor(gm),observer=await pageFor(player);
  const c=(await command('character.create',{name:'Deleted mob',system:'mob'})).payload.character;
  await command('character.update',{id:c.id,set:{'hp.max':9}});
  const token=(await command('token.add',{x:455,y:455,character_id:c.id})).payload.token;
  await until(async()=> (await stageToken(master,token.id))?.hpVisible,'GM sees mob hp');
  await until(()=>stageToken(observer,token.id),'player sees mob token');
  const before=observer.received.length;
  await command('character.delete',{id:c.id});
  for(const p of [master,observer]) await until(async()=>{const t=await stageToken(p,token.id);return t&&t.data.character_id===null&&!t.hpVisible;},'detached live token');
  assert.ok(observer.received.slice(before).some(m=>m.type==='tokens_refresh'));
  assert.ok(observer.received.slice(before).some(m=>m.type==='snapshot'&&m.scene.tokens.some(t=>t.id===token.id&&t.character_id===null&&t.hp===null)));
  await master.close();await observer.close();
});

test('Alpha token settings: linked controls removed without data loss; legacy and unlinked tokens remain usable',{timeout:90000},async()=>{
 const p=await pageFor(gm);const c=(await command('character.create',{name:'Linked legacy'})).payload.character;
 const image=await gm.request.post(`${api}/api/uploads`,{data:await p.locator('canvas').screenshot(),headers:{'Content-Type':'image/png'}});assert.equal(image.status(),200);const url=(await image.json()).url;
 const point=await p.evaluate(()=>window.observedStage.freeCellNearCenter());
 const linked=(await command('token.add',{...point,character_id:c.id,image_url:url})).payload.token;
 await until(()=>stageToken(p,linked.id),'legacy token');await p.evaluate(id=>window.observedStage.select(id),linked.id);
 await p.getByRole('button',{name:'настройки токена',exact:true}).click();
 assert.equal(await p.getByRole('combobox',{name:'Персонаж токена',exact:true}).count(),0);
 assert.equal(await p.locator('.token-card input[type=file]').count(),0);
 assert.equal(await p.getByRole('button',{name:'Сменить картинку',exact:true}).count(),0);
 await p.getByRole('button',{name:'Большой',exact:true}).click();
 await until(async()=> (await scene(p)).tokens.find(t=>t.id===linked.id)?.size===2,'size update');
 const nameInput=p.locator('.token-card-settings form input');await nameInput.fill('Legacy renamed');await nameInput.press('Enter');
 await p.getByRole('checkbox',{name:'Скрыт от игроков',exact:true}).check();
 await until(async()=>{const t=(await scene(p)).tokens.find(t=>t.id===linked.id);return t.name==='Legacy renamed'&&t.layer==='gm';},'name/layer update');
 let token=(await scene(p)).tokens.find(t=>t.id===linked.id);assert.equal(token.image_url,url);assert.equal(token.character_id,c.id);
 await p.getByRole('button',{name:'Открыть лист',exact:true}).click();await p.locator('.sheet').waitFor();await closeSheet(p);
 // Double click still uses the actual Pixi pointer handler.
 const pos=await atToken(p,linked.id);await p.mouse.dblclick(pos.x,pos.y);await p.locator('.sheet').waitFor();await closeSheet(p);
 const plain=(await command('token.add',{x:point.x+210,y:point.y,name:'Plain object'})).payload.token;await until(()=>stageToken(p,plain.id),'plain token');
 await p.evaluate(id=>window.observedStage.select(id),plain.id);await p.getByRole('button',{name:'настройки токена',exact:true}).click();
 assert.equal(await p.locator('.token-card input[type=file]').count(),1);assert.equal(await p.getByRole('combobox',{name:'Персонаж токена',exact:true}).count(),1);
 const receivedStart=await observeTokenLink(p,plain.id);
 try{
  const link=p.getByRole('combobox',{name:'Персонаж токена',exact:true});
  await link.selectOption(c.id);
  const bound=await until(async()=>{const token=(await scene(p)).tokens.find(t=>t.id===plain.id);return token?.character_id===c.id?token:null;},'link existing plain token');
  assert.equal(bound.character_id,c.id);
  // HTTP can observe the commit before token.updated reaches the app and React.
  const update=await until(()=>matchingLinkUpdate(p.received.slice(receivedStart),plain.id,c.id),`link update/snapshot for ${plain.id}`);
  const client=await until(async()=>{
   const state=await tokenLinkClientState(p,plain.id);
   return state.stageAlive&&Number.isInteger(state.socketSequence)&&state.socketSequence>=update.seq&&state.stageToken?.id===plain.id&&state.stageToken.character_id===c.id&&
    state.selected?.id===plain.id&&state.selected.character_id===c.id?state:null;
  },`applied link in SceneSocket, SceneStage and selected for ${plain.id}`);
  assert.equal(client.stageToken.character_id,c.id);assert.equal(client.selected.character_id,c.id);
  await link.waitFor({state:'detached'});
  assert.equal(await p.getByRole('combobox',{name:'Персонаж токена',exact:true}).count(),0);
 }catch(error){
  await saveTokenLinkFailure(p,()=>scene(p),plain.id,c.id,receivedStart,error).catch(diagnostic=>console.error('Token link diagnostics failed:',diagnostic));
  throw error;
 }
 await p.close();
});

test('v012 multi-select: Shift clicks and rectangle, permission-aware Delete/button, fog/removal and snapshot cleanup',{timeout:120000},async()=>{
 const original=sceneId,temp=(await command('scene.create',{name:'Group selection regression'})).payload.id;
 await command('scene.activate',{id:temp});setSceneId(temp);await probe(control,temp);
 try{
  const master=await pageFor(gm),owner=await pageFor(player);await probe(owner,temp);
  const mine=[];for(let i=0;i<6;i++)mine.push((await command('token.add',{x:245+(i%3)*140,y:245+Math.floor(i/3)*140,name:`Group own ${i}`},owner)).payload.token);
  const foreign=(await command('token.add',{x:665,y:245,name:'Foreign protected'})).payload.token;
  const shared=(await command('token.add',{x:665,y:385,name:'Shared editable',owner_id:null})).payload.token;
  const secret=(await command('token.add',{x:595,y:315,name:'Secret group',layer:'gm'})).payload.token;
  await until(()=>stageToken(owner,shared.id),'all group tokens delivered');
  const selected=p=>p.evaluate(()=>[...window.observedStage.selectedIds].sort());
  const click=async(p,t,shift=false)=>{const v=await atToken(p,t.id);if(shift)await p.keyboard.down('Shift');await p.mouse.click(v.x,v.y);if(shift)await p.keyboard.up('Shift');};
  await click(owner,mine[0],true);await click(owner,mine[1],true);assert.deepEqual(await selected(owner),[mine[0].id,mine[1].id].sort());
  await click(owner,mine[1],true);assert.deepEqual(await selected(owner),[mine[0].id]);
  await owner.keyboard.press('Escape');assert.deepEqual(await selected(owner),[]);
  const before=(await scene(owner)).tokens;
  const rectangle=async(p,a,b)=>{
   const points=await p.evaluate(({a,b})=>{const s=window.observedStage,r=s.app.canvas.getBoundingClientRect();return[a,b].map(q=>{const v=s.world.toGlobal(q);return{x:r.left+v.x,y:r.top+v.y};});},{a,b});
   await p.keyboard.down('Shift');await p.mouse.move(points[0].x,points[0].y);await p.mouse.down();await p.mouse.move(points[1].x,points[1].y,{steps:8});await p.mouse.up();await p.keyboard.up('Shift');
  };
  await rectangle(owner,{x:190,y:190},{x:710,y:430});
  const visible=[...mine,foreign,shared].map(t=>t.id).sort();assert.deepEqual(await selected(owner),visible);
  assert.equal(await owner.getByRole('status').filter({hasText:'Выбрано: 8'}).count(),1);
  assert.equal(await owner.getByRole('button',{name:'Удалить выбранные (7)',exact:true}).count(),1);
  assert.deepEqual((await scene(owner)).tokens,before,'selection does not move tokens');
  // Delete in an editor must never delete the selected tokens.
  await owner.locator('.chat-input input').fill('keep text');await owner.locator('.chat-input input').press('Delete');assert.deepEqual((await scene(owner)).tokens,before);
  await owner.locator('.chat-input input').blur();const from=master.received.length,ownerFrom=owner.received.length;
  await owner.keyboard.press('Delete');
  await until(async()=> (await scene(owner)).tokens.filter(t=>visible.includes(t.id)).length===1,'player group removed');
  for(const t of [...mine,shared]){
   await until(()=>owner.received.slice(ownerFrom).some(m=>m.name==='token.removed'&&m.payload.id===t.id),`player receives removal ${t.id}`);
   await until(async()=>await stageToken(owner,t.id)===null,`player renders removal ${t.id}`);
   assert.equal(await stageToken(owner,t.id),null);
   await until(()=>master.received.slice(from).some(m=>m.name==='token.removed'&&m.payload.id===t.id),'GM receives removal');
   await until(async()=>await stageToken(master,t.id)===null,`GM renders removal ${t.id}`);
   assert.equal(await stageToken(master,t.id),null);
  }
  assert.deepEqual((await scene(owner)).tokens.filter(t=>visible.includes(t.id)).map(t=>t.id),[foreign.id]);
  assert.ok(await stageToken(owner,foreign.id));assert.deepEqual(await selected(owner),[foreign.id]);assert.equal(await stageToken(owner,secret.id),null);
  // GM can select and delete both the foreign and hidden token, using the group button.
  await click(master,foreign,true);await click(master,secret,true);
  await master.getByRole('button',{name:'Удалить выбранные (2)',exact:true}).click();await until(async()=> (await scene(master)).tokens.length===0,'GM group removed');
  for(const t of [foreign,secret]) await until(async()=>await stageToken(master,t.id)===null,`GM renders group removal ${t.id}`);
  await until(async()=>await stageToken(owner,foreign.id)===null,'player renders foreign token removed by GM');
  const a=(await command('token.add',{x:245,y:245})).payload.token,b=(await command('token.add',{x:385,y:245})).payload.token;
  await until(()=>stageToken(owner,b.id),'cleanup tokens delivered');await click(owner,a,true);await click(owner,b,true);
  await command('fog.cover',{x:190,y:190,w:250,h:110});await until(async()=>(await selected(owner)).length===0,'fog prunes group');
  await command('fog.clear');await until(()=>stageToken(owner,b.id),'tokens revealed');await click(owner,a,true);await click(owner,b,true);
  await owner.reload();await owner.locator('canvas').waitFor();await until(()=>stageToken(owner,b.id),'snapshot tokens rendered after reload');assert.deepEqual(await selected(owner),[]);
  // A fresh snapshot on the existing stage removes stale IDs while retaining surviving selection.
  await click(master,a,true);await click(master,b,true);
  await master.evaluate(async id=>{const data=await(await fetch(`/api/scenes/${id}`)).json();data.tokens=[];window.observedStage.setSnapshot(data);},temp);
  assert.deepEqual(await selected(master),[]);
  await master.close();await owner.close();
 }finally{
  setSceneId(original);await command('scene.activate',{id:original});await probe(control,original);await command('scene.delete',{id:temp});
 }
});

test('Final preview desktop: real intermediate ghosts, unchanged DB, commit/reject/cancel, disconnect and stale packets',{timeout:120000},async()=>{
 const original=sceneId,temp=(await command('scene.create',{name:'Drag preview regression'})).payload.id;await command('scene.activate',{id:temp});setSceneId(temp);await probe(control,temp);
 try{
  const master=await pageFor(gm),owner=await pageFor(player,{trackSockets:true});
  const ownerId=await owner.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().me.id);
  const upload=await gm.request.post(`${api}/api/uploads`,{data:await master.locator('canvas').screenshot(),headers:{'Content-Type':'image/png'}});const image=(await upload.json()).url;
  const tok=(await command('token.add',{x:245,y:455,owner_id:ownerId,image_url:image})).payload.token;
  await until(async()=> (await stageToken(owner,tok.id))?.imageVisible,'owner portrait loaded');await until(async()=> (await stageToken(master,tok.id))?.imageVisible,'observer portrait loaded');
  const ghosts=p=>p.evaluate(()=>[...window.observedStage.movementPreviews].map(([id,v])=>({id,tokenId:v.tokenId,x:v.image.x,y:v.image.y,step:v.step,image:v.image.visible,width:v.image.texture.width})));
  const begin=async()=>{const at=await atToken(owner,tok.id);await owner.mouse.move(at.x,at.y);await owner.mouse.down();return at;};
  const before=await scene(master),start=await begin();
  for(const p of [master,owner])await p.evaluate(async()=>{window.previewUiUpdates=0;window.offPreviewUi=(await import('/src/state/store.ts')).useUi.subscribe(()=>window.previewUiUpdates++);});
  await owner.mouse.move(start.x+70,start.y,{steps:5});const first=await until(async()=>{const all=await ghosts(master);return all.find(v=>v.tokenId===tok.id&&v.x===315);},'first real preview');assert.equal(first.image,true);assert.ok(first.width>1);
  assert.equal((await stageToken(master,tok.id)).data.x,245);assert.equal((await stageToken(owner,tok.id)).data.x,245);assert.equal(await owner.evaluate(id=>window.observedStage.tokens.get(id).node.x,tok.id),245,'origin stays visible');assert.deepEqual(await scene(master),before);
  await owner.waitForTimeout(2300);assert.equal((await ghosts(master)).length,1,'held drag stays visible beyond expiry through bounded heartbeat');
  await owner.waitForTimeout(130);await owner.mouse.move(start.x+140,start.y,{steps:5});await until(async()=> (await ghosts(master)).some(v=>v.x===385),'second intermediate preview');
  for(const p of [master,owner]){assert.equal(await p.evaluate(()=>window.previewUiUpdates),0,'preview does not update Zustand');await p.evaluate(()=>window.offPreviewUi());}
  await owner.mouse.up();await until(async()=> (await stageToken(master,tok.id))?.data.x===385&&(await ghosts(master)).length===0,'authoritative commit');assert.equal((await scene(master)).seq,before.seq+1);
  await master.evaluate(({id,token})=>window.observedStage.applyTokenPreview({type:'token_preview',id:token,drag_id:id,step:999,base_seq:0,end:false,x:999,y:455}),{id:first.id,token:tok.id});assert.equal((await ghosts(master)).length,0,'closed drag cannot resurrect');
  const wall=(await command('wall.add',{x1:455,y1:420,x2:455,y2:490})).payload.wall;
  const rejected=await begin();await owner.mouse.move(rejected.x+140,rejected.y,{steps:6});await until(async()=> (await ghosts(master)).some(v=>v.x===525),'preview beyond wall');await owner.mouse.up();
  await until(async()=> (await ghosts(master)).length===0,'rejected preview cleared');await until(()=>owner.getByText('стена на пути',{exact:true}).count(),'server movement rejection');assert.equal((await stageToken(master,tok.id)).data.x,385);assert.equal(nextToken(await scene(master),tok.id).x,385);
  await command('wall.remove',{id:wall.id});const cancelled=await begin();await owner.mouse.move(cancelled.x+70,cancelled.y,{steps:5});await until(async()=> (await ghosts(master)).length===1,'cancel ghost started');await owner.keyboard.press('Escape');await owner.mouse.up();await until(async()=> (await ghosts(master)).length===0,'Escape cancels preview');assert.equal(nextToken(await scene(master),tok.id).x,385);
  const disconnected=await begin();await owner.mouse.move(disconnected.x+70,disconnected.y,{steps:5});await until(async()=> (await ghosts(master)).length===1,'disconnect ghost started');const snaps=owner.received.filter(m=>m.type==='snapshot').length;
  await owner.evaluate(()=>window.sceneSockets.find(s=>s.readyState===1).close());await owner.mouse.up();await until(async()=> (await ghosts(master)).length===0,'disconnect clears peer ghost');await until(()=>owner.received.filter(m=>m.type==='snapshot').length>snaps,'fresh reconnect snapshot');assert.equal((await ghosts(owner)).length,0);assert.equal(nextToken(await scene(master),tok.id).x,385);
  for(let i=0;i<3;i++){const x=nextToken(await scene(master),tok.id).x,at=await begin();await owner.mouse.move(at.x+70,at.y,{steps:3});await until(async()=>(await ghosts(master)).some(v=>v.x===x+70),'rapid drag starts');await owner.mouse.up();await until(async()=>nextToken(await scene(master),tok.id).x===x+70&&(await ghosts(master)).length===0,'rapid drag committed');}
  await master.close();await owner.close();
 }finally{setSceneId(original);await command('scene.activate',{id:original});await probe(control,original);await command('scene.delete',{id:temp});}
});

test('Final preview touch and secrecy: touch drag/cancel, GM-layer, fog destination, scene switch',{timeout:120000},async()=>{
 const original=sceneId,temp=(await command('scene.create',{name:'Touch preview privacy'})).payload.id;await command('scene.activate',{id:temp});setSceneId(temp);await probe(control,temp);
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await player.storageState()});
 try{
  const master=await pageFor(gm),owner=await pageFor(context),ownerId=await owner.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().me.id);
  const tok=(await command('token.add',{x:105,y:245,owner_id:ownerId})).payload.token;await until(()=>stageToken(owner,tok.id),'touch token');
  const cdp=await context.newCDPSession(owner),point=await atToken(owner,tok.id);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]});
  await touch('touchStart',point.x,point.y);await touch('touchMove',point.x+70,point.y+70);await until(()=>master.evaluate(()=>window.observedStage.movementPreviews.size===1),'touch preview');assert.equal(nextToken(await scene(master),tok.id).x,105);await touch('touchEnd');await until(async()=>nextToken(await scene(master),tok.id).x===175,'touch commit');
  const q=await atToken(owner,tok.id);await touch('touchStart',q.x,q.y);await touch('touchMove',q.x+70,q.y);await until(()=>master.evaluate(()=>window.observedStage.movementPreviews.size===1),'touch cancel preview');await touch('touchCancel');await until(()=>master.evaluate(()=>window.observedStage.movementPreviews.size===0),'touch cancellation');assert.equal(nextToken(await scene(master),tok.id).x,175);
  const secret=(await command('token.add',{x:525,y:315,layer:'gm'})).payload.token;const seq=(await scene(master)).seq,drag=crypto.randomUUID(),from=owner.received.length;
  await control.evaluate(({id,seq,drag})=>window.probe.send(JSON.stringify({name:'token.preview',payload:{id,base_seq:seq,drag_id:drag,step:1,x:595,y:315}})),{id:secret.id,seq,drag});await until(()=>master.evaluate(id=>window.observedStage.movementPreviews.has(id),drag),'GM sees private ghost');await control.evaluate(()=>window.probe.send(JSON.stringify({name:'chat.say',payload:{text:'private-preview-barrier'}})));await until(()=>owner.received.slice(from).some(m=>m.type==='chat'&&m.message.text==='private-preview-barrier'),'privacy barrier');assert.equal(JSON.stringify(owner.received.slice(from)).includes(secret.id),false);
  await command('fog.cover',{x:210,y:210,w:120,h:120});const visible=(await command('token.add',{x:175,y:175})).payload.token;await until(()=>stageToken(owner,visible.id),'visible NPC outside fog');const fogDrag=crypto.randomUUID(),fogSeq=(await scene(master)).seq,fogStart=owner.received.length;
  await control.evaluate(({id,seq,drag})=>window.probe.send(JSON.stringify({name:'token.preview',payload:{id,base_seq:seq,drag_id:drag,step:1,x:245,y:245}})),{id:visible.id,seq:fogSeq,drag:fogDrag});await until(()=>master.evaluate(id=>window.observedStage.movementPreviews.has(id),fogDrag),'GM ghost inside fog');await control.evaluate(()=>window.probe.send(JSON.stringify({name:'chat.say',payload:{text:'fog-preview-barrier'}})));await until(()=>owner.received.slice(fogStart).some(m=>m.type==='chat'&&m.message.text==='fog-preview-barrier'),'fog barrier');assert.equal(owner.received.slice(fogStart).some(m=>m.type==='token_preview'&&!m.end&&m.drag_id===fogDrag),false);
  await command('fog.clear');const r=await atToken(owner,tok.id);await touch('touchStart',r.x,r.y);await touch('touchMove',r.x+70,r.y);await until(()=>master.evaluate(()=>window.observedStage.movementPreviews.size===1),'before scene switch');
  await owner.evaluate(()=>{window.touchPreviousStage=window.observedStage;});
  const next=(await command('scene.create',{name:'Switch during touch preview'})).payload.id;await command('scene.activate',{id:next});await touch('touchEnd');await until(()=>owner.received.some(m=>m.type==='snapshot'&&m.scene.id===next),'new scene snapshot');
  // A snapshot can arrive while SceneView is replacing its asynchronous renderer.
  // Wait for the new stage, then assert immediately: do not poll the preview away.
  await until(()=>owner.evaluate(()=>window.observedStage?.isAlive && window.observedStage!==window.touchPreviousStage),'new scene renderer');
  assert.equal(await owner.evaluate(()=>window.observedStage.movementPreviews.size),0);await until(()=>master.evaluate(()=>window.observedStage.movementPreviews.size===0),'old scene preview cleared');await command('scene.activate',{id:temp});await command('scene.delete',{id:next});
  await master.close();await owner.close();
 }finally{await context.close();setSceneId(original);await command('scene.activate',{id:original});await probe(control,original);await command('scene.delete',{id:temp});}
});
