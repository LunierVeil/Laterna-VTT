import type { Character, CombatEntry } from "../../../shared/api/protocol";
import type { CharacterStats } from "../../token/model/presentation";
import type { SelectedToken } from "../../token/model/selection";

/** Client projections/intents only. These types are not serialized wire DTOs. */
export interface TokenInspectorView {
  stats: CharacterStats;
  subtitle: string;
  badgeLabel: string;
  health?: {current?: number; max?: number};
}
export type HealthChange = {target: "character"; set: Record<string, unknown>} | {target: "token"; hp: number};
export interface CharacterDefinition {
  tokenStats: (character: Character) => CharacterStats | null;
  tokenInspector: (character: Character, token: SelectedToken) => TokenInspectorView | null;
  healthChange: (character: Character, token: SelectedToken, next: number) => HealthChange | undefined;
  initiativeBonus: (character: Character) => number;
}
export interface CharacterPresentation {
  tokenStats: CharacterDefinition["tokenStats"];
  tokenInspector: CharacterDefinition["tokenInspector"];
  healthChange: CharacterDefinition["healthChange"];
  initiativeBonus: (character: Character | undefined) => number;
  initiativeTitle: (bonus: number) => string;
  initiativeResult: (roll: NonNullable<CombatEntry["roll"]>) => string;
}
