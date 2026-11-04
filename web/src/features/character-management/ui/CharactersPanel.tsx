import { useUi, uiActions, selectAccounts, selectIsGm, selectPlaceHidden, selectCharacters } from "../../../state/public";
import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { TokenPlacementPort } from "../../../entities/scene/model/scene-port";
import type { Character } from "../../../shared/api/protocol";
import type { CatalogBindings, CatalogRowProps } from "../../../entities/character/ui/catalog-slot";
import { SheetRow } from "./SheetRow";

type HostProps = { socket: SceneSocket; stageRef: React.MutableRefObject<TokenPlacementPort | null>; catalog: CatalogBindings };
const row = (socket: SceneSocket) => (props: CatalogRowProps) => <SheetRow key={props.character.id} {...props} socket={socket} />;

function PlayerSheets({ socket, stageRef, catalog, list }: HostProps & { list: Character[] }) {
  const accounts = useUi(selectAccounts);
  const isGm = useUi(selectIsGm);
  const importFile = async (f: File) => {
    if (f.size > 512 * 1024) return uiActions.flashError("файл больше 512 КБ");
    socket.send("character.import", { source: await f.text() });
  };
  const View = catalog.Players;
  return <View list={list} accounts={accounts} isGm={isGm} renderRow={row(socket)} onImport={importFile}
    onCreate={() => socket.send("character.create", { name: "Новый персонаж" })}
    onPlace={c => { const p = stageRef.current?.freeCellNearCenter(); if (p) socket.send("token.add", { ...p, character_id: c.id }); }} />;
}

function MobSheets({ socket, stageRef, catalog, list }: HostProps & { list: Character[] }) {
  const placeHidden = useUi(selectPlaceHidden);
  const View = catalog.Mobs;
  return <View list={list} placeHidden={placeHidden} renderRow={row(socket)} onPlaceHidden={uiActions.setPlaceHidden}
    onCreate={() => socket.send("character.create", { name: "Новый моб", system: "mob" })}
    onCopy={c => socket.send("character.copy", { id: c.id })}
    onPlace={c => {
      const p = stageRef.current?.freeCellNearCenter(); if (!p) return;
      socket.send("token.add", { x: p.x, y: p.y, character_id: c.id, ...(placeHidden ? { layer: "gm" } : {}) });
    }} />;
}

export function CharactersPanel(props: HostProps) {
  const characters = useUi(selectCharacters);
  const isGm = useUi(selectIsGm);
  const View = props.catalog.Root;
  return <View characters={characters} isGm={isGm}
    renderPlayers={list => <PlayerSheets {...props} list={list} />}
    renderMobs={list => <MobSheets {...props} list={list} />} />;
}
