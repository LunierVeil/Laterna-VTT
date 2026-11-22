import { useEffect } from "react";
import { useTouchInput } from "../../../shared/lib/input/useTouchInput";
import { useUi, uiActions, selectIsGm, selectFogMode, selectWallKind, selectPlaceHidden, selectTool, selectCombat, selectCombatOpen, selectDiceOpen, selectChaining } from "../../../state/public";
import { WALL_KINDS, type Tool } from "../../../entities/scene/model/tool";
import { Icon, type IconName } from "../../../shared/ui/icons/icons";
import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { FogUndoPort } from "../../../entities/scene/model/scene-port";

// gm - инструмент только мастера. Права проверяет сервер, тут - чтобы не
// показывать игроку кнопки, которые всё равно ответят отказом.
const TOOLS: { id: Tool; icon: IconName; label: string; hint: string; gm?: boolean; touch?: boolean }[] = [
  { id: "select", icon: "select", label: "Выбор", hint: "ЛКМ - двигать свой токен, клик по двери - открыть/закрыть, Shift+клик или Shift+рамка - выбрать несколько; Delete - удалить выбранные доступные токены; Esc - снять выделение; Alt+клик - пинг" },
  { id: "ping", icon: "ping", touch: true, label: "Пинг", hint: "Тап по карте - показать место всем" },
  { id: "token", icon: "token", gm: true, label: "Токен", hint: "Клик - поставить токен в клетку" },
  { id: "ruler", icon: "ruler", label: "Линейка", hint: "Тяни - расстояние в футах. Клетка 5 фт, диагональ тоже 5" },
  { id: "wall", icon: "wall", label: "Стены и двери", hint: "Клик-клик - отрезок. Ctrl+Z - убрать свою стену. Дверь: Shift+клик в «Выборе» - запереть", gm: true },
  { id: "erase", icon: "erase", label: "Стереть", hint: "Клик по стене - удалить", gm: true },
  { id: "fog", icon: "fog", label: "Туман", hint: "Тяни рамку: «Скрыть» закрывает область от игроков, «Открыть» - открывает. Ctrl+Z - отменить своё", gm: true },
];

/** Параметры инструмента - выезжают рядом с его кнопкой. */
function ToolOptions({ tool, socket, stageRef }: { tool: Tool; socket: SceneSocket; stageRef: React.MutableRefObject<FogUndoPort | null> }) {
  const isGm = useUi(selectIsGm);
  const fogMode = useUi(selectFogMode);
  // Кнопки "всё" - тоже свои действия: Ctrl+Z их отменяет.
  const fogAll = (name: string) => stageRef.current?.noteMyFogCmd(socket.send(name, {}));
  const wallKind = useUi(selectWallKind);
  const placeHidden = useUi(selectPlaceHidden);
  if (!isGm) return null;
  if (tool === "wall" || tool === "wall-edit") {
    return (
      <div className="rail-flyout rail-flyout-walls" role="group" aria-label="Разметка препятствий">
        {WALL_KINDS.map(({ value, label }) => (
          <button
            key={value}
            className={tool === "wall" && wallKind === value ? "seg seg-on" : "seg"}
            aria-pressed={tool === "wall" && wallKind === value}
            onClick={() => {
              uiActions.setWallKind(value);
              uiActions.setTool("wall");
            }}
          >
            {label}
          </button>
        ))}
        <button className={tool === "wall-edit" ? "seg seg-on" : "seg"}
          aria-pressed={tool === "wall-edit"} onClick={() => uiActions.setTool("wall-edit")}>
          Свойства
        </button>
      </div>
    );
  }
  if (tool === "fog") {
    return (
      <div className="rail-flyout" role="group" aria-label="туман">
        {(["cover", "reveal"] as const).map((m) => (
          <button key={m} className={fogMode === m ? "seg seg-on" : "seg"} onClick={() => uiActions.setFogMode(m)}>
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
          onClick={() => uiActions.setPlaceHidden(!placeHidden)}
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
export function ToolRail({ socket, stageRef }: { socket: SceneSocket; stageRef: React.MutableRefObject<FogUndoPort | null> }) {
  const tool = useUi(selectTool);
  const isGm = useUi(selectIsGm);
  const touch = useTouchInput();
  useEffect(() => { if (!touch && tool === "ping") uiActions.setTool("select"); }, [touch, tool]);
  const combat = useUi(selectCombat);
  const combatOpen = useUi(selectCombatOpen);
  const diceOpen = useUi(selectDiceOpen);

  return (
    <nav className="rail" aria-label="Инструменты">
      {[false, true].filter(gm => !gm || isGm).map(gm => <div className="rail-group" role="group" aria-label={gm ? "Инструменты мастера" : "Карта"} key={String(gm)}>
      {TOOLS.filter((t) => !!t.gm === gm && (!t.touch || touch)).map((t) => {
        const active = t.id === tool || (t.id === "wall" && tool === "wall-edit");
        return (
          <div key={t.id} className="rail-slot">
            <button
              className={active ? "rail-btn rail-btn-on" : "rail-btn"}
              title={`${t.label}. ${t.hint}`}
              aria-label={t.label}
              aria-pressed={active}
              onClick={() => uiActions.setTool(t.id)}
            >
              <Icon name={t.icon} />
            </button>
            {active && <ToolOptions tool={tool} socket={socket} stageRef={stageRef} />}
          </div>
        );
      })}
      </div>)}
      <button className="rail-btn" aria-label="Кубики" title="Кубики" aria-expanded={diceOpen} onClick={() => uiActions.setDiceOpen(!useUi.getState().diceOpen)}><Icon name="dice" /></button>
      <div className="rail-sep" />
      <button
        className={combat || combatOpen ? "rail-btn rail-btn-on" : "rail-btn"}
        title="Трекер инициативы"
        aria-label="Трекер инициативы"
        aria-pressed={combatOpen}
        onClick={() => uiActions.setCombatOpen(!combatOpen)}
      >
        <Icon name="combat" />
      </button>
    </nav>
  );
}

/** Подсказка к инструменту - внизу слева поверх сцены. */
export function ToolHint() {
  const tool = useUi(selectTool);
  const chaining = useUi(selectChaining);
  const hint = chaining
    ? "Цепочка: Esc, ПКМ или клик в ту же точку - закончить"
    : tool === "wall-edit" ? "Выберите стену, дверь или окно на карте" : TOOLS.find((t) => t.id === tool)?.hint;
  return <div className={chaining ? "tool-hint tool-hint-active" : "tool-hint"}>{hint}</div>;
}
