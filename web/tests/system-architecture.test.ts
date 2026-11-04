import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function walk(dir: string): string[] {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const sources = walk(root).filter(p=>/\.tsx?$/.test(p)).map(file=>({file,name:path.relative(root,file).split(path.sep).join("/"),ast:ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true)}));
const edges: {from:string;to:string;specifier:string;names:string[]}[] = [];
for (const {file,name,ast} of sources) {
  function add(node: ts.Node, names: string[] = []) {
    if (!ts.isStringLiteral(node)) return;
    const resolved=ts.resolveModuleName(node.text,file,{moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true},ts.sys).resolvedModule;
    edges.push({from:name,to:resolved?.resolvedFileName.startsWith(root)?path.relative(root,resolved.resolvedFileName).split(path.sep).join("/"):node.text,specifier:node.text,names});
  }
  function visit(n: ts.Node) {
    if (ts.isImportDeclaration(n)) {
      const bindings=n.importClause?.namedBindings;
      add(n.moduleSpecifier,bindings&&ts.isNamedImports(bindings)?bindings.elements.map(e=>e.propertyName?.text??e.name.text):[]);
    }
    if (ts.isExportDeclaration(n)&&n.moduleSpecifier) add(n.moduleSpecifier);
    if (ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]) add(n.arguments[0]);
    if (ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)) add(n.argument.literal);
    ts.forEachChild(n,visit);
  }
  visit(ast);
}
const legacy: string[] = [];
test("only app composition imports system modules; the legacy allowlist is empty", () => {
  const actual=new Set<string>();
  for (const e of edges.filter(e=>e.to.startsWith("systems/")&&!e.from.startsWith("systems/"))) {
    if (e.from.startsWith("app/systems/")) continue;
    assert.ok(legacy.includes(e.from),JSON.stringify(e)); actual.add(e.from);
  }
  assert.deepEqual([...actual].sort(),legacy);
  for (const e of edges.filter(e=>e.from.startsWith("entities/")||e.from.startsWith("shared/")||e.from.startsWith("state/"))) assert.ok(!e.to.startsWith("systems/"),JSON.stringify(e));
});
test("system code cannot reach app/store/widgets or the scene transport; model stays framework-free", () => {
  for (const e of edges.filter(e=>e.from.startsWith("systems/"))) {
    assert.ok(!/^(app|pages|widgets|features|state)\//.test(e.to),JSON.stringify(e));
    assert.notEqual(e.to,"shared/api/scene-socket.ts",JSON.stringify(e));
    if (e.from.startsWith("systems/dnd5e/model/")) assert.ok(!/^(react|react-dom|zustand|pixi\.js)(\/|$)/.test(e.specifier)&&!e.to.includes("/ui/"),JSON.stringify(e));
  }
  for (const {name,ast} of sources.filter(s=>s.name.startsWith("systems/"))) {
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n)) {
        const expression=n.expression.getText(ast);
        assert.ok(!["fetch","useUi","Math.random"].includes(expression),name);
        // Existing card IDs, not game RNG: retain exactly the legacy UUID call.
        if (expression === "crypto.randomUUID") assert.equal(name,"systems/dnd5e/ui/legacy/Cards.tsx");
        if (ts.isPropertyAccessExpression(n.expression)) assert.ok(!["send","setState","getState"].includes(n.expression.name.text),name);
      }
      if (ts.isNewExpression(n)) assert.ok(!["WebSocket","SceneSocket","SceneStage"].includes(n.expression.getText(ast)),name);
      ts.forEachChild(n,visit);
    }
    visit(ast);
  }
});
test("universal consumers cannot resolve app registries or inspect legacy sheet rules", () => {
  const widgets=["widgets/scene-canvas/ui/SceneView.tsx","widgets/token-inspector/ui/TokenCard.tsx","widgets/combat-tracker/ui/InitiativePanel.tsx","widgets/character-sheet/ui/CharacterSheet.tsx","features/character-management/ui/CharactersPanel.tsx","features/character-management/ui/SheetRow.tsx"];
  for (const e of edges.filter(e=>widgets.includes(e.from))) {
    assert.ok(!/^(app|systems)\//.test(e.to)&&!e.to.endsWith("legacy-sheet-schema.ts"),JSON.stringify(e));
  }
  for (const {name,ast} of sources.filter(s=>widgets.includes(s.name))) {
    function visit(n: ts.Node) {
      if (ts.isIdentifier(n)) assert.ok(!["SHEETS","hpChanges","characterStatsFor"].includes(n.text),name);
      ts.forEachChild(n,visit);
    }
    visit(ast);
  }
  assert.deepEqual(edges.filter(e=>e.names.includes("SHEETS")).map(e=>e.from),[]);
  assert.equal(existsSync(path.join(root,"sheets/HpControls.tsx")),false);
});
test("renderer CharacterStats keeps one canonical optional hp/max/badge/speed contract", () => {
  const definitions: {name:string;node:ts.InterfaceDeclaration}[]=[];
  for (const {name,ast} of sources) for (const n of ast.statements) if (ts.isInterfaceDeclaration(n)&&n.name.text==="CharacterStats") definitions.push({name,node:n});
  assert.equal(definitions.length,1); assert.equal(definitions[0].name,"entities/token/model/presentation.ts");
  assert.deepEqual(definitions[0].node.members.map(m=>({key:m.name?.getText(),optional:ts.isPropertySignature(m)&&!!m.questionToken,type:ts.isPropertySignature(m)?m.type?.getText():null})),[
    {key:"hp",optional:true,type:"number"},{key:"max",optional:true,type:"number"},{key:"badge",optional:true,type:"string"},{key:"speed",optional:true,type:"number"},
  ]);
});
