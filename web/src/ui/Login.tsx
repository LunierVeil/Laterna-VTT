import { useEffect, useState } from "react";
import type { UserInfo } from "../types";
import { Logo } from "./icons";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/**
 * Каркас экранов до игры (макет "1 вход"): слева - что это за стол,
 * справа - форма. В списке - только то, что уже работает.
 */
function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="gate">
      <section className="gate-hero">
        <div className="brand">
          <Logo size={40} />
          <span className="gate-brand">Laterna</span>
        </div>
        <div className="gate-pitch">
          <h1>
            Свой стол.
            <br />
            Свой свет.
          </h1>
          <p className="gate-lead">
            Открытый виртуальный стол для D&amp;D, который мастер поднимает у себя. Без подписки и без
            чужих серверов.
          </p>
          <ul className="gate-points">
            <li>Персонажи из Long Story Short - импорт файлом</li>
            <li>Мобы и NPC: шаблон и сколько угодно экземпляров на карте</li>
            <li>Броски только на сервере, скрытые броски мастера</li>
          </ul>
        </div>
        <p className="gate-foot muted">Открытый код · self-hosted</p>
      </section>
      <section className="gate-panel">{children}</section>
    </div>
  );
}

/** Вход игрока или мастера по имени и паролю. Аккаунты заводит ГМ. */
export function LoginScreen({
  onDone,
  notice,
  onGmKey,
}: {
  onDone: (me: UserInfo) => void;
  notice?: string | null;
  /** Вход мастера по ключу; вернёт текст ошибки или null. */
  onGmKey: (key: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [byKey, setByKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Gate>
      {byKey ? (
        <form
          className="gate-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const err = await onGmKey(key.trim());
            setBusy(false);
            if (err) setError(err);
          }}
        >
          <span className="gate-kicker">Вход мастера</span>
          <h2>По ключу</h2>
          <p className="muted">Ключ печатает сервер при запуске и хранит в server/gm_key.txt.</p>
          <label className="gate-field">
            Ключ ГМ
            <input autoFocus type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </label>
          {error && <p className="gate-error">{error}</p>}
          <button type="submit" className="gate-submit" disabled={busy || !key.trim()}>
            Войти
          </button>
          <button
            type="button"
            className="gate-link"
            onClick={() => {
              setByKey(false);
              setError(null);
            }}
          >
            ← обычный вход
          </button>
        </form>
      ) : (
        <form
          className="gate-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { ok, data } = await post("/api/login", { name: name.trim(), password });
            setBusy(false);
            if (ok) onDone(data);
            else setError(data.detail || "не удалось войти");
          }}
        >
          <span className="gate-kicker">Laterna VTT</span>
          <h2>За стол</h2>
          <label className="gate-field">
            Имя
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
          </label>
          <label className="gate-field">
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {(error ?? notice) && <p className="gate-error">{error ?? notice}</p>}
          <button type="submit" className="gate-submit" disabled={busy || !name.trim() || !password}>
            Войти за стол
          </button>
          <div className="gate-note">
            Аккаунты создаёт мастер. Нет пароля - попроси у него ссылку-приглашение.
            <button
              type="button"
              className="gate-link"
              onClick={() => {
                setByKey(true);
                setError(null);
              }}
            >
              Я мастер - войти по ключу
            </button>
          </div>
        </form>
      )}
    </Gate>
  );
}

/** Первый вход мастера по ключу: придумать себе имя и пароль. */
export function GmSetupScreen({ gmKey, onDone }: { gmKey: string; onDone: (me: UserInfo) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Gate>
      <form
        className="gate-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== repeat) return setError("пароли не совпадают");
          setBusy(true);
          setError(null);
          const { ok, data } = await post("/api/gm/login", { key: gmKey, name: name.trim(), password });
          setBusy(false);
          if (ok) onDone(data);
          else setError(data.detail || "не удалось создать аккаунт");
        }}
      >
        <h2>Аккаунт мастера</h2>
        <p className="muted">
          Ключ подошёл. Придумай имя и пароль - дальше будешь входить ими. Ключ останется запасным
          входом, если пароль забудешь.
        </p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoComplete="username" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль, от 8 символов"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder="Пароль ещё раз"
          autoComplete="new-password"
        />
        {error && <p className="gate-error">{error}</p>}
        <button type="submit" className="gate-submit" disabled={busy || !name.trim() || !password}>
          Создать и войти
        </button>
      </form>
    </Gate>
  );
}

/**
 * Вход по ссылке от мастера: новый игрок сам задаёт имя и пароль, или
 * игрок, забывший пароль, задаёт новый. Ссылка одноразовая.
 */
export function InviteScreen({ token, onDone }: { token: string; onDone: (me: UserInfo) => void }) {
  const [info, setInfo] = useState<{ kind: "join" | "reset" | "shared"; name?: string | null; paused?: boolean; signed_in?: UserInfo | null } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);

  useEffect(() => {
    void post("/api/invite/info", { token }).then(({ ok, data }) =>
      ok ? (setInfo(data), data.paused && setExisting(true)) : setFatal(data.detail || "приглашение не найдено или истекло"),
    );
  }, [token]);

  if (fatal) {
    return (
      <Gate>
        <form className="gate-form" onSubmit={(e) => e.preventDefault()}>
          <h2>Приглашение</h2>
          <p className="gate-error">{fatal}</p>
          <p className="muted">Попроси у мастера новую ссылку или войди, если аккаунт уже есть.</p>
          <a href="/">На экран входа</a>
        </form>
      </Gate>
    );
  }
  if (!info) return <div className="gate-wait">Проверяю приглашение...</div>;

  const join = info.kind !== "reset";
  const shared = info.kind === "shared";
  const login = shared && existing;
  return (
    <Gate>
      <form
        className="gate-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!login && password !== repeat) return setError("пароли не совпадают");
          setBusy(true);
          setError(null);
          const { ok, data } = await post("/api/invite/accept", {
            token,
            mode: shared ? (login ? "login" : "register") : "auto",
            name: join ? name.trim() : undefined,
            password,
          });
          setBusy(false);
          if (ok) onDone(data);
          else setError(data.detail || "не получилось");
        }}
      >
        <h2>{shared ? "Присоединиться к кампании" : join ? "Новый игрок" : "Новый пароль"}</h2>
        {shared && <>
          {info.signed_in && <button type="button" className="btn" disabled={busy} onClick={async () => {
            setBusy(true); const {ok,data} = await post("/api/invite/accept", {token, mode:"continue"}); setBusy(false);
            if (ok) onDone(data); else setError(data.detail || "не получилось войти");
          }}>Продолжить как {info.signed_in.name}</button>}
          <label><input type="checkbox" checked={existing} disabled={info.paused} onChange={e => setExisting(e.target.checked)} /> У меня есть аккаунт</label>
          {info.paused && <p className="muted">Приём новых игроков временно отключён. Участники могут войти со своим паролем.</p>}
        </>}
        <p className="muted">
          {join
            ? "Мастер пригласил тебя в игру. Придумай имя и пароль - дальше будешь входить ими."
            : `Мастер дал ссылку на смену пароля для «${info.name}». Старые входы перестанут работать.`}
        </p>
        {join && (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoComplete="username" />
        )}
        <input
          autoFocus={!join}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль, от 8 символов"
          autoComplete={login ? "current-password" : "new-password"}
        />
        {!login && <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder="Пароль ещё раз"
          autoComplete="new-password"
        />}
        {error && <p className="gate-error">{error}</p>}
        <button type="submit" className="gate-submit" disabled={busy || (join && !name.trim()) || !password}>
          {login ? "Войти в кампанию" : join ? "Создать и войти" : "Сменить и войти"}
        </button>
      </form>
    </Gate>
  );
}
