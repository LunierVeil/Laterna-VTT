import { useCallback, useEffect, useRef, useState } from "react";
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
import type { Message } from "./shared/api/protocol";

import { GM_KEY_FROM_URL, INVITE_FROM_URL, gmKeyLogin } from "./app/session/access";

import { useCampaignScene } from "./app/session/useCampaignScene";
import { useSceneConnection } from "./app/session/useSceneConnection";

export default function App() {
  const [hideSidebar, setHideSidebar] = useState(true);
  const [hideRail, setHideRail] = useState(false);
  const me = useUi((s) => s.me);
  // Экран до игры: проверяем сессию, затем вход или первый вход мастера.
  const [checking, setChecking] = useState(true);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(INVITE_FROM_URL);
  const stageRef = useRef<SceneStage | null>(null);
  const [animatedRoll, setAnimatedRoll] = useState<Message | null>(null);
  const seenRolls = useRef(new Set<string>());
  const resetRolls = useCallback(() => {
    setAnimatedRoll(null);
    seenRolls.current.clear();
  }, []);
  const diceOpen = useUi(s => s.diceOpen), diceAnimation = useUi(s => s.diceAnimation);
  const closeDice = useCallback(() => useUi.getState().setDiceOpen(false), []);
  useEffect(() => {if (!diceAnimation) setAnimatedRoll(null);}, [diceAnimation]);
  const loginWithKey = (key: string) => gmKeyLogin(key, setSetupKey);

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

  const { sceneId, setSceneId, openScene } = useCampaignScene(me, resetRolls, setLoginNotice);

  const { socket, handleReady } = useSceneConnection({
    sceneId, me, stageRef, seenRolls, setAnimatedRoll, setLoginNotice, setSceneId, openScene,
  });

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
