import type { CharacterStats } from "../scene/stage";
import { SHEETS } from "./dnd5e";
import type { Character } from "../types";

export function at(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Хиты и КД для токенов - из листов, которые этому клиенту видны. Что брать,
 * говорит схема листа (token); чужих листов здесь нет, значит и полосок нет.
 */
export function statsOf(characters: Record<string, Character>): Map<string, CharacterStats> {
  const out = new Map<string, CharacterStats>();
  for (const c of Object.values(characters)) {
    const stats = characterStats(c);
    if (stats) out.set(c.id, stats);
  }
  return out;
}

/** То же для одного листа: карточка токена показывает те же числа, что токен. */
export function characterStats(c: Character): CharacterStats | null {
  const view = SHEETS[c.system]?.token;
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

