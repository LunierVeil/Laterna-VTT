import type { CharacterDefinition, CharacterPresentation } from "../../entities/character/model/definition";
import { dnd5eDefinition, mobDefinition, initiativeTitle, initiativeResult } from "../../systems/dnd5e/model/definitions";

// Wire keys remain unchanged. Map avoids inherited object keys acting as definitions.
const definitions = new Map<string, CharacterDefinition>([
  ["dnd5e", dnd5eDefinition],
  ["mob", mobDefinition],
]);
export const resolveDefinition = (key: string): CharacterDefinition | undefined => definitions.get(key);

/** Stable composition callbacks; widgets receive projections rather than the registry. */
export const systemPresentation: CharacterPresentation = {
  tokenStats: character => resolveDefinition(character.system)?.tokenStats(character) ?? null,
  tokenInspector: (character, token) => resolveDefinition(character.system)?.tokenInspector(character, token) ?? null,
  healthChange: (character, token, next) => resolveDefinition(character.system)?.healthChange(character, token, next),
  initiativeBonus: character => character ? resolveDefinition(character.system)?.initiativeBonus(character) ?? 0 : 0,
  initiativeTitle,
  initiativeResult,
};
