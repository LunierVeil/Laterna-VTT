import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


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

test('v012 dice: seven types, server faces/totals on two clients, chat history, secret rolls and nonblocking cleanup',{timeout:120000},async()=>{
 const master=await pageFor(gm),observer=await pageFor(player);
 for(const p of [master,observer]){await p.getByRole('button',{name:'Кубики',exact:true}).click();await p.getByRole('dialog',{name:'Меню кубиков'}).waitFor();await p.getByRole('checkbox',{name:'Анимация кубиков',exact:true}).check();}
 const menu=observer.getByRole('dialog',{name:'Меню кубиков'});
 for(const sides of [4,6,8,10,12,20,100]){
  await menu.getByRole('button',{name:`d${sides}`,exact:true}).click();await menu.getByRole('spinbutton',{name:'Количество кубиков'}).fill('2');await menu.getByRole('spinbutton',{name:'Модификатор броска'}).fill('-3');
  assert.equal(await menu.getByLabel('Формула броска',{exact:true}).textContent(),`2d${sides}-3`);
  const start=observer.received.length;await menu.getByRole('button',{name:'Бросить',exact:true}).click();
  const message=await until(()=>observer.received.slice(start).find(m=>m.type==='chat'&&m.message.kind==='roll')?.message,'server roll');
  const roll=message.roll;assert.equal(roll.formula,`2d${sides}-3`);assert.equal(roll.total,roll.terms[0].rolls.reduce((a,b)=>a+b,0)-3);assert.ok(roll.terms[0].rolls.every(n=>n>=1&&n<=sides));
  for(const p of [master,observer]){
   const overlay=p.locator(`.dice-animation[data-message-id="${message.id}"]`);await overlay.waitFor();
   assert.deepEqual(await overlay.locator('.animated-die').evaluateAll(es=>es.map(e=>Number(e.dataset.value))),roll.terms[0].rolls);
   assert.equal(Number(await overlay.locator('.dice-animation-total strong').textContent()),roll.total);
   assert.equal(Number(await p.locator('.chat-log .msg').last().locator('.roll-total').textContent()),roll.total,'rendered chat total matches animation');
   await until(async()=>await overlay.getAttribute('data-phase')==='settled','dice settled');
   if(process.env.BROWSER_RESULTS_DIR&&p===master&&sides===20){await mkdir(process.env.BROWSER_RESULTS_DIR,{recursive:true});await p.screenshot({path:resolve(process.env.BROWSER_RESULTS_DIR,'v012-dice.png')});}
   assert.equal((await p.evaluate(async id=>(await import('/src/state/store.ts')).useUi.getState().messages.find(m=>m.id===id),message.id)).roll.total,roll.total);
  }
 }
 await master.getByRole('checkbox',{name:'Скрытно ГМ',exact:true}).check();const start=observer.received.length;
 await master.getByRole('button',{name:'Быстрый d20',exact:true}).click();
 const secret=await until(()=>observer.received.slice(start).find(m=>m.type==='chat'&&m.message.kind==='hidden_roll')?.message,'hidden placeholder');
 await master.locator(`.dice-animation[data-message-id="${secret.id}"]`).waitFor();assert.equal(secret.roll,null);assert.equal(await observer.locator(`.dice-animation[data-message-id="${secret.id}"]`).count(),0);
 await master.getByRole('checkbox',{name:'Скрытно ГМ',exact:true}).uncheck();
 await observer.getByRole('button',{name:'Закрыть кубики',exact:true}).click();
 // A live animation is pointer-transparent; ordinary mouse input reaches Pixi.
 await master.getByRole('button',{name:'Закрыть кубики',exact:true}).click();
 await probe(observer,sceneId);
 const token=(await command('token.add',{x:525,y:665,name:'Dice movement'},observer)).payload.token;
 await control.evaluate(()=>window.probe.send(JSON.stringify({id:crypto.randomUUID(),name:'dice.roll',payload:{formula:'d20'}})));await observer.locator('.dice-animation').waitFor();
 const xy=await atToken(observer,token.id);await observer.mouse.move(xy.x,xy.y);await observer.mouse.down();await observer.mouse.move(xy.x+70,xy.y,{steps:5});await observer.mouse.up();
 await until(async()=> (await scene(observer)).tokens.find(t=>t.id===token.id)?.x===595,'token moved during animation');
 await until(async()=>await observer.locator('.dice-animation').count()===0,'animation objects released');
 // Resync restores the history, without replaying its rolls.
 const before=observer.received.filter(m=>m.type==='snapshot').length;
 await observer.reload();await observer.locator('canvas').waitFor();await until(()=>observer.received.filter(m=>m.type==='snapshot').length>before,'reconnect snapshot');
 assert.equal(await observer.locator('.dice-animation').count(),0);
 await command('token.remove',{id:token.id});await master.close();await observer.close();
});

test('v012 dice mobile: viewport fit, close/quick roll, disable preference, reduced motion, rapid bounded rolls',{timeout:120000},async()=>{
 const context=await browser.newContext({viewport:{width:360,height:800},hasTouch:true,isMobile:true,storageState:await player.storageState()});
 const p=await pageFor(context),observer=await pageFor(gm);await probe(p,sceneId);
 for(const width of [360,390,430,768]){
  await p.setViewportSize({width,height:850});await p.getByRole('button',{name:'Кубики',exact:true}).tap();
  const menu=p.getByRole('dialog',{name:'Меню кубиков'});await menu.waitFor();
  const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=850);
  assert.equal(await menu.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  const hit=await p.getByRole('button',{name:'Закрыть кубики',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.equal(hit,true);
  await p.getByRole('button',{name:'Закрыть кубики',exact:true}).tap();assert.equal(await menu.count(),0);
 }
 await p.getByRole('button',{name:'Кубики',exact:true}).tap();await p.getByRole('checkbox',{name:'Анимация кубиков',exact:true}).uncheck();
 let start=p.received.length;await p.getByRole('button',{name:'Быстрый d20',exact:true}).tap();await until(()=>p.received.slice(start).some(m=>m.type==='chat'&&m.message.roll?.formula==='1d20'),'disabled roll persisted');assert.equal(await p.locator('.dice-animation').count(),0);
 await p.reload();await p.locator('canvas').waitFor();await p.getByRole('button',{name:'Кубики',exact:true}).tap();assert.equal(await p.getByRole('checkbox',{name:'Анимация кубиков',exact:true}).isChecked(),false);
 await p.getByRole('checkbox',{name:'Анимация кубиков',exact:true}).check();await p.emulateMedia({reducedMotion:'reduce'});start=p.received.length;
 await p.getByRole('button',{name:'Быстрый d20',exact:true}).tap();await until(()=>p.received.slice(start).some(m=>m.type==='chat'&&m.message.kind==='roll'),'reduced roll');assert.equal(await p.locator('.dice-animation').count(),0);
 await p.emulateMedia({reducedMotion:'no-preference'});
 await probe(p,sceneId);
 start=p.received.length;const observerStart=observer.received.length;
 await p.evaluate(()=>{for(let i=0;i<8;i++)window.probe.send(JSON.stringify({id:crypto.randomUUID(),name:'dice.roll',payload:{formula:'100d6+5',label:`rapid ${i}`}}));});
 const batch=await until(()=>{const list=[...new Map(p.received.slice(start).filter(m=>m.type==='chat'&&m.message.roll?.label?.startsWith('rapid ')).map(m=>[m.message.id,m.message])).values()];return list.length===8?list:null;},'eight rapid server rolls');
 const last=batch.at(-1),overlay=p.locator(`.dice-animation[data-message-id="${last.id}"]`);await overlay.waitFor();
 assert.equal(await p.locator('.dice-animation').count(),1);assert.equal(await overlay.locator('.animated-die').count(),12);assert.equal(await overlay.locator('.dice-extra').textContent(),'ещё 88 в чате');
 for(const m of batch){const received=await until(()=>observer.received.slice(observerStart).find(v=>v.type==='chat'&&v.message.id===m.id)?.message,'rapid observer delivery');assert.deepEqual(received.roll,m.roll);}
 await until(async()=>await p.locator('.dice-animation').count()===0,'rapid animation cleanup');
 await observer.close();await p.close();await context.close();
});
