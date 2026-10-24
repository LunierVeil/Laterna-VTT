import { useRef } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";

/** Свои листы; у ГМ - все, с подписью, чей. */
export function CharactersPanel({ socket }: { socket: SceneSocket }) {
  const characters = useUi((s) => s.characters);
  const accounts = useUi((s) => s.accounts);
  const isGm = useUi((s) => s.isGm);
  const file = useRef<HTMLInputElement>(null);
  const list = Object.values(characters);

  // Файл читаем и отправляем как есть: разбирает его адаптер на сервере.
  // Размер проверяем и здесь, чтобы не гонять заведомо лишнее.
  const importFile = async (f: File) => {
    if (f.size > 512 * 1024) return useUi.getState().flashError("файл больше 512 КБ");
    socket.send("character.import", { source: await f.text() });
  };

  return (
    <div className="side-panel">
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
      <p className="muted side-note">
        JSON из кнопки «скачать» на mycharacterbuilder.com или из самого LSS.
      </p>
    </div>
  );
}
