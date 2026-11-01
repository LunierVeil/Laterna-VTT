import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneSocket } from "./net/socket";
import { SceneView } from "./scene/SceneView";
import type { SceneStage } from "./scene/stage";
import { TopBar } from "./ui/TopBar";
import { ToolRail, ToolHint } from "./ui/ToolRail";
import { Sidebar } from "./ui/Sidebar";
import { ZoomControl } from "./ui/ZoomControl";
import { TokenCard } from "./ui/TokenCard";
import { InitiativePanel } from "./ui/InitiativePanel";
import { useUi } from "./state/store";
import { GmSetupScreen, InviteScreen, LoginScreen } from "./ui/Login";
import { CharacterSheet } from "./sheets/CharacterSheet";
import { DiceMenu } from "./ui/DicePanel";
import { DiceAnimation } from "./ui/DiceAnimation";
import { SelectionBar } from "./ui/SelectionBar";
import type { Message } from "./types";
import type { Scene, SceneInfo, UserInfo } from "./types";

const GM_SCENE = "lanterna.gmScene";

/**
 * Ключ ГМ приходит один раз в ссылке ?gm=... Забираем его при загрузке
 * модуля (а не в эффекте: StrictMode запускает эффекты дважды, и второй
 * запуск уже не нашёл бы ключ в адресе) и сразу убираем из адресной
 * строки - чтобы не светить при показе экрана. Дальше нужна только сессия.
 */
function takeFromUrl(param: string): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(param);
  if (value) {
    url.searchParams.delete(param);
    history.replaceState(null, "", url);
  }
  return value;
}

const GM_KEY_FROM_URL = takeFromUrl("gm");
// Приглашение от мастера - так же: забрать и убрать из адреса.
const INVITE_FROM_URL = takeFromUrl("invite");

/**
 * Вход мастера по ключу - из ссылки ?gm=... или с экрана входа. Первый
 * раз (аккаунта ещё нет) - на экран "придумай имя и пароль".
 * Возвращает текст ошибки или null.
 */
async function gmKeyLogin(
  key: string,
  onSetup: (key: string) => void,
): Promise<string | null> {
  const res = await fetch("/api/gm/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.needs_setup) onSetup(key);
  else if (res.ok) useUi.getState().setMe(data as UserInfo);
  else return data.detail || "ключ ГМ не подошёл";
  return null;
}

export default function App() {
  const [hideSidebar, setHideSidebar] = useState(true);
  const [hideRail, setHideRail] = useState(false);
  const me = useUi((s) => s.me);
  // Экран до игры: проверяем сессию, затем вход или первый вход мастера.
  const [checking, setChecking] = useState(true);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(INVITE_FROM_URL);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const stageRef = useRef<SceneStage | null>(null);
  const [animatedRoll, setAnimatedRoll] = useState<Message | null>(null);
  const seenRolls = useRef(new Set<string>());
  const diceOpen = useUi(s => s.diceOpen), diceAnimation = useUi(s => s.diceAnimation);
  const closeDice = useCallback(() => useUi.getState().setDiceOpen(false), []);
  useEffect(() => {if (!diceAnimation) setAnimatedRoll(null);}, [diceAnimation]);
  const loginWithKey = (key: string) => gmKeyLogin(key, setSetupKey);

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
          const error = await loginWithKey(GM_KEY_FROM_URL);
          if (!error) return;
          setLoginNotice(error);
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
      setAnimatedRoll(null);
      seenRolls.current.clear();
      useUi.getState().setCharacters([]);
      useUi.getState().openCharacter(null);
      return;
    }
    setLoginNotice(null);
    // Листы - свои, у ГМ все. Дальше их держат в актуальном виде сообщения сокета.
    void fetch("/api/characters")
      .then((r) => r.json())
      .then((list) => useUi.getState().setCharacters(list))
      .catch((e) => console.error("не получил листы", e));
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
        // History is never an animation source, including reconnects/scene switches.
        for (const m of msg.scene.messages) seenRolls.current.add(m.id);
        while (seenRolls.current.size > 512) seenRolls.current.delete(seenRolls.current.values().next().value!);
        ui.setScene(msg.scene.name, msg.scene.grid_size, msg.scene.background_url);
        ui.setCombat(msg.scene.combat);
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
      if (msg.type === "ping") {
        // Не событие сцены: без seq, в буфер до готовности стейджа не кладём.
        stageRef.current?.showPing(msg.x, msg.y, msg.author, msg.color);
        return;
      }
      if (msg.type === "chat") {
        ui.pushMessage(msg.message);
        if (!seenRolls.current.has(msg.message.id)) {
          seenRolls.current.add(msg.message.id);
          if (msg.message.kind === "roll" && msg.message.roll && useUi.getState().diceAnimation) setAnimatedRoll(msg.message);
        }
        if (seenRolls.current.size > 512) seenRolls.current.delete(seenRolls.current.values().next().value!);
        return;
      }
      if (msg.type === "campaign") {
        ui.setCampaign(msg.active_scene_id, msg.scenes, msg.users, msg.invites, msg.folders);
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
      if (msg.type === "character") {
        ui.putCharacter(msg.character);
        return;
      }
      if (msg.type === "character_deleted") {
        ui.dropCharacter(msg.id);
        return;
      }
      if (msg.type === "reply") {
        // Новый лист - сразу открыть.
        if (msg.name === "character.created") {
          ui.openCharacter(msg.payload.character.id);
          // Импорт LSS: что перенесено и что нет - одной строкой.
          const report = msg.payload.report as { done: string[]; skipped: string[] } | undefined;
          if (report) {
            const done = report.done.length ? `перенесено: ${report.done.join(", ")}` : "";
            const skipped = report.skipped.length ? `не перенесено: ${report.skipped.join("; ")}` : "";
            ui.flashNotice(`Импорт LSS - ${[done, skipped].filter(Boolean).join(". ") || "готово"}`);
          }
        }
        // ГМ создал сцену - сразу открываем её, чтобы готовить.
        if (msg.name === "scene.created") openScene(msg.payload.id);
        // Код приглашения приходит только сюда и только один раз.
        if (msg.name === "invite.created") ui.setLastInvite(msg.payload);
        return;
      }
      if (msg.name === "combat.updated") {
        // Панели - в React; подсветку хода на карте стейдж берёт из того же события.
        ui.setCombat(msg.payload.combat);
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
  const notice = useUi((s) => s.notice);
  const openCharacter = useUi((s) => (s.openCharacterId ? s.characters[s.openCharacterId] : null));

  // По ссылке-приглашению - её экран, даже если в браузере уже кто-то вошёл:
  // ссылку открыли, чтобы завести аккаунт, а не продолжить чужую сессию.
  if (inviteToken) {
    return (
      <InviteScreen
        token={inviteToken}
        onDone={(u) => {
          setInviteToken(null);
          useUi.getState().setMe(u);
        }}
      />
    );
  }
  if (checking) return <div className="gate-wait">Загрузка...</div>;
  if (!me && setupKey) return (
      <GmSetupScreen
        gmKey={setupKey}
        onDone={(u) => {
          // Аккаунт создан - ключ больше не нужен. Иначе после выхода
          // снова открылся бы экран "придумай имя и пароль".
          setSetupKey(null);
          useUi.getState().setMe(u);
        }}
      />
    );
  if (!me) return <LoginScreen notice={loginNotice} onDone={(u) => useUi.getState().setMe(u)} onGmKey={loginWithKey} />;
  if (!socket) return <div className="gate-wait">Загрузка сцены...</div>;

  return (
    <div className={`app ${hideSidebar ? "hide-sidebar" : ""} ${hideRail ? "hide-rail" : ""}`}>
      <div className="mobile-panels">
        <button aria-label={hideSidebar ? "Открыть панели" : "Свернуть панели"} aria-expanded={!hideSidebar} aria-controls="table-sidebar" onClick={() => {
          if (hideSidebar) useUi.getState().setSideTab("chat");
          setHideSidebar(!hideSidebar);
        }}>{hideSidebar ? "Чат ›" : "‹ Скрыть чат"}</button>
        <button onClick={() => setHideRail(!hideRail)}>{hideRail ? "Инструменты" : "Свернуть инструменты"}</button>
      </div>
      <TopBar socket={socket} sceneId={sceneId!} />
      <main>
        <ToolRail socket={socket} stageRef={stageRef} />
        <div className="scene-area">
          <SceneView socket={socket} stageRef={stageRef} onReady={handleReady} />
          <TokenCard socket={socket} stageRef={stageRef} />
          <InitiativePanel socket={socket} />
          <ToolHint />
          <SelectionBar stageRef={stageRef} />
          {diceOpen && <DiceMenu socket={socket} onClose={closeDice} />}
          <DiceAnimation key={animatedRoll?.id ?? "none"} message={diceAnimation ? animatedRoll : null} />
          <ZoomControl stageRef={stageRef} />
        </div>
        <Sidebar onHide={() => setHideSidebar(true)} socket={socket} sceneId={sceneId!} onOpenScene={openScene} stageRef={stageRef} />
      </main>
      {openCharacter && <CharacterSheet key={openCharacter.id} character={openCharacter} socket={socket} />}
      {error && <div className="toast">{error}</div>}
      {notice && !error && (
        <div className="toast toast-notice" role="status" onClick={() => useUi.setState({ notice: null })}>
          {notice}
        </div>
      )}
    </div>
  );
}
