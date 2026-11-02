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
