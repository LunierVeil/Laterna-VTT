import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, gm, player, pageFor, command, closeSheet, until, scene, stageToken } from './fixture.mjs';

test('Catalog: PC/NPC UI create, copy, placement, owner/GM visibility and safe deletion detach', {timeout:120000}, async()=>{
  const sent=[];const observe=p=>p.on('websocket',ws=>ws.on('framesent',frame=>{try{const m=JSON.parse(String(frame.payload));if(m.type==='cmd')sent.push({page:p,...m});}catch{}}));
  gm.on('page',observe);player.on('page',observe);
  const master=await pageFor(gm),owner=await pageFor(player);
  try{
    for(const p of [master,owner])await p.getByRole('tab',{name:'Персонажи',exact:true}).click();
    assert.equal(await owner.getByRole('tab',{name:'Мобы и NPC',exact:true}).count(),0);
    const start=sent.length;await owner.getByRole('button',{name:'Новый персонаж',exact:true}).click();
    await owner.locator('.sheet').waitFor();
    const pc=await owner.evaluate(async()=>{const s=(await import('/src/state/store.ts')).useUi.getState();return s.characters[s.openCharacterId];});
    assert.deepEqual(sent.slice(start).find(m=>m.page===owner&&m.name==='character.create').payload,{name:'Новый персонаж'});
    await closeSheet(owner);
    const pcRow=owner.locator('.sheet-row').filter({has:owner.locator('.sheet-row-name',{hasText:pc.name})});await pcRow.waitFor();
    assert.equal(await pcRow.getByRole('button',{name:'Удалить',exact:true}).count(),1);
    await master.getByRole('tab',{name:'Мобы и NPC',exact:true}).click();
    const mark=sent.length;await master.getByRole('button',{name:'Новый моб',exact:true}).click();await master.locator('.sheet').waitFor();
    const npc=await master.evaluate(async()=>{const s=(await import('/src/state/store.ts')).useUi.getState();return s.characters[s.openCharacterId];});
    assert.deepEqual(sent.slice(mark).find(m=>m.page===master&&m.name==='character.create').payload,{name:'Новый моб',system:'mob'});
    await command('character.update',{id:npc.id,set:{'hp.max':9}});await closeSheet(master);
    const row=()=>master.locator('.sheet-row').filter({has:master.locator('.sheet-row-name',{hasText:npc.name})}).filter({hasNot:master.locator('.sheet-row-name',{hasText:`${npc.name} 2`})});
    await row().waitFor();const copyMark=sent.length;
    await row().getByRole('button',{name:'Копия',exact:true}).click();await master.locator('.sheet').waitFor();
    const copy=await master.evaluate(async()=>{const s=(await import('/src/state/store.ts')).useUi.getState();return s.characters[s.openCharacterId];});
    assert.notEqual(copy.id,npc.id);assert.equal(copy.system,'mob');assert.deepEqual(copy.data,npc.data.hp?npc.data:{hp:{max:9}});
    assert.deepEqual(sent.slice(copyMark).find(m=>m.name==='character.copy').payload,{id:npc.id});await closeSheet(master);
    const placeMark=sent.length;await row().getByRole('button',{name:'На карту',exact:true}).click();
    const token=await until(async()=>(await scene(master)).tokens.find(t=>t.character_id===npc.id),'placed NPC');
    const place=sent.slice(placeMark).find(m=>m.name==='token.add');assert.equal(place.payload.character_id,npc.id);assert.equal('layer'in place.payload,false);
    for(const p of [master,owner])await until(()=>stageToken(p,token.id),'placed token rendered');
    assert.equal(await owner.locator('.sheet-row').filter({hasText:npc.name}).count(),0,'private NPC absent from player catalog');
    await row().getByRole('button',{name:'Удалить',exact:true}).click();
    const dialog=master.getByRole('alertdialog');await dialog.waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Отмена',exact:true}).evaluate(e=>e===document.activeElement),true);
    await until(async()=>(await dialog.textContent()).includes('и потеряют свои хиты'),'mob deletion impact count');
    await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.ok((await(await gm.request.get(`${api}/api/characters`)).json()).some(c=>c.id===npc.id));
    const deleteMark=sent.length;await row().getByRole('button',{name:'Удалить',exact:true}).click();await dialog.getByRole('button',{name:'Удалить',exact:true}).click();
    await until(()=>sent.slice(deleteMark).some(m=>m.name==='character.delete'&&m.payload.id===npc.id),'delete sent');
    for(const p of [master,owner])await until(async()=>{const t=await stageToken(p,token.id);return t&&t.data.character_id===null&&!t.hpVisible;},'UI delete detaches client tokens');
    assert.equal(sent.slice(deleteMark).filter(m=>m.name==='character.delete').length,1);
    assert.equal((await(await player.request.get(`${api}/api/characters`)).json()).some(c=>c.system==='mob'),false);
  }finally{gm.off('page',observe);player.off('page',observe);}
});
