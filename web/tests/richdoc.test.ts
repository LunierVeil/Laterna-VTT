// Белый список текстов на клиенте - тот же, что на сервере.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDoc, safeHref } from "../src/sheets/richDoc.ts";

test("https - да, остальное - нет", () => {
  assert.equal(safeHref("https://5e14.ttg.club/x"), "https://5e14.ttg.club/x");
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "http://a.b", "//a.b", "https://", "https://a b", 'https://x"y', null, 1]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
});

test("ссылка с javascript: теряет марку, текст остаётся; divider -> horizontalRule", () => {
  const out = cleanDoc({
    type: "doc",
    content: [
      { type: "divider", content: [{ type: "text", text: "x" }] },
      { type: "paragraph", content: [{ type: "text", text: "клик", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
      { type: "paragraph", content: [{ type: "text", text: "ок", marks: [{ type: "link", attrs: { href: "https://a.ru", target: "_self" } }] }] },
    ],
  });
  assert.deepEqual(out?.content?.[0], { type: "horizontalRule" });
  assert.deepEqual(out?.content?.[1].content?.[0], { type: "text", text: "клик" });
  assert.deepEqual(out?.content?.[2].content?.[0].marks, [{ type: "link", attrs: { href: "https://a.ru" } }]);
});
