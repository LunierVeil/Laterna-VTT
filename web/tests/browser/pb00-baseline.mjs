// Optional PB-00 foundation probe, separate from the unchanged strict CI manifest.
// CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser/pb00-baseline.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir, cpus, release, platform, totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
import { browser, gm, player, control, dir, api, sceneId, setSceneId, command,
  probe, pageFor, until, stageToken, stageListenerCount } from './fixture.mjs';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../..');
const report = {base: '7e5b84916b8ed1fdcdcd225ff62ac5a0991a9c79', observations: {}};
async function saveReport() {
  const out = process.env.BROWSER_RESULTS_DIR || resolve(tmpdir(), 'laterna-browser-results', 'pb00-baseline');
  await mkdir(out, {recursive:true});
  report.isolation = {temporaryDirectory:dir, database:'test.db', uploads:'uploads',
    cleanupOwner:'existing browser fixture after hook; verify directory absence after process exit'};
  await writeFile(resolve(out, 'baseline.json'), JSON.stringify(report, null, 2));
}

async function scenario(name) {
  const original = sceneId;
  const sid = (await command('scene.create', {name:`PB00 ${name}`})).payload.id;
  try {
    const gmId = (await (await gm.request.get(`${api}/api/me`)).json()).id;
    const playerId = (await (await player.request.get(`${api}/api/me`)).json()).id;
    const start = performance.now();
    const {stdout} = await execute(resolve(root, 'server/.venv/bin/python'), [
      resolve(root, 'server/tests/fixtures/los_baseline.py'), '--scenario', name,
      '--database', resolve(dir, 'test.db'), '--scene', sid, '--gm', gmId, '--player', playerId,
    ]);
    const seed = JSON.parse(stdout), seedMs = performance.now() - start;
    await command('scene.activate', {id:sid});
    await probe(control, sid);
    setSceneId(sid);
    return {sid, seed, seedMs, async close() {
      await command('scene.activate', {id:original});
      await probe(control, original); setSceneId(original);
      await command('scene.delete', {id:sid});
    }};
  } catch (error) {
    await command('scene.activate', {id:original});
    await probe(control, original); setSceneId(original);
    await command('scene.delete', {id:sid});
    throw error;
  }
}

test('PB00: two real clients apply ordered events, manual fog, GM noops and reconnect snapshot', {timeout:120000}, async () => {
  const fixture = await scenario('manual-fog');
  let master, observer;
  try {
    master = await pageFor(gm, {trackSockets:true});
    observer = await pageFor(player, {trackSockets:true});
    const [own, fogHidden, secret] = fixture.seed.ids.tokens;
    await until(() => stageToken(observer, own), 'owner remains rendered under manual fog');
    await until(() => stageToken(master, secret), 'GM renders private layer');
    const snap = observer.received.find(m => m.type === 'snapshot' && m.scene.id === fixture.sid);
    assert.deepEqual(snap.scene.tokens.map(t => t.id), [own]);
    assert.deepEqual(snap.scene.walls, []);
    assert.equal(await stageToken(observer, fogHidden), null);
    assert.equal(await stageToken(observer, secret), null);
    assert.equal(await observer.evaluate(() => window.observedStage.walls.size), 0);
    const updated = await command('token.update', {id:secret,name:'PB00 private update'});
    const noop = await until(() => observer.received.find(m => m.type === 'event' && m.seq === updated.seq), 'private mutation advances player seq');
    assert.deepEqual(noop, {type:'event',seq:updated.seq,name:'noop',payload:{},cmd_id:null});
    assert.equal(updated.seq, snap.seq + 1);
    const id = randomUUID();
    await observer.evaluate(({id,own}) => window.sceneSockets.find(s => s.readyState === 1).send(JSON.stringify({type:'cmd',id,name:'token.move',payload:{id:own,x:875,y:175}})), {id,own});
    const moved = await until(() => master.received.find(m => m.type === 'event' && m.cmd_id === id), 'GM receives player move with cmd_id');
    await until(() => observer.received.some(m => m.type === 'event' && m.cmd_id === id), 'player receives its acknowledgement');
    assert.equal(moved.seq, updated.seq + 1);
    for (const p of [master,observer]) await until(async () => (await stageToken(p,own))?.data.x === 875, 'move is applied to both SceneStages');

    // Real disconnect; the other context stays online. Do not change reconnect timers.
    const mark = observer.received.length;
    await player.setOffline(true);
    await observer.evaluate(() => window.sceneSockets.find(s => s.readyState === 1).close());
    await until(() => observer.evaluate(async () => !(await import('/src/state/public.ts')).useUi.getState().connected), 'UI reports disconnection');
    const offline = await command('token.move', {id:own,x:945,y:175});
    await player.setOffline(false);
    const restored = await until(() => observer.received.slice(mark).find(m => m.type === 'snapshot' && m.scene.id === fixture.sid && m.seq === offline.seq), 'automatic reconnect gets current snapshot');
    assert.equal(restored.scene.tokens.find(t => t.id === own).x, 945);
    assert.equal(restored.scene.tokens.some(t => [fogHidden,secret].includes(t.id)), false);
    assert.deepEqual(restored.scene.walls, []);
    await until(async () => (await stageToken(observer,own))?.data.x === 945, 'snapshot applied to PixiJS');
    await until(() => observer.evaluate(async () => (await import('/src/state/public.ts')).useUi.getState().connected), 'UI reports reconnection');
    assert.equal(await observer.evaluate(() => window.sceneSockets.filter(s => s.readyState === 1).length), 1);
    const visibleEvents = observer.received.filter(m => m.type === 'event').map(m => m.seq);
    assert.deepEqual(visibleEvents, [updated.seq,moved.seq]);
    report.observations.twoClients = {snapshotSeq:snap.seq, eventSeq:visibleEvents, reconnectedSeq:restored.seq,
      ownTokenUnderFog:true, gmTokenAbsent:true, fogEnemyAbsent:true, fogOccluderAbsent:true, liveAppSockets:1};
    await saveReport();
  } finally {
    await player.setOffline(false);
    await master?.close(); await observer?.close(); await fixture.close();
  }
});

test('PB00: measured Alpha 30/200/15 rendering and resource cleanup, no performance gate', {timeout:120000}, async () => {
  const fixture = await scenario('complex');
  let page, session;
  try {
    const start = performance.now();
    page = await pageFor(gm, {observeLifecycle:true,trackSockets:true});
    await until(() => page.evaluate(() => window.observedStage.tokens.size === 30 && window.observedStage.walls.size === 200), 'complex snapshot fully applied');
    const readyMs = performance.now() - start;
    const snapshot = page.received.find(m => m.type === 'snapshot' && m.scene.id === fixture.sid);
    assert.equal(snapshot.scene.tokens.length, 30);
    assert.equal(snapshot.scene.walls.length, 200);
    assert.equal(snapshot.scene.tokens.filter(t => t.emits_light > 0).length, 15);
    session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    const heapBefore = await session.send('Runtime.getHeapUsage');
    const measurement = await page.evaluate(async () => {
      const stage = window.observedStage;
      const gl = stage.app.renderer.gl;
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
      // Warm up a finite number of rendered frames, not a sleep or an FPS gate.
      for (let i=0;i<30;i++) await new Promise(requestAnimationFrame);
      const intervals=[], renderCpu=[];
      let previous=await new Promise(requestAnimationFrame);
      for (let i=0;i<120;i++) {
        const now=await new Promise(requestAnimationFrame); intervals.push(now-previous); previous=now;
        const start=performance.now(); stage.app.render(); renderCpu.push(performance.now()-start);
      }
      const summary = values => {
        const sorted=[...values].sort((a,b)=>a-b),sum=values.reduce((a,b)=>a+b,0);
        return {samples:values.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1),mean:sum/values.length};
      };
      const canvas=stage.app.canvas.getBoundingClientRect();
      window.pb00Old={stage,canvas:stage.app.canvas,root:stage.app.stage,ticker:stage.app.ticker};
      return {rafIntervalsMs:summary(intervals),additionalRenderCpuMs:summary(renderCpu),
        renderer,tickerFps:stage.app.ticker.FPS,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
        canvas:{width:canvas.width,height:canvas.height},rawRafIntervalsMs:intervals,rawAdditionalRenderCpuMs:renderCpu};
    });
    assert.equal(measurement.rafIntervalsMs.samples, 120);
    assert.equal(await stageListenerCount(page,'window.observedStage','window.observedStage.app.canvas'), 5);
    const heapLoaded = await session.send('Runtime.getHeapUsage');
    const domLoaded = await session.send('Memory.getDOMCounters');
    await page.screenshot({path:resolve(process.env.BROWSER_RESULTS_DIR || tmpdir(),'pb00-complex.png')});
    await fixture.close();
    await until(() => page.evaluate(() => window.observedStage?.isAlive && window.observedStage !== window.pb00Old.stage && !window.pb00Old.stage.isAlive), 'complex scene unmounted');
    const cleanup = await page.evaluate(() => {
      const old=window.pb00Old;
      return {oldCanvasConnected:old.canvas.isConnected,oldRootDestroyed:old.root.destroyed,
        oldRenderer:old.stage.app.renderer,oldResizeObserver:old.stage.resizeObserver,oldTickerStopped:!old.ticker.started,
        liveStages:window.observedStages.filter(s => s.isAlive && s.app.canvas.isConnected).length,
        connectedCanvases:document.querySelectorAll('.scene canvas').length,liveSockets:window.sceneSockets.filter(s=>s.readyState===1).length};
    });
    assert.deepEqual(cleanup, {oldCanvasConnected:false,oldRootDestroyed:true,oldRenderer:null,
      oldResizeObserver:null,oldTickerStopped:true,liveStages:1,connectedCanvases:1,liveSockets:1});
    assert.equal(await stageListenerCount(page,'window.pb00Old.stage','window.pb00Old.canvas'), 0);
    // Drop diagnostic references before post-cleanup heap collection, as in the existing resource probe.
    await page.evaluate(() => {
      const stage=window.observedStage;window.observedStages=[stage];
      window.observedMountResources=window.observedMountResources.filter(r=>r.stage===stage);
      window.sceneSockets=window.sceneSockets.filter(s=>s.readyState===1);delete window.pb00Old;
    });
    await session.send('HeapProfiler.collectGarbage');
    const heapAfter = await session.send('Runtime.getHeapUsage');
    const domAfter = await session.send('Memory.getDOMCounters');
    const pixi=JSON.parse(await readFile(resolve(root,'web/node_modules/pixi.js/package.json'),'utf8')).version;
    report.environment = {os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,logicalCpus:cpus().length,
      hostMemoryBytes:totalmem(),browser:browser.version(),node:process.version,pixi,mode:'Vite development, headless Chromium, one GM canvas; shared cloud CPU'};
    report.observations.performance = {seedMs:fixture.seedMs,readyMs, ...measurement,heapBefore,heapLoaded,heapAfter,domLoaded,domAfter,cleanup};
    await saveReport();
    console.log('PB00_BASELINE',JSON.stringify({readyMs,seedMs:fixture.seedMs,raf:measurement.rafIntervalsMs,renderCpu:measurement.additionalRenderCpuMs,cleanup}));
  } finally {
    await session?.detach(); await page?.close();
    // close() already ran on success; on error return to the original scene too.
    if (sceneId === fixture.sid) await fixture.close();
  }
});
