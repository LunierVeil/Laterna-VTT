import type { Character } from "../../../shared/api/protocol";

/** Command callbacks only; no transport or client state in system renderers. */
export interface SheetOps {
  list: (path: string, op: "add" | "update" | "remove", extra: { item?: object; item_id?: string; changes?: object }) => void;
  counter: (path: string, delta: number, maxPath?: string) => void;
  roll?: (formula: string, label: string) => void;
}
export interface SheetActions extends SheetOps {
  set: (path: string, value: unknown) => void;
  setMany: (changes: Record<string, unknown>) => void;
  roll: (formula: string, label: string) => void;
  rename: (name: unknown) => void;
  remove: () => void;
  reimport: () => void;
  say: (text: string) => void;
  close: () => void;
  error: (message: string) => void;
  uploadPortrait: (file: File) => Promise<string>;
}
export interface CharacterSheetProps {
  character: Character;
  isGm: boolean;
  owner?: string;
  actions: SheetActions;
}
