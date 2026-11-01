import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const web = resolve(import.meta.dirname, '../..'), root = resolve(web, '..');
let browser, server, vite, dir, base, api, gm, player, sceneId, control;
const errors = [];
async function port() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const n = s.address().port; await new Promise(r => s.close(r)); return n;
}
async function until(fn, label, timeout = 12000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw Error(`Timeout: ${label}; last=${JSON.stringify(value)}`);
}
async function ready(url) { await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, url, 20000); }
async function probe(page, sid) {
  await page.evaluate(async sid => {
    window.probe?.close(); window.delivered = [];
    const ws = window.probe = new WebSocket(`ws://${location.host}/ws/scene/${sid}`);
    ws.onmessage = e => window.delivered.push(JSON.parse(e.data));
    await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
  }, sid);
  await until(() => page.evaluate(() => delivered.some(m => m.type === 'snapshot')), 'probe snapshot');
}
async function command(name, payload = {}, page = control) {
  const id = randomUUID();
  await page.evaluate(({id,name,payload}) => {window.delivered=[];probe.send(JSON.stringify({id,name,payload}));}, {id,name,payload});
  const result = await until(() => page.evaluate(({id,name,payload}) => delivered.find(m => m.cmd_id === id ||
    (['character.update','character.list'].includes(name) && m.type === 'character' && m.character.id === payload.id) ||
    (name === 'character.delete' && m.type === 'character_deleted' && m.id === payload.id)), {id,name,payload}), name);
  assert.notEqual(result.type, 'error', JSON.stringify(result)); return result;
}
async function pageFor(context) {
  const p = await context.newPage(); p.received=capture(p); p.setDefaultTimeout(8000); p.on('pageerror', e => errors.push(e.message));
  if(sceneId) await p.addInitScript(id=>localStorage.setItem('lanterna.gmScene',id),sceneId);
  await p.route('**/src/main.tsx', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({response, body: `import {SceneStage as ObservedStage} from '/src/scene/stage.ts';
const originalMount=ObservedStage.prototype.mount;
window.observedStages=[];
Object.defineProperty(window,'observedStage',{get:()=>window.observedStages.findLast(s=>s.isAlive&&s.app.canvas.isConnected)});
ObservedStage.prototype.mount=async function(...args){await originalMount.apply(this,args);window.observedStages.push(this);};
` + source});
  });
  await p.goto(base); await p.locator('canvas').waitFor();
  await until(() => p.evaluate(async () => (await import('/src/state/store.ts')).useUi.getState().connected && window.observedStage?.isAlive), 'app connected');
  return p;
}
async function openSheet(p, id) {
  await p.evaluate(async id => (await import('/src/state/store.ts')).useUi.getState().openCharacter(id), id);
  await p.locator('.sheet').waitFor();
}
async function closeSheet(p) { await p.locator('.sheet').getByRole('button', {name: 'Закрыть', exact: true}).click(); }
async function scene(p) { return (await p.request.get(`${api}/api/scenes/${sceneId}`)).json(); }
function capture(p) {
  const messages = []; p.on('websocket', ws => ws.on('framereceived', frame => { try { messages.push(JSON.parse(String(frame.payload))); } catch {} }));
  return messages;
}
before(async () => {
  dir = await mkdtemp(resolve(tmpdir(), 'laterna-regression-'));
  const apiPort = await port(), webPort = await port(); api = `http://127.0.0.1:${apiPort}`; base = `http://127.0.0.1:${webPort}`;
  const key = randomUUID(); await writeFile(resolve(dir, 'key'), key, {mode: 0o600});
  server = spawn(resolve(root, 'server/.venv/bin/uvicorn'), ['app.main:app','--host','127.0.0.1','--port',String(apiPort),'--no-proxy-headers'], {
    cwd: resolve(root,'server'), env: {...process.env, DATABASE_URL:`sqlite+aiosqlite:///${dir}/test.db`, UPLOAD_DIR:resolve(dir,'uploads'), GM_KEY_FILE:resolve(dir,'key'), FRONTEND_URL:base}, stdio: ['ignore','pipe','pipe']});
  let logs = ''; server.stderr.on('data', x => logs += x); server.stdout.resume();
  vite = spawn(process.execPath, [resolve(web,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(webPort),'--strictPort'], {cwd:web,env:{...process.env,VITE_API_TARGET:api},stdio:'ignore'});
  await ready(`${api}/api/health`); await ready(base);
  browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
  gm = await browser.newContext({viewport:{width:1280,height:900}});
  const login = await gm.request.post(`${api}/api/gm/login`, {data:{key,name:'Regression GM',password:randomUUID()}}); assert.equal(login.status(),200);
  // Cookie hostname is shared by API and Vite; ports do not scope cookies.
  control = await pageFor(gm); sceneId = (await (await gm.request.get(`${api}/api/campaign`)).json()).active_scene_id; await probe(control,sceneId);
  const inv = await command('invite.create');
  player = await browser.newContext({viewport:{width:1280,height:900}});
  const accepted = await player.request.post(`${api}/api/invite/accept`,{data:{token:inv.payload.token,name:'Regression player',password:randomUUID()}}); assert.equal(accepted.status(),200);
  // Execute the repository's smoke test against this isolated live server.
  const script = `import asyncio,sys,smoke_test; smoke_test.BASE=${JSON.stringify(api)}; smoke_test.WS=${JSON.stringify(api.replace('http','ws'))}; sys.exit(asyncio.run(smoke_test.main()))`;
  const smoke = spawn(resolve(root,'server/.venv/bin/python'),['-c',script],{cwd:resolve(root,'server'),env:{...process.env, DATABASE_URL:`sqlite+aiosqlite:///${dir}/test.db`,GM_KEY_FILE:resolve(dir,'key'),LANTERNA_GM_KEY:key},stdio:['ignore','pipe','pipe'],timeout:30000});
  let smokeLog='';smoke.stdout.on('data',x=>smokeLog+=x);smoke.stderr.on('data',x=>smokeLog+=x);
  const code=await new Promise(r=>smoke.on('exit',r)); assert.equal(code,0,smokeLog); console.log('Repository smoke_test.py: passed');
}, {timeout:60000});
after(async () => {
  await browser?.close();
  for(const p of [vite,server]) if(p && p.exitCode===null) {p.kill('SIGTERM'); await new Promise(r=>{p.once('exit',r);setTimeout(()=>{p.kill('SIGKILL');r();},3000).unref();});}
  if(dir) await rm(dir,{recursive:true,force:true});
  assert.deepEqual(errors,[], 'browser page errors');
});

afterEach(async t=>{
  const out=process.env.BROWSER_RESULTS_DIR||resolve(tmpdir(),'laterna-browser-results');
  await mkdir(out,{recursive:true});
  let i=0;for(const ctx of browser?.contexts()??[]) for(const p of ctx.pages()) if(p!==control) await p.screenshot({path:resolve(out,t.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+(++i)+'.png'),timeout:2000}).catch(()=>{});
  for(const ctx of browser?.contexts()??[]) for(const p of ctx.pages()) if(p!==control) await p.close();
  if(control&&!control.isClosed())await command('scene.activate',{id:sceneId});
});

test('B03: open PC and mob sheets retain geometry without overlaps after a scene switch',{timeout:120000},async () => {
  const p = await pageFor(gm);
  for(const system of ['dnd5e','mob']) {
    const c = (await command('character.create',{name:`Layout ${system}`,system})).payload.character;
    await until(() => p.evaluate(async id => !!(await import('/src/state/store.ts')).useUi.getState().characters[id],c.id),'sheet delivered');
    if(system==='dnd5e') {
      await command('character.list',{id:c.id,path:'weapons',op:'add',item:{name:'Long weapon name',attack:5,damage:'1d8+3'}});
      await command('character.list',{id:c.id,path:'equipment',op:'add',item:{name:'Travel equipment',qty:3,weight:2}});
    }
    await openSheet(p,c.id);
    const blocks = await p.locator('.sheet-block').evaluateAll(es=>es.map(e=>({x:e.offsetLeft,y:e.offsetTop,w:e.offsetWidth,h:e.offsetHeight})));
    const next = (await command('scene.create',{name:`Layout scene ${system}`})).payload.id;
    await p.getByRole('tab',{name:'Сцены',exact:true}).click();
    await p.locator('.scene-row').filter({hasText:`Layout scene ${system}`}).getByRole('button',{name:'Открыть',exact:true}).click();
    await until(() => p.evaluate(async () => (await import('/src/state/store.ts')).useUi.getState().sceneName.startsWith('Layout scene')), 'scene switched');
    assert.deepEqual(await p.locator('.sheet-block').evaluateAll(es=>es.map(e=>({x:e.offsetLeft,y:e.offsetTop,w:e.offsetWidth,h:e.offsetHeight}))),blocks);
    const overlaps=await p.locator('.sheet-block').evaluateAll(es=>es.some((a,i)=>es.slice(i+1).some(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.width&&x.height&&y.width&&y.height&&x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;})));
    assert.equal(overlaps,false,'sheet blocks overlap after scene switch');
    await closeSheet(p); await p.setViewportSize({width:1280,height:900});
    await p.getByRole('tab',{name:'Сцены',exact:true}).click();
    // Return via campaign's initial scene, without reloading the page.
    await p.locator('.scene-row').filter({has: p.locator(`[title="${(await scene(p)).name}"]`)}).getByRole('button',{name:'Открыть',exact:true}).click();
    await command('scene.delete',{id:next});
  }
  await p.close();
});

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
    assert.ok(p.received.some(m=>m.name==='token.added'&&m.payload.token.id===tok.id&&m.payload.token.owner_id===c.owner_id));
  }
  const before=(await scene(master)).tokens.length;
  await master.locator('.sheet-row').filter({hasText:'Place me'}).dragTo(master.locator('.scene'),{targetPosition:{x:250,y:300}});
  const dropped=await until(async()=>{const tokens=(await scene(master)).tokens;return tokens.length===before+1?tokens.at(-1):null;},'native drop token');
  assert.ok(master.received.some(m=>m.name==='token.added'&&m.payload.token.id===dropped.id));
  assert.equal(dropped.character_id,c.id);assert.equal(dropped.owner_id,c.owner_id);
  await owner.close();await master.close();
});

test('B05: damage from sheet and token card consumes temporary hp and broadcasts the remainder',{timeout:90000},async () => {
  const p=await pageFor(gm);const c=(await command('character.create',{name:'Damage hero'})).payload.character;
  const set={'vitals.hp.current':20,'vitals.hp.max':20,'vitals.hp.temp':10};await command('character.update',{id:c.id,set});
  await until(()=>p.evaluate(async id=>(await import('/src/state/store.ts')).useUi.getState().characters[id]?.data.vitals?.hp?.temp===10,c.id),'hp delivered');
  await openSheet(p,c.id);const input=p.getByRole('textbox',{name:'изменить хиты на',exact:true});await input.fill('-4');await input.press('Enter');
  await until(()=>p.evaluate(async id=>{const h=(await import('/src/state/store.ts')).useUi.getState().characters[id]?.data.vitals.hp;return h.current===20&&h.temp===6;},c.id),'sheet damage');
  await closeSheet(p);
  const tok=(await command('token.add',{x:315,y:315,character_id:c.id})).payload.token;
  // Select via the UI store (same selection consumed by TokenCard); damage still uses real controls and WS.
  await until(() => p.evaluate(id => window.observedStage.tokens.has(id),tok.id),'token rendered');
  await p.evaluate(id=>window.observedStage.select(id),tok.id);
  await p.locator('.token-card').waitFor();const damage=p.locator('.token-card').getByRole('textbox',{name:'изменить хиты на',exact:true});
  await damage.fill('-9');await damage.press('Enter');
  await until(()=>p.evaluate(async id=>{const h=(await import('/src/state/store.ts')).useUi.getState().characters[id]?.data.vitals.hp;return h.current===17&&h.temp===0;},c.id),'token card damage');await p.close();
});

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

async function stageToken(p,id) { return p.evaluate(id=>{const v=window.observedStage?.tokens.get(id);return v ? {data:v.data,image:v.imageUrl,hpVisible:v.hpText.visible,imageVisible:v.image.visible,textureWidth:v.image.texture.width} : null;},id); }
async function atToken(p,id) {
  return p.evaluate(id=>{const s=window.observedStage,v=s.tokens.get(id),r=s.app.canvas.getBoundingClientRect(),g=v.node.getGlobalPosition();return {x:r.left+g.x,y:r.top+g.y};},id);
}

test('B01/B02: live player renders fog events and the correct snapshot when GM changes scene',{timeout:90000},async()=>{
  const p=await pageFor(player);const frames=p.received;
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
  await command('scene.activate',{id:next});
  await until(()=>frames.some(m=>m.type==='snapshot'&&m.scene.id===next),'destination snapshot');
  await until(()=>stageToken(p,visible.id),'destination visible token');
  assert.equal(await stageToken(p,hidden.id),null);assert.equal(await stageToken(p,tok.id),null);
  assert.ok(frames.some(m=>m.type==='snapshot'&&m.scene.id===next&&m.scene.fog.length));
  await command('scene.activate',{id:sceneId});await until(()=>stageToken(p,tok.id),'return to first scene');
  await command('scene.delete',{id:next});await prep.close();await p.close();
});

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


test('B10: populated PC and mob sheets fit every mobile tab in view and edit modes',{timeout:120000},async()=>{
  const p=await pageFor(gm),failures=[];
  for(const system of ['dnd5e','mob']) {
    const c=(await command('character.create',{name:`Mobile ${system}`,system})).payload.character;
    if(system==='dnd5e') {
      await command('character.list',{id:c.id,path:'weapons',op:'add',item:{name:'Long weapon name',attack:5,damage:'1d8+3'}});
      await command('character.list',{id:c.id,path:'equipment',op:'add',item:{name:'Travel equipment',qty:3,weight:2}});
    }
    await until(()=>p.evaluate(async id=>!!(await import('/src/state/store.ts')).useUi.getState().characters[id],c.id),'mobile sheet delivered');
    await openSheet(p,c.id);
    for(const width of [360,390,430,768,1024,1280]) {
      await p.setViewportSize({width,height:850});
      const bounds=await p.locator('.sheet').boundingBox();
      // Preserve the original fullscreen requirement on phones; desktop is a modal beside the chat.
      if(width<=760 && bounds.width<width-4)failures.push({system,width,reason:'not full width'});
      if(bounds.x<0 || bounds.x+bounds.width>width+1)failures.push({system,width,reason:'outside viewport'});
      for(const edit of [false,true]) {
        if(edit)await p.locator('.sheet').getByRole('button',{name:'Редактировать',exact:true}).click();
        for(const tab of await p.locator('.sheet-tab').all()) {
          await tab.click();
          const overflows=await p.locator('.sheet').evaluate(e=>[e,...e.querySelectorAll('.sheet-table-wrap')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>({class:x.className,width:x.clientWidth,scroll:x.scrollWidth})));
          if(overflows.length)failures.push({system,width,edit,tab:await tab.textContent(),overflows});
        }
        if(edit)await p.locator('.sheet').getByRole('button',{name:'Готово',exact:true}).click();
      }
    }
    await closeSheet(p);await p.setViewportSize({width:1280,height:900});
  }
  assert.deepEqual(failures,[],JSON.stringify(failures));await p.close();
});

test('Alpha layout: empty/populated PC and mob, view/edit, six widths; controls stay inside cards',{timeout:240000},async()=>{
 const p=await pageFor(gm),issues=[];
 for(const system of ['dnd5e','mob'])for(const filled of [false,true]){
  const c=(await command('character.create',{name:`Alpha ${system} ${filled}`,system})).payload.character;
  if(filled){
   const set={proficiency:3,'vitals.hp.current':19,'vitals.hp.max':25,'vitals.ac':16,'hp.max':20,ac:14,kind:'Гуманоид',size:'Средний',senses:'Тёмное зрение 60 фт',languages:'Общий, драконий',defenses:'Сопротивление огню, иммунитет к яду',saves_skills:'Лов +4, Скрытность +6'};
   for(const a of ['str','dex','con','int','wis','cha']){set[`abilities.${a}.score`]=16;set[`abilities.${a}.save`]=2;set[`abilities.${a}.save_bonus`]=6;}
   await command('character.update',{id:c.id,set});
   await command('character.list',{id:c.id,path:system==='mob'?'attacks':'weapons',op:'add',item:{name:'Длинное название оружия',attack:5,damage:'1d8+3',type:'Колющий'}});
  }
  await until(()=>p.evaluate(async id=>!!(await import('/src/state/store.ts')).useUi.getState().characters[id],c.id),'alpha sheet');
  await openSheet(p,c.id);await p.locator('.sheet').getByRole('tab',{name:'Главное',exact:true}).click();
  if(system==='dnd5e')assert.equal(await p.locator('.sheet').getByRole('tab',{name:'Навыки',exact:true}).count(),0);
  for(const width of [360,390,430,768,1024,1280]){
   await p.setViewportSize({width,height:900});
   for(const edit of [false,true]){
    if(edit)await p.locator('.sheet').getByRole('button',{name:'Редактировать',exact:true}).click();
    const geometry=await p.locator('.sheet').evaluate(sheet=>{
     const blocks=[...sheet.querySelectorAll('.sheet-body .sheet-block')];
     const rect=e=>e.getBoundingClientRect();
     const overlaps=blocks.flatMap((a,i)=>blocks.slice(i+1).filter(b=>{const x=rect(a),y=rect(b);return x.left<y.right-1&&x.right>y.left+1&&x.top<y.bottom-1&&x.bottom>y.top+1;}).map(b=>[a.querySelector('h3')?.textContent,b.querySelector('h3')?.textContent]));
     const escaped=[...sheet.querySelectorAll('.sheet-body input,.sheet-body select,.sheet-body button,.sheet-ability,.view-ability,.ability-group')].filter(e=>{
      const parent=e.closest('.ability-group')??e.closest('.sheet-block');if(!parent)return false;const a=rect(e),b=rect(parent);return a.width>0&&a.height>0&&(a.left<b.left-1||a.right>b.right+1||a.top<b.top-1||a.bottom>b.bottom+1);
     }).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),class:e.className}));
     return {overlaps,escaped,overflow:sheet.scrollWidth>sheet.clientWidth+1,abilities:sheet.querySelectorAll('.ability-group,.sheet-ability,.view-ability').length};
    });
    if(geometry.overlaps.length||geometry.escaped.length||geometry.overflow||geometry.abilities!==6)issues.push({system,filled,width,edit,...geometry});
    if(edit)await p.locator('.sheet').getByRole('button',{name:'Готово',exact:true}).click();
   }
  }
  await closeSheet(p);await p.setViewportSize({width:1280,height:900});
 }
 assert.deepEqual(issues,[],JSON.stringify(issues));await p.close();
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
 const touch=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,storageState:await gm.storageState()});const g=await pageFor(touch);
 assert.equal(await g.getByRole('button',{name:'Пинг',exact:true}).count(),1);
 assert.equal(await g.getByRole('button',{name:'Выбор',exact:true}).count(),1);
 for(const label of ['Токен','Стены и двери','Стереть','Туман'])assert.equal(await g.getByRole('button',{name:label,exact:true}).count(),1);
 assert.notEqual(await g.getByRole('button',{name:'Пинг',exact:true}).locator('path').getAttribute('d'),await g.getByRole('button',{name:'Выбор',exact:true}).locator('path').getAttribute('d'));
 await touch.close();
});

test('Alpha chat: open, hide from chat, return, preserve draft; rotate and resize canvas',{timeout:90000},async()=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await player.storageState()});const p=await pageFor(context);
 const open=p.getByRole('button',{name:'Открыть панели',exact:true});await open.tap();
 const chat=p.locator('.chat');const input=chat.locator('input,textarea').last();await input.fill('Черновик после сворачивания');
 await p.getByRole('button',{name:'Скрыть чат',exact:true}).tap();assert.equal(await p.locator('.sidebar').isVisible(),false);
 const b=await open.boundingBox();assert.ok(b.width>=44&&b.height>=44);await open.tap();
 assert.equal(await input.inputValue(),'Черновик после сворачивания');
 await p.getByRole('button',{name:'Скрыть чат',exact:true}).tap();
 for(const viewport of [{width:844,height:390},{width:390,height:844},{width:1024,height:768},{width:360,height:850}]){
  await p.setViewportSize(viewport);await open.tap();await p.getByRole('button',{name:'Скрыть чат',exact:true}).tap();
  await until(()=>p.evaluate(()=>{const c=document.querySelector('.scene'),r=c.getBoundingClientRect();return window.observedStage.app.screen.width===Math.round(r.width)&&Math.abs(window.observedStage.app.screen.height-r.height)<1;}),'canvas follows container');
 }
 await context.close();
});

test('Alpha skills: grouped main controls, expertise/manual/automatic bonuses, search and server rolls preserve data',{timeout:90000},async()=>{
 const p=await pageFor(gm);const c=(await command('character.create',{name:'Skills preserved'})).payload.character;
 await command('character.update',{id:c.id,set:{'abilities.str.score':18,'abilities.str.save':2,'abilities.str.save_bonus':9,proficiency:3,'skills.athletics.prof':2,'skills.athletics.bonus':13,'info.class':'Воин'}});
 await until(()=>p.evaluate(async id=>(await import('/src/state/store.ts')).useUi.getState().characters[id]?.data.skills?.athletics?.bonus===13,c.id),'skills delivered');
 await p.evaluate(()=>localStorage.setItem('lanterna.sheetTab','skills'));await openSheet(p,c.id);
 assert.equal(await p.locator('.sheet').getByRole('tab',{name:'Главное',exact:true}).getAttribute('aria-selected'),'true');
 const group=p.getByRole('article',{name:'Сила',exact:true});await group.waitFor();
 assert.equal(await group.getByRole('button',{name:'Атлетика',exact:true}).count(),1);assert.equal(await p.locator('.ability-check').count(),24);
 assert.equal(await group.locator('[data-path="skills.athletics"] .check-bonus').textContent(),'+13*');
 const before=p.received.length;await group.getByRole('button',{name:'Атлетика',exact:true}).click();
 await until(()=>p.received.slice(before).some(m=>m.type==='chat'&&m.message.roll?.formula==='1d20+13'),'server skill roll');
 await p.locator('.sheet').getByRole('button',{name:'Редактировать',exact:true}).click();
 const manual=p.getByRole('textbox',{name:'Атлетика: свой бонус',exact:true});await manual.fill('');await manual.press('Enter');
 const prof=p.getByRole('combobox',{name:'Атлетика: владение',exact:true});await prof.selectOption('1');
 await p.locator('.sheet').getByRole('button',{name:'Готово',exact:true}).click();
 await until(async()=> (await group.locator('[data-path="skills.athletics"] .check-bonus').textContent())==='+7','computed bonus');
 await group.getByRole('button',{name:'Атлетика: владение',exact:true}).click();
 await until(async()=> (await group.locator('[data-path="skills.athletics"] .check-bonus').textContent())==='+10','expertise');
 assert.equal(await group.locator('[data-path="abilities.str"] .check-bonus').textContent(),'+9*');
 await p.getByRole('searchbox',{name:'Поиск по листу'}).fill('Атлетика');assert.match(await p.locator('.search-results').textContent(),/Атлетика.*\+10/);
 const stored=(await(await p.request.get(`${api}/api/characters`)).json()).find(x=>x.id===c.id).data;
 assert.equal(stored.info.class,'Воин');assert.equal(stored.abilities.str.save_bonus,9);assert.equal(stored.skills.athletics.prof,2);assert.equal(stored.skills.athletics.bonus,null);
 await p.close();
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
 await p.getByRole('combobox',{name:'Персонаж токена',exact:true}).selectOption(c.id);
 await until(async()=> (await scene(p)).tokens.find(t=>t.id===plain.id)?.character_id===c.id,'link existing plain token');
 assert.equal(await p.getByRole('combobox',{name:'Персонаж токена',exact:true}).count(),0);
 await p.close();
});
