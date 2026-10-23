import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { Message } from "../types";

function RollLine({ m }: { m: Message }) {
  if (!m.roll) return null;
  const parts = m.roll.terms.map((t, i) => {
    if (t.kind === "flat") return <span key={i} className="term-flat">{t.sign < 0 ? "-" : "+"}{t.value}</span>;
    return (
      <span key={i} className="term-dice">
        {i > 0 && (t.sign < 0 ? "-" : "+")}
        {t.rolls.map((r, j) => (
          <b key={j} className={t.kept.includes(r) ? "die" : "die die-dropped"}>
            {r}
          </b>
        ))}
      </span>
    );
  });
  return (
    <div className="roll">
      <div className="roll-head">
        <span className="muted">{m.roll.formula}</span>
        <span className="roll-total">{m.roll.total}</span>
      </div>
      <div className="roll-terms">{parts}</div>
    </div>
  );
}

export function Chat({ socket }: { socket: SceneSocket }) {
  const { messages, user } = useUi();
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
          <div key={m.id} className={m.author === user ? "msg msg-own" : "msg"}>
            <div className="msg-author">{m.author}</div>
            {m.kind === "roll" ? <RollLine m={m} /> : <div className="msg-text">{m.text}</div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
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
