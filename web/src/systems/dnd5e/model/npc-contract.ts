/** Editor draft for D&D 5e 2014. Storage, commands and token state have their own contracts. */
export type NpcAbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type NpcSection = "traits" | "actions" | "bonusActions" | "reactions" | "legendaryActions" | "lairActions";

export type NpcUsage =
  | { readonly kind: "limited"; readonly uses: number; readonly period: string }
  | { readonly kind: "recharge"; readonly text: string }
  | { readonly kind: "manual"; readonly text: string };

export interface NpcAbility {
  readonly id: string;
  readonly label: string;
  /** Original rule text, including qualifications, costs and manual instructions. */
  readonly text: string;
  /** Tags retain the entry's position in the section and let the editor find it. */
  readonly role?: "multiattack" | "spellcasting" | "innateSpellcasting";
  readonly usage?: readonly NpcUsage[];
  readonly resourceIds?: readonly string[];
  readonly attack?: { readonly toHit?: string; readonly damage?: string; readonly damageType?: string };
}

export interface NpcResource {
  readonly id: string;
  readonly name: string;
  readonly max: number;
  readonly current: number;
  readonly resetText?: string;
}

export interface NpcStatblock {
  readonly creatureType?: string;
  readonly size?: string;
  readonly alignment?: string;
  readonly armorClass?: { readonly value: number; readonly details?: string };
  readonly hp?: { readonly max: number; readonly hitDice?: string };
  readonly movement?: string;
  readonly abilityScores?: Readonly<Partial<Record<NpcAbilityKey, {
    readonly score: number;
    readonly modifier?: number;
  }>>>;
  readonly savingThrows?: readonly { readonly ability: NpcAbilityKey; readonly bonus: number }[];
  readonly skills?: readonly { readonly name: string; readonly bonus: number }[];
  readonly senses?: string;
  readonly languages?: string;
  readonly challengeRating?: string;
  readonly xp?: number;
  readonly damageResistances?: string;
  readonly damageVulnerabilities?: string;
  readonly damageImmunities?: string;
  readonly conditionImmunities?: string;
  /** Authored condition rules; live conditions belong to the encounter. */
  readonly conditionNotes?: string;
  readonly sections?: Readonly<Partial<Record<NpcSection, readonly NpcAbility[]>>>;
  readonly legendaryIntro?: string;
  readonly lairIntro?: string;
  readonly resources?: readonly NpcResource[];
  readonly sourceNote?: string;
}

export interface NpcSrd51Provenance {
  readonly kind: "srd51";
  readonly homebrewSnapshotId: string;
  readonly templateId: `srd51:${string}`;
  readonly sourceId: "srd51-en";
  readonly firstPage: number;
  readonly lastPage: number;
  readonly lastLine: string;
  readonly documentSha256: string;
  readonly documentUrl: string;
  readonly title: string;
  readonly language: "en";
  readonly license: "CC-BY-4.0";
  readonly licenseUrl: string;
  readonly attribution: string;
  readonly changes: string;
}

type NpcJsonValue = null | boolean | number | string | readonly NpcJsonValue[] | NpcJsonObject;
interface NpcJsonObject {
  readonly [key: string]: NpcJsonValue;
}

export interface NpcDraftContent {
  readonly rulesEdition: "2014";
  readonly name: string;
  readonly statblock: NpcStatblock;
  readonly provenance?: NpcSrd51Provenance;
  /** Opaque original mob JSON, including gear, cards, counters and unknown keys. */
  readonly legacyMobData?: NpcJsonObject;
}

export interface NpcDraft extends NpcDraftContent {
  /** Supplied by the caller. Token IDs and the immutable source identity live elsewhere. */
  readonly sheetId: string;
}

/** Copy JSON-compatible editor content into an independent sheet draft. */
export function copyNpcDraft(content: NpcDraftContent, sheetId: string): NpcDraft {
  return { ...structuredClone(content), sheetId };
}
