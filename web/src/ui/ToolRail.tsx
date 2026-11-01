import { useEffect } from "react";
import { useTouchInput } from "./input";
import { useUi } from "../state/store";
import type { Tool } from "../types";
import { Icon, type IconName } from "./icons";
import type { SceneSocket } from "../net/socket";
import type { SceneStage } from "../scene/stage";

// gm - инструмент только мастера. Права проверяет сервер, тут - чтобы не
// показывать игроку кнопки, которые всё равно ответят отказом.
const TOOLS: { id: Tool; icon: IconName; label: string; hint: string; gm?: boolean; touch?: boolean }[] = [
  { id: "select", icon: "select", label: "Выбор", hint: "ЛКМ - двигать свой токен, клик по двери - открыть/закрыть, Delete - удалить свой токен; Alt+клик - пинг" },
  { id: "ping", icon: "ping", touch: true, label: "Пинг", hint: "Тап по карте - показать место всем" },
  { id: "token", icon: "token", gm: true, label: "Токен", hint: "Клик - поставить токен в клетку" },
  { id: "ruler", icon: "ruler", label: "Линейка", hint: "Тяни - расстояние в футах. Клетка 5 фт, диагональ тоже 5" },
  { id: "wall", icon: "wall", label: "Стены и двери", hint: "Клик-клик - отрезок. Ctrl+Z - убрать свою стену. Дверь: Shift+клик в «Выборе» - запереть", gm: true },
  { id: "erase", icon: "erase", label: "Стереть", hint: "Клик по стене - удалить", gm: true },
  { id: "fog", icon: "fog", label: "Туман", hint: "Тяни рамку: «Скрыть» закрывает область от игроков, «Открыть» - открывает. Ctrl+Z - отменить своё", gm: true },
];

/** Параметры инструмента - выезжают рядом с его кнопкой. */
function ToolOptions({ tool, socket, stageRef }: { tool: Tool; socket: SceneSocket; stageRef: React.MutableRefObject<SceneStage | null> }) {
  const isGm = useUi((s) => s.isGm);
  const fogMode = useUi((s) => s.fogMode);
  // Кнопки "всё" - тоже свои действия: Ctrl+Z их отменяет.
  const fogAll = (name: string) => stageRef.current?.noteMyFogCmd(socket.send(name, {}));
  const wallKind = useUi((s) => s.wallKind);
  const placeHidden = useUi((s) => s.placeHidden);
  if (!isGm) return null;
  if (tool === "wall") {
    return (
      <div className="rail-flyout" role="group" aria-label="что рисовать">
        {(["wall", "door"] as const).map((k) => (
          <button
            key={k}
            className={wallKind === k ? "seg seg-on" : "seg"}
            onClick={() => useUi.getState().setWallKind(k)}
          >
            <Icon name={k} size={16} />
            {k === "wall" ? "Стена" : "Дверь"}
          </button>
        ))}
      </div>
    );
  }
  if (tool === "fog") {
    return (
      <div className="rail-flyout" role="group" aria-label="туман">
        {(["cover", "reveal"] as const).map((m) => (
          <button key={m} className={fogMode === m ? "seg seg-on" : "seg"} onClick={() => useUi.getState().setFogMode(m)}>
            {m === "cover" ? "Скрыть" : "Открыть"}
          </button>
        ))}
        <span className="rail-flyout-sep" />
        <button className="seg" title="закрыть туманом всю карту" onClick={() => fogAll("fog.cover_all")}>
          Скрыть всё
        </button>
        <button className="seg" title="убрать весь туман" onClick={() => fogAll("fog.clear")}>
          Открыть всё
        </button>
      </div>
    );
  }
  if (tool === "token") {
    return (
      <div className="rail-flyout">
        <button
          className={placeHidden ? "seg seg-on" : "seg"}
          title="новые токены сразу скрыты от игроков - засада"
          aria-pressed={placeHidden}
          onClick={() => useUi.getState().setPlaceHidden(!placeHidden)}
        >
          <Icon name="eyeOff" size={16} />
          Ставить скрытыми
        </button>
      </div>
    );
  }
  return null;
}

/** Колонка инструментов слева от сцены. */
export function ToolRail({ socket, stageRef }: { socket: SceneSocket; stageRef: React.MutableRefObject<SceneStage | null> }) {
  const tool = useUi((s) => s.tool);
  const isGm = useUi((s) => s.isGm);
  const touch = useTouchInput();
  useEffect(() => { if (!touch && tool === "ping") useUi.getState().setTool("select"); }, [touch, tool]);
  const combat = useUi((s) => s.combat);
  const combatOpen = useUi((s) => s.combatOpen);

  return (
    <nav className="rail" aria-label="Инструменты">
      {[false, true].filter(gm => !gm || isGm).map(gm => <div className="rail-group" role="group" aria-label={gm ? "Инструменты мастера" : "Карта"} key={String(gm)}>
      {TOOLS.filter((t) => !!t.gm === gm && (!t.touch || touch)).map((t) => (
        <div key={t.id} className="rail-slot">
          <button
            className={t.id === tool ? "rail-btn rail-btn-on" : "rail-btn"}
            title={`${t.label}. ${t.hint}`}
            aria-label={t.label}
            aria-pressed={t.id === tool}
            onClick={() => useUi.getState().setTool(t.id)}
          >
            <Icon name={t.icon} />
          </button>
          {t.id === tool && <ToolOptions tool={t.id} socket={socket} stageRef={stageRef} />}
        </div>
      ))}
      </div>)}
      <div className="rail-sep" />
      <button
        className={combat || combatOpen ? "rail-btn rail-btn-on" : "rail-btn"}
        title="Трекер инициативы"
        aria-label="Трекер инициативы"
        aria-pressed={combatOpen}
        onClick={() => useUi.getState().setCombatOpen(!combatOpen)}
      >
        <Icon name="combat" />
      </button>
    </nav>
  );
}

/** Подсказка к инструменту - внизу слева поверх сцены. */
export function ToolHint() {
  const tool = useUi((s) => s.tool);
  const chaining = useUi((s) => s.chaining);
  const hint = chaining
    ? "Цепочка: Esc, ПКМ или клик в ту же точку - закончить"
    : TOOLS.find((t) => t.id === tool)?.hint;
  return <div className={chaining ? "tool-hint tool-hint-active" : "tool-hint"}>{hint}</div>;
}
