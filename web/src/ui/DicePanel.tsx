import { useState } from "react";
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

  const roll = (f: string) => {
    socket.send("chat.say", { text: `/r ${f}` });
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
        {(formula || mod !== 0) && (
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
        )}
      </div>

      <div className="dice-row">
        <button type="button" className="die-btn" title={`2d20kh1${modText}`} onClick={() => roll(`2d20kh1${modText}`)}>
          d20 преим.
        </button>
        <button type="button" className="die-btn" title={`2d20kl1${modText}`} onClick={() => roll(`2d20kl1${modText}`)}>
          d20 помеха
        </button>
        <button type="button" className="dice-roll" disabled={!formula} onClick={() => roll(formula)}>
          Бросить
        </button>
      </div>
    </div>
  );
}
