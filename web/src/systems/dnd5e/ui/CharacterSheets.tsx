import type { CharacterSheetProps } from "../../../entities/character/ui/sheet-port";
import { dnd5e } from "../model/dnd5e";
import { mob } from "../model/mob";
import { CharacterSheetView } from "./legacy/CharacterSheetView";

// Module-scope components: snapshots/reconnect must never remount local drafts.
export function Dnd5eSheet(props: CharacterSheetProps) {
  return <CharacterSheetView {...props} schema={dnd5e} />;
}
export function MobSheet(props: CharacterSheetProps) {
  return <CharacterSheetView {...props} schema={mob} />;
}
/** Preserve legacy unknown-system UI; this does not resolve a D&D definition. */
export function UnsupportedSheet(props: CharacterSheetProps) {
  return <CharacterSheetView {...props} />;
}
