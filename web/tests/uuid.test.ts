import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuidV4 } from '../src/shared/lib/uuid.ts';
const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
test('native UUID preserves receiver and result', () => {
  const source = {randomUUID() {assert.equal(this,source);return '12345678-1234-4123-8123-123456789abc' as const;}, getRandomValues() {throw Error('unused');}};
  assert.equal(uuidV4(source), '12345678-1234-4123-8123-123456789abc');
});
test('fallback sets version/variant, retains legacy card IDs and is unique', () => {
  const source = {getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)};
  const ids = new Set(Array.from({length:10000}, () => uuidV4(source)));
  assert.equal(ids.size,10000);
  for(const id of ids) { assert.match(id,pattern); assert.match(`c-${id.slice(0,12)}`,/^c-[0-9a-f]{8}-[0-9a-f]{3}$/); }
  assert.equal(uuidV4({getRandomValues: (a: any) => {a.fill(255);return a;}}), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
test('no insecure entropy fallback', () => {
  assert.throws(()=>uuidV4({} as Crypto), /безопасный источник/);
  assert.throws(()=>uuidV4({getRandomValues(){throw Error('entropy failed');}}), /entropy failed/);
});

test('socket entropy failure reports an error without optimistic mutation or sending', async () => {
  const { SceneSocket } = await import('../src/shared/api/scene-socket.ts');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {configurable:true,value:{}});
  try {
    const socket = new SceneSocket('test');
    let applied = false;
    const messages: any[] = [];
    socket.on(m => messages.push(m));
    assert.equal(socket.send('token.add',{}, {apply(){applied=true;},revert(){throw Error('not applied');}}),'');
    assert.equal(applied,false);
    assert.equal(messages.length,1);
    assert.equal(messages[0].type,'error');
    assert.equal(messages[0].cmd_id,null);
  } finally { if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor); }
});
