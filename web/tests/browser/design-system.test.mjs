import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browser, base, errors, until } from './fixture.mjs';

async function fixture(query, viewport = {width:1280,height:900}) {
  const context=await browser.newContext({viewport}),page=await context.newPage();
  page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/tests/browser/fixtures/design-system.html?${query}`);
  return {context,page};
}

test('Design System: ConfirmDialog safe focus, keyboard, backdrop and confirmation', {timeout:90000}, async()=>{
 for(const width of [1280,390])for(const variant of ['danger','primary']){
  const {context,page:p}=await fixture(`variant=${variant}`,{width,height:900});
  try{
   const cancel=p.getByRole('button',{name:'Отмена',exact:true}),dialog=p.getByRole('alertdialog',{name:'Удалить «Страж»?'}),state=p.locator('output');
   await dialog.waitFor();await until(()=>cancel.evaluate(el=>el===document.activeElement),'initial cancel focus');
   assert.equal(await dialog.getAttribute('aria-modal'),'true');await p.evaluate(()=>document.fonts.ready);
   if(process.env.BROWSER_RESULTS_DIR){await mkdir(process.env.BROWSER_RESULTS_DIR,{recursive:true});await p.screenshot({path:resolve(process.env.BROWSER_RESULTS_DIR,`confirm-${variant}-${width}.png`),animations:'disabled'});}
   await p.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-confirmed'),'0');assert.equal(await state.getAttribute('data-cancelled'),'1');
   const reopen=async()=>{await p.getByRole('button',{name:'Открыть подтверждение'}).click();await until(()=>cancel.evaluate(el=>el===document.activeElement),'reopened cancel focus');};
   await reopen();await p.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-cancelled'),'2');
   await reopen();await p.getByRole('heading',{name:'Удалить «Страж»?'}).click();assert.equal(await dialog.count(),1);
   await p.locator('.dialog-overlay').click({position:{x:2,y:2}});await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-cancelled'),'3');
   await reopen();await p.keyboard.press('Space');await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-cancelled'),'4');
   await reopen();await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'Удалить',exact:true}).evaluate(el=>el===document.activeElement),true);
   await p.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await state.getAttribute('data-confirmed'),'1');assert.equal(await state.getAttribute('data-cancelled'),'4');
  }finally{await context.close();}
 }
});

test('Design System: fields, checkboxes, refs, native forms and disabled behavior', {timeout:60000}, async()=>{
 const {context,page:p}=await fixture('mode=components');
 try{
  await p.getByRole('region',{name:'Основные элементы'}).waitFor();
  const name=p.getByRole('textbox',{name:'Имя',exact:true}),check=p.getByRole('checkbox',{name:'Сетка',exact:true}),state=p.getByTestId('state');
  await p.getByText('Имя',{exact:true}).click();assert.equal(await name.evaluate(el=>el===document.activeElement),true);
  await name.fill('Алия');assert.equal(await state.getAttribute('data-name'),'Алия');
  await p.getByRole('button',{name:'Без отправки',exact:true}).click();assert.equal(await state.getAttribute('data-submits'),'0');
  await p.getByRole('button',{name:'Отправить',exact:true}).click();assert.equal(await state.getAttribute('data-submits'),'1');
  await p.getByRole('button',{name:'Фокус на имя'}).click();assert.equal(await name.evaluate(el=>el===document.activeElement),true);
  await p.getByRole('button',{name:'Фокус на чекбокс'}).click();assert.equal(await check.evaluate(el=>el===document.activeElement),true);
  await p.keyboard.press('Space');assert.equal(await check.isChecked(),true);assert.equal(await state.getAttribute('data-checked'),'true');
  await p.getByText('Сетка',{exact:true}).click();assert.equal(await check.isChecked(),false);
  const before=await state.getAttribute('data-clicks');await p.getByRole('button',{name:'Недоступная',exact:true}).evaluate(el=>el.click());assert.equal(await state.getAttribute('data-clicks'),before);
  assert.equal(await p.getByRole('textbox',{name:'Недоступное поле'}).isDisabled(),true);
  const disabled=p.getByRole('checkbox',{name:'Недоступный выбор'});assert.equal(await disabled.isDisabled(),true);const labelBounds=await p.getByText('Недоступный выбор',{exact:true}).boundingBox();assert.ok(labelBounds);await p.mouse.click(labelBounds.x+labelBounds.width/2,labelBounds.y+labelBounds.height/2);assert.equal(await disabled.isChecked(),true);
  const invalid=p.getByRole('textbox',{name:'Проверка',exact:true});assert.equal(await invalid.getAttribute('aria-invalid'),'true');
  const described=(await invalid.getAttribute('aria-describedby')).split(' ');assert.ok(described.includes('field-hint'));assert.equal(await p.locator(`[id="${described[1]}"]`).textContent(),'Введите значение');
  assert.equal(await p.locator('.fixture-panel').count(),1);
 }finally{await context.close();}
});

test('Design System: palette, button states and keyboard skips disabled controls', {timeout:60000}, async()=>{
 const {context,page:p}=await fixture('mode=components');
 try{
  const button=p.getByRole('button',{name:'Обычная',exact:true});await button.waitFor();await p.keyboard.press('Tab');assert.equal(await button.evaluate(el=>el===document.activeElement),true);
  assert.equal(await button.evaluate(el=>getComputedStyle(el).outlineWidth),'2px');for(let i=0;i<4;i++)await p.keyboard.press('Tab');assert.equal(await p.getByRole('textbox',{name:'Имя',exact:true}).evaluate(el=>el===document.activeElement),true);
  const primary=p.getByRole('button',{name:'Основная',exact:true});assert.equal(await primary.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(240, 177, 74)');
  await button.hover();assert.equal(await button.evaluate(el=>getComputedStyle(el).borderColor),'rgb(58, 62, 75)');await p.mouse.down();assert.equal(await button.evaluate(el=>getComputedStyle(el).filter),'brightness(0.95)');await p.mouse.up();
  const disabled=p.getByRole('button',{name:'Недоступная',exact:true});await disabled.hover();assert.equal(await disabled.evaluate(el=>getComputedStyle(el).opacity),'0.5');assert.equal(await disabled.evaluate(el=>getComputedStyle(el).borderColor),'rgb(44, 47, 58)');
  const aliases=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);return ['--color-background','--color-panel','--color-success','--color-danger'].map(name=>s.getPropertyValue(name).trim());});assert.deepEqual(aliases,['#121318','#17181e','#6cc070','#c75c5c']);
  assert.equal(await button.getAttribute('type'),'button');assert.equal((await button.getAttribute('class')).includes('fixture-button'),true);
 }finally{await context.close();}
});
