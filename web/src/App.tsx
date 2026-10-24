import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneSocket } from "./net/socket";
import { SceneView } from "./scene/SceneView";
import type { SceneStage } from "./scene/stage";
import { Toolbar } from "./ui/Toolbar";
import { Chat } from "./ui/Chat";
import { TokenPanel } from "./ui/TokenPanel";
import { useUi } from "./state/store";
import { GmSetupScreen, LoginScreen } from "./ui/Login";
import type { Scene, SceneInfo, UserInfo } from "./types";

const GM_SCENE = "lanterna.gmScene";

/**
 * Ключ ГМ приходит один раз в ссылке ?gm=... Забираем его при загрузке
 * модуля (а не в эффекте: StrictMode запускает эффекты дважды, и второй
 * запуск уже не нашёл бы ключ в адресе) и сразу убираем из адресной
 * строки - чтобы не светить при показе экрана. Дальше нужна только сессия.
 */
const GM_KEY_FROM_URL = (() => {
  const url = new URL(location.href);
  const key = url.searchParams.get("gm");
  if (key) {
    url.searchParams.delete("gm");
    history.replaceState(null, "", url);
  }
  return key;
})();

export default function App() {
  const me = useUi((s) => s.me);
  // Экран до игры: проверяем сессию, затем вход или первый вход мастера.
  const [checking, setChecking] = useState(true);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const stageRef = useRef<SceneStage | null>(null);

  // Сокет подключается быстрее, чем инициализируется PixiJS, поэтому
  // снапшот и события, пришедшие до готовности сцены, копим здесь и
  // проигрываем, когда стейдж поднялся. Иначе первый снапшот теряется
  // и сцена остаётся пустой навсегда.
  const buffered = useRef<{
    scene: Scene | null;
    events: { name: string; payload: any; cmdId: string | null }[];
  }>({ scene: null, events: [] });

  useEffect(() => {
    const ui = useUi.getState();
    void (async () => {
      try {
        if (GM_KEY_FROM_URL) {
          const res = await fetch("/api/gm/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: GM_KEY_FROM_URL }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.needs_setup) return setSetupKey(GM_KEY_FROM_URL);
          if (res.ok) return ui.setMe(data as UserInfo);
          setLoginNotice(data.detail || "ключ ГМ не подошёл");
        }
        const res = await fetch("/api/me");
        if (res.ok) ui.setMe(await res.json()); // null, если сессии нет
      } catch (e) {
        console.error("не проверил сессию", e);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  // Игрок всегда в активной сцене. ГМ возвращается туда, где был.
  // Вышел - сцены больше нет, сокет закроется вместе с ней.
  useEffect(() => {
    if (!me) {
      setSceneId(null);
      return;
    }
    setLoginNotice(null);
    void fetch("/api/campaign")
      .then((r) => r.json())
      .then((c: { active_scene_id: string; scenes?: SceneInfo[] }) => {
        const saved = localStorage.getItem(GM_SCENE);
        const ok = c.scenes?.some((s) => s.id === saved);
        setSceneId(ok ? saved : c.active_scene_id);
      })
      .catch((e) => console.error("не получил кампанию", e));
  }, [me?.id]);

  const openScene = useCallback((id: string) => {
    localStorage.setItem(GM_SCENE, id);
    setSceneId(id);
  }, []);

  const socket = useMemo(
    // me?.id в зависимостях: вошёл другим - это другое подключение.
    () => (sceneId && me ? new SceneSocket(sceneId) : null),
    [sceneId, me?.id],
  );

  const handleReady = useCallback((stage: SceneStage) => {
    const buf = buffered.current;
    if (buf.scene) stage.setSnapshot(buf.scene);
    for (const e of buf.events) stage.applyEvent(e.name, e.payload, e.cmdId);
    buf.events = [];
  }, []);

  useEffect(() => {
    if (!socket) return;
    const ui = useUi.getState();

    // Сокет новый - значит, и сцена, скорее всего, другая: снапшот и
    // выделение от прошлой к ней не относятся.
    buffered.current = { scene: null, events: [] };
    ui.setSelected(null);
    ui.setChaining(false);

    const off = socket.on((msg) => {
      if (msg.type === "snapshot") {
        ui.setConnected(true);
        if (msg.you) ui.setMe(msg.you);
        ui.setMessages(msg.scene.messages);
        ui.setScene(msg.scene.name, msg.scene.grid_size, msg.scene.background_url);
        buffered.current.scene = msg.scene;
        buffered.current.events = [];
        stageRef.current?.setSnapshot(msg.scene);
        return;
      }
      if (msg.type === "auth_required") {
        setLoginNotice("сессия кончилась - войди снова");
        ui.setMe(null);
        return;
      }
      if (msg.type === "presence") {
        ui.setUsers(msg.users);
        return;
      }
      if (msg.type === "error") {
        ui.flashError(msg.message);
        return;
      }
      if (msg.type === "chat") {
        ui.pushMessage(msg.message);
        return;
      }
      if (msg.type === "campaign") {
        ui.setCampaign(msg.active_scene_id, msg.scenes, msg.users);
        // Аккаунт удалили - сессии больше нет, на экран входа.
        const myId = useUi.getState().me?.id;
        if (myId && !msg.users.some((u) => u.id === myId)) {
          // Сначала пояснение, потом выход: setMe перерисовывает App сразу
          // (zustand), и экран входа иначе появился бы без пояснения.
          setLoginNotice("аккаунт удалён мастером");
          ui.setMe(null);
          return;
        }
        // Игрока ведёт ГМ: он всегда там, где активная сцена. ГМ остаётся,
        // где был, пока его сцену не удалили.
        const stay = msg.scenes
          ? msg.scenes.some((s) => s.id === sceneId)
          : msg.active_scene_id === sceneId;
        if (!stay) setSceneId(msg.active_scene_id);
        return;
      }
      if (msg.type === "reply") {
        // ГМ создал сцену - сразу открываем её, чтобы готовить.
        if (msg.name === "scene.created") openScene(msg.payload.id);
        return;
      }
      if (msg.name === "scene.updated") {
        // Имя и клетка нужны интерфейсу; сама сцена - дальше, в стейдж.
        ui.setScene(msg.payload.name, msg.payload.grid_size, msg.payload.background_url);
      }
      if (stageRef.current) {
        stageRef.current.applyEvent(msg.name, msg.payload, msg.cmd_id);
      } else {
        buffered.current.events.push({
          name: msg.name,
          payload: msg.payload,
          cmdId: msg.cmd_id,
        });
      }
    });

    socket.connect();
    return () => {
      off();
      socket.close();
      useUi.getState().setConnected(false);
    };
  }, [socket, sceneId, openScene]);

  const error = useUi((s) => s.error);

  if (checking) return <div className="gate">Загрузка...</div>;
  if (!me && setupKey) return <GmSetupScreen gmKey={setupKey} onDone={(u) => useUi.getState().setMe(u)} />;
  if (!me) return <LoginScreen notice={loginNotice} onDone={(u) => useUi.getState().setMe(u)} />;
  if (!socket) return <div className="gate">Загрузка сцены...</div>;

  return (
    <div className="app">
      <Toolbar socket={socket} sceneId={sceneId!} onOpenScene={openScene} />
      <main>
        <div className="scene-area">
          <SceneView socket={socket} stageRef={stageRef} onReady={handleReady} />
          <TokenPanel socket={socket} />
        </div>
        <Chat socket={socket} />
      </main>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
