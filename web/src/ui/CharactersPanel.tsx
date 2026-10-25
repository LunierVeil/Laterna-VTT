import { useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { SceneStage } from "../scene/stage";
import type { Character } from "../types";
import { safeUpload } from "../net/upload";
import { at } from "../sheets/tokenStats";

/** Листы персонажей: свои; у ГМ - все, с подписью, чей. */
function PlayerSheets({ socket, list }: { socket: SceneSocket; list: Character[] }) {
  const accounts = useUi((s) => s.accounts);
  const isGm = useUi((s) => s.isGm);
  const file = useRef<HTMLInputElement>(null);

  // Файл читаем и отправляем как есть: разбирает его адаптер на сервере.
  // Размер проверяем и здесь, чтобы не гонять заведомо лишнее.
  const importFile = async (f: File) => {
    if (f.size > 512 * 1024) return useUi.getState().flashError("файл больше 512 КБ");
    socket.send("character.import", { source: await f.text() });
  };

  return (
    <>
      {list.length === 0 && <p className="muted side-note">Пока ни одного листа.</p>}
      <ul className="scene-list">
        {list.map((c) => (
          <li key={c.id} className="scene-row">
            <span className="scene-row-name" title={c.name}>
              {c.name}
            </span>
            {isGm && (
              <span className="muted">{accounts.find((a) => a.id === c.owner_id)?.name ?? "без владельца"}</span>
            )}
            <span className="scene-row-actions">
              <button className="tool" onClick={() => useUi.getState().openCharacter(c.id)}>
                Открыть
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button className="tool" onClick={() => socket.send("character.create", { name: "Новый персонаж" })}>
        Новый персонаж
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importFile(f);
        }}
      />
      <button className="tool" onClick={() => file.current?.click()}>
        Импорт из Long Story Short
      </button>
      <p className="muted side-note">JSON из кнопки «скачать» на mycharacterbuilder.com или из самого LSS.</p>
    </>
  );
}

/**
 * Мобы и NPC - только у ГМ. Лист - шаблон: «На карту» ставит экземпляр
 * со своими хитами и номером (Гоблин 1, Гоблин 2). Нужен другой вариант
 * («гоблин с луком») - «Копия», и правишь её.
 */
function MobSheets({
  socket,
  list,
  stageRef,
}: {
  socket: SceneSocket;
  list: Character[];
  stageRef: React.MutableRefObject<SceneStage | null>;
}) {
  const placeHidden = useUi((s) => s.placeHidden);
  const place = (c: Character) => {
    const p = stageRef.current?.freeCellNearCenter();
    if (!p) return;
    // Имя, хиты и портрет экземпляра выставит сервер - из листа.
    socket.send("token.add", { x: p.x, y: p.y, character_id: c.id, ...(placeHidden ? { layer: "gm" } : {}) });
  };
  const num = (c: Character, path: string) => {
    const v = at(c.data, path);
    return typeof v === "number" ? v : "—";
  };

  return (
    <>
      {list.length === 0 && <p className="muted side-note">Мобов пока нет. Заведи шаблон - и ставь на карту сколько нужно.</p>}
      <ul className="mob-list">
        {list.map((c) => {
          const portrait = safeUpload(at(c.data, "portrait"));
          return (
            <li key={c.id} className="mob-row">
              <span className="mob-avatar">
                {portrait ? <img src={portrait} alt="" /> : c.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <button className="mob-main" title="открыть лист" onClick={() => useUi.getState().openCharacter(c.id)}>
                <span className="mob-name">{c.name}</span>
                <span className="muted mob-stats">
                  хиты {num(c, "hp.max")} · КД {num(c, "ac")}
                  {typeof at(c.data, "cr") === "string" && at(c.data, "cr") !== "" && ` · опасность ${at(c.data, "cr")}`}
                </span>
              </button>
              <span className="mob-actions">
                <button className="tool" title="поставить в центр экрана" onClick={() => place(c)}>
                  На карту
                </button>
                <button className="tool" title="копия листа - другой вариант моба" onClick={() => socket.send("character.copy", { id: c.id })}>
                  Копия
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <button className="tool" onClick={() => socket.send("character.create", { name: "Новый моб", system: "mob" })}>
        Новый моб
      </button>
      <label className="side-check" title="новые токены сразу скрыты от игроков - засада">
        <input type="checkbox" checked={placeHidden} onChange={(e) => useUi.getState().setPlaceHidden(e.target.checked)} />
        Ставить скрытыми
      </label>
      <p className="muted side-note">
        У каждого моба на карте свои хиты. Игроки видят токен, но не его хиты и не лист.
      </p>
    </>
  );
}

export function CharactersPanel({
  socket,
  stageRef,
}: {
  socket: SceneSocket;
  stageRef: React.MutableRefObject<SceneStage | null>;
}) {
  const characters = useUi((s) => s.characters);
  const isGm = useUi((s) => s.isGm);
  const [kind, setKind] = useState<"pc" | "mob">("pc");
  const all = Object.values(characters);
  const mobs = all.filter((c) => c.system === "mob");
  const pcs = all.filter((c) => c.system !== "mob");

  return (
    <div className="side-panel">
      {isGm && (
        <div className="seg-group" role="tablist">
          <button role="tab" aria-selected={kind === "pc"} className={kind === "pc" ? "seg seg-on" : "seg"} onClick={() => setKind("pc")}>
            Персонажи игроков
          </button>
          <button role="tab" aria-selected={kind === "mob"} className={kind === "mob" ? "seg seg-on" : "seg"} onClick={() => setKind("mob")}>
            Мобы и NPC
          </button>
        </div>
      )}
      {isGm && kind === "mob" ? (
        <MobSheets socket={socket} list={mobs} stageRef={stageRef} />
      ) : (
        <PlayerSheets socket={socket} list={pcs} />
      )}
    </div>
  );
}
