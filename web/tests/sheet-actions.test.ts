import { test } from "node:test";
import assert from "node:assert/strict";
import { createSheetActions } from "../src/widgets/character-sheet/model/sheet-actions.ts";

test("sheet host preserves command shapes and reads hidden rolls at invocation", () => {
  const sent: unknown[] = []; let hidden = false;
  const local = { close: () => {}, error: (_: string) => {}, uploadPortrait: async (_: File) => "/uploads/x" };
  const a = createSheetActions("pc", (name, payload) => sent.push({ name, payload }), () => hidden, local);
  a.set("hp.current", 3); a.setMany({ "hp.current": 2, "hp.temp": 0 });
  a.rename(null); a.remove(); a.reimport(); a.say("hello");
  a.roll("1d20+2", "skill"); hidden = true; a.roll("1d6", "hidden");
  a.list("spells", "add", { item: { name: "Spell" } });
  a.counter("slots.1.left", -1, "slots.1.total"); a.counter("uses", 1);
  assert.deepEqual(sent, [
    { name: "character.update", payload: { id: "pc", set: { "hp.current": 3 } } },
    { name: "character.update", payload: { id: "pc", set: { "hp.current": 2, "hp.temp": 0 } } },
    { name: "character.update", payload: { id: "pc", name: "" } },
    { name: "character.delete", payload: { id: "pc" } },
    { name: "character.reimport", payload: { id: "pc" } },
    { name: "chat.say", payload: { text: "hello" } },
    { name: "dice.roll", payload: { formula: "1d20+2", label: "skill", hidden: false } },
    { name: "dice.roll", payload: { formula: "1d6", label: "hidden", hidden: true } },
    { name: "character.list", payload: { id: "pc", path: "spells", op: "add", item: { name: "Spell" } } },
    { name: "character.counter", payload: { id: "pc", path: "slots.1.left", delta: -1, max_path: "slots.1.total" } },
    { name: "character.counter", payload: { id: "pc", path: "uses", delta: 1 } },
  ]);
  assert.equal(a.close, local.close); assert.equal(a.uploadPortrait, local.uploadPortrait);
});
