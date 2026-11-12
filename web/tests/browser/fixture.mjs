import { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const suite = process.env.LATERNA_BROWSER_SUITE || process.argv[1]?.split('/').at(-1)?.replace('.test.mjs', '') || 'browser';
if (process.env.BROWSER_RESULTS_DIR) process.env.BROWSER_RESULTS_DIR = resolve(process.env.BROWSER_RESULTS_DIR, suite);
const web = resolve(import.meta.dirname, '../..'), root = resolve(web, '..');
const httpHost = process.env.LATERNA_HTTP_HOST || '127.0.0.1';
export let browser, server, vite, dir, base, api, gm, player, sceneId, control;
let key;
export function setSceneId(id) { sceneId = id; }
export const errors = [];
let serverLog = "", viteLog = "";
const startupRecords = [];
export async function port() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const n = s.address().port; await new Promise(r => s.close(r)); return n;
}
export async function until(fn, label, timeout = 12000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw Error(`Timeout: ${label}; last=${JSON.stringify(value)}`);
}
export async function ready(url) { await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, url, 20000); }
export async function probe(page, sid) {
  await page.evaluate(async sid => {
    window.probe?.close(); window.delivered = [];
    const ws = window.probe = new WebSocket(`ws://${location.host}/ws/scene/${sid}`);
    ws.onmessage = e => window.delivered.push(JSON.parse(e.data));
    await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
  }, sid);
  await until(() => page.evaluate(() => delivered.some(m => m.type === 'snapshot')), 'probe snapshot');
}
export async function command(name, payload = {}, page = control) {
  const id = randomUUID();
  await page.evaluate(({id,name,payload}) => {window.delivered=[];probe.send(JSON.stringify({id,name,payload}));}, {id,name,payload});
  const result = await until(() => page.evaluate(({id,name,payload}) => delivered.find(m => m.cmd_id === id ||
    (['character.update','character.list'].includes(name) && m.type === 'character' && m.character.id === payload.id) ||
    (name === 'character.delete' && m.type === 'character_deleted' && m.id === payload.id)), {id,name,payload}), name);
  assert.notEqual(result.type, 'error', JSON.stringify(result)); return result;
}
export async function pageFor(context, options = {}) {
  const started = Date.now();
  const p = await context.newPage();
  const startupConsole=[];p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')startupConsole.push(m.text());});
  if(options.trackSockets)await p.addInitScript(()=>{const Native=window.WebSocket;window.sceneSockets=[];window.WebSocket=class extends Native {constructor(...args){super(...args);if(String(args[0]).includes('/ws/scene/'))window.sceneSockets.push(this);}};});
  p.received=capture(p); p.setDefaultTimeout(8000); p.on('pageerror', e => errors.push(e.message));
  if(options.observeLifecycle)p.on('pageerror',error=>console.error('Scene lifecycle page error',error.stack));
  if(sceneId && !options.preserveSavedScene) await p.addInitScript(id=>localStorage.setItem('lanterna.gmScene',id),sceneId);
  await p.route('**/src/main.tsx', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({response, body: `import {SceneStage as ObservedStage} from '/src/widgets/scene-canvas/lib/stage.ts';
window.observedStageClass=ObservedStage;
window.observedMountResources=[];
const originalMount=ObservedStage.prototype.mount;
window.observedStages=[];
window.stageMounts=[];
window.stageMountGates=[];
Object.defineProperty(window,'observedStage',{get:()=>window.observedStages.findLast(s=>s.isAlive&&s.app.canvas.isConnected)});
ObservedStage.prototype.mount=async function(...args){
  const timing={start:performance.now(),finish:null};window.stageMounts.push(timing);
  try {
    ${options.beforeStageMount ? 'await new Promise(resolve=>window.stageMountGates.push(resolve));' : ''}
    if(window.holdNextStageMount){window.holdNextStageMount=false;window.heldSceneStage=this;await new Promise(resolve=>window.stageMountGates.push(resolve));}
    await originalMount.apply(this,args);window.observedStages.push(this);
    ${options.observeLifecycle ? 'window.observedMountResources.push({stage:this,canvas:this.app.canvas,root:this.app.stage,ticker:this.app.ticker});' : ''}
  }
  finally {timing.finish=performance.now();}
};
` + source});
  });
  await p.goto(base);
  if (process.env.LATERNA_HTTP_HOST) {
    assert.equal(await p.evaluate(() => window.isSecureContext), false);
    assert.equal(await p.evaluate(() => typeof crypto.randomUUID), 'undefined');
    assert.equal(await p.evaluate(() => {try {crypto.randomUUID(); return false;} catch(error) {return error instanceof TypeError;}}), true, 'old native call reproduces the HTTP failure');
    assert.match(await p.evaluate(async () => (await import('/src/shared/lib/uuid.ts')).uuidV4()), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  if(options.beforeStageMount) {
    await until(()=>p.received.some(m=>m.type==='snapshot'),'snapshot before renderer mount');
    assert.equal(await p.locator('canvas').count(),0,'renderer is still held before mount');
    await until(()=>p.evaluate(()=>window.stageMountGates.length>0),'renderer mount gate registered');
    await options.beforeStageMount(p);
    await p.evaluate(()=>window.stageMountGates.splice(0).forEach(release=>release()));
  }
  try { await p.locator('canvas').waitFor(); }
  catch(error) {
    startupRecords.push({elapsedMs:Date.now()-started,failed:true,console:startupConsole,mounts:await p.evaluate(()=>window.stageMounts??[])});
    console.error('Canvas startup diagnostics', startupConsole, await p.evaluate(()=>({url:location.href,ready:document.readyState,canvases:[...document.querySelectorAll('canvas')].map(c=>({connected:c.isConnected,width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()})),stages:window.observedStages?.length,resources:performance.getEntriesByType('resource').map(r=>({name:r.name.replace(location.origin,''),start:r.startTime,duration:r.duration})).slice(-35),text:document.body.innerText.slice(0,500)})));
    throw error;
  }
  await until(() => p.evaluate(async () => (await import('/src/state/store.ts')).useUi.getState().connected && window.observedStage?.isAlive), 'app connected');
  assert.equal(await p.evaluate(()=>Object.getPrototypeOf(window.observedStage)===window.observedStageClass.prototype&&window.observedStage.app.canvas===document.querySelector('.scene canvas')),true,'fixture observes the app stage and its canvas');
  startupRecords.push({elapsedMs:Date.now()-started,failed:false,console:startupConsole,mounts:await p.evaluate(()=>window.stageMounts??[]),pages:context.pages().length,contexts:browser.contexts().length});
  return p;
}
// Native Chromium listener inspection; no EventTarget/PixiJS monkey patch.
export async function stageListenerCount(page, stageExpression, canvasExpression) {
  const session=await page.context().newCDPSession(page);
  try {
    const result=await session.send('Runtime.evaluate',{
      expression:`(() => {const stage=${stageExpression}, canvas=${canvasExpression};const w=getEventListeners(window),c=getEventListeners(canvas);return [...(w.keydown??[]),...(w.blur??[]),...(w.pointercancel??[]),...(w.touchcancel??[]),...(c.wheel??[])].filter(r=>[stage.onKeyDown,stage.onPointerCancel,stage.onWheel].includes(r.listener)).length;})()`,
      includeCommandLineAPI:true,returnByValue:true,
    });
    assert.equal(result.exceptionDetails,undefined,'listener inspection succeeds');
    return result.result.value;
  } finally {await session.detach();}
}
export async function openSheet(p, id) {
  await p.evaluate(async id => (await import('/src/state/store.ts')).useUi.getState().openCharacter(id), id);
  await p.locator('.sheet').waitFor();
}
export async function closeSheet(p) { await p.locator('.sheet').getByRole('button', {name: 'Закрыть', exact: true}).click(); }
export async function scene(p) { return (await p.request.get(`${api}/api/scenes/${sceneId}`)).json(); }
export function capture(p) {
  const messages = []; p.on('websocket', ws => ws.on('framereceived', frame => { try { messages.push(JSON.parse(String(frame.payload))); } catch {} }));
  return messages;
}
before(async () => {
  dir = await mkdtemp(resolve(tmpdir(), 'laterna-regression-'));
  const apiPort = await port(), webPort = await port(); api = `http://${httpHost}:${apiPort}`; base = `http://${httpHost}:${webPort}`;
  key = randomUUID(); await writeFile(resolve(dir, 'key'), key, {mode: 0o600});
  server = spawn(resolve(root, 'server/.venv/bin/uvicorn'), ['app.main:app','--host',httpHost,'--port',String(apiPort),'--no-proxy-headers'], {
    cwd: resolve(root,'server'), env: {...process.env, DATABASE_URL:`sqlite+aiosqlite:///${dir}/test.db`, UPLOAD_DIR:resolve(dir,'uploads'), GM_KEY_FILE:resolve(dir,'key'), FRONTEND_URL:base}, stdio: ['ignore','pipe','pipe']});
  server.stderr.on('data', x => serverLog += x); server.stdout.on('data', x => serverLog += x);
  vite = spawn(process.execPath, [resolve(web,'node_modules/vite/bin/vite.js'),'--host',httpHost,'--port',String(webPort),'--strictPort'], {cwd:web,env:{...process.env,VITE_API_TARGET:api},stdio:['ignore','pipe','pipe']});
  vite.stdout.on('data', x => viteLog += x); vite.stderr.on('data', x => viteLog += x);
  await ready(`${api}/api/health`); await ready(base);
  browser = await chromium.launch({headless:true, ...(process.env.LATERNA_HTTP_HOST && process.env.HTTP_PROXY ? {proxy:{server:process.env.HTTP_PROXY,bypass:httpHost}} : {}), ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:[...(process.env.LATERNA_HTTP_HOST ? [`--proxy-bypass-list=${httpHost}`] : []),'--no-sandbox','--enable-blink-features=MiddleClickAutoscroll']});
  gm = await browser.newContext({viewport:{width:1280,height:900}});
  const login = await gm.request.post(`${api}/api/gm/login`, {data:{key,name:'Regression GM',password:randomUUID()}}); assert.equal(login.status(),200);
  // Cookie hostname is shared by API and Vite; ports do not scope cookies.
  // This actor only sends protocol commands and records events. Loading the
  // SPA kept an unused software WebGL renderer active for the entire suite,
  // competing with the actual GM/player/touch canvases on CI runners.
  control = await gm.newPage();
  control.received = capture(control);
  control.on('pageerror', error => errors.push(error.message));
  const healthResponse = await control.goto(`${base}/api/health`); assert.equal(healthResponse.status(),200, await control.locator('body').innerText());
  sceneId = (await (await gm.request.get(`${api}/api/campaign`)).json()).active_scene_id;
  await probe(control,sceneId);
  const inv = await command('invite.create');
  player = await browser.newContext({viewport:{width:1280,height:900}});
  const accepted = await player.request.post(`${api}/api/invite/accept`,{data:{token:inv.payload.token,name:'Regression player',password:randomUUID()}}); assert.equal(accepted.status(),200);

}, {timeout:60000});
after(async () => {
  await browser?.close();
  for(const p of [vite,server]) if(p && p.exitCode===null) {p.kill('SIGTERM'); await new Promise(r=>{p.once('exit',r);setTimeout(()=>{p.kill('SIGKILL');r();},3000).unref();});}
  const out=process.env.BROWSER_RESULTS_DIR||resolve(tmpdir(),'laterna-browser-results',suite);
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'startup.json'),JSON.stringify(startupRecords,null,2));
  await writeFile(resolve(out,'server.log'),serverLog); await writeFile(resolve(out,'vite.log'),viteLog);
  if(dir) await rm(dir,{recursive:true,force:true});
  assert.deepEqual(errors,[], 'browser page errors');
});

afterEach(async t=>{
  const out=process.env.BROWSER_RESULTS_DIR||resolve(tmpdir(),'laterna-browser-results',suite);
  await mkdir(out,{recursive:true});
  let i=0;for(const ctx of browser?.contexts()??[]) for(const p of ctx.pages()) if(p!==control) await p.screenshot({path:resolve(out,t.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+(++i)+'.png'),timeout:2000}).catch(()=>{});
  for(const ctx of browser?.contexts()??[]) for(const p of ctx.pages()) if(p!==control) await p.close();
  for(const ctx of browser?.contexts()??[]) if(ctx!==gm && ctx!==player) await ctx.close();
  if(control&&!control.isClosed())await command('scene.activate',{id:sceneId});
});

export async function stageToken(p,id) { return p.evaluate(id=>{const v=window.observedStage?.tokens.get(id);return v ? {data:v.data,image:v.imageUrl,hpVisible:v.hpText.visible,imageVisible:v.image.visible,textureWidth:v.image.texture.width} : null;},id); }
export async function atToken(p,id) {
  return p.evaluate(id=>{const s=window.observedStage,v=s.tokens.get(id),r=s.app.canvas.getBoundingClientRect(),g=v.node.getGlobalPosition();return {x:r.left+g.x,y:r.top+g.y};},id);
}
export function nextToken(s,id){return s.tokens.find(t=>t.id===id);}
export async function repositorySmoke() {
  // Execute the repository's smoke test against this isolated live server.
  const script = `import asyncio,sys,smoke_test; smoke_test.BASE=${JSON.stringify(api)}; smoke_test.WS=${JSON.stringify(api.replace('http','ws'))}; sys.exit(asyncio.run(smoke_test.main()))`;
  const smoke = spawn(resolve(root,'server/.venv/bin/python'),['-c',script],{cwd:resolve(root,'server'),env:{...process.env, DATABASE_URL:`sqlite+aiosqlite:///${dir}/test.db`,GM_KEY_FILE:resolve(dir,'key'),LANTERNA_GM_KEY:key},stdio:['ignore','pipe','pipe'],timeout:30000});
  let smokeLog='';smoke.stdout.on('data',x=>smokeLog+=x);smoke.stderr.on('data',x=>smokeLog+=x);
  const code=await new Promise(r=>smoke.on('exit',r)); assert.equal(code,0,smokeLog); console.log('Repository smoke_test.py: passed');
}
