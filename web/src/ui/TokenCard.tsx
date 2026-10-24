import { useEffect, useRef, useState } from "react";
import { useUi, type SelectedToken } from "../state/store";
import { uploadImage } from "../net/upload";
import type { SceneSocket } from "../net/socket";
import type { SceneStage } from "../scene/stage";
import { SHEETS } from "../sheets/dnd5e";
import { at, characterStats } from "../sheets/tokenStats";
import { HpWidget } from "../sheets/CharacterSheet";
import { Icon } from "./icons";

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
 * Карточка выбранного токена - над ним на карте, как в макете. Ничего не
 * меняет сама: токен - token.update, хиты - character.update; показывает
 * то, что вернул сервер.
 */
export function TokenCard({
  socket,
  stageRef,
}: {
  socket: SceneSocket;
  stageRef: React.MutableRefObject<SceneStage | null>;
}) {
  const selected = useUi((s) => s.selected);
  const me = useUi((s) => s.me);
  const isGm = useUi((s) => s.isGm);
  const accounts = useUi((s) => s.accounts);
  const character = useUi((s) => (selected?.character_id ? s.characters[selected.character_id] : undefined));
  const [settings, setSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSettings(false);
    setConfirmDelete(false);
  }, [selected?.id]);

  // Положение - мимо React: стейдж зовёт это, когда токен сдвинулся на экране.
  useEffect(() => {
    const stage = stageRef.current;
    const el = root.current;
    if (!stage || !el || !selected) return;
    stage.setAnchorListener((a) => {
      if (!a) return;
      const area = el.parentElement!.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 12;
      const clamp = (v: number, max: number) => Math.max(8, Math.min(max - 8, v));
      let left = clamp(a.x - w / 2, area.width - w);
      // Над токеном; не влезает - под ним (ниже имени); и там нет - сбоку.
      let top = a.y - a.r - gap - h;
      if (top < 8) {
        top = a.y + a.r + gap + 14;
        if (top + h > area.height - 8) {
          top = clamp(a.y - h / 2, area.height - h);
          left = a.x + a.r + gap + w <= area.width - 8 ? a.x + a.r + gap : clamp(a.x - a.r - gap - w, area.width - w);
        }
      }
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      el.style.visibility = "visible";
    });
    return () => stage.setAnchorListener(null);
  }, [stageRef, selected?.id, settings, confirmDelete]);

  if (!selected) return null;

  const mine = selected.owner_id === null || selected.owner_id === me?.id;
  const ownerName = accounts.find((a) => a.id === selected.owner_id)?.name ?? "?";
  // ГМ правит любой токен, но видит, чей он.
  const editable = mine || isGm;
  const schema = character ? SHEETS[character.system] : undefined;
  const stats = character ? characterStats(character) : null;
  const subtitle = schema && character ? schema.summary.subtitle.map((p) => at(character.data, p)).filter((v) => v != null && v !== "").join(" ") : "";
  const tile = (label: string, value: unknown) => (
    <div className="card-stat">
      <span className="card-stat-label">{label}</span>
      <span className="card-stat-value">{value == null || value === "" ? "—" : String(value)}</span>
    </div>
  );

  return (
    <div className="token-card" ref={root} style={{ visibility: "hidden" }}>
      <div className="token-card-head">
        <strong className="token-card-name" title={selected.name}>
          {selected.name}
        </strong>
        <span className="muted token-card-sub">{subtitle || (!mine ? ownerName : "")}</span>
      </div>

      {character && stats && (
        <>
          <div className="card-stats">
            {tile("Хиты", stats.hp !== undefined ? `${stats.hp}${stats.max ? `/${stats.max}` : ""}` : undefined)}
            {tile(SHEETS[character.system]?.token?.badge.label ?? "КД", stats.badge)}
            {tile("Скор.", stats.speed)}
          </div>
          {schema && (
            <HpWidget
              schema={schema}
              data={character.data}
              set={(path, value) => socket.send("character.update", { id: character.id, set: { [path]: value } })}
            />
          )}
        </>
      )}
      {!character && editable && <p className="muted token-card-note">Без листа. Привязать - в настройках.</p>}
      {!editable && <p className="muted token-card-note">Токен {ownerName}, менять нельзя.</p>}

      <div className="token-card-actions">
        {character && (
          <button className="btn btn-accent grow" title="или двойной клик по токену" onClick={() => useUi.getState().openCharacter(character.id)}>
            Открыть лист
          </button>
        )}
        {editable && (
          <button
            className={settings ? "icon-btn icon-btn-box btn-on" : "icon-btn icon-btn-box"}
            title="настройки токена"
            aria-label="настройки токена"
            aria-pressed={settings}
            onClick={() => setSettings((v) => !v)}
          >
            <Icon name="gear" size={18} />
          </button>
        )}
        {editable &&
          (confirmDelete ? (
            <button className="btn tool-danger" onClick={() => socket.send("token.remove", { id: selected.id })}>
              Удалить?
            </button>
          ) : (
            <button
              className="icon-btn icon-btn-box"
              title="удалить токен (Delete)"
              aria-label="удалить токен"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={18} />
            </button>
          ))}
      </div>

      {editable && settings && (
        <div className="token-card-settings">
          {!mine && isGm && <div className="muted">токен игрока {ownerName}</div>}
          <TokenEditor key={selected.id} token={selected} socket={socket} />
        </div>
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
