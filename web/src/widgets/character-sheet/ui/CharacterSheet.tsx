import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { Character } from "../../../shared/api/protocol";
import { uploadImage } from "../../../shared/api/upload";
import { useUi, uiActions, selectIsGm, selectAccounts } from "../../../state/public";
import type { SheetBindings } from "../../../entities/character/ui/sheet-port";
import { createSheetActions } from "../model/sheet-actions";

/** Connected host; editing, drafts and Context remain in the renderer. */
export function CharacterSheet({ character, socket, sheet }: { character: Character; socket: SceneSocket; sheet: SheetBindings }) {
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
  const View = sheet.resolve(character.system) ?? sheet.unsupported;
  return <View character={character} isGm={isGm}
    owner={accounts.find(a => a.id === character.owner_id)?.name} actions={actions} />;
}
