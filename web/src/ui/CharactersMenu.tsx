import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { usePopover } from "./usePopover";

/** Свои листы; у ГМ - все, с подписью, чей. */
export function CharactersMenu({ socket }: { socket: SceneSocket }) {
  const characters = useUi((s) => s.characters);
  const accounts = useUi((s) => s.accounts);
  const isGm = useUi((s) => s.isGm);
  const { open, setOpen, root } = usePopover();
  const list = Object.values(characters);

  return (
    <div className="scene-menu" ref={root}>
      <button className={open ? "tool tool-active" : "tool"} onClick={() => setOpen((o) => !o)}>
        Персонажи
      </button>
      {open && (
        <div className="scene-menu-pop scenes-pop">
          {list.length === 0 && <p className="muted scene-menu-note">Пока ни одного листа.</p>}
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
                  <button
                    className="tool"
                    onClick={() => {
                      useUi.getState().openCharacter(c.id);
                      setOpen(false);
                    }}
                  >
                    Открыть
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <button
            className="tool"
            onClick={() => {
              socket.send("character.create", { name: "Новый персонаж" });
              setOpen(false);
            }}
          >
            Новый персонаж
          </button>
        </div>
      )}
    </div>
  );
}
