// Standalone opt-in probe, outside required manifest pending Owner approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId,
  command, probe, pageFor, until, stageToken, atToken } from './fixture.mjs';

assert.equal(process.env.LANTERNA_EXPERIMENTAL_VISIBILITY, '1', 'explicit experimental backend flag required');

test('Gameplay LOS: real GM door click, two personal players, media revoke and reconnect', {timeout:120000}, async () => {
  const invite = await command('invite.create');
  const second = await browser.newContext({viewport:{width:1280,height:900}});
  const accepted = await second.request.post(`${api}/api/invite/accept`, {data:{
    token:invite.payload.token, name:'LOS second player', password:randomUUID()}});
  assert.equal(accepted.status(), 200);
  const seeds = [];
  for (const [index, context] of [player, second].entries()) {
    const seed = await context.newPage(); await seed.goto(`${base}/api/health`); await probe(seed, sceneId);
    const character = (await command('character.create', {name:`LOS PC ${index}`}, seed)).payload.character;
    const token = (await command('token.add', {character_id:character.id, x:index ? 400 : 100, y:index ? 400 : 200}, seed)).payload.token;
    seeds.push(token); await seed.close();
  }
  const portrait = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  const uploaded = await gm.request.post(`${api}/api/uploads`, {data:portrait, headers:{'Content-Type':'image/png'}});
  assert.equal(uploaded.status(), 200); const url = (await uploaded.json()).url;
  const character = (await command('character.create', {name:'LOS private NPC', system:'mob'})).payload.character;
  await command('character.update', {id:character.id, set:{portrait:url, 'hp.max':15}});
  const npc = (await command('token.add', {character_id:character.id, x:400, y:200})).payload.token;
  const door = (await command('wall.add', {x1:250,y1:100,x2:250,y2:300,kind:'door'})).payload.wall;
  await command('wall.add', {x1:250,y1:0,x2:250,y2:100});
  await command('wall.add', {x1:250,y1:300,x2:250,y2:1000});
  const master = await pageFor(gm), left = await pageFor(player), right = await pageFor(second);
  for (const p of [master,left,right]) await p.evaluate(() => {
    const stage = window.observedStage; stage.world.scale.set(1); stage.world.position.set(100,100);
  });
  await until(() => stageToken(master,npc.id), 'GM NPC');
  await until(() => stageToken(right,npc.id), 'second player personal LOS');
  assert.equal(await stageToken(left,npc.id), null);
  assert.equal(JSON.stringify(left.received).includes(npc.id), false, 'hidden ID never reached this browser');
  assert.equal((await left.request.get(`${api}${url}`)).status(),404);
  assert.equal((await right.request.get(`${api}${url}`)).status(),200);
  const sheets=await left.request.get(`${api}/api/characters`);
  assert.equal(sheets.status(),200);
  assert.equal(JSON.stringify(await sheets.json()).includes(character.id),false,'NPC sheet is private even when its token is visible');

  const clickDoor = async () => {
    const point = await master.evaluate(() => {
      const s=window.observedStage, p=s.world.toGlobal({x:250,y:200}), r=s.app.canvas.getBoundingClientRect();
      return {x:r.left+p.x,y:r.top+p.y};
    });
    await master.mouse.click(point.x, point.y);
  };
  const visible = async (p, expected) => until(async () => Boolean(await stageToken(p,npc.id)) === expected,
    `NPC ${expected ? 'visible' : 'absent'} in real Pixi stage`);
  await clickDoor(); await visible(left,true);
  assert.equal((await left.request.get(`${api}${url}`)).status(),200);
  const ownPoint=await atToken(left,seeds[0].id); await left.mouse.click(ownPoint.x,ownPoint.y);
  await left.locator('.token-card').waitFor();
  assert.equal((await stageToken(left,seeds[0].id)).data.owner_id,seeds[0].owner_id);
  const before = left.received.length;
  await clickDoor(); await visible(left,false);
  assert.equal((await left.request.get(`${api}${url}`, {headers:{Range:'bytes=0-8'}})).status(),404);
  assert.equal(JSON.stringify(left.received.slice(before)).includes('LOS private NPC'),false,'close never sends a private NPC payload');
  await visible(master,true); await visible(right,true);
  await left.reload();
  await until(() => left.evaluate(() => window.observedStage?.isAlive), 'reconnected scene stage');
  await until(() => stageToken(left,seeds[0].id), 'own PC after reconnect');
  assert.equal(await stageToken(left,npc.id),null);
  await command('wall.door', {id:door.id,state:'locked'});
  await visible(left,false);
  await command('wall.door', {id:door.id,state:'open'});
  await visible(left,true);
  await command('wall.door', {id:door.id,state:'closed'});
  await visible(left,false);
  // W3 server contract over real WS: glass reveals, opacity revokes; personal views remain separate.
  await command('wall.update',{id:door.id,kind:'window',blocks_sight:false,blocks_movement:true});
  await visible(left,true); await visible(right,true);
  assert.equal((await left.request.get(`${api}${url}`)).status(),200);
  await command('wall.update',{id:door.id,blocks_sight:true});
  await visible(left,false); await visible(right,true);
  assert.equal((await left.request.get(`${api}${url}`,{headers:{Range:'bytes=0-8'}})).status(),404);
  await command('wall.update',{id:door.id,kind:'door',door_state:'closed'});
  await visible(left,false);
  const otherScene=(await command('scene.create',{name:'LOS empty scene'})).payload.id;
  await command('scene.activate',{id:otherScene});
  await until(()=>left.received.some(m=>m.type==='snapshot'&&m.scene.id===otherScene),'player follows active scene');
  await until(async()=>!(await stageToken(left,seeds[0].id)),'old scene PC removed');
  assert.equal(await stageToken(left,npc.id),null);
  assert.equal((await left.request.get(`${api}/api/scenes/${sceneId}`)).status(),404,'old scene cannot bypass active-scene access');
  await command('scene.activate',{id:sceneId});
  await until(()=>stageToken(left,seeds[0].id),'own PC restored in original scene');
  assert.equal(await stageToken(left,npc.id),null,'scene switch never restores hidden NPC');
});
