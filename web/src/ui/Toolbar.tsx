import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { Tool } from "../types";
import { SceneMenu } from "./SceneMenu";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Выбор", hint: "ЛКМ - двигать токен, по пустому месту - панорама, Delete - удалить свой токен" },
  { id: "token", label: "Токен", hint: "Клик - поставить токен в клетку" },
  { id: "wall", label: "Стена", hint: "Клик-клик - отрезок. Ctrl+Z - убрать свою стену" },
  { id: "erase", label: "Стереть", hint: "Клик по стене - удалить. Красная - твоя, серая - чужая, её не удалить" },
];

export function Toolbar({ socket }: { socket: SceneSocket }) {
  const { tool, setTool, users, connected, sceneName, chaining } = useUi();
  const hint = chaining
    ? "Цепочка: Esc, ПКМ или клик в ту же точку - закончить"
    : TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <strong>{sceneName || "Сцена"}</strong>
        <span className={connected ? "dot dot-on" : "dot dot-off"} />
        <span className="muted">{connected ? "на связи" : "нет связи"}</span>
        <SceneMenu socket={socket} />
      </div>

      <div className="toolbar-tools">
        {TOOLS.map((t) => (
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
      </div>
    </header>
  );
}
