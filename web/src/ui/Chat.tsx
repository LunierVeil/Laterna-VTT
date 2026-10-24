import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { Message } from "../types";
import { DicePanel } from "./DicePanel";

function RollLine({ m }: { m: Message }) {
  if (!m.roll) return null;
  const parts = m.roll.terms.map((t, i) => {
    if (t.kind === "flat") return <span key={i} className="term-flat">{t.sign < 0 ? "-" : "+"}{t.value}</span>;
    const sides = Number(/d(\d+)/i.exec(t.text)?.[1] ?? 0);
    // kept - мультимножество, а не набор значений: при 4d6kh3 и [2,6,1,1]
    // зачёркнута должна быть ровно одна единица, а не ни одной.
    const left = [...t.kept];
    return (
      <span key={i} className="term-dice">
        {i > 0 && (t.sign < 0 ? "-" : "+")}
        {t.rolls.map((r, j) => {
          const k = left.indexOf(r);
          if (k >= 0) left.splice(k, 1);
          let cls = "die";
          if (k < 0) cls += " die-dropped";
          else if (r === sides) cls += " die-max";
          else if (r === 1) cls += " die-min";
          return (
            <b key={j} className={cls}>
              {r}
            </b>
          );
        })}
      </span>
    );
  });
  return (
    <div className="roll">
      {m.roll.label && <div className="roll-label">{m.roll.label}</div>}
      <div className="roll-head">
        <span className="muted">{m.roll.formula}</span>
        <span className="roll-total">{m.roll.total}</span>
      </div>
      <div className="roll-terms">{parts}</div>
    </div>
  );
}

export function Chat({ socket }: { socket: SceneSocket }) {
  const { messages, me } = useUi();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    socket.send("chat.say", { text: value });
    setText("");
  };

  return (
    <aside className="chat">
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={m.author_id && m.author_id === me?.id ? "msg msg-own" : "msg"}>
            <div className="msg-author">{m.author}</div>
            {m.kind === "roll" ? <RollLine m={m} /> : <div className="msg-text">{m.text}</div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <DicePanel socket={socket} />
      <form className="chat-input" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="сообщение или /r 2d6+3"
        />
        <button type="submit">↵</button>
      </form>
    </aside>
  );
}
