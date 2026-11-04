import type { CharacterStats } from "../../../entities/token/model/presentation";
import type { Character } from "../../../shared/api/protocol";
import type { SheetSchema } from "../../../entities/character/model/legacy-sheet-schema";

export function at(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/** Pure projector for an explicitly resolved legacy schema; no global registry. */
export function characterStatsFor(c: Character, schema: SheetSchema | undefined): CharacterStats | null {
  const view = schema?.token;
  if (!view) return null;
  const num = (p: string) => (typeof at(c.data, p) === "number" ? (at(c.data, p) as number) : undefined);
  const badge = at(c.data, view.badge.key);
  // Скорость в листе - текст ("30", "30 фт"): берём число в начале.
  const speedRaw = view.speed ? String(at(c.data, view.speed) ?? "").match(/^\s*(\d+)/)?.[1] : undefined;
  return {
    hp: num(view.bar.current),
    max: num(view.bar.max),
    badge: badge == null || badge === "" ? undefined : String(badge),
    speed: speedRaw ? Number(speedRaw) : undefined,
  };
}

