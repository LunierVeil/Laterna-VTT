import { useUi } from "../state/store";
import type { Tool } from "../types";
import { Icon, type IconName } from "./icons";

// gm - инструмент только мастера. Права проверяет сервер, тут - чтобы не
// показывать игроку кнопки, которые всё равно ответят отказом.
const TOOLS: { id: Tool; icon: IconName; label: string; hint: string; gm?: boolean }[] = [
  { id: "select", icon: "select", label: "Выбор", hint: "ЛКМ - двигать свой токен, клик по двери - открыть/закрыть, Delete - удалить свой токен" },
  { id: "token", icon: "token", label: "Токен", hint: "Клик - поставить токен в клетку" },
  { id: "ruler", icon: "ruler", label: "Линейка", hint: "Тяни - расстояние в футах. Клетка 5 фт, диагональ тоже 5" },
  { id: "wall", icon: "wall", label: "Стены и двери", hint: "Клик-клик - отрезок. Ctrl+Z - убрать свою стену. Дверь: Shift+клик в «Выборе» - запереть", gm: true },
  { id: "erase", icon: "erase", label: "Стереть", hint: "Клик по стене - удалить", gm: true },
];

/** Параметры инструмента - выезжают рядом с его кнопкой. */
function ToolOptions({ tool }: { tool: Tool }) {
  const isGm = useUi((s) => s.isGm);
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
export function ToolRail() {
  const tool = useUi((s) => s.tool);
  const isGm = useUi((s) => s.isGm);
  const combat = useUi((s) => s.combat);
  const combatOpen = useUi((s) => s.combatOpen);

  return (
    <nav className="rail" aria-label="Инструменты">
      {TOOLS.filter((t) => isGm || !t.gm).map((t) => (
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
          {t.id === tool && <ToolOptions tool={t.id} />}
        </div>
      ))}
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
