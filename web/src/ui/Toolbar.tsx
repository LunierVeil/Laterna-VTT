import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { Tool } from "../types";
import { SceneMenu } from "./SceneMenu";
import { ScenesMenu } from "./ScenesMenu";
import { PlayersMenu } from "./PlayersMenu";
import { CharactersMenu } from "./CharactersMenu";

// gm - инструмент только мастера. Права проверяет сервер, тут - чтобы не
// показывать игроку кнопки, которые всё равно ответят отказом.
const TOOLS: { id: Tool; label: string; hint: string; gm?: boolean }[] = [
  { id: "select", label: "Выбор", hint: "ЛКМ - двигать свой токен, по пустому месту - панорама, Delete - удалить свой токен" },
  { id: "token", label: "Токен", hint: "Клик - поставить токен в клетку" },
  { id: "wall", label: "Стена", hint: "Клик-клик - отрезок. Ctrl+Z - убрать свою стену", gm: true },
  { id: "erase", label: "Стереть", hint: "Клик по стене - удалить", gm: true },
];

export function Toolbar({
  socket,
  sceneId,
  onOpenScene,
}: {
  socket: SceneSocket;
  sceneId: string;
  onOpenScene: (id: string) => void;
}) {
  const { tool, setTool, users, connected, sceneName, chaining, isGm, activeSceneId, me } = useUi();
  const hidden = isGm && activeSceneId !== null && sceneId !== activeSceneId;
  const hint = chaining
    ? "Цепочка: Esc, ПКМ или клик в ту же точку - закончить"
    : TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <strong>{sceneName || "Сцена"}</strong>
        {isGm && <span className="gm-badge" title="ты ведёшь игру">ГМ</span>}
        {hidden && <span className="prep-badge">заготовка - игроки не видят</span>}
        <span className={connected ? "dot dot-on" : "dot dot-off"} />
        <span className="muted">{connected ? "на связи" : "нет связи"}</span>
        {isGm && <ScenesMenu socket={socket} sceneId={sceneId} onOpenScene={onOpenScene} />}
        {isGm && <SceneMenu socket={socket} />}
        {isGm && <PlayersMenu socket={socket} />}
        <CharactersMenu socket={socket} />
      </div>

      <div className="toolbar-tools">
        {TOOLS.filter((t) => isGm || !t.gm).map((t) => (
          <button
            key={t.id}
            className={t.id === tool ? "tool tool-active" : "tool"}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar-right">
        <span className={chaining ? "hint hint-active" : "muted"}>{hint}</span>
        <span className="users">{users.join(", ")}</span>
        <span className="me">{me?.name}</span>
        <button
          className="tool"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" }).catch(() => {});
            useUi.getState().setMe(null);
          }}
        >
          Выйти
        </button>
      </div>
    </header>
  );
}
