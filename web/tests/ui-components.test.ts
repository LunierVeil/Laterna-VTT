import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Unit tests execute the actual TSX components; CSS behavior is covered in Chromium.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return {format: "module", source: "", shortCircuit: true};
    if (url.endsWith(".tsx")) return {format: "module", shortCircuit: true, source: ts.transpileModule(
      readFileSync(fileURLToPath(url), "utf8"),
      {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020}},
    ).outputText};
    return nextLoad(url, context);
  },
});
const { Button } = await import("../src/shared/ui/Button/Button.tsx");
const { TextField } = await import("../src/shared/ui/TextField/TextField.tsx");
const { Checkbox } = await import("../src/shared/ui/Checkbox/Checkbox.tsx");
const { Panel } = await import("../src/shared/ui/Panel/Panel.tsx");

test("Button renders a native safe button and preserves native attributes", () => {
  const html = renderToStaticMarkup(createElement(Button, {disabled: true, name: "action", "aria-label": "Удалить", className: "custom", variant: "danger"}, "Удалить"));
  assert.match(html, /^<button /); assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/); assert.match(html, /aria-label="Удалить"/);
  assert.match(html, /ds-button--danger custom/);
  assert.match(renderToStaticMarkup(createElement(Button, {type: "submit"})), /type="submit"/);
});

test("TextField links label, input, existing description and error without losing input attributes", () => {
  const html = renderToStaticMarkup(createElement(TextField, {label: "Имя", error: "Ошибка", "aria-describedby": "hint", name: "hero", placeholder: "Введите имя", required: true}));
  const id = html.match(/<input[^>]* id="([^"]+)"/)![1];
  assert.ok(html.includes(`for="${id}"`));
  assert.ok(html.includes(`aria-describedby="hint ${id}-error"`));
  assert.ok(html.includes(`id="${id}-error"`));
  assert.match(html, /aria-invalid="true"/); assert.match(html, /name="hero"/);
  assert.match(html, /placeholder="Введите имя"/); assert.match(html, /required=""/);
});

test("Checkbox and Panel preserve native semantics and caller-provided attributes", () => {
  const checkbox = renderToStaticMarkup(createElement(Checkbox, {label: "Сетка", disabled: true, defaultChecked: true, name: "grid", id: "grid"}));
  assert.match(checkbox, /<label[^>]*for="grid"/); assert.match(checkbox, /type="checkbox"/);
  assert.match(checkbox, /disabled=""/); assert.match(checkbox, /checked=""/); assert.match(checkbox, /Сетка/);
  const panel = renderToStaticMarkup(createElement(Panel, {role: "region", "aria-label": "Панель", className: "custom"}, "Содержимое"));
  assert.match(panel, /^<div /); assert.match(panel, /class="ds-panel custom"/);
  assert.match(panel, /role="region"/); assert.match(panel, /Содержимое/);
});

const { Tabs } = await import("../src/shared/ui/Tabs/Tabs.tsx");
const { Dialog } = await import("../src/shared/ui/Dialog/Dialog.tsx");
const { Tooltip } = await import("../src/shared/ui/Tooltip/Tooltip.tsx");
const { Select } = await import("../src/shared/ui/Select/Select.tsx");

test("Tabs renders linked ARIA panels, retains inactive content and omits permission-hidden tabs", () => {
  const html = renderToStaticMarkup(createElement(Tabs, {value:"chat",onValueChange:()=>{},size:"compact",items:[
    {value:"chat",label:"Чат",content:"Черновик"}, {value:"other",label:"Другая",content:"Локальное состояние",disabled:true},
    {value:"gm",label:"Секрет",content:"Секрет",hidden:true},
  ]}));
  assert.match(html, /role="tablist"/); assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-selected="true"/); assert.match(html, /tabindex="0"/);
  assert.match(html, /disabled=""/); assert.match(html, /hidden=""/);
  assert.match(html, /Локальное состояние/); assert.doesNotMatch(html, /Секрет/);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]);
  for (const id of controls) assert.ok(html.includes(`id="${id}"`));
});

test("Select preserves native options, labels, controlled selection, error and loading descriptions", () => {
  const html = renderToStaticMarkup(createElement(Select, {label:"Режим",value:"b",loading:true,error:"Ошибка", "aria-describedby":"hint",options:[{value:"a",label:"Первый",disabled:true},{value:"b",label:"Второй"}],onChange:()=>{}}));
  const id = html.match(/<select[^>]* id="([^"]+)"/)![1];
  assert.ok(html.includes(`for="${id}"`)); assert.match(html, /<select /);
  assert.match(html, /disabled=""/); assert.match(html, /aria-busy="true"/);
  assert.match(html, /value="b" selected=""/); assert.match(html, /aria-invalid="true"/);
  assert.ok(html.includes(`aria-describedby="hint ${id}-error ${id}-loading"`));
  assert.match(html, /role="status"/); assert.match(html, /role="alert"/);
});

test("Tooltip leaves child semantics and existing description intact before interaction", () => {
  const html = renderToStaticMarkup(createElement(Tooltip, {content:"Помощь",children:createElement("button", {"aria-describedby":"hint"},"Кнопка")}));
  assert.match(html, /<button aria-describedby="hint">Кнопка<\/button>/);
  assert.doesNotMatch(html, /role="tooltip"/);
});

test("Closed Dialog does not render or expose background modal semantics", () => {
  assert.equal(renderToStaticMarkup(createElement(Dialog, {open:false,title:"Удалить?",confirmLabel:"Удалить",onConfirm:()=>{},onClose:()=>{}})), "");
});
