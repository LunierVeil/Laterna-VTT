import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gm, player, sceneId, command, pageFor, probe, until, stageToken } from './fixture.mjs';

test('Initiative: linked bonus, server d20 result, owner/GM rights and missing bonus fallback', {timeout:120000}, async () => {
  const sent = [];
  const observe = page => page.on('websocket', ws => ws.on('framesent', frame => {
    try {const msg = JSON.parse(String(frame.payload)); if (msg.type === 'cmd') sent.push({page, ...msg});} catch {}
  }));
  gm.on('page', observe); player.on('page', observe);
  const master = await pageFor(gm), owner = await pageFor(player);
  try {
    await probe(owner, sceneId);
    const c = (await command('character.create', {name:'Initiative owner'}, owner)).payload.character;
    await command('character.update', {id:c.id, set:{'vitals.initiative':3}}, owner);
    const own = (await command('token.add', {x:175,y:175,character_id:c.id})).payload.token;
    const empty = (await command('character.create', {name:'Initiative no bonus'})).payload.character;
    const missing = (await command('token.add', {x:315,y:175,character_id:empty.id})).payload.token;
    const unlinked = (await command('token.add', {x:455,y:175,name:'Initiative unlinked'})).payload.token;
    for (const p of [master, owner]) {
      await until(() => stageToken(p, own.id), 'linked initiative token rendered');
      await p.getByRole('button', {name:'Трекер инициативы', exact:true}).click();
    }
    await until(() => owner.evaluate(async id => (await import('/src/state/store.ts')).useUi.getState().characters[id]?.data.vitals?.initiative === 3, c.id), 'linked bonus applied on owner');
    const select = async (p, id) => {await until(() => stageToken(p,id), 'token visible before selection'); await p.evaluate(id => window.observedStage.select(id), id);};
    await select(owner, own.id);
    await owner.locator('.initiative').getByRole('button', {name:`В бой: ${own.name}`,exact:true}).click();
    const ownEntry = await until(() => owner.evaluate(async id => (await import('/src/state/store.ts')).useUi.getState().combat?.entries.find(e=>e.token_id===id), own.id), 'owner added own initiative entry');
    const row = (p, name) => p.locator('.init-row').filter({has:p.locator('.init-name', {hasText:name})});
    const ownRow = row(owner,own.name);
    await ownRow.getByRole('textbox', {name:`${own.name}: инициатива`,exact:true}).fill('12');
    await ownRow.getByRole('textbox', {name:`${own.name}: инициатива`,exact:true}).press('Enter');
    await until(() => master.evaluate(async id => (await import('/src/state/store.ts')).useUi.getState().combat?.entries.find(e=>e.id===id)?.init===12, ownEntry.id), 'manual initiative delivered');
    const roll = async (p, name, entryId, bonus) => {
      const mark = sent.length, r = row(p,name);
      await r.getByRole('button', {name:'🎲',exact:true}).click();
      const cmd = await until(() => sent.slice(mark).find(m=>m.page===p&&m.name==='combat.roll'&&m.payload.entry_id===entryId), 'actual combat.roll frame');
      assert.deepEqual(cmd.payload, {entry_id:entryId,bonus});
      const event = await until(() => p.received.find(m=>m.type==='event'&&m.name==='combat.updated'&&m.cmd_id===cmd.id), 'correlated server combat result');
      const result = event.payload.combat.entries.find(e=>e.id===entryId);
      assert.ok(Number.isInteger(result.roll.die)&&result.roll.die>=1&&result.roll.die<=20);
      assert.equal(result.roll.formula, bonus ? `1d20${bonus>0?'+':''}${bonus}` : '1d20');
      assert.equal(result.init, result.roll.die+bonus);
      await until(async () => await r.getByRole('textbox', {name:`${name}: инициатива`,exact:true}).inputValue()===String(result.init), 'server total rendered');
      await until(async () => await r.locator('.init-roll').textContent()===`d20: ${result.roll.die}`, 'server die rendered');
      assert.equal(await r.locator('.init-roll').getAttribute('title'), result.roll.formula);
      return result;
    };
    await roll(owner, own.name, ownEntry.id, 3);
    const gmResult = await roll(master, own.name, ownEntry.id, 3);
    await until(async () => await ownRow.getByRole('textbox').inputValue()===String(gmResult.init), 'GM roll broadcasts to owner');
    // A player cannot add a GM-owned token; hidden UI is also enforced by the server.
    await select(owner, missing.id);
    assert.equal(await owner.locator('.initiative').getByRole('button', {name:`В бой: ${missing.name}`,exact:true}).count(),0);
    const deny = async (name,payload) => {
      const id=randomUUID(); await owner.evaluate(({id,name,payload})=>window.probe.send(JSON.stringify({type:'cmd',id,name,payload})),{id,name,payload});
      const reply=await until(()=>owner.received.find(m=>m.type==='error'&&m.cmd_id===id), 'permission rejection');
      assert.match(reply.message,/свой|твой/);
    };
    await deny('combat.add',{token_id:missing.id});
    for (const token of [missing,unlinked]) {
      await select(master,token.id);
      await master.locator('.initiative').getByRole('button',{name:`В бой: ${token.name}`,exact:true}).click();
      const entry=await until(()=>master.evaluate(async id=>(await import('/src/state/store.ts')).useUi.getState().combat?.entries.find(e=>e.token_id===id),token.id),'GM added fallback entry');
      await roll(master,token.name,entry.id,0);
      await row(owner,token.name).waitFor();
      assert.equal(await row(owner,token.name).getByRole('textbox').count(),0);
      assert.equal(await row(owner,token.name).getByRole('button',{name:'🎲',exact:true}).count(),0);
      await deny('combat.roll',{entry_id:entry.id,bonus:0});
    }
  } finally {
    gm.off('page',observe); player.off('page',observe);
    await master.close(); await owner.close();
  }
});
