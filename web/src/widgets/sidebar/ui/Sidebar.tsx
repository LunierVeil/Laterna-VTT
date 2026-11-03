import { useUi, type SideTab } from "../../../state/store";
import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { TokenPlacementPort } from "../../../entities/scene/model/scene-port";
import { Chat } from "../../../features/chat/ui/Chat";
import { DicePanel } from "../../../features/dice/ui/DicePanel";
import { ScenesPanel } from "../../../features/scene-management/ui/ScenesPanel";
import { PlayersPanel } from "../../../features/player-management/ui/PlayersPanel";
import { CharactersPanel } from "../../../ui/CharactersPanel";

const TABS: { id: SideTab; label: string; gm?: boolean }[] = [
  { id: "chat", label: "Чат" },
  { id: "characters", label: "Персонажи" },
  { id: "scenes", label: "Сцены", gm: true },
  { id: "players", label: "Игроки", gm: true },
];

/** Правая колонка: чат и всё, что раньше висело кнопками в шапке. */
export function Sidebar({
  socket,
  onHide,
  sceneId,
  onOpenScene,
  stageRef,
}: {
  socket: SceneSocket;
  onHide?: () => void;
  sceneId: string;
  onOpenScene: (id: string) => void;
  stageRef: React.MutableRefObject<TokenPlacementPort | null>;
}) {
  const tab = useUi((s) => s.sideTab);
  const isGm = useUi((s) => s.isGm);

  return (
    <aside id="table-sidebar" className="sidebar">
      <button className="sidebar-close tool" aria-label="Скрыть чат" onClick={onHide}>Скрыть чат ›</button>
      <div className="side-tabs" role="tablist">
        {TABS.filter((t) => isGm || !t.gm).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "side-tab side-tab-on" : "side-tab"}
            onClick={() => useUi.getState().setSideTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Чат не размонтируем: иначе теряется недописанное сообщение и прокрутка. */}
      <Chat socket={socket} hidden={tab !== "chat"} diceControls={<DicePanel socket={socket} />} />
      {tab === "characters" && <CharactersPanel socket={socket} stageRef={stageRef} />}
      {tab === "scenes" && isGm && <ScenesPanel socket={socket} sceneId={sceneId} onOpenScene={onOpenScene} />}
      {tab === "players" && isGm && <PlayersPanel socket={socket} />}
    </aside>
  );
}
