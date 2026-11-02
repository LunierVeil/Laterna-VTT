import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


test('B06: portrait edits and mob deletion update both live scenes after automatic reconnect',{timeout:90000},async()=>{
  const master=await pageFor(gm), observer=await pageFor(player);const frames=observer.received;
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
  await master.close();await observer.close();
});
