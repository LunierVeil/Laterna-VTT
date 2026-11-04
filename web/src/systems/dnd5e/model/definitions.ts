import type { CharacterDefinition } from "../../../entities/character/model/definition";
import type { SheetSchema } from "../../../entities/character/model/legacy-sheet-schema";
import type { CombatEntry } from "../../../shared/api/protocol";
import { dnd5e } from "./dnd5e";
import { mob } from "./mob";
import { at, characterStatsFor } from "./tokenStats";
import { hpChanges } from "./bonus";

function definition(schema: SheetSchema, instanceHealth: boolean): CharacterDefinition {
  return {
    tokenStats: character => characterStatsFor(character, schema),
    tokenInspector: (character, token) => {
      const stats = characterStatsFor(character, schema);
      if (!stats) return null;
      // Inspector intentionally differs from stage fallback for legacy mob hp=null.
      const hp = instanceHealth ? token.hp ?? undefined : stats.hp;
      return {
        stats: {...stats, hp},
        subtitle: schema.summary.subtitle.map(path => at(character.data, path)).filter(v => v != null && v !== "").join(" "),
        badgeLabel: schema.token?.badge.label ?? "КД",
        health: {current: hp, max: stats.max},
      };
    },
    healthChange: (character, _token, next) => instanceHealth
      ? {target: "token", hp: next}
      : {target: "character", set: hpChanges(schema, character.data, next)},
    initiativeBonus: character => {
      const path = schema.token?.initiative;
      if (!path) return 0;
      // Keep the exact existing initiative traversal (not a new normalization).
      let node: any = character.data;
      for (const part of path.split(".")) node = node?.[part];
      return typeof node === "number" ? node : 0;
    },
  };
}

export const dnd5eDefinition = definition(dnd5e, false);
export const mobDefinition = definition(mob, true);

/** Compatibility with the existing server combat.roll = 1d20 + bonus contract. */
export const initiativeTitle = (bonus: number) => `бросить 1d20${bonus ? `${bonus > 0 ? "+" : ""}${bonus}` : ""} (бонус из листа)`;
export const initiativeResult = (roll: NonNullable<CombatEntry["roll"]>) => `d20: ${roll.die}`;
