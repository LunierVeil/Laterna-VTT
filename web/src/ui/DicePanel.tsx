import { diceFormula, DICE_SIDES, MAX_MENU_DICE } from "./diceDisplay";
import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";

const DICE = [4, 6, 8, 10, 12, 20, 100];
const MAX_PER_DIE = 99;

/**
 * Набор кубов кликами. Сама ничего не бросает - собирает строку вида
 * 1d20+2d6+3 и шлёт её в чат как /r. Бросок делает сервер.
 */
export function DicePanel({ socket }: { socket: SceneSocket }) {
  // pool: грани -> сколько кубов. Это состояние интерфейса, не сцены.
  const [pool, setPool] = useState<Record<number, number>>({});
  const [mod, setMod] = useState(0);

  const add = (sides: number, delta: number) =>
    setPool((p) => {
      const n = Math.max(0, Math.min(MAX_PER_DIE, (p[sides] ?? 0) + delta));
      const next = { ...p };
      if (n) next[sides] = n;
      else delete next[sides];
      return next;
    });

  const modText = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : "";
  // Крупные кубы вперёд: 1d20+2d6 читается привычнее, чем 2d6+1d20.
  const diceText = Object.keys(pool)
    .map(Number)
    .sort((a, b) => b - a)
    .map((s) => `${pool[s]}d${s}`)
    .join("+");
  const formula = diceText ? diceText + modText : "";

  const isGm = useUi((s) => s.isGm);
  const hidden = useUi((s) => s.hiddenRolls);
  const roll = (f: string) => {
    // Бросает сервер. Скрыто - только у ГМ: игроку уйдёт "бросил скрыто".
    socket.send("dice.roll", { formula: f, hidden: isGm && hidden });
    setPool({});
    setMod(0);
  };

  return (
    <div className="dice-panel">
      <div className="dice-row">
        {DICE.map((s) => (
          <button
            key={s}
            type="button"
            className={pool[s] ? "die-btn die-btn-on" : "die-btn"}
            title="ЛКМ - добавить, ПКМ - убрать"
            onClick={() => add(s, 1)}
            onContextMenu={(e) => {
              e.preventDefault();
              add(s, -1);
            }}
          >
            d{s}
            {pool[s] ? <span className="die-count">{pool[s]}</span> : null}
          </button>
        ))}
      </div>

      {/* Набор и модификатор - только когда что-то набрано, иначе панель шумит. */}
      {(formula || mod !== 0) && (
        <div className="dice-row">
          <div className="dice-mod">
            <button type="button" className="die-btn die-btn-sq" onClick={() => setMod((m) => m - 1)}>
              −
            </button>
            <span className="dice-mod-value">{modText || "±0"}</span>
            <button type="button" className="die-btn die-btn-sq" onClick={() => setMod((m) => m + 1)}>
              +
            </button>
          </div>
          <span className="dice-formula">{formula || <span className="muted">набери кубы</span>}</span>
          <button
            type="button"
            className="die-btn die-btn-sq"
            title="очистить"
            onClick={() => {
              setPool({});
              setMod(0);
            }}
          >
            ×
          </button>
          <button type="button" className="dice-roll" disabled={!formula} onClick={() => roll(formula)}>
            Бросить
          </button>
        </div>
      )}

      <div className="dice-row">
        <button type="button" className="btn grow" title={`2d20kh1${modText}`} onClick={() => roll(`2d20kh1${modText}`)}>
          Преимущество
        </button>
        <button type="button" className="btn grow" title={`2d20kl1${modText}`} onClick={() => roll(`2d20kl1${modText}`)}>
          Помеха
        </button>
        {isGm && (
          <button
            type="button"
            className={hidden ? "btn grow btn-on" : "btn grow"}
            title="результат увидишь только ты; игроки - «бросил скрыто»"
            aria-pressed={hidden}
            onClick={() => useUi.getState().setHiddenRolls(!hidden)}
          >
            Скрытно ГМ
          </button>
        )}
      </div>
    </div>
  );
}

/** Same dice.roll command as the chat and sheet; only the formula UI differs. */
export function DiceMenu({socket, onClose}: {socket: SceneSocket; onClose: () => void}) {
  const [sides, setSides] = useState(20), [count, setCount] = useState(1), [mod, setMod] = useState(0);
  const {isGm, hiddenRolls, diceAnimation, connected} = useUi();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {if (e.key === "Escape") {e.stopPropagation(); onClose();}};
    window.addEventListener("keydown", key, true);
    return () => {window.removeEventListener("keydown", key, true); prior?.focus();};
  }, [onClose]);
  const roll = (formula: string) => socket.send("dice.roll", {formula, hidden: isGm && hiddenRolls});
  const formula = diceFormula(sides, count, mod);
  return <section className="dice-menu" role="dialog" aria-label="Меню кубиков" onKeyDown={e => e.stopPropagation()}>
    <header><h3>Кубики</h3><button ref={closeRef} className="tool" aria-label="Закрыть кубики" onClick={onClose}>×</button></header>
    <div className="dice-types" role="group" aria-label="Тип кубика">{DICE_SIDES.map(s => <button key={s} className="die-btn" aria-pressed={sides === s} onClick={() => setSides(s)}>d{s}</button>)}</div>
    <label className="dice-counter">Количество
      <button className="tool" aria-label="Уменьшить количество" disabled={count <= 1} onClick={() => setCount(count - 1)}>−</button>
      <input aria-label="Количество кубиков" type="number" min={1} max={MAX_MENU_DICE} value={count} onChange={e => setCount(Math.max(1, Math.min(MAX_MENU_DICE, Math.trunc(Number(e.target.value)) || 1)))} />
      <button className="tool" aria-label="Увеличить количество" disabled={count >= MAX_MENU_DICE} onClick={() => setCount(count + 1)}>+</button>
    </label>
    <label className="dice-counter">Модификатор
      <button className="tool" aria-label="Уменьшить модификатор" disabled={mod <= -1000} onClick={() => setMod(mod - 1)}>−</button>
      <input aria-label="Модификатор броска" type="number" min={-1000} max={1000} value={mod} onChange={e => setMod(Math.max(-1000, Math.min(1000, Math.trunc(Number(e.target.value)) || 0)))} />
      <button className="tool" aria-label="Увеличить модификатор" disabled={mod >= 1000} onClick={() => setMod(mod + 1)}>+</button>
    </label>
    <output className="dice-formula" aria-label="Формула броска">{formula}</output>
    <div className="dice-row"><button className="btn btn-accent grow" disabled={!connected} onClick={() => roll(formula)}>Бросить</button><button className="btn" disabled={!connected} onClick={() => roll("1d20")}>Быстрый d20</button></div>
    {isGm && <label><input type="checkbox" checked={hiddenRolls} onChange={e => useUi.getState().setHiddenRolls(e.target.checked)} /> Скрытно ГМ</label>}
    <label><input type="checkbox" checked={diceAnimation} onChange={e => useUi.getState().setDiceAnimation(e.target.checked)} /> Анимация кубиков</label>
    <small className="muted">До {MAX_MENU_DICE} кубиков. Результат сохраняется в чате. При уменьшении движения в системе анимация отключена.</small>
  </section>;
}
