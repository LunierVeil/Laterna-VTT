import type { SheetActions } from "../../../entities/character/ui/sheet-port";

/** Connected host supplies the live hidden-roll preference, not a captured snapshot. */
export function createSheetActions(id: string, send: (name: string, payload: Record<string, unknown>) => void,
  hidden: () => boolean, local: Pick<SheetActions, "close" | "error" | "uploadPortrait">): SheetActions {
  return {
    ...local,
    set: (path, value) => send("character.update", { id, set: { [path]: value } }),
    setMany: changes => send("character.update", { id, set: changes }),
    rename: name => send("character.update", { id, name: name ?? "" }),
    remove: () => send("character.delete", { id }),
    reimport: () => send("character.reimport", { id }),
    say: text => send("chat.say", { text }),
    roll: (formula, label) => send("dice.roll", { formula, label, hidden: hidden() }),
    list: (path, op, extra) => send("character.list", { id, path, op, ...extra }),
    counter: (path, delta, maxPath) => send("character.counter", { id, path, delta, ...(maxPath ? { max_path: maxPath } : {}) }),
  };
}
