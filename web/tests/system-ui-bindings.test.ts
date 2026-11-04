import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
registerHooks({
  resolve(specifier, context, next) {
    try {return next(specifier, context);} catch (error) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) for (const suffix of [".ts", ".tsx"]) {
        try {return next(specifier + suffix, context);} catch {}
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return {format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),"utf8"), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText};
    return next(url, context);
  },
});
const { systemBindings, resolveHealthControl } = await import("../src/app/systems/ui-bindings.ts");
const { systemPresentation } = await import("../src/app/systems/registry.ts");
const { HpControls } = await import("../src/systems/dnd5e/ui/HpControls.tsx");
const { projectStats } = await import("../src/entities/token/lib/project-stats.ts");

test("health slots resolve to the original stable component for PC/NPC and never default unknown keys", () => {
  assert.equal(resolveHealthControl("dnd5e"), HpControls); assert.equal(resolveHealthControl("mob"), HpControls);
  assert.equal(systemBindings.healthControl, resolveHealthControl);
  assert.equal(systemBindings.presentation, systemPresentation);
  for (const key of ["unknown", "__proto__", "constructor", ""]) assert.equal(resolveHealthControl(key), undefined);
  const html = renderToStaticMarkup(createElement(resolveHealthControl("dnd5e")!, {current:5,max:10,onSet:()=>{}}));
  assert.match(html, /^<div class="hp-controls">/); assert.match(html, /aria-label="−1 хит"/);
  assert.match(html, /aria-label="изменить хиты на"/); assert.match(html, /aria-label="\+1 хит"/);
});

test("renderer aggregation accepts injected system-free projections and only reads supplied records", () => {
  const c = {id:"visible",name:"C",system:"test-only",data:{},owner_id:null,source_format:null};
  const stats = {hp:3,max:7,badge:"test"}, calls: string[] = [];
  const result = projectStats({c}, character => {calls.push(character.id); return stats;});
  assert.deepEqual(calls,["visible"]); assert.equal(result.get(c.id),stats); assert.equal(result.has("private"),false);
  assert.deepEqual([...projectStats({c},()=>null)],[]); assert.deepEqual(c.data,{});
});

test("catalog slots stay stable; unknown records remain in the PC catalog and mob impact is supplied by the system", () => {
  const make = (id: string, system: string) => ({id,name:id,system,data:{},owner_id:null,source_format:null});
  const pc = make("pc", "dnd5e"), unknown = make("unknown", "other"), mob = make("mob", "mob");
  const lists: string[][] = [];
  const Root = systemBindings.catalog.Root;
  const html = renderToStaticMarkup(createElement(Root, {
    characters: {pc,unknown,mob}, isGm: true,
    renderPlayers: list => {lists.push(list.map(c=>c.id)); return null;},
    renderMobs: () => {throw new Error("default tab must remain PC");},
  }));
  assert.deepEqual(lists, [["pc","unknown"]]); assert.match(html, /Мобы и NPC/);
  const rows: any[] = [];
  renderToStaticMarkup(createElement(systemBindings.catalog.Mobs, {
    list: [mob], placeHidden: false, renderRow: row => {rows.push(row); return null;},
    onCreate:()=>{}, onCopy:()=>{}, onPlace:()=>{}, onPlaceHidden:()=>{},
  }));
  assert.equal(rows[0].character, mob); assert.equal(rows[0].deletionImpact, " и потеряют свои хиты");
  assert.equal(systemBindings.catalog.Root, Root);
});
