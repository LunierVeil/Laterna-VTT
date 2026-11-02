// Книга заклинаний в схеме: один блок на вкладке, пути - как ждёт сервер.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dnd5e } from "../src/sheets/dnd5e.ts";

test("вкладка «Заклинания» - книга с ячейками slots.N", () => {
  const tab = dnd5e.tabs.find((t) => t.id === "spells");
  assert.ok(tab);
  assert.equal(tab.blocks.length, 1);
  const book = tab.blocks[0];
  assert.equal(book.kind, "spellbook");
  if (book.kind !== "spellbook") return;
  assert.equal(book.path, "spells");
  assert.equal(book.slots, "slots");
});
