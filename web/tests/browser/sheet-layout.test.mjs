import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gm, until, command, pageFor, openSheet, closeSheet } from './fixture.mjs';

function mobileSheetTest(system) {
  return async () => {
    const p=await pageFor(gm),failures=[];
    const c=(await command('character.create',{name:`Mobile ${system}`,system})).payload.character;
    if(system==='dnd5e') {
      await command('character.list',{id:c.id,path:'weapons',op:'add',item:{name:'Long weapon name',attack:5,damage:'1d8+3'}});
      await command('character.list',{id:c.id,path:'equipment',op:'add',item:{name:'Travel equipment',qty:3,weight:2}});
    }
    await until(()=>p.evaluate(async id=>!!(await import('/src/state/store.ts')).useUi.getState().characters[id],c.id),'mobile sheet delivered');
    await openSheet(p,c.id);
    for(const width of [360,390,430,768,1024,1280]) {
      const started = Date.now();
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
      console.log('B10 viewport', JSON.stringify({system,width,elapsedMs:Date.now()-started}));
    }
    await closeSheet(p);await p.setViewportSize({width:1280,height:900});
    assert.deepEqual(failures,[],JSON.stringify(failures));await p.close();
  };
}

test('B10 PC: populated sheet fits every mobile tab in view and edit modes', {timeout:120000}, mobileSheetTest('dnd5e'));
test('B10 NPC: populated sheet fits every mobile tab in view and edit modes', {timeout:120000}, mobileSheetTest('mob'));

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
