import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


test('B12: mobile panels collapse and restore map space',{timeout:90000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await player.storageState()});
  const p=await pageFor(context);const observed=await pageFor(gm);const events=observed.received;
  // Reload observer once so capture attaches to the app connection.
  await observed.reload();await observed.locator('canvas').waitFor();
  const canvas=p.locator('canvas');const initial=(await canvas.boundingBox()).width;
  await p.getByRole('button',{name:'Открыть панели',exact:true}).tap();assert.equal(await p.locator('.sidebar').isVisible(),true);
  await p.getByRole('button',{name:'Свернуть панели',exact:true}).tap();assert.equal(await p.locator('.sidebar').isVisible(),false);
  await p.getByRole('button',{name:'Свернуть инструменты',exact:true}).tap();
  assert.equal(await p.locator('.rail').isVisible(),false);await until(async()=> (await canvas.boundingBox()).width>initial,'map expands');
  await p.getByRole('button',{name:'Инструменты',exact:true}).tap();assert.equal(await p.locator('.rail').isVisible(),true);
  await observed.close();await context.close();
});


test('B11: explicit ping tool on touch device broadcasts to the GM',{timeout:60000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await player.storageState()});
  const observer=await pageFor(gm),p=await pageFor(context);
  const before=observer.received.length;
  await p.getByRole('button',{name:'Пинг',exact:true}).tap();
  await p.locator('canvas').tap({position:{x:150,y:200}});
  const ping=await until(()=>observer.received.slice(before).find(m=>m.type==='ping'&&m.author==='Regression player'),'touch ping delivery');
  assert.ok(Number.isFinite(ping.x)&&Number.isFinite(ping.y));
  await context.close();await observer.close();
});

test('Alpha tools: capabilities instead of width; player creation removed, ruler/GM tools and Alt ping work',{timeout:90000},async()=>{
 const mouse=await browser.newContext({viewport:{width:360,height:850},hasTouch:false,storageState:await player.storageState()});const p=await pageFor(mouse);
 assert.equal(await p.getByRole('button',{name:'Пинг',exact:true}).count(),0);
 assert.equal(await p.getByRole('button',{name:'Токен',exact:true}).count(),0);
 await p.getByRole('button',{name:'Линейка',exact:true}).click();const r=await p.locator('canvas').boundingBox();
 await p.mouse.move(r.x+100,r.y+100);await p.mouse.down();await p.mouse.move(r.x+180,r.y+160,{steps:4});
 assert.equal(await p.evaluate(()=>window.observedStage.measureLabel.visible),true);await p.mouse.up();
 await p.getByRole('button',{name:'Выбор',exact:true}).click();const prior=control.received.length;
 await p.keyboard.down('Alt');await p.locator('canvas').click({position:{x:170,y:220}});await p.keyboard.up('Alt');
 await until(()=>control.received.slice(prior).find(m=>m.type==='ping'&&m.author==='Regression player'),'desktop Alt ping');
 await mouse.close();
 const touch=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,storageState:await gm.storageState()});const g=await pageFor(touch,{trackSockets:true});
 assert.equal(await g.getByRole('button',{name:'Пинг',exact:true}).count(),1);
 assert.equal(await g.getByRole('button',{name:'Выбор',exact:true}).count(),1);
 for(const label of ['Токен','Стены и двери','Стереть','Туман'])assert.equal(await g.getByRole('button',{name:label,exact:true}).count(),1);
 assert.notEqual(await g.getByRole('button',{name:'Пинг',exact:true}).locator('path').getAttribute('d'),await g.getByRole('button',{name:'Выбор',exact:true}).locator('path').getAttribute('d'));
 // Real canvas clicks and a real WS reconnect must not connect to the old endpoint.
 await g.getByRole('button',{name:'Стены и двери',exact:true}).click();
 const before=(await scene(g)).walls.length;
 await g.locator('canvas').click({position:{x:140,y:140}});
 await g.locator('canvas').click({position:{x:210,y:140}});
 await until(async()=> (await scene(g)).walls.length===before+1,'confirmed wall');
 assert.notEqual(await g.evaluate(()=>window.observedStage.wallStart),null);
 const snapshots=g.received.filter(m=>m.type==='snapshot').length;
 let releaseReconnect;
 const reconnectGate=new Promise(resolve=>{releaseReconnect=resolve;});
 await g.routeWebSocket('**/ws/scene/**',async ws=>{await reconnectGate;ws.connectToServer();});
 await g.evaluate(()=>new Promise(resolve=>{const ws=window.sceneSockets.find(s=>s.readyState===1);ws.addEventListener('close',()=>resolve(),{once:true});ws.close();}));
 assert.equal(await g.evaluate(()=>window.observedStage.disconnected),true);
 await g.locator('canvas').click({position:{x:280,y:280}});
 assert.equal(await g.evaluate(()=>window.observedStage.wallStart),null,'offline click cannot start a wall');
 releaseReconnect();
 await until(()=>g.received.filter(m=>m.type==='snapshot').length>snapshots,'wall reconnect snapshot');
 assert.equal(await g.evaluate(()=>window.observedStage.wallStart),null);
 assert.equal((await scene(g)).walls.length,before+1,'confirmed geometry survives');
 await g.locator('canvas').click({position:{x:280,y:210}});
 assert.equal((await scene(g)).walls.length,before+1,'first reconnect click starts a new chain');
 await g.locator('canvas').click({position:{x:350,y:210}});
 await until(async()=> (await scene(g)).walls.length===before+2,'second click creates one segment');
 await g.keyboard.press('Escape');
 assert.equal(await g.evaluate(()=>window.observedStage.wallStart),null);
 await touch.close();
});
