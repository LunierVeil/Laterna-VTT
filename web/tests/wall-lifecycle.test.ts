import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Resolve Vite local imports while executing real stage methods without a GPU.
registerHooks({load(url, context, next) {
  if (url.endsWith('.ts')) return {format:'module', shortCircuit:true, source:ts.transpileModule(
    readFileSync(fileURLToPath(url),'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
  return next(url,context);
},resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const candidate = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}});
const { SceneStage } = await import('../src/widgets/scene-canvas/lib/stage.ts');
function fixture() {
  const stage: any = Object.create(SceneStage.prototype);
  const changes: boolean[] = [];
  Object.assign(stage, {destroyed:false, disconnected:false, wallStart:{x:70,y:70}, sceneId:'a',
    walls:new Map([['confirmed',{id:'confirmed'}]]), tokens:new Map(),
    movementPreviews:new Map(), selectedIds:new Set(), dragging:null,
    ghostLayer:{clear(){}}, cb:{onChainChange:(active:boolean)=>changes.push(active)},
    app:{destroy(){}}, visualLayer:null});
  for (const name of ['drawGhostWall','drawBackground','drawGrid','setMap','drawWalls','drawFog','setCurrentTurn','setSelection','refreshVisuals']) stage[name]=()=>{};
  return {stage,changes};
}
const snapshot = (id:string) => ({id, grid_size:70, width:700, height:700,
  walls:[{id:'confirmed'}],tokens:[],fog:[],combat:null});
test('disconnect clears stale wall start and retains confirmed walls on reconnect',()=>{
  const {stage,changes}=fixture();
  stage.handleDisconnect();
  assert.equal(stage.wallStart,null);
  assert.equal(stage.walls.has('confirmed'),true);
  assert.equal(stage.disconnected,true);
  stage.setSnapshot(snapshot('a'));
  assert.equal(stage.disconnected,false);
  assert.equal(stage.wallStart,null);
  assert.equal(stage.walls.has('confirmed'),true);
  assert.deepEqual(changes,[false]);
});
test('ordinary snapshot preserves chain; scene change ends it',()=>{
  const {stage,changes}=fixture();
  stage.setSnapshot(snapshot('a'));
  assert.deepEqual(stage.wallStart,{x:70,y:70});
  assert.deepEqual(changes,[]);
  stage.setSnapshot(snapshot('b'));
  assert.equal(stage.wallStart,null);
  assert.deepEqual(changes,[false]);
});
test('explicit cancellation is idempotent and retains confirmed walls',()=>{
  const {stage,changes}=fixture();
  stage.endChain();stage.endChain();
  assert.equal(stage.wallStart,null);
  assert.equal(stage.walls.has('confirmed'),true);
  assert.deepEqual(changes,[false]);
});
test('unmount ends chain and repeated disposal is safe',()=>{
  const previous=globalThis.window;
  (globalThis as any).window={removeEventListener(){}};
  try {
    const {stage,changes}=fixture();
    stage.destroy();stage.destroy();
    assert.equal(stage.wallStart,null);
    assert.deepEqual(changes,[false]);
  } finally { (globalThis as any).window=previous; }
});
