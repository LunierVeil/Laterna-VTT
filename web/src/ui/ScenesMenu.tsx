import { useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { usePopover } from "./usePopover";

/**
 * Сцены кампании - только для ГМ. «Открыть» переводит одного ГМ,
 * «Показать игрокам» делает сцену активной и переводит всех.
 */
export function ScenesMenu({
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
  const { open, setOpen, root } = usePopover();
  const [name, setName] = useState("");
  // Удаление - в два клика: сцена уходит вместе с токенами и стенами.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const create = () => {
    socket.send("scene.create", { name: name.trim() });
    setName("");
    setOpen(false);
  };

  return (
    <div className="scene-menu" ref={root}>
      <button
        className={open ? "tool tool-active" : "tool"}
        onClick={() => {
          setOpen((o) => !o);
          setConfirmDelete(null);
        }}
      >
        Сцены
      </button>
      {open && (
        <div className="scene-menu-pop scenes-pop">
          <ul className="scene-list">
            {scenes.map((s) => {
              const active = s.id === activeSceneId;
              const here = s.id === sceneId;
              return (
                <li key={s.id} className={here ? "scene-row scene-row-here" : "scene-row"}>
                  <span className="scene-row-name" title={s.name}>
                    {s.name}
                  </span>
                  {active && <span className="scene-row-live">у игроков</span>}
                  <span className="scene-row-actions">
                    {!here && (
                      <button
                        className="tool"
                        onClick={() => {
                          onOpenScene(s.id);
                          setOpen(false);
                        }}
                      >
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
            className="scene-menu-row"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              className="scene-new-name"
              placeholder="Новая сцена"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="tool" type="submit">
              Создать
            </button>
          </form>
          <p className="muted scene-menu-note">Новая сцена скрыта, пока не нажмёшь «Показать».</p>
        </div>
      )}
    </div>
  );
}
