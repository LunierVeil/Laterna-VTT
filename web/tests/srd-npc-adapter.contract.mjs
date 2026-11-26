import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const server = resolve(web, "../server");
const npcContract = process.env.LATERNA_NPC_CONTRACT
  ? resolve(process.env.LATERNA_NPC_CONTRACT)
  : join(web, "src/systems/dnd5e/model/npc-contract.ts");

test("TypeScript checks 58 live Python drafts and an editable homebrew NPC", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "laterna-srd-npc-contract-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const emitted = spawnSync(
    process.env.PYTHON ?? "python3",
    ["-m", "tests.fixtures.srd_npc_adapter_contract"],
    { cwd: server, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 20000 },
  );
  assert.ifError(emitted.error);
  assert.equal(emitted.status, 0, emitted.stderr);
  const drafts = JSON.parse(emitted.stdout);
  assert.equal(drafts.length, 58);
  assert.equal(new Set(drafts.map(({ draft }) => draft.provenance.templateId)).size, 58);

  const homebrew = {
    rulesEdition: "2014",
    name: "Manual NPC",
    sheetId: "homebrew",
    statblock: {
      creatureType: "Custom Type",
      challengeRating: "variable",
      xp: 333,
      abilityScores: { str: { score: 42, modifier: 16 } },
      sections: { lairActions: [{ id: "lair-1", label: "Local lore", text: "Free-form rule." }] },
    },
    legacyMobData: { state: [null, 0, false, { extension: "текст" }] },
  };
  const sourceFile = join(temporary, "emitted.mts");
  const importPath = relative(temporary, npcContract).split(sep).join("/");
  const modulePath = importPath.startsWith(".") ? importPath : `./${importPath}`;
  const compile = (records) => {
    writeFileSync(sourceFile, `
      import type { NpcDraft } from ${JSON.stringify(modulePath)};
      export const imports = ${JSON.stringify(records)} satisfies readonly {
        draft: NpcDraft;
        import_metadata: { catalog_schema_version: 1 };
      }[];
      export const manual = ${JSON.stringify(homebrew)} satisfies NpcDraft;
    `);
    return spawnSync(
      process.execPath,
      [join(web, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict",
        "--exactOptionalPropertyTypes", "--skipLibCheck", "--target", "ES2022",
        "--module", "preserve", "--moduleResolution", "bundler", "--pretty", "false", sourceFile],
      { encoding: "utf8", timeout: 30000 },
    );
  };
  const positive = compile(drafts);
  assert.ifError(positive.error);
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);

  // Prove the generated literals are checked, including nested values and excess fields.
  const invalid = structuredClone(drafts);
  invalid[0].draft.statblock.xp = "0";
  invalid[1].draft.provenance.catalogSchemaVersion = 1;
  const negative = compile(invalid);
  assert.ifError(negative.error);
  assert.notEqual(negative.status, 0);
  assert.match(negative.stdout, /Type 'string' is not assignable to type 'number'/);
  assert.match(negative.stdout, /TS2353:.*catalogSchemaVersion.*does not exist in type 'NpcSrd51Provenance'/);

  const { copyNpcDraft } = await import(pathToFileURL(npcContract));
  const imported = drafts.find(({ draft }) => draft.provenance.templateId === "srd51:goblin").draft;
  const importedCopy = copyNpcDraft(imported, "imported-copy");
  const originalActions = imported.statblock.sections.actions;
  importedCopy.statblock.sections.actions.reverse();
  importedCopy.statblock.sections.actions[0].label = "Edited action";
  assert.deepEqual(
    importedCopy.statblock.sections.actions.map(({ id }) => id),
    originalActions.map(({ id }) => id).reverse(),
  );
  assert.notEqual(originalActions.at(-1).label, "Edited action");
  assert.deepEqual(importedCopy.provenance, imported.provenance);

  const copied = copyNpcDraft(homebrew, "homebrew-copy");
  assert.deepEqual(copied, { ...homebrew, sheetId: "homebrew-copy" });
  copied.statblock.abilityScores.str.score = 99;
  assert.equal(homebrew.statblock.abilityScores.str.score, 42);
});
