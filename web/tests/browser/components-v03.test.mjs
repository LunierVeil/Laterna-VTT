import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browser, base, errors, until } from './fixture.mjs';

async function fixture(width=1280,query='') {
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/tests/browser/fixtures/components-v03.html?${query}`);
 await page.getByRole('heading',{name:'Компоненты v0.3'}).waitFor();return {context,page};
}
async function shot(page,name) {
 if(!process.env.BROWSER_RESULTS_DIR)return;
 await mkdir(process.env.BROWSER_RESULTS_DIR,{recursive:true});await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:resolve(process.env.BROWSER_RESULTS_DIR,`${name}.png`),animations:'disabled'});
}
const focused = locator => locator.evaluate(el=>el===document.activeElement);

test('Components v0.3 Tabs: roving focus, conditional/disabled tabs, retained drafts and narrow overflow', {timeout:90000}, async()=>{
 for(const width of [340,280])for(const query of ['', 'regular']){
  const {context,page:p}=await fixture(width,query);
  try{
   const chat=p.getByRole('tab',{name:'Чат',exact:true}),characters=p.getByRole('tab',{name:'Персонажи',exact:true}),scenes=p.getByRole('tab',{name:'Сцены',exact:true}),players=p.getByRole('tab',{name:'Игроки',exact:true});
   await p.getByRole('textbox',{name:'Черновик'}).fill('Несохранённый черновик');
   assert.equal(await chat.evaluate(el=>getComputedStyle(el).color),'rgb(240, 177, 74)');await chat.focus();await p.keyboard.press('ArrowRight');assert.equal(await focused(characters),true);assert.equal(await characters.getAttribute('aria-selected'),'true');
   await p.keyboard.press('ArrowRight');assert.equal(await focused(scenes),true);
   await p.keyboard.press('End');assert.equal(await focused(players),true);await p.keyboard.press('ArrowRight');assert.equal(await focused(chat),true);
   assert.equal(await p.getByRole('textbox',{name:'Черновик'}).inputValue(),'Несохранённый черновик');
   await p.keyboard.press('ArrowLeft');assert.equal(await focused(players),true);await p.keyboard.press('Home');assert.equal(await focused(chat),true);
   assert.equal(await p.locator('[role=tab][tabindex="0"]').count(),1);
   await p.getByRole('checkbox',{name:'GM',exact:true}).uncheck();assert.equal(await scenes.count(),0);assert.equal(await players.count(),0);
   await characters.click();await p.getByRole('textbox',{name:'Поиск персонажа'}).fill('Алия');await chat.click();await characters.click();assert.equal(await p.getByRole('textbox',{name:'Поиск персонажа'}).inputValue(),'Алия');
   await p.getByRole('checkbox',{name:'Отключить вкладки'}).check();assert.equal(await p.locator('[role=tab]:not(:disabled)').count(),0);assert.equal(await p.getByRole('textbox',{name:'Поиск персонажа'}).inputValue(),'Алия');assert.equal(await p.locator('[role=tab][tabindex="0"]').count(),0);
   await p.getByRole('checkbox',{name:'Отключить вкладки'}).uncheck();await chat.click();
   await p.getByRole('checkbox',{name:'GM',exact:true}).check();await players.click();await p.keyboard.press('Home');
   for(const key of ['End','Home','ArrowRight','ArrowRight','ArrowRight','ArrowLeft','Home']){
    await p.keyboard.press(key);
    await until(()=>p.locator('[role=tab][aria-selected=true]').evaluate(el=>{
     const tab=el.getBoundingClientRect(),list=el.parentElement.getBoundingClientRect();
     return el===document.activeElement&&tab.left>=list.left-1&&tab.right<=list.right+1;
    }),`keyboard-selected tab fully visible after ${key}`);
   }
   const metrics=await p.getByRole('tablist').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,overflow:getComputedStyle(el).overflowX,font:getComputedStyle(el.firstElementChild).fontSize}));
   assert.ok(metrics.scroll>metrics.client);assert.equal(metrics.overflow,'auto');assert.ok(parseFloat(metrics.font)>=13);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   for(const tab of await p.getByRole('tab').all()){const panel=await tab.getAttribute('aria-controls');assert.equal(await p.locator(`[id="${panel}"]`).getAttribute('aria-labelledby'),await tab.getAttribute('id'));}
   await shot(p,`tabs-${width}-${query||'compact'}`);
  }finally{await context.close();}
 }
});

test('Components v0.3 Dialog: native modal, safe Enter, trap, restore, cancel, pending and async error', {timeout:90000}, async()=>{
 const {context,page:p}=await fixture();
 try{
  const opener=p.getByRole('button',{name:'Открыть Dialog'}),dialog=p.getByRole('alertdialog'),cancel=p.getByRole('button',{name:'Отмена',exact:true}),confirm=p.getByRole('button',{name:'Подтвердить',exact:true}),state=p.getByTestId('dialog-state');
  const open=async()=>{await opener.click();await dialog.waitFor();await until(()=>focused(cancel),'cancel focus');assert.equal(await dialog.evaluate(el=>el.matches(':modal')),true);};
  await open();await p.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-calls'),'0');assert.equal(await focused(opener),true);
  await open();await p.keyboard.press('Shift+Tab');assert.equal(await focused(confirm),true);await p.keyboard.press('Tab');assert.equal(await focused(cancel),true);
  await p.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await focused(opener),true);
  await open();await p.getByRole('heading',{name:'Подтвердить действие?'}).click();assert.equal(await dialog.count(),1);
  await p.mouse.click(2,2);await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-calls'),'0');
  await p.getByRole('combobox',{name:'Результат',exact:true}).selectOption('error');await open();await confirm.click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').textContent(),/Не удалось сохранить/);assert.equal(await confirm.isEnabled(),true);await shot(p,'dialog-error');await cancel.click();
  await p.getByRole('combobox',{name:'Результат',exact:true}).selectOption('deferred');await open();
  const before=Number(await state.getAttribute('data-calls'));await confirm.evaluate(el=>{el.click();el.click();});
  await until(async()=>await dialog.getAttribute('aria-busy')==='true','dialog busy');assert.equal(await dialog.getByRole('status').textContent(),'Выполняется…');assert.equal(Number(await state.getAttribute('data-calls')),before+1);
  assert.equal(await cancel.isDisabled(),true);assert.equal(await confirm.isDisabled(),true);await p.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el===document.activeElement),true);assert.equal(await dialog.evaluate(el=>getComputedStyle(el).outlineColor),'rgb(240, 177, 74)');await p.keyboard.press('Escape');await p.mouse.click(2,2);assert.equal(await dialog.count(),1);await shot(p,'dialog-pending');
  await p.locator('#reject-operation').evaluate(el=>el.click());await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('alert').textContent(),'Ошибка операции');assert.equal(await confirm.isEnabled(),true);await cancel.click();
  await open();await confirm.click();await until(async()=>await dialog.getAttribute('aria-busy')==='true','retry busy');await p.locator('#resolve-operation').evaluate(el=>el.click());await dialog.waitFor({state:'detached'});assert.equal(await focused(opener),true);
  await p.getByRole('combobox',{name:'Результат',exact:true}).selectOption('success');await p.getByRole('combobox',{name:'Тип диалога'}).selectOption('confirmation');await open();await cancel.click();
  await p.getByRole('combobox',{name:'Тип диалога'}).selectOption('information');await opener.click();const info=p.getByRole('dialog');await info.waitFor();assert.equal(await cancel.count(),0);assert.equal(await focused(p.getByRole('button',{name:'Понятно'})),true);await p.keyboard.press('Enter');await info.waitFor({state:'detached'});
  await p.setViewportSize({width:280,height:400});await p.getByRole('checkbox',{name:'Длинное описание'}).check();await p.getByRole('combobox',{name:'Тип диалога'}).selectOption('danger');await open();
  assert.equal(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true);
  assert.equal(await p.locator('.ds-dialog-body').evaluate(el=>el.scrollHeight>el.clientHeight),true);assert.equal(await cancel.isVisible(),true);await shot(p,'dialog-long-280');await cancel.click();
 }finally{await context.close();}
});

test('Components v0.3 Tooltip: hover delay, focus, Escape, all placements and viewport collision', {timeout:60000}, async()=>{
 const {context,page:p}=await fixture();
 try{
  for(const placement of ['top','bottom','left','right']){
   const trigger=p.getByRole('button',{name:placement,exact:true});await trigger.focus();const tip=p.getByRole('tooltip');await tip.waitFor();
   assert.equal(await tip.textContent(),`Подсказка ${placement}`);assert.equal(await tip.getAttribute('data-placement'),placement);
   assert.ok((await trigger.getAttribute('aria-describedby')).split(' ').includes(await tip.getAttribute('id')));assert.ok((await trigger.getAttribute('aria-describedby')).includes('existing-hint'));
   await p.keyboard.press('Escape');await tip.waitFor({state:'detached'});assert.equal(await focused(trigger),true);await trigger.blur();
  }
  const trigger=p.getByRole('button',{name:'top',exact:true});await p.mouse.move(0,0);
  await trigger.evaluate(el=>{
   window.tooltipTiming={start:null,shown:null};
   el.addEventListener('mouseover',()=>{window.tooltipTiming.start=performance.now();},{once:true});
   const observer=new MutationObserver(()=>{if(document.querySelector('[role=tooltip]')){window.tooltipTiming.shown=performance.now();observer.disconnect();}});
   observer.observe(document.body,{childList:true,subtree:true});
  });
  await trigger.hover();await p.getByRole('tooltip').waitFor();
  const timing=await p.evaluate(()=>window.tooltipTiming);assert.ok(timing.start!==null&&timing.shown-timing.start>=390,JSON.stringify(timing));await p.mouse.move(0,0);await p.getByRole('tooltip').waitFor({state:'detached'});
  await p.setViewportSize({width:280,height:400});await p.getByRole('button',{name:'У края'}).focus();await p.getByRole('tooltip').waitFor();
  await until(()=>p.getByRole('tooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'tooltip in viewport');
  assert.equal(await p.getByRole('tooltip').getAttribute('data-placement'),'left');await shot(p,'tooltip-edge-280');
  assert.equal(await p.getByRole('tooltip').evaluate(el=>getComputedStyle(el).animationName),'none');await p.keyboard.press('Escape');await p.getByRole('tooltip').waitFor({state:'detached'});
  const edge=p.getByRole('button',{name:'У края'});await edge.blur();
  for(const corner of ['left:8px;top:8px','right:8px;top:8px','left:8px;bottom:8px','right:8px;bottom:8px']){
   await p.locator('.v03-edge').evaluate((el,position)=>el.style.cssText=`position:fixed;${position}`,corner);
   await p.mouse.move(140,200);await edge.focus();await p.getByRole('tooltip').waitFor();
   await until(()=>p.getByRole('tooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),`tooltip corner ${corner}`);
   await p.getByRole('tooltip').hover();await p.keyboard.press('Escape');await p.getByRole('tooltip').waitFor({state:'detached'});await edge.blur();
  }
 }finally{await context.close();}
});

test('Components v0.3 Select: native keyboard, controlled value, disabled, error, loading and ref', {timeout:60000}, async()=>{
 const {context,page:p}=await fixture(340);
 try{
  const select=p.getByRole('combobox',{name:'Режим',exact:true});await p.getByText('Режим',{exact:true}).click();assert.equal(await focused(select),true);
  await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');await until(async()=>await p.getByTestId('selected').textContent()==='view','first native option');
  await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');await until(async()=>await p.getByTestId('selected').textContent()==='edit','skip disabled option');
  assert.equal(await select.inputValue(),'edit');await p.keyboard.press('Tab');assert.equal(await focused(p.getByRole('combobox',{name:'Ошибка выбора'})),true);assert.equal(await p.getByRole('combobox',{name:'Недоступный режим'}).isDisabled(),true);
  const error=p.getByRole('combobox',{name:'Ошибка выбора'});assert.equal(await error.getAttribute('aria-invalid'),'true');const ids=(await error.getAttribute('aria-describedby')).split(' ');assert.ok(ids.includes('select-hint'));assert.equal(await p.locator(`[id="${ids[1]}"]`).textContent(),'Выберите доступный режим');
  const loading=p.getByRole('combobox',{name:'Загружаемый режим'});await p.getByRole('button',{name:'Переключить загрузку'}).click();assert.equal(await loading.isDisabled(),true);assert.equal(await loading.getAttribute('aria-busy'),'true');await loading.locator('..').getByRole('status').waitFor();await shot(p,'select-states-340');
  await p.getByRole('button',{name:'Переключить загрузку'}).click();assert.equal(await loading.isEnabled(),true);
  await p.getByRole('button',{name:'Фокус на select'}).click();assert.equal(await focused(select),true);
 }finally{await context.close();}
});
