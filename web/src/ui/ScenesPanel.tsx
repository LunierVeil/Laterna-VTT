import { useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { MapSettings } from "./MapSettings";

/**
 * Сцены кампании - только для ГМ. «Открыть» переводит одного ГМ,
 * «Показать» делает сцену активной и переводит всех.
 */
export function ScenesPanel({
  socket,
  sceneId,
  onOpenScene,
}: {
  socket: SceneSocket;
  sceneId: string;
  onOpenScene: (id: string) => void;
}) {
  const scenes = useUi((s) => s.scenes);
  const activeSceneId = useUi((s) => s.activeSceneId);
  const [name, setName] = useState("");
  // Удаление - в два клика: сцена уходит вместе с токенами и стенами.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const create = () => {
    socket.send("scene.create", { name: name.trim() });
    setName("");
  };

  return (
    <div className="side-panel">
      <ul className="scene-list">
        {scenes.map((s) => {
          const active = s.id === activeSceneId;
          const here = s.id === sceneId;
          return (
            <li key={s.id} className={here ? "scene-row scene-row-here" : "scene-row"}>
              <span className="scene-row-name" title={s.name}>
                {s.name}
              </span>
              {active && <span className="badge-live">видят игроки</span>}
              <span className="scene-row-actions">
                {!here && (
                  <button className="tool" onClick={() => onOpenScene(s.id)}>
                    Открыть
                  </button>
                )}
                {!active && (
                  <button className="tool" onClick={() => socket.send("scene.activate", { id: s.id })}>
                    Показать
                  </button>
                )}
                {!active &&
                  (confirmDelete === s.id ? (
                    <button
                      className="tool tool-danger"
                      onClick={() => {
                        socket.send("scene.delete", { id: s.id });
                        setConfirmDelete(null);
                      }}
                    >
                      Точно?
                    </button>
                  ) : (
                    <button className="tool" title="удалить сцену" onClick={() => setConfirmDelete(s.id)}>
                      ×
                    </button>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
      <form
        className="side-row"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="grow"
          placeholder="Новая сцена"
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="tool" type="submit">
          Создать
        </button>
      </form>
      <p className="muted side-note">Новая сцена скрыта, пока не нажмёшь «Показать».</p>

      <h3 className="side-heading">Эта сцена</h3>
      <MapSettings socket={socket} />
    </div>
  );
}
