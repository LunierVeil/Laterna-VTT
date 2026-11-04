import { useState } from "react";

export function HpControls({ current, max, onSet }: { current?: number; max?: number; onSet: (v: number) => void }) {
  const [amount, setAmount] = useState("");
  const change = (delta: number) => {
    const base = current ?? max ?? 0;
    let next = base + delta;
    if (max !== undefined) next = Math.min(next, max);
    onSet(Math.max(-999, next));
  };
  return (
    <div className="hp-controls">
      <button className="tool" title="−1 хит" aria-label="−1 хит" onClick={() => change(-1)}>
        −
      </button>
      <input
        className="hp-amount"
        placeholder="±N"
        aria-label="изменить хиты на"
        title="−7 - урон, 5 - лечение; Enter"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const n = Number(amount.trim());
          if (Number.isInteger(n) && n !== 0) change(n);
          setAmount("");
        }}
      />
      <button className="tool" title="+1 хит" aria-label="+1 хит" onClick={() => change(1)}>
        +
      </button>
    </div>
  );
}
