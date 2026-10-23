import { useEffect, useRef, useState } from "react";
import { useUi, type SelectedToken } from "../state/store";
import type { SceneSocket } from "../net/socket";

const PALETTE = [
  "#c75c5c", "#d98e48", "#d4c05a", "#6cae5f", "#4fa3a5",
  "#5b8fd6", "#8a6fd1", "#c46fb0", "#8b8f99", "#e8e8ec",
];

const SIZES = [
  { size: 1, label: "Средний", hint: "1×1" },
  { size: 2, label: "Большой", hint: "2×2" },
  { size: 3, label: "Огромный", hint: "3×3" },
];

/**
 * Свойства выбранного токена. Ничего не меняет сама - шлёт token.update
 * и показывает то, что пришло обратно от сервера.
 */
export function TokenPanel({ socket }: { socket: SceneSocket }) {
  const selected = useUi((s) => s.selected);
  const user = useUi((s) => s.user);
  const isGm = useUi((s) => s.isGm);
  if (!selected) return null;

  const mine = selected.owner === null || selected.owner === user;
  // ГМ правит любой токен, но видит, чей он.
  const editable = mine || isGm;
  return (
    <div className="token-panel">
      {!mine && isGm && <div className="muted">токен игрока {selected.owner}</div>}
      {editable ? (
        <TokenEditor key={selected.id} token={selected} socket={socket} />
      ) : (
        <>
          <div className="token-panel-name">{selected.name}</div>
          <div className="muted">токен игрока {selected.owner}, менять нельзя</div>
        </>
      )}
    </div>
  );
}

function TokenEditor({ token, socket }: { token: SelectedToken; socket: SceneSocket }) {
  const [name, setName] = useState(token.name);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // draft - для обработчиков, которым нужен свежий текст без ререндера.
  // sent - последнее отправленное имя, чтобы blur и размонтирование
  // не слали одно и то же дважды.
  const draft = useRef(token.name);
  const sent = useRef(token.name);

  // Имя поменялось событием (другая вкладка, подтверждение) - подхватываем.
  useEffect(() => {
    setName(token.name);
    draft.current = token.name;
    sent.current = token.name;
  }, [token.name]);

  const commitName = () => {
    const value = draft.current.trim();
    if (!value) {
      setName(sent.current);
      draft.current = sent.current;
      return;
    }
    if (value === sent.current) return;
    sent.current = value;
    socket.send("token.update", { id: token.id, name: value });
  };

  // Клик по пустой сцене снимает выделение и размонтирует панель -
  // blur до этого может не дойти. Недосохранённое имя отправляем здесь.
  const commitRef = useRef(commitName);
  commitRef.current = commitName;
  useEffect(() => () => commitRef.current(), []);

  const sendColor = (color: string) => {
    if (color.toLowerCase() !== token.color.toLowerCase()) {
      socket.send("token.update", { id: token.id, color });
    }
  };

  // onChange у input[type=color] срабатывает на каждое движение по палитре.
  // Шлём только по нативному change - когда выбор закончен.
  const sendColorRef = useRef(sendColor);
  sendColorRef.current = sendColor;
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => sendColorRef.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  // Цвет сменили палитрой или из другой вкладки - пипетка показывает его же.
  useEffect(() => {
    if (picker.current) picker.current.value = token.color;
  }, [token.color]);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          input.current?.blur();
        }}
      >
        <input
          ref={input}
          className="token-panel-input"
          value={name}
          maxLength={200}
          onChange={(e) => {
            setName(e.target.value);
            draft.current = e.target.value;
          }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              draft.current = sent.current;
              setName(sent.current);
              input.current?.blur();
            }
          }}
        />
      </form>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={c === token.color.toLowerCase() ? "swatch swatch-active" : "swatch"}
            style={{ background: c }}
            onClick={() => sendColor(c)}
          />
        ))}
        <label className="swatch swatch-custom" title="свой цвет">
          +
          <input ref={picker} type="color" className="swatch-picker" defaultValue={token.color} />
        </label>
      </div>
      <div className="sizes">
        {SIZES.map((s) => (
          <button
            key={s.size}
            type="button"
            title={s.hint}
            className={s.size === token.size ? "tool tool-active" : "tool"}
            onClick={() => s.size !== token.size && socket.send("token.update", { id: token.id, size: s.size })}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
