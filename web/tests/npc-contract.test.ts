import assert from "node:assert/strict";
import { test } from "node:test";
import { copyNpcDraft, type NpcDraftContent } from "../src/systems/dnd5e/model/npc-contract.ts";

test("NPC draft owns its copied legacy gear and rich card data", () => {
  const source = {
    rulesEdition: "2014" as const,
    name: "Проводник",
    statblock: { hp: { max: 7 } },
    legacyMobData: { equipment: [{
      id: "gear-1", name: "Сумка", qty: 1, weight: 2, link: "https://example.invalid/item",
      doc: { blocks: [{ text: "Содержимое сумки" }] }, extension: { marked: true },
    }] },
  };
  const original = structuredClone(source.legacyMobData);
  const draft = copyNpcDraft(source, "sheet-1");
  source.legacyMobData.equipment[0].doc.blocks[0].text = "Изменённый источник";
  assert.equal(draft.sheetId, "sheet-1");
  assert.deepEqual(draft.legacyMobData, original);
});

test("an incomplete 2014 NPC stays incomplete and retains fractional CR", () => {
  const source = {
    rulesEdition: "2014",
    name: "Сторож",
    statblock: { creatureType: "humanoid", size: "Medium", hp: { max: 7 }, challengeRating: "1/4" },
  } satisfies NpcDraftContent;
  assert.deepEqual(copyNpcDraft(source, "sheet-watch"), { ...source, sheetId: "sheet-watch" });
});

test("editor draft preserves the order and full text of manually run rules", () => {
  const ruleText = "Choose either option:\n• Open the passage; or\n• End the effect. Use only while the bell rings.";
  const source = {
    rulesEdition: "2014",
    name: "Смотритель маяка",
    statblock: {
      creatureType: "elemental (brass)",
      size: "Large",
      alignment: "neutral",
      armorClass: { value: 15, details: "18 while the beacon is lit" },
      hp: { max: 42, hitDice: "5d10 + 15" },
      movement: "20 ft., fly 40 ft. while the beacon is lit",
      abilityScores: { str: { score: 17, modifier: 3 }, cha: { score: 12 } },
      savingThrows: [{ ability: "wis", bonus: 4 }],
      skills: [{ name: "Perception", bonus: 5 }],
      senses: "darkvision 60 ft., passive Perception 15",
      languages: "Common, understands Aquan but cannot speak it",
      challengeRating: "3",
      xp: 700,
      damageResistances: "cold while submerged",
      damageVulnerabilities: "lightning",
      damageImmunities: "fire from the beacon",
      conditionImmunities: "charmed",
      conditionNotes: "The shutter stays open while the keeper is stunned.",
      legendaryIntro: "The keeper can use a legendary action at the end of another creature's turn.",
      lairIntro: "At initiative count 20, the keeper picks an effect.",
      resources: [{ id: "charge", name: "Заряд", current: 1, max: 2, resetText: "С рассветом" }],
      sections: {
        traits: [
          { id: "prepared", label: "Spellcasting", role: "spellcasting", text: "1st level (2 slots): two spells." },
          { id: "innate", label: "Innate Spellcasting", role: "innateSpellcasting", text: "At will: light." },
        ],
        actions: [
          { id: "multi", label: "Multiattack", role: "multiattack", text: "One Hook and one Spark." },
          { id: "hook", label: "Hook", text: "Push the target if it is standing.",
            attack: { toHit: "+5", damage: "1d8 + 3", damageType: "piercing" } },
          { id: "spark", label: "Spark (Recharge 5–6)", text: ruleText,
            attack: { damage: "1d6", damageType: "lightning" },
            usage: [{ kind: "recharge", text: "Recharge 5–6" }] },
        ],
        bonusActions: [{ id: "shutter", label: "Shutter", text: ruleText,
          usage: [{ kind: "limited", uses: 2, period: "per dawn" }], resourceIds: ["charge"] }],
        reactions: [{ id: "flare", label: "Flare", text: "After a bell rings, close one shutter." }],
        legendaryActions: [{ id: "turn", label: "Turn the Beacon (Costs 2 Actions)", text: ruleText }],
        lairActions: [{ id: "wave", label: "Wave", text: ruleText,
          usage: [{ kind: "manual", text: "Общий ресурс меняет ГМ." }] }],
      },
      sourceNote: "A synthetic note with a blank line.\n\nIts whitespace is meaningful.",
    },
  } satisfies NpcDraftContent;
  const draft = copyNpcDraft(source, "sheet-beacon");
  assert.deepEqual(draft.statblock, source.statblock);
  assert.deepEqual(draft.statblock.sections?.actions?.map(({ id }) => id), ["multi", "hook", "spark"]);
  assert.equal(draft.statblock.sections?.lairActions?.[0].text, ruleText);
  assert.deepEqual(draft.statblock.resources?.[0], source.statblock.resources[0]);
});

test("two sheet IDs retain detached provenance and text after a source update", () => {
  const content = {
    rulesEdition: "2014",
    name: "Синтетический пример",
    provenance: {
      kind: "srd51", homebrewSnapshotId: "snapshot-1", templateId: "srd51:fixture",
      sourceId: "srd51-en", firstPage: 270, lastPage: 271, lastLine: "Synthetic final line",
      documentSha256: "a".repeat(64), documentUrl: "https://example.invalid/source.pdf",
      title: "Synthetic source", language: "en", license: "CC-BY-4.0",
      licenseUrl: "https://example.invalid/license", attribution: "Synthetic attribution", changes: "Synthetic changes",
    },
    statblock: {
      sections: { actions: [{ id: "a", label: "Signal (special)", text: "Original text.\n\nKeep this paragraph." }] },
    },
  } satisfies NpcDraftContent;
  const original = structuredClone(content);
  const first = copyNpcDraft(content, "sheet-a");
  const second = copyNpcDraft(first, "sheet-b");

  content.provenance.lastLine = "New source marker";
  content.statblock.sections.actions[0].text = "New catalog edition";
  assert.deepEqual(first, { ...original, sheetId: "sheet-a" });
  assert.deepEqual(second, { ...original, sheetId: "sheet-b" });
  assert.notEqual(first.statblock.sections?.actions?.[0], second.statblock.sections?.actions?.[0]);
  assert.notEqual(first.provenance, second.provenance);
});
