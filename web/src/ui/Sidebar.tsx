import { useUi, type SideTab } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { SceneStage } from "../scene/stage";
import { Chat } from "./Chat";
import { ScenesPanel } from "./ScenesPanel";
import { PlayersPanel } from "./PlayersPanel";
import { CharactersPanel } from "./CharactersPanel";

const TABS: { id: SideTab; label: string; gm?: boolean }[] = [
  { id: "chat", label: "Чат" },
  { id: "characters", label: "Персонажи" },
  { id: "scenes", label: "Сцены", gm: true },
  { id: "players", label: "Игроки", gm: true },
];

/** Правая колонка: чат и всё, что раньше висело кнопками в шапке. */
export function Sidebar({
  socket,
  sceneId,
  onOpenScene,
  stageRef,
}: {
  socket: SceneSocket;
  sceneId: string;
  onOpenScene: (id: string) => void;
  stageRef: React.MutableRefObject<SceneStage | null>;
}) {
  const tab = useUi((s) => s.sideTab);
  const isGm = useUi((s) => s.isGm);

  return (
    <aside className="sidebar">
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
      <Chat socket={socket} hidden={tab !== "chat"} />
      {tab === "characters" && <CharactersPanel socket={socket} stageRef={stageRef} />}
      {tab === "scenes" && isGm && <ScenesPanel socket={socket} sceneId={sceneId} onOpenScene={onOpenScene} />}
      {tab === "players" && isGm && <PlayersPanel socket={socket} />}
    </aside>
  );
}
