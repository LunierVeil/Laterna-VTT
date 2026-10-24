import { useEffect, useState } from "react";
import type { UserInfo } from "../types";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/** Вход игрока или мастера по имени и паролю. Аккаунты заводит ГМ. */
export function LoginScreen({ onDone, notice }: { onDone: (me: UserInfo) => void; notice?: string | null }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="gate">
      <form
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
        <h1>Lanterna</h1>
        <p className="muted">Аккаунт выдаёт мастер. Регистрации нет.</p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoComplete="username" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
        />
        {(error ?? notice) && <p className="gate-error">{error ?? notice}</p>}
        <button type="submit" disabled={busy || !name.trim() || !password}>
          Войти
        </button>
      </form>
    </div>
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
    <div className="gate">
      <form
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
        <h1>Аккаунт мастера</h1>
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
        <button type="submit" disabled={busy || !name.trim() || !password}>
          Создать и войти
        </button>
      </form>
    </div>
  );
}

/**
 * Вход по ссылке от мастера: новый игрок сам задаёт имя и пароль, или
 * игрок, забывший пароль, задаёт новый. Ссылка одноразовая.
 */
export function InviteScreen({ token, onDone }: { token: string; onDone: (me: UserInfo) => void }) {
  const [info, setInfo] = useState<{ kind: "join" | "reset"; name?: string | null } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void post("/api/invite/info", { token }).then(({ ok, data }) =>
      ok ? setInfo(data) : setFatal(data.detail || "приглашение не найдено или истекло"),
    );
  }, [token]);

  if (fatal) {
    return (
      <div className="gate">
        <form onSubmit={(e) => e.preventDefault()}>
          <h1>Приглашение</h1>
          <p className="gate-error">{fatal}</p>
          <p className="muted">Попроси у мастера новую ссылку или войди, если аккаунт уже есть.</p>
          <a href="/">На экран входа</a>
        </form>
      </div>
    );
  }
  if (!info) return <div className="gate">Проверяю приглашение...</div>;

  const join = info.kind === "join";
  return (
    <div className="gate">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== repeat) return setError("пароли не совпадают");
          setBusy(true);
          setError(null);
          const { ok, data } = await post("/api/invite/accept", {
            token,
            name: join ? name.trim() : undefined,
            password,
          });
          setBusy(false);
          if (ok) onDone(data);
          else setError(data.detail || "не получилось");
        }}
      >
        <h1>{join ? "Новый игрок" : "Новый пароль"}</h1>
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
        <button type="submit" disabled={busy || (join && !name.trim()) || !password}>
          {join ? "Создать и войти" : "Сменить и войти"}
        </button>
      </form>
    </div>
  );
}
