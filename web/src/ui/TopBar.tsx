import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { Icon, Logo } from "./icons";

/**
 * Очередь хода в шапке - видно всем, не открывая трекер. Клик по очереди
 * открывает трекер; управление ходом - те же команды combat.*.
 */
function InitiativeStrip({ socket }: { socket: SceneSocket }) {
  const combat = useUi((s) => s.combat);
  const isGm = useUi((s) => s.isGm);
  const me = useUi((s) => s.me);
  if (!combat || combat.entries.length === 0) return <div className="initiative-strip" />;

  const current = combat.entries.find((e) => e.id === combat.current);
  const myTurn = !!current && !!me && current.owner_id === me.id;
  return (
    <nav className="initiative-strip" aria-label="Инициатива">
      <button className="strip-round" title="открыть трекер" onClick={() => useUi.getState().setCombatOpen(true)}>
        {current ? `Раунд ${combat.round}` : "Бой не начат"}
      </button>
      {combat.entries.map((e) => (
        <button
          key={e.id}
          className={e.id === combat.current ? "strip-chip strip-chip-current" : "strip-chip"}
          title="открыть трекер"
          onClick={() => useUi.getState().setCombatOpen(true)}
        >
          <span className="strip-avatar">{e.name.trim().charAt(0).toUpperCase() || "?"}</span>
          <span className="strip-name">
            {e.name}
            {e.init != null && ` · ${e.init}`}
          </span>
        </button>
      ))}
      {isGm && (
        <button className="btn" onClick={() => socket.send("combat.next", {})}>
          {current ? "Следующий ход" : "Начать бой"}
        </button>
      )}
      {!isGm && myTurn && (
        <button className="btn btn-accent" onClick={() => socket.send("combat.next", {})}>
          Закончить ход
        </button>
      )}
    </nav>
  );
}

export function TopBar({ socket, sceneId }: { socket: SceneSocket; sceneId: string }) {
  const { users, connected, sceneName, isGm, activeSceneId, me } = useUi();
  const hidden = isGm && activeSceneId !== null && sceneId !== activeSceneId;
  // Себя видно рядом, в списке - остальные. Убираем одно вхождение: у
  // тёзки-игрока имя то же.
  const others = [...users];
  const mine = me ? others.indexOf(me.name) : -1;
  if (mine >= 0) others.splice(mine, 1);

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">Laterna</span>
      </div>
      <div className="topbar-scene">
        <span className="topbar-scene-name">{sceneName || "Сцена"}</span>
        <span className={connected ? "status status-on" : "status status-off"}>
          <span className="status-dot" />
          {connected ? "на связи" : "нет связи"}
        </span>
        {hidden && <span className="prep-badge">заготовка - игроки не видят</span>}
      </div>

      <InitiativeStrip socket={socket} />

      <div className="topbar-right">
        {others.length > 0 && (
          <span className="users" title="сейчас за столом">
            {others.join(", ")}
          </span>
        )}
        <span className="me">{me?.name}</span>
        {isGm && (
          <span className="gm-badge" title="ты ведёшь игру">
            ГМ
          </span>
        )}
        <button
          className="icon-btn"
          title="выйти"
          aria-label="выйти"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" }).catch(() => {});
            useUi.getState().setMe(null);
          }}
        >
          <Icon name="logout" size={18} />
        </button>
      </div>
    </header>
  );
}
