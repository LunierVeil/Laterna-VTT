import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneSocket } from "./net/socket";
import { SceneView } from "./scene/SceneView";
import type { SceneStage } from "./scene/stage";
import { Toolbar } from "./ui/Toolbar";
import { Chat } from "./ui/Chat";
import { TokenPanel } from "./ui/TokenPanel";
import { useUi } from "./state/store";
import type { Scene } from "./types";

function NamePrompt() {
  const setUser = useUi((s) => s.setUser);
  const [value, setValue] = useState("");
  return (
    <div className="gate">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) setUser(value.trim());
        }}
      >
        <h1>Lanterna</h1>
        <p className="muted">Представьтесь. Аутентификации пока нет - это просто имя.</p>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Имя" />
        <button type="submit">Войти</button>
      </form>
    </div>
  );
}

export default function App() {
  const user = useUi((s) => s.user);
  const gmKey = useUi((s) => s.gmKey);
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
    void fetch("/api/scenes")
      .then((r) => r.json())
      .then((list) => setSceneId(list[0]?.id ?? null))
      .catch((e) => console.error("не получил список сцен", e));
  }, []);

  const socket = useMemo(
    // gmKey в зависимостях: ключ сброшен -> переподключаемся уже игроком.
    () => (sceneId && user ? new SceneSocket(sceneId, user) : null),
    [sceneId, user, gmKey],
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

    const off = socket.on((msg) => {
      if (msg.type === "snapshot") {
        ui.setConnected(true);
        if (msg.you) {
          ui.setIsGm(msg.you.is_gm);
          // Ключ устарел (сервер выдал новый) - не держим его и не шлём дальше.
          if (gmKey && !msg.you.is_gm) {
            ui.dropGmKey();
            ui.flashError("ключ ГМ не подошёл - вошёл как игрок");
          }
        }
        ui.setMessages(msg.scene.messages);
        ui.setScene(msg.scene.name, msg.scene.grid_size, msg.scene.background_url);
        buffered.current.scene = msg.scene;
        buffered.current.events = [];
        stageRef.current?.setSnapshot(msg.scene);
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
      if (msg.name === "chat.said") {
        ui.pushMessage(msg.payload.message);
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
  }, [socket, gmKey]);

  const error = useUi((s) => s.error);

  if (!user) return <NamePrompt />;
  if (!socket) return <div className="gate">Загрузка сцены...</div>;

  return (
    <div className="app">
      <Toolbar socket={socket} />
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
