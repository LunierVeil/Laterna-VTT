import { useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";

const inviteUrl = (token: string) => `${location.origin}/?invite=${encodeURIComponent(token)}`;

/**
 * Аккаунты игроков - только для ГМ. Регистрации нет: аккаунт появляется
 * только по ссылке от мастера, но имя и пароль игрок придумывает сам.
 */
export function PlayersPanel({ socket }: { socket: SceneSocket }) {
  const accounts = useUi((s) => s.accounts);
  const invites = useUi((s) => s.invites);
  const lastInvite = useUi((s) => s.lastInvite);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "?";

  const invite = (userId: string | null) => {
    useUi.getState().setLastInvite(null);
    setCopied(false);
    socket.send("invite.create", userId ? { user_id: userId } : {});
  };

  const copy = async (text: string, input: HTMLInputElement | null) => {
    // Буфер обмена браузер даёт только на https и localhost. По адресу в
    // сети (http://192.168...) его нет - тогда просто выделяем ссылку.
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      input?.select();
    }
  };

  return (
    <div className="side-panel">
      <ul className="scene-list">
        {accounts.map((a) => (
          <li key={a.id} className="scene-row">
            <span className="scene-row-name" title={a.name}>
              {a.name}
            </span>
            {a.is_gm ? (
              <span className="badge-live">мастер</span>
            ) : (
              <span className="scene-row-actions">
                <button
                  className="tool"
                  title="ссылка, по которой игрок задаст новый пароль; старые входы перестанут работать"
                  onClick={() => invite(a.id)}
                >
                  Сброс пароля
                </button>
                {confirmDelete === a.id ? (
                  <button
                    className="tool tool-danger"
                    onClick={() => {
                      socket.send("player.delete", { id: a.id });
                      setConfirmDelete(null);
                    }}
                  >
                    Точно?
                  </button>
                ) : (
                  <button
                    className="tool"
                    title="удалить игрока - его токены перейдут тебе"
                    onClick={() => setConfirmDelete(a.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      <button className="tool" onClick={() => invite(null)}>
        Пригласить игрока
      </button>

      {lastInvite && (
        <div className="invite-box">
          <div className="muted">
            {lastInvite.user_id ? `Ссылка на новый пароль для «${nameOf(lastInvite.user_id)}»` : "Ссылка для нового игрока"}
            {" "}- одноразовая, 7 дней. Код видно только сейчас.
          </div>
          <div className="invite-row">
            <input
              readOnly
              className="invite-link"
              value={inviteUrl(lastInvite.token)}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="tool"
              onClick={(e) => void copy(inviteUrl(lastInvite.token), e.currentTarget.previousElementSibling as HTMLInputElement)}
            >
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
          {location.hostname === "localhost" && (
            <div className="muted side-note">
              Игроку на другом компьютере замени localhost на адрес этого компьютера в сети - его
              печатает ./laterna.sh при запуске («Игрокам в этой сети»), а ./dev.sh - строка Network.
            </div>
          )}
        </div>
      )}

      {invites.length > 0 && (
        <ul className="scene-list">
          {invites.map((i) => (
            <li key={i.id} className="scene-row">
              <span className="scene-row-name muted">
                {i.user_id ? `сброс пароля: ${nameOf(i.user_id)}` : "приглашение нового игрока"}, до{" "}
                {new Date(i.expires_at).toLocaleDateString()}
              </span>
              <span className="scene-row-actions">
                <button className="tool" onClick={() => socket.send("invite.revoke", { id: i.id })}>
                  Отозвать
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted side-note">Регистрации нет: аккаунт появляется только по твоей ссылке.</p>
    </div>
  );
}
