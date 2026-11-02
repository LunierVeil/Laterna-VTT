import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


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


test('Final sheets: native middle autoscroll cannot escape the sheet; wheel and reopening work',{timeout:120000},async()=>{
 const p=await pageFor(gm);await p.setViewportSize({width:1024,height:620});
 await p.evaluate(()=>document.addEventListener('mousedown',e=>{if(e.button===1)window.middleEvents.push(e.defaultPrevented);}));
 for(const system of ['dnd5e','mob']){
  const c=(await command('character.create',{system,name:`Autoscroll ${system}`})).payload.character;
  const notes=Array(150).fill('Long accessible sheet content').join('\n');await command('character.update',{id:c.id,set:{notes}});
  for(const editing of [false,true]){
   await openSheet(p,c.id);if(system==='dnd5e')await p.locator('.sheet').getByRole('tab',{name:'О персонаже',exact:true}).click();
   const sheet=p.locator('.sheet');if(editing)await sheet.getByRole('button',{name:'Редактировать',exact:true}).click();
   await sheet.evaluate(e=>e.scrollTop=0);await p.evaluate(()=>window.middleEvents=[]);
   const before=await sheet.boundingBox();await p.mouse.click(before.x+before.width-30,before.y+70,{button:'middle'});await p.mouse.move(before.x+before.width-30,610);await p.waitForTimeout(500);
   const after=await sheet.boundingBox(),data=await p.evaluate(()=>({root:document.scrollingElement.scrollTop,overlay:document.querySelector('.sheet-overlay').scrollTop,sheet:document.querySelector('.sheet').scrollTop,middle:window.middleEvents}));
   assert.deepEqual(data.middle,[true]);assert.equal(data.root,0);assert.equal(data.overlay,0);assert.equal(data.sheet,0);assert.deepEqual(after,before);assert.ok(after.y>=-1&&after.y+after.height<=621);
   assert.equal(await sheet.evaluate(e=>getComputedStyle(e).overflowY),'auto');
   await p.mouse.move(before.x+before.width-25,before.y+before.height/2);await p.mouse.wheel(0,500);await until(()=>sheet.evaluate(e=>e.scrollTop>0),'ordinary wheel remains available');
   await sheet.evaluate(e=>e.scrollTop=e.scrollHeight);assert.equal(await sheet.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-1),true,'all sheet content is reachable');
   await sheet.evaluate(e=>e.scrollTop=0);await closeSheet(p);await openSheet(p,c.id);assert.ok((await sheet.boundingBox()).y>=0);await closeSheet(p);
  }
  assert.equal((await(await gm.request.get(`${api}/api/characters`)).json()).find(x=>x.id===c.id).data.notes,notes);
 }
 await p.close();
});

test('Final NPC equipment: shared card editor CRUD, document, reload and player privacy',{timeout:90000},async()=>{
 const master=await pageFor(gm),observer=await pageFor(player);const c=(await command('character.create',{name:'Private equipment NPC',system:'mob'})).payload.character;
 await openSheet(master,c.id);await master.getByRole('tab',{name:'Снаряжение',exact:true}).click();await master.getByRole('button',{name:'+ Предмет',exact:true}).click();
 const editor=master.locator('.card-editing');await editor.getByPlaceholder('Название',{exact:true}).fill('Secret NPC sabre');await editor.getByLabel('Кол-во',{exact:true}).fill('2');await editor.locator('.ProseMirror').fill('Hidden silver properties');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();
 await master.locator('.card-title').filter({hasText:'Secret NPC sabre'}).waitFor();
 let stored=(await(await gm.request.get(`${api}/api/characters`)).json()).find(x=>x.id===c.id);assert.equal(stored.data.equipment[0].qty,2);assert.match(JSON.stringify(stored.data.equipment[0].doc),/Hidden silver properties/);
 for(const width of [360,390,430,768]){await master.setViewportSize({width,height:850});const sheet=master.locator('.sheet'),r=await sheet.boundingBox();assert.ok(r.x>=-1&&r.x+r.width<=width+1);assert.equal(await sheet.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);}
 await master.setViewportSize({width:1280,height:900});
 await master.reload();await master.locator('canvas').waitFor();await openSheet(master,c.id);await master.getByRole('tab',{name:'Снаряжение',exact:true}).click();
 await master.locator('.card').filter({hasText:'Secret NPC sabre'}).getByTitle('править',{exact:true}).click();await editor.getByPlaceholder('Название',{exact:true}).fill('Secret NPC axe');await editor.getByLabel('Кол-во',{exact:true}).fill('3');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();
 stored=(await until(async()=>{const s=(await(await gm.request.get(`${api}/api/characters`)).json()).find(x=>x.id===c.id);return s.data.equipment[0]?.name==='Secret NPC axe'?s:null;},'NPC edit persisted'));assert.equal(stored.data.equipment[0].qty,3);
 const card=master.locator('.card').filter({hasText:'Secret NPC axe'});await card.getByTitle('удалить',{exact:true}).click();await card.getByRole('button',{name:'Удалить?',exact:true}).click();await until(async()=>!(await(await gm.request.get(`${api}/api/characters`)).json()).find(x=>x.id===c.id).data.equipment.length,'NPC item removed');
 assert.equal(JSON.stringify(observer.received).includes('Secret NPC'),false);assert.equal((await(await player.request.get(`${api}/api/characters`)).json()).some(x=>x.id===c.id),false);
 await closeSheet(master);await master.close();await observer.close();
});
