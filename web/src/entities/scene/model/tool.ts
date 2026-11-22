export type Tool = "ping" | "select" | "wall" | "wall-edit" | "token" | "erase" | "ruler" | "fog";

export const WALL_KINDS = [
  { value: "wall", label: "Стена" },
  { value: "door", label: "Дверь" },
  { value: "window", label: "Окно" },
] as const;
export type WallKind = typeof WALL_KINDS[number]["value"];

export function wallDefaults(kind: WallKind) {
  return { kind, door_state: "closed", blocks_sight: kind !== "window", blocks_movement: true };
}
