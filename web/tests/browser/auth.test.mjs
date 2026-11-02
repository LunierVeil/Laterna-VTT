import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browser, errors, base, api, gm, player, sceneId, control, setSceneId,
  until, probe, command, pageFor, openSheet, closeSheet, scene, capture,
  stageToken, atToken, nextToken } from './fixture.mjs';


test('Final shared invite: one copied link for independent users, repeat login, pause and revoke',{timeout:120000},async()=>{
 const master=await pageFor(gm),observer=await pageFor(player);await master.getByRole('tab',{name:'Игроки',exact:true}).click();
 await master.getByRole('button',{name:'Создать общую ссылку',exact:true}).click();
 const link=master.getByRole('textbox',{name:'Общая ссылка-приглашение'});await link.waitFor();
 await master.getByRole('textbox',{name:'Адрес сервера для игроков'}).fill('https://table.example:9443/path?gm=must-not-copy');
 const copied=await link.inputValue();assert.equal(new URL(copied).origin,'https://table.example:9443');assert.equal(new URL(copied).searchParams.has('gm'),false);
 await gm.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await master.getByRole('button',{name:'Копировать общую ссылку',exact:true}).click();assert.equal(await master.evaluate(()=>navigator.clipboard.readText()),copied);
 const token=new URL(copied).searchParams.get('invite');assert.ok(token.length>=40);
 const sessions=[];
 for(const name of ['Shared browser A','Shared browser B']){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(`${base}/?invite=${encodeURIComponent(token)}`);await p.getByPlaceholder('Имя',{exact:true}).fill(name);await p.getByPlaceholder('Пароль, от 8 символов',{exact:true}).fill('browserpass123');await p.getByPlaceholder('Пароль ещё раз',{exact:true}).fill('browserpass123');await p.getByRole('button',{name:'Создать и войти',exact:true}).click();await p.locator('canvas').waitFor();
  assert.equal(await p.evaluate(async()=> (await import('/src/state/store.ts')).useUi.getState().isGm),false);assert.equal(new URL(p.url()).searchParams.has('invite'),false);sessions.push({ctx,p,name});
 }
 const before=(await(await gm.request.get(`${api}/api/campaign`)).json()).users.length;
 const ctx=await browser.newContext(),again=await ctx.newPage();await again.goto(`${base}/?invite=${token}`);await again.getByRole('checkbox',{name:'У меня есть аккаунт'}).check();await again.getByPlaceholder('Имя',{exact:true}).fill(sessions[0].name);await again.getByPlaceholder('Пароль, от 8 символов',{exact:true}).fill('browserpass123');await again.getByRole('button',{name:'Войти в кампанию',exact:true}).click();await again.locator('canvas').waitFor();assert.equal((await(await gm.request.get(`${api}/api/campaign`)).json()).users.length,before);
 await master.getByRole('checkbox',{name:'Приём новых игроков'}).uncheck();await until(async()=>!(await master.getByRole('checkbox',{name:'Приём новых игроков'}).isChecked())&&(await master.getByRole('checkbox',{name:'Приём новых игроков'}).isEnabled()),'pause applied');
 const info=await sessions[1].ctx.request.post(`${api}/api/invite/info`,{data:{token}});assert.equal((await info.json()).paused,true);
 await sessions[1].p.goto(`${base}/?invite=${token}`);await sessions[1].p.getByRole('button',{name:`Продолжить как ${sessions[1].name}`}).click();await sessions[1].p.locator('canvas').waitFor();
 const refused=await observer.request.post(`${api}/api/invite/accept`,{data:{token,name:'Paused new browser',password:'browserpass123'}});assert.equal(refused.status(),403);
 await master.getByRole('button',{name:'Отозвать общую ссылку',exact:true}).click();await master.getByRole('button',{name:'Создать общую ссылку',exact:true}).waitFor();assert.equal((await observer.request.post(`${api}/api/invite/info`,{data:{token}})).status(),404);
 for(const s of sessions)assert.equal((await s.ctx.request.get(`${api}/api/me`)).status(),200);
 assert.equal(JSON.stringify(observer.received).includes(token),false);assert.equal(await observer.getByRole('tab',{name:'Игроки',exact:true}).count(),0);
 for(const s of sessions)await s.ctx.close();await ctx.close();await master.close();await observer.close();
});
