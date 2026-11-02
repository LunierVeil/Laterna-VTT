import { useEffect, useState } from "react";
import type { Message } from "../types";
import { displayDice } from "./diceDisplay";

/** One replaceable presentation, no queue or frame loop. Never reads history. */
export function DiceAnimation({message}: {message: Message | null}) {
  const [phase, setPhase] = useState<"rolling" | "settled" | "done">("rolling");
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!message || reduced) return;
    const settle = setTimeout(() => setPhase("settled"), 700);
    const finish = setTimeout(() => setPhase("done"), 4200);
    return () => {clearTimeout(settle); clearTimeout(finish);};
  }, [message, reduced]);
  if (!message?.roll || message.kind !== "roll" || reduced || phase === "done") return null;
  const roll = message.roll, {dice, remaining} = displayDice(roll);
  return <div className={`dice-animation dice-${phase}`} data-message-id={message.id} data-phase={phase} role="status" aria-label={`Бросок ${message.author}`}>
    <div className="dice-animation-heading">{message.author}{roll.hidden ? " · скрыто" : ""} · {roll.label || roll.formula}</div>
    <div className="dice-faces">{dice.map((die, i) => <span key={i} className={`animated-die animated-d${die.sides} ${die.dropped ? "animated-dropped" : ""}`} style={{animationDelay: `${i * 15}ms`}} data-value={die.value}>
      <small>d{die.sides === 100 ? "100 %" : die.sides}</small><b>{die.negative ? "−" : ""}{die.value}</b>
    </span>)}{remaining > 0 && <span className="dice-extra">ещё {remaining} в чате</span>}</div>
    <div className="dice-animation-total">{roll.formula} · Итого: <strong>{roll.total}</strong></div>
  </div>;
}
