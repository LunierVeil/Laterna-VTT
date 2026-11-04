import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { Character } from "../../../shared/api/protocol";
import { uploadImage } from "../../../shared/api/upload";
import { useUi, uiActions, selectIsGm, selectAccounts } from "../../../state/public";
import { SHEETS } from "../../../systems/dnd5e/model/dnd5e";
import { CharacterSheetView } from "./CharacterSheetView";
import { createSheetActions } from "../model/sheet-actions";

/** Connected host; editing, drafts and Context remain in the renderer. */
export function CharacterSheet({ character, socket }: { character: Character; socket: SceneSocket }) {
  const accounts = useUi(selectAccounts);
  const isGm = useUi(selectIsGm);
  const actions = createSheetActions(character.id, (name, payload) => socket.send(name, payload),
    () => useUi.getState().isGm && useUi.getState().hiddenRolls, {
      close: () => uiActions.openCharacter(null),
      error: uiActions.flashError,
      uploadPortrait: async file => {
        const { url } = await uploadImage(file, { maxBytes: (isGm ? 25 : 5) * 1024 * 1024, maxSide: 2048, what: "портрет" });
        return url;
      },
    });
  return <CharacterSheetView character={character} isGm={isGm}
    owner={accounts.find(a => a.id === character.owner_id)?.name} actions={actions} schema={SHEETS[character.system]} />;
}
