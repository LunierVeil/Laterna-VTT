import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entries = JSON.parse(await readFile(new URL('../src/app/mock/srd51.json', import.meta.url), 'utf8'));
assert.equal(entries.length, 50);
assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
for (const entry of entries) {
  assert.match(entry.id, /^srd-[a-z-]+$/);
  assert.ok(Number.isInteger(entry.page) && entry.page > 250 && entry.page < 410);
  assert.ok(Number.isInteger(entry.hp) && entry.hp > 0);
  assert.ok(Number.isInteger(entry.ac) && entry.ac > 0);
  assert.ok(Number.isInteger(entry.speed) && entry.speed >= 0);
  assert.match(entry.challenge, /^(\d+|1\/[248])$/);
  assert.ok(entry.actions.length > 0 && entry.actions.every(action => typeof action === 'string' && action.trim()));
}
console.log('SRD 5.1: 50 unique local catalogue profiles with source pages.');
