import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


test('B06: portrait edits and mob deletion update both live scenes after automatic reconnect',{timeout:90000},async()=>{
  const early=(await command('token.add',{x:105,y:105,name:'Buffered session token'})).payload.token;
  const master=await pageFor(gm,{trackSockets:true,beforeStageMount:async p=>{
    const start=p.received.length;
    await command('token.move',{id:early.id,x:175,y:105});
    await command('token.move',{id:early.id,x:245,y:175});
    await until(()=>p.received.slice(start).filter(m=>m.name==='token.moved'&&m.payload.id===early.id).length===2,'ordered events arrive before mount');
    assert.equal(await p.locator('canvas').count(),0);
  }}), observer=await pageFor(player);const frames=observer.received;
  await until(async()=>{const t=await stageToken(master,early.id);return t?.data.x===245&&t.data.y===175;},'snapshot then ordered events replay after mount');
  assert.equal(await master.evaluate(()=>window.observedStages.filter(s=>s.isAlive&&s.app.canvas.isConnected).length),1,'one live renderer');
  assert.equal(await master.evaluate(()=>window.sceneSockets.filter(s=>s.readyState===1).length),1,'one live app connection');
  const firstSocket=await master.evaluate(()=>window.sceneSockets.findIndex(s=>s.readyState===1));
  const c=(await command('character.create',{name:'Portrait mob',system:'mob'})).payload.character;
  await command('character.update',{id:c.id,set:{'hp.max':8}});
  // Upload a real PNG through the application endpoint (not a synthetic URL).
  const png=await master.locator('canvas').screenshot();
  const upload=await gm.request.post(`${api}/api/uploads`,{data:png,headers:{'Content-Type':'image/png'}});assert.equal(upload.status(),200);const url=(await upload.json()).url;
  const plain=(await command('token.add',{x:245,y:245,character_id:c.id})).payload.token;
  const own=(await command('token.add',{x:385,y:245,character_id:c.id,image_url:url})).payload.token;
  await command('character.update',{id:c.id,set:{portrait:url}});
  for(const p of [master,observer]) await until(async()=> (await stageToken(p,plain.id))?.image===url && (await stageToken(p,plain.id))?.imageVisible,'portrait texture rendered');
  assert.ok(frames.some(m=>m.type==='tokens_refresh'));
  assert.equal(frames.some(m=>m.type==='character'&&m.character.id===c.id),false,'mob sheet stays private');
  assert.ok(frames.some(m=>m.type==='snapshot'&&m.scene.tokens.some(t=>t.id===plain.id&&t.portrait_url===url)));
  await command('character.update',{id:c.id,set:{portrait:null}});
  for(const p of [master,observer]) {
    await until(async()=> (await stageToken(p,plain.id))?.image===null,'portrait cleared');
    assert.equal((await stageToken(p,own.id)).image,url,'own image preserved');
  }
  await until(()=>master.evaluate(id=>window.observedStage.tokens.has(id),plain.id),'master token');
  await master.evaluate(id=>window.observedStage.select(id),plain.id);
  assert.equal((await stageToken(master,plain.id)).hpVisible,true);
  await command('character.delete',{id:c.id});
  for(const p of [master,observer]) await until(async()=>{const t=await stageToken(p,plain.id);return t&&t.data.character_id===null&&!t.hpVisible;},'detached rendered token');
  assert.equal((await stageToken(observer,own.id)).image,url);
  assert.ok(frames.some(m=>m.type==='snapshot'&&m.scene.tokens.some(t=>t.id===plain.id&&t.character_id===null&&t.hp===null)));
  assert.equal(await master.evaluate(i=>window.sceneSockets[i].readyState,firstSocket),3,'old connection closed after resync');
  assert.equal(await master.evaluate(()=>window.sceneSockets.filter(s=>s.readyState===1).length),1,'reconnect leaves one live connection');
  await master.close();await observer.close();
});
