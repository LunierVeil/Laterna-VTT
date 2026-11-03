// Manual bounded stress check, separate from the 35-case CI browser manifest.
// Run: CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser/pixi-cleanup-resources.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pageFor, player, sceneId, control, command, probe, until, stageToken, stageListenerCount } from './fixture.mjs';

test('Pixi cleanup: repeated switches release local resources and retain bounded live state', {timeout:240000}, async()=>{
  const original=sceneId,next=(await command('scene.create',{name:'Cleanup resource probe'})).payload.id;
  await probe(control,next);const tokenB=(await command('token.add',{x:245,y:245,name:'Resource probe'})).payload.token;
  await probe(control,original);const tokenA=(await command('token.add',{x:245,y:245,name:'Resource probe'})).payload.token;
  const p=await pageFor(player,{observeLifecycle:true,trackSockets:true}),session=await p.context().newCDPSession(p),samples=[];
  try {
    for(let cycle=0;cycle<30;cycle++){
      await p.evaluate(()=>{const s=window.observedStage;window.resourcePrevious={stage:s,canvas:s.app.canvas,root:s.app.stage,ticker:s.app.ticker};});
      const target=cycle%2===0?next:original,token=cycle%2===0?tokenB:tokenA,start=p.received.length;
      await command('scene.activate',{id:target});
      await until(()=>p.received.slice(start).some(m=>m.type==='snapshot'&&m.scene.id===target),'resource probe snapshot');
      await until(()=>p.evaluate(()=>window.observedStage?.isAlive&&window.observedStage!==window.resourcePrevious.stage&&!window.resourcePrevious.stage.isAlive),'resource probe stage replacement');
      await until(()=>stageToken(p,token.id),'current Graphics token');
      assert.deepEqual(await p.evaluate(()=>{
        const old=window.resourcePrevious,current=window.observedStage;
        return {oldCanvas:old.canvas.isConnected,oldRootDestroyed:old.root.destroyed,oldRenderer:old.stage.app.renderer,oldObserver:old.stage.resizeObserver,oldTickerStopped:!old.ticker.started,liveStages:window.observedStages.filter(s=>s.isAlive&&s.app.canvas.isConnected).length,canvases:document.querySelectorAll('.scene canvas').length,activeSockets:window.sceneSockets.filter(s=>s.readyState===1).length,currentTicker:current.app.ticker.started};
      }),{oldCanvas:false,oldRootDestroyed:true,oldRenderer:null,oldObserver:null,oldTickerStopped:true,liveStages:1,canvases:1,activeSockets:1,currentTicker:true});
      assert.equal(await stageListenerCount(p,'window.resourcePrevious.stage','window.resourcePrevious.canvas'),0);
      assert.equal(await stageListenerCount(p,'window.observedStage','window.observedStage.app.canvas'),5);
      if(cycle%6===0)await p.locator('canvas').screenshot();
      // Release only diagnostic references, so the observer itself does not retain destroyed stages.
      await p.evaluate(()=>{
        const current=window.observedStage;
        window.observedStages=[current];window.observedMountResources=window.observedMountResources.filter(r=>r.stage===current);
        window.stageMounts=[];window.sceneSockets=window.sceneSockets.filter(s=>s.readyState===1);delete window.resourcePrevious;
      });
      await session.send('HeapProfiler.collectGarbage');
      const heap=await session.send('Runtime.getHeapUsage'),dom=await session.send('Memory.getDOMCounters');
      const evaluated=await session.send('Runtime.evaluate',{expression:'getEventListeners(window)',includeCommandLineAPI:true,returnByValue:true});
      assert.equal(evaluated.exceptionDetails,undefined);
      const windowListeners=Object.values(evaluated.result.value).reduce((sum,list)=>sum+list.length,0);
      samples.push({cycle:cycle+1,warmup:cycle<6,heap:heap.usedSize,backing:heap.backingStorageSize??null,embedder:heap.embedderHeapUsedSize??null,nodes:dom.nodes,documents:dom.documents,listeners:dom.jsEventListeners,windowListeners});
    }
    const measured=samples.filter(s=>!s.warmup);
    assert.equal(new Set(measured.map(s=>s.windowListeners)).size,1,'no accumulation of window listeners');
    const out=process.env.BROWSER_RESULTS_DIR||resolve(tmpdir(),'laterna-pixi-resource-probe');await mkdir(out,{recursive:true});
    await writeFile(resolve(out,'resources.json'),JSON.stringify(samples,null,2));
    console.log('RESOURCE_SAMPLES',JSON.stringify(samples));
  } finally {await session.detach();await p.close();await command('scene.activate',{id:original});await command('scene.delete',{id:next});await command('token.remove',{id:tokenA.id});}
});
