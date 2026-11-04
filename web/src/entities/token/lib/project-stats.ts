import type { Character } from "../../../shared/api/protocol";
import type { CharacterStats } from "../model/presentation";

/** Aggregate only the caller's visible records; no system lookup or state access. */
export function projectStats(
  characters: Record<string, Character>,
  project: (character: Character) => CharacterStats | null,
): Map<string, CharacterStats> {
  const result = new Map<string, CharacterStats>();
  for (const character of Object.values(characters)) {
    const stats = project(character);
    if (stats) result.set(character.id, stats);
  }
  return result;
}
