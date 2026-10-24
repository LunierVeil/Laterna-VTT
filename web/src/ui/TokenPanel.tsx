import { useEffect, useRef, useState } from "react";
import { useUi, type SelectedToken } from "../state/store";
import { uploadImage } from "../net/upload";
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
  const me = useUi((s) => s.me);
  const isGm = useUi((s) => s.isGm);
  const accounts = useUi((s) => s.accounts);
  if (!selected) return null;

  const mine = selected.owner_id === null || selected.owner_id === me?.id;
  const ownerName = accounts.find((a) => a.id === selected.owner_id)?.name ?? "?";
  // ГМ правит любой токен, но видит, чей он.
  const editable = mine || isGm;
  return (
    <div className="token-panel">
      {!mine && isGm && <div className="muted">токен игрока {ownerName}</div>}
      {editable ? (
        <TokenEditor key={selected.id} token={selected} socket={socket} />
      ) : (
        <>
          <div className="token-panel-name">{selected.name}</div>
          <div className="muted">токен игрока {ownerName}, менять нельзя</div>
        </>
      )}
    </div>
  );
}

/**
 * Привязка токена к листу. В списке - только видимые этому клиенту листы:
 * игроку свои, ГМ все (сервер проверяет то же самое).
 */
/**
 * Картинка токена. Загрузить может и игрок (лимит меньше, чем у ГМ);
 * поставить - тот, кто может править токен, это проверяет сервер.
 */
function TokenImage({ token, socket }: { token: SelectedToken; socket: SceneSocket }) {
  const isGm = useUi((s) => s.isGm);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File) => {
    setBusy(true);
    try {
      const { url } = await uploadImage(f, {
        // Должно совпадать с лимитами в server/app/config.py.
        maxBytes: (isGm ? 25 : 5) * 1024 * 1024,
        maxSide: 2048,
        what: "картинка",
      });
      socket.send("token.update", { id: token.id, image_url: url });
    } catch (e) {
      useUi.getState().flashError(e instanceof Error ? e.message : "загрузка не удалась");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="token-link">
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      <button className="tool" disabled={busy} onClick={() => file.current?.click()}>
        {busy ? "Загрузка..." : token.image_url ? "Сменить картинку" : "Картинка"}
      </button>
      {token.image_url && (
        <button className="tool" onClick={() => socket.send("token.update", { id: token.id, image_url: null })}>
          Убрать
        </button>
      )}
    </div>
  );
}

function CharacterLink({ token, socket }: { token: SelectedToken; socket: SceneSocket }) {
  const characters = useUi((s) => s.characters);
  const linked = token.character_id ? characters[token.character_id] : undefined;
  const list = Object.values(characters);
  return (
    <div className="token-link">
      <select
        aria-label="Персонаж токена"
        value={token.character_id ?? ""}
        onChange={(e) => {
          const id = e.target.value || null;
          // Привязали - токен берёт имя персонажа: на карте сразу видно, кто это.
          const payload: Record<string, unknown> = { id: token.id, character_id: id };
          if (id && characters[id]) payload.name = characters[id].name;
          socket.send("token.update", payload);
        }}
      >
        <option value="">без листа</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {linked && (
        <button className="tool" title="или двойной клик по токену" onClick={() => useUi.getState().openCharacter(linked.id)}>
          Лист
        </button>
      )}
    </div>
  );
}

const isGmNow = () => useUi.getState().isGm;

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
      {isGmNow() && (
        <label className="token-hidden">
          <input
            type="checkbox"
            checked={token.layer === "gm"}
            onChange={(e) => socket.send("token.update", { id: token.id, layer: e.target.checked ? "gm" : "tokens" })}
          />
          Скрыт от игроков
        </label>
      )}
      <TokenImage token={token} socket={socket} />
      <CharacterLink token={token} socket={socket} />
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
