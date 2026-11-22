// Opt-in real-canvas PB-03 probe. Required legacy manifest remains unchanged.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cpus,platform} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {browser,base,api,gm,player,control,dir,sceneId,setSceneId,command,probe,pageFor,until,stageToken} from './fixture.mjs';
assert.equal(process.env.LANTERNA_EXPERIMENTAL_VISIBILITY,'1');

async function pixel(page,x,y){return page.evaluate(({x,y})=>{
 const s=window.observedStage,p=s.world.toGlobal({x,y}),gl=s.app.canvas.getContext('webgl2')??s.app.canvas.getContext('webgl');
 s.app.render();const rgba=new Uint8Array(4);gl.readPixels(Math.round(p.x),s.app.canvas.height-Math.round(p.y)-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
 return [...rgba].slice(0,3).reduce((a,b)=>a+b,0);
},{x,y});}
async function paint(page){await until(()=>page.evaluate(()=>window.observedStage?.visualLayer?.updates>0),'real visual texture painted');}
async function settings(page,value){const before=await page.evaluate(()=>window.observedStage.visualLayer?.updates??0);await command('scene.visuals',{settings:value});await until(()=>page.evaluate(({value,before})=>{
 const s=window.observedStage;return JSON.stringify(s.visualState?.settings)===JSON.stringify(value)&&(!value||s.visualLayer.updates>before);
},{value,before}),'settings applied and painted');}
const lit=async(p,x,y)=>until(async()=>await pixel(p,x,y)>25,`lit canvas ${x},${y}`);
const dark=async(p,x,y)=>until(async()=>await pixel(p,x,y)<5,`dark canvas ${x},${y}`);

function distribution(samples) {
 const sorted = [...samples].sort((a, b) => a - b);
 const nearestRank = q => sorted[Math.ceil(sorted.length * q) - 1];
 return {median: nearestRank(.5), p95: nearestRank(.95)};
}

// Arm before sending on the real GM scene socket. Match both the server's
// cmd_id and the Worker generation, so late or unrelated paints cannot finish a sample.
async function geometryLatency(page, name, payload) {
 return page.evaluate(({name, payload}) => new Promise((resolve, reject) => {
  const stage = window.observedStage;
  const layer = stage.visualLayer;
  const socket = window.sceneSockets.findLast(ws => ws.readyState === WebSocket.OPEN);
  const id = crypto.randomUUID();
  const apply = stage.applyEvent;
  const paint = layer.paint;
  let generation, eventAt, sentAt;
  const timeout = setTimeout(() => finish(new Error(`No matching geometry paint for ${name}`)), 8000);
  function finish(error, sample) {
   clearTimeout(timeout);
   stage.applyEvent = apply;
   layer.paint = paint;
   socket.removeEventListener('message', onMessage);
   if (error) reject(error);
   else resolve(sample);
  }
  function onMessage(event) {
   const message = JSON.parse(event.data);
   if (message.cmd_id === id && message.type === 'error') finish(new Error(message.message));
  }
  stage.applyEvent = function(event, data, cmdId) {
   const matched = event === 'wall.updated' && cmdId === id && data.wall.id === payload.id;
   if (matched) eventAt = performance.now();
   const previous = layer.generation;
   apply.call(this, event, data, cmdId);
   if (matched) {
    generation = layer.generation;
    if (generation === previous) finish(new Error('Geometry event did not invalidate the mask'));
   }
  };
  layer.paint = function(request, result) {
   paint.call(this, request, result);
   if (result.generation !== generation) return;
   if (!result.available) return finish(new Error('Measured mask is unavailable'));
   const paintedAt = performance.now();
   finish(null, {sendToEvent: eventAt - sentAt, eventToMask: paintedAt - eventAt, sendToMask: paintedAt - sentAt});
  };
  socket.addEventListener('message', onMessage);
  sentAt = performance.now();
  try { socket.send(JSON.stringify({type:'cmd', id, name, payload})); }
  catch (error) { finish(error); }
 }), {name, payload});
}

test('PB03: real light, personal FoW, doors, movement, manual fog and lifecycle',{timeout:180000},async()=>{
 const second=await browser.newContext({viewport:{width:1280,height:900}}),invite=await command('invite.create');
 assert.equal((await second.request.post(`${api}/api/invite/accept`,{data:{token:invite.payload.token,name:'Light player two',password:randomUUID()}})).status(),200);
 const tokens=[];
 for(const [i,ctx] of [player,second].entries()){
  const seed=await ctx.newPage();await seed.goto(`${base}/api/health`);await probe(seed,sceneId);
  const c=(await command('character.create',{name:`Light PC ${i}`},seed)).payload.character;
  tokens.push((await command('token.add',{character_id:c.id,x:i?400:100,y:i?400:200},seed)).payload.token);await seed.close();
 }
 const npc=(await command('token.add',{x:400,y:200,name:'Light private NPC',owner_id:null})).payload.token;
 const door=(await command('wall.add',{x1:250,y1:100,x2:250,y2:300,kind:'door'})).payload.wall;
 await command('wall.add',{x1:250,y1:0,x2:250,y2:100});await command('wall.add',{x1:250,y1:300,x2:250,y2:1000});
 const master=await pageFor(gm,{trackSockets:true}),left=await pageFor(player),right=await pageFor(second);
 for(const p of [master,left,right])await p.evaluate(()=>{const s=window.observedStage;s.world.scale.set(1);s.world.position.set(100,100);});
 assert.equal(await stageToken(left,npc.id),null);assert.equal(JSON.stringify(left.received).includes(npc.id),false);
 await master.getByRole('tab',{name:'Сцены',exact:true}).click();await master.locator('.scene-settings > summary').click();
 await master.getByText('Свет и обзор (экспериментально)',{exact:true}).click();
 await master.getByRole('combobox',{name:'Окружающий свет'}).selectOption('none');
 await master.getByRole('button',{name:'Добавить источник',exact:true}).click();
 for(const [key,value] of Object.entries({x:100,y:200,radius:450}))await master.getByRole('spinbutton',{name:`Источник 1: ${key}`,exact:true}).fill(String(value));
 await master.getByRole('button',{name:'Применить свет и обзор',exact:true}).click();
 for(const p of [master,left,right])await paint(p);
 await lit(left,150,230);await dark(right,400,230);await dark(left,400,230);
 const light={x:100,y:200,radius:450},other={x:400,y:400,radius:220};
 await settings(right,{ambient:'none',sources:[light,other]});await lit(right,450,230);await dark(left,400,230);
 await settings(right,{ambient:'none',sources:[light]});await dark(right,400,230);
 // Existing pointer → onDoor → command; not a simulated renderer state update.
 const canvasPoint=async(x,y)=>master.evaluate(({x,y})=>{const s=window.observedStage,p=s.world.toGlobal({x,y}),r=s.app.canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};},{x,y});
 const clickMap=async(x,y)=>{const p=await canvasPoint(x,y);await master.mouse.click(p.x,p.y);};
 const clickDoor=()=>clickMap(250,200);
 await clickDoor();await lit(left,400,230);await lit(right,400,230);await until(()=>stageToken(left,npc.id),'server authorizes and renders NPC');
 await clickDoor();await dark(left,400,230);await dark(right,400,230);await until(async()=>!(await stageToken(left,npc.id)),'server revokes NPC');
 const upload=await gm.request.post(`${api}/api/uploads`,{data:await master.locator('canvas').screenshot(),headers:{'Content-Type':'image/png'}});
 assert.equal(upload.status(),200);
 await command('scene.update',{background_url:(await upload.json()).url});
 await until(()=>master.evaluate(()=>window.observedStage.map.visible),'map underlay loaded before editing');
 await master.getByRole('button',{name:'Стены и двери',exact:true}).click();
 await master.getByRole('button',{name:'Окно',exact:true}).click();
 await clickMap(73,73);
 const end=await canvasPoint(143,73);
 await master.mouse.move(end.x,end.y);
 assert.deepEqual(await master.evaluate(()=>window.observedStage.wallStart),{x:70,y:70});
 await master.keyboard.press('Escape');
 assert.equal(await master.evaluate(()=>window.observedStage.wallStart),null);
 await clickMap(73,73);await clickMap(143,73);await master.keyboard.press('Escape');
 const added=await until(()=>master.evaluate(()=>[...window.observedStage.walls.values()].find(w=>w.kind==='window')),'window drawn in editor');
 assert.deepEqual([added.x1,added.y1,added.x2,added.y2,added.blocks_sight,added.blocks_movement],[70,70,140,70,false,true]);
 await master.keyboard.press('Control+z');
 await until(()=>master.evaluate(id=>!window.observedStage.walls.has(id),added.id),'undo confirmed window');
 await command('scene.update',{background_url:null});
 await until(()=>master.evaluate(()=>!window.observedStage.map.visible),'test map removed');

 await master.getByRole('button',{name:'Свойства',exact:true}).click();
 const editDoor=async()=>{await clickDoor();return master.getByRole('alertdialog',{name:'Свойства препятствия'});};
 const waitWall=predicate=>until(()=>master.evaluate(({id,predicate})=>{
  const wall=window.observedStage.walls.get(id);return wall?.kind===predicate.kind&&wall.blocks_sight===predicate.sight;
 },{id:door.id,predicate}),'confirmed obstacle edit');
 let editor=await editDoor();
 await editor.getByLabel('Тип препятствия').selectOption('wall');
 await editor.getByRole('button',{name:'Сохранить'}).click();
 await waitWall({kind:'wall',sight:true});
 editor=await editDoor();
 await editor.getByLabel('Тип препятствия').selectOption('window');
 assert.equal(await editor.getByLabel('Блокирует обзор').isChecked(),false);
 assert.equal(await editor.getByLabel('Блокирует движение').isChecked(),true);
 await editor.getByRole('button',{name:'Сохранить'}).click();
 await waitWall({kind:'window',sight:false});
 await lit(left,400,230);await lit(right,400,230);
 await until(()=>stageToken(left,npc.id),'visible NPC through glass');
 await assert.rejects(command('token.move',{id:tokens[0].id,x:400,y:200}),/стен/);
 assert.equal(await left.getByRole('button',{name:'Стены и двери',exact:true}).count(),0);
 editor=await editDoor();await editor.getByLabel('Блокирует обзор').check();
 await editor.getByRole('button',{name:'Отмена'}).click();
 await lit(left,400,230);
 editor=await editDoor();await editor.getByLabel('Блокирует обзор').check();
 await editor.getByRole('button',{name:'Сохранить'}).click();
 await waitWall({kind:'window',sight:true});
 await dark(left,400,230);await dark(right,400,230);
 await until(async()=>!(await stageToken(left,npc.id)),'opaque window revokes NPC');
 await left.reload();await paint(left);
 await left.evaluate(()=>{const s=window.observedStage;s.world.scale.set(1);s.world.position.set(100,100);});
 await dark(left,400,230);assert.equal(await stageToken(left,npc.id),null);
 editor=await editDoor();
 await editor.getByLabel('Блокирует движение').uncheck();
 await command('wall.update',{id:door.id,blocks_movement:false});
 await until(()=>master.evaluate(id=>window.observedStage.walls.get(id)?.blocks_movement===false,door.id),'other GM command committed');
 await editor.getByRole('button',{name:'Сохранить'}).click();
 await editor.getByText('Препятствие изменилось. Откройте его свойства снова.',{exact:true}).waitFor();
 await editor.getByRole('button',{name:'Отмена'}).click();
 editor=await editDoor();
 await editor.getByLabel('Блокирует обзор').uncheck();
 await master.evaluate(()=>window.sceneSockets.findLast(ws=>ws.readyState===WebSocket.OPEN).close());
 await editor.waitFor({state:'hidden'});
 await until(()=>master.evaluate(()=>!window.observedStage.disconnected),'GM reconnected after editing');
 await waitWall({kind:'window',sight:true});
 await dark(left,400,230);
 editor=await editDoor();await editor.getByLabel('Тип препятствия').selectOption('door');
 await editor.getByRole('button',{name:'Сохранить'}).click();
 await waitWall({kind:'door',sight:true});
 await settings(left,{ambient:'full',sources:[]});await lit(left,150,230);await dark(left,400,230);await lit(right,450,230);
 await command('fog.cover',{x:140,y:220,w:40,h:40});await until(async()=>await pixel(left,150,230)===26,'existing manual FoW RGB 7/8/11');
 await command('fog.reveal',{x:140,y:220,w:40,h:40});await lit(left,150,230);
 await command('wall.door',{id:door.id,state:'open'});await lit(left,400,230);
 await command('token.move',{id:tokens[0].id,x:100,y:500});await dark(left,400,230);
 await command('token.move',{id:tokens[0].id,x:100,y:200});await lit(left,400,230);
 const updates=await left.evaluate(()=>window.observedStage.visualLayer.updates);
 await left.evaluate(()=>{const s=window.observedStage;s.zoomBy(.8/s.world.scale.x);s.world.position.set(70,60);});
 await lit(left,400,230);assert.equal(await left.evaluate(()=>window.observedStage.visualLayer.updates),updates,'pan/zoom does not rebuild mask');
 await left.reload();await paint(left);await left.evaluate(()=>{window.observedStage.world.scale.set(1);window.observedStage.world.position.set(100,100);});await lit(left,400,230);
 // A real worker response is delayed, then delivered after its owning stage dies.
 await left.evaluate(()=>{const v=window.observedStage.visualLayer;window.oldVisual=v;window.heldVisual=[];const receive=v.worker.onmessage;v.worker.onmessage=e=>window.heldVisual.push(()=>receive(e));});
 await command('scene.visuals',{settings:{ambient:'none',sources:[light]}});
 await until(()=>left.evaluate(()=>window.heldVisual.length>0),'real worker result held');
 const next=(await command('scene.create',{name:'Light empty scene'})).payload.id;await command('scene.activate',{id:next});
 await until(()=>left.received.some(m=>m.type==='snapshot'&&m.scene.id===next),'new scene snapshot');
 await until(()=>left.evaluate(()=>window.oldVisual.destroyed),'old visual resources disposed');
 await until(()=>left.evaluate(()=>window.observedStage?.isAlive),'new scene renderer mounted');
 assert.deepEqual(await left.evaluate(()=>{window.heldVisual.splice(0).forEach(f=>f());const v=window.oldVisual;return {destroyed:v.texture.destroyed,width:v.canvas.width,pending:v.pending};}),{destroyed:true,width:0,pending:null});
 assert.equal(await left.evaluate(()=>Boolean(window.observedStage.visualLayer?.sprite.visible)),false,'empty scene has no old light mask');
 await command('scene.activate',{id:sceneId});await until(()=>left.evaluate(()=>window.observedStage?.visualLayer?.updates>0),'original scene lighting restored');
});

test('PB03: PB00 30/200/15 baseline, stable renderer and worker disposal',{timeout:120000},async()=>{
 const root=resolve(import.meta.dirname,'../../..'),original=sceneId;
 const sid=(await command('scene.create',{name:'PB03 performance baseline'})).payload.id;
 let master;
 const inspector=await browser.newBrowserCDPSession();
 const workers=async()=> (await inspector.send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker').length;
 const beforeWorkers=await workers();
 try{
  const gmId=(await (await gm.request.get(`${api}/api/me`)).json()).id,playerId=(await (await player.request.get(`${api}/api/me`)).json()).id;
  await promisify(execFile)(resolve(root,'server/.venv/bin/python'),[resolve(root,'server/tests/fixtures/los_baseline.py'),'--scenario','complex','--database',resolve(dir,'test.db'),'--scene',sid,'--gm',gmId,'--player',playerId]);
  await command('scene.activate',{id:sid});await probe(control,sid);setSceneId(sid);
  try{master=await pageFor(gm,{trackSockets:true});}catch(error){
   const page=gm.pages().find(p=>p!==control);
   console.error('PB03 baseline startup',await page?.evaluate(async()=>({connected:(await import('/src/state/public.ts')).useUi.getState().connected,mounts:window.stageMounts,stages:window.observedStages?.map(s=>({alive:s.isAlive,connected:s.app.canvas?.isConnected})),text:document.body.innerText.slice(0,160)})));throw error;
  }
  assert.equal(await master.evaluate(()=>window.observedStage.tokens.size),30);
  assert.equal(await master.evaluate(()=>window.observedStage.walls.size),200);
  await master.evaluate(()=>{window.benchRenderer=window.observedStage.app.renderer;});
  const sources=Array.from({length:15},(_,i)=>({x:105+i*126,y:105,radius:700})); // explicit sources, NOT emits_light mapping
  await settings(master,{ambient:'none',sources});
  const cdp=await master.context().newCDPSession(master);await cdp.send('HeapProfiler.collectGarbage');const heapBefore=await cdp.send('Runtime.getHeapUsage');
  for(let i=0;i<8;i++)await settings(master,{ambient:'none',sources:sources.map(s=>({...s,radius:701+i}))});
  assert.equal(await master.evaluate(()=>window.benchRenderer===window.observedStage.app.renderer&&document.querySelectorAll('.scene canvas').length===1),true);
  const samples=await master.evaluate(()=>window.observedStage.visualLayer.timings.slice(-8));assert.equal(samples.length,8);
  await cdp.send('HeapProfiler.collectGarbage');const heapAfter=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
  // Replace two obstacles in place so the 30/200/15 workload stays constant.
  const [doorId,windowId]=await master.evaluate(()=>[...window.observedStage.walls.values()]
   .sort((a,b)=>a.y1-b.y1||a.x1-b.x1).slice(0,2).map(w=>w.id));
  await geometryLatency(master,'wall.update',{id:doorId,kind:'door',door_state:'closed'});
  await geometryLatency(master,'wall.update',{id:windowId,kind:'window',blocks_sight:true,blocks_movement:true});
  const transitions=[
   {label:'door.open',name:'wall.door',payload:{id:doorId,state:'open'}},
   {label:'door.closed',name:'wall.door',payload:{id:doorId,state:'closed'}},
   {label:'window.clear',name:'wall.update',payload:{id:windowId,blocks_sight:false}},
   {label:'window.opaque',name:'wall.update',payload:{id:windowId,blocks_sight:true}},
  ];
  for (const transition of transitions) await geometryLatency(master,transition.name,transition.payload);
  const latency=new Map(transitions.map(t=>[t.label,[]]));
  for(let round=0;round<20;round++){
   for (const {label,name,payload} of transitions) latency.get(label).push(await geometryLatency(master,name,payload));
  }
  const geometryMs=Object.fromEntries([...latency].map(([label,values])=>[label,{
   samples:values,sendToEvent:distribution(values.map(s=>s.sendToEvent)),
   eventToMask:distribution(values.map(s=>s.eventToMask)),sendToMask:distribution(values.map(s=>s.sendToMask)),
  }]));
  const report={platform:platform(),cpu:cpus()[0].model,wallCount:200,tokenCount:30,sourceCount:15,samples,
   workerMs:distribution(samples.map(s=>s.cpu)),paintMs:distribution(samples.map(s=>s.paint)),geometryMs,heapBefore,heapAfter,
   limitations:'Local headless Chromium, 8 warm runs, no FPS/SLA or GPU-memory claim; heap includes Pixi/JS caches.'};
  const out=process.env.BROWSER_RESULTS_DIR||resolve(tmpdir(),'laterna-browser-results','visual-lighting.mjs');await mkdir(out,{recursive:true});await writeFile(resolve(out,'performance.json'),JSON.stringify(report,null,2));console.log('PB03 baseline',JSON.stringify(report));
  await master.close();await until(async()=>await workers()===beforeWorkers,'owned worker terminates when page closes');
 }finally{
  await master?.close();await command('scene.activate',{id:original});await probe(control,original);setSceneId(original);await command('scene.delete',{id:sid});await inspector.detach();
 }
});
