import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const files = walk(root).filter(p => /\.tsx?$/.test(p));
const sources = files.map(file => ({file, name: path.relative(root, file).split(path.sep).join("/"), ast: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)}));
const edges: {from: string; to: string; typeOnly: boolean}[] = [];
for (const {file, name, ast} of sources) {
  function add(specifier: ts.Node, typeOnly: boolean) {
    if (!ts.isStringLiteral(specifier)) return;
    const resolved = ts.resolveModuleName(specifier.text, file, {moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true}, ts.sys).resolvedModule;
    if (resolved?.resolvedFileName.startsWith(root) && /\.tsx?$/.test(resolved.resolvedFileName)) edges.push({from: name, to: path.relative(root, resolved.resolvedFileName).split(path.sep).join("/"), typeOnly});
  }
  function visit(n: ts.Node) {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.every(e => e.isTypeOnly)));
      add(n.moduleSpecifier, typeOnly);
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier) add(n.moduleSpecifier, n.isTypeOnly);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0]) add(n.arguments[0], false);
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) add(n.argument.literal, true);
    ts.forEachChild(n, visit);
  }
  visit(ast);
}

test("state dependencies use public UI API or the exact app/session bridge allowlist", () => {
  const bridge = new Set(["app/session/access.ts", "app/session/useCampaignScene.ts", "app/session/useSceneConnection.ts"]);
  for (const e of edges) {
    if (e.from.startsWith("state/")) assert.ok(["state/", "entities/", "shared/"].some(p => e.to.startsWith(p)), JSON.stringify(e));
    else if (e.to.startsWith("state/")) {
      assert.ok(!["entities/", "shared/", "systems/"].some(p => e.from.startsWith(p)), JSON.stringify(e));
      assert.ok(e.to === "state/public.ts" || (e.to === "state/bridge.ts" && bridge.has(e.from)), JSON.stringify(e));
    }
  }
  for (const {name, ast} of sources.filter(s => !s.name.startsWith("state/"))) {
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) assert.notEqual(n.expression.name.text, "setState", `${name}: raw write`);
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        assert.ok(!n.left.getText(ast).replace(/\s/g, "").includes("useUi.getState()"), `${name}: snapshot mutation`);
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
  }
});

test("runtime and type-only dependency graphs remain acyclic", () => {
  for (const graph of [edges, edges.filter(e => !e.typeOnly)]) {
    const done = new Set<string>(), active = new Set<string>();
    function visit(name: string) {
      assert.ok(!active.has(name), `cycle at ${name}`); if (done.has(name)) return;
      active.add(name); for (const e of graph.filter(e => e.from === name)) visit(e.to);
      active.delete(name); done.add(name);
    }
    for (const s of sources) visit(s.name);
  }
});

test("there is one production Zustand create and state does not own network or renderer lifecycle", () => {
  const creates: string[] = [];
  for (const {name, ast} of sources) {
    const constructors = new Set<string>();
    for (const n of ast.statements) if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^zustand(?:\/vanilla)?$/.test(n.moduleSpecifier.text)) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const b of bindings.elements) if (["create", "createStore"].includes(b.propertyName?.text ?? b.name.text)) constructors.add(b.name.text);
    }
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        if (constructors.has(n.expression.text)) creates.push(name);
        if (name.startsWith("state/")) assert.notEqual(n.expression.text, "fetch", `${name}: HTTP in state`);
      }
      if (name.startsWith("state/") && ts.isNewExpression(n)) assert.ok(!["WebSocket", "SceneSocket", "SceneStage"].includes(n.expression.getText(ast)), name);
      ts.forEachChild(n, visit);
    }
    visit(ast);
  }
  assert.deepEqual(creates, ["state/store.ts"]);
});

test("08a retains the three existing whole-store subscriptions instead of narrowing them", () => {
  const whole: string[] = [];
  for (const {name, ast} of sources.filter(s => !s.name.startsWith("state/"))) {
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && n.expression.getText(ast) === "useUi" && n.arguments.length === 0) whole.push(name);
      ts.forEachChild(n, visit);
    }
    visit(ast);
  }
  assert.deepEqual(whole.sort(), ["features/chat/ui/Chat.tsx", "features/dice/ui/DicePanel.tsx", "widgets/table-header/ui/TopBar.tsx"]);
});
