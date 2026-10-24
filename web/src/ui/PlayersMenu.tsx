import { useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { usePopover } from "./usePopover";

/**
 * Аккаунты игроков - только для ГМ. Регистрации нет: имя и пароль задаёт
 * мастер и сам передаёт их игроку.
 */
export function PlayersMenu({ socket }: { socket: SceneSocket }) {
  const accounts = useUi((s) => s.accounts);
  const { open, setOpen, root } = usePopover();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  // У кого сейчас открыто поле нового пароля и кого подтверждаем удалить.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const close = () => {
    setResetFor(null);
    setConfirmDelete(null);
    setNewPassword("");
  };

  return (
    <div className="scene-menu" ref={root}>
      <button
        className={open ? "tool tool-active" : "tool"}
        onClick={() => {
          setOpen((o) => !o);
          close();
        }}
      >
        Игроки
      </button>
      {open && (
        <div className="scene-menu-pop scenes-pop">
          <ul className="scene-list">
            {accounts.map((a) => (
              <li key={a.id} className="scene-row">
                <span className="scene-row-name" title={a.name}>
                  {a.name}
                </span>
                {a.is_gm ? (
                  <span className="scene-row-live">мастер</span>
                ) : resetFor === a.id ? (
                  <form
                    className="scene-row-actions"
                    onSubmit={(e) => {
                      e.preventDefault();
                      socket.send("player.password", { id: a.id, password: newPassword });
                      close();
                    }}
                  >
                    <input
                      autoFocus
                      type="password"
                      className="player-pass"
                      placeholder="новый пароль"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button className="tool" type="submit" disabled={!newPassword}>
                      ОК
                    </button>
                  </form>
                ) : (
                  <span className="scene-row-actions">
                    <button
                      className="tool"
                      title="задать новый пароль - игрока выкинет, войдёт с новым"
                      onClick={() => {
                        close();
                        setResetFor(a.id);
                      }}
                    >
                      Пароль
                    </button>
                    {confirmDelete === a.id ? (
                      <button
                        className="tool tool-danger"
                        onClick={() => {
                          socket.send("player.delete", { id: a.id });
                          close();
                        }}
                      >
                        Точно?
                      </button>
                    ) : (
                      <button
                        className="tool"
                        title="удалить игрока - его токены перейдут тебе"
                        onClick={() => {
                          close();
                          setConfirmDelete(a.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <form
            className="player-new"
            onSubmit={(e) => {
              e.preventDefault();
              socket.send("player.create", { name: name.trim(), password });
              setName("");
              setPassword("");
            }}
          >
            <input
              placeholder="Имя игрока"
              maxLength={100}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="password"
              placeholder="Пароль, от 8 символов"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="tool" type="submit" disabled={!name.trim() || !password}>
              Создать
            </button>
          </form>
          <p className="muted scene-menu-note">Имя и пароль передай игроку сам. Регистрации нет.</p>
        </div>
      )}
    </div>
  );
}
