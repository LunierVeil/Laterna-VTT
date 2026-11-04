import { useCallback, useEffect, useRef, useState } from "react";
import { TablePage } from "../pages/table/ui/TablePage";
import type { SceneStage } from "../widgets/scene-canvas/lib/stage";
import { useUi, uiActions, selectMe, selectDiceOpen, selectDiceAnimation, selectError, selectNotice, selectSessionEpoch } from "../state/public";
import { AccessPage } from "../pages/access/ui/AccessPage";
import type { Message } from "../shared/api/protocol";

import { GM_KEY_FROM_URL, INVITE_FROM_URL, gmKeyLogin, acceptSession, captureSession } from "./session/access";

import { systemBindings } from "./systems/ui-bindings";

import { useCampaignScene } from "./session/useCampaignScene";
import { useSceneConnection } from "./session/useSceneConnection";

export default function App() {
  const [hideSidebar, setHideSidebar] = useState(true);
  const [hideRail, setHideRail] = useState(false);
  const me = useUi(selectMe);
  const epoch = useUi(selectSessionEpoch);
  // Экран до игры: проверяем сессию, затем вход или первый вход мастера.
  const [checking, setChecking] = useState(true);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(INVITE_FROM_URL);
  const stageRef = useRef<SceneStage | null>(null);
  const [animation, setAnimation] = useState<{epoch: number; message: Message} | null>(null);
  const animatedRoll = animation?.epoch === epoch ? animation.message : null;
  const setAnimatedRoll = useCallback((message: Message | null) => setAnimation(message ? {epoch, message} : null), [epoch]);
  const seenRolls = useRef(new Set<string>());
  const resetRolls = useCallback(() => {
    setAnimation(null);
    seenRolls.current.clear();
  }, []);
  const diceOpen = useUi(selectDiceOpen), diceAnimation = useUi(selectDiceAnimation);
  const closeDice = useCallback(() => uiActions.setDiceOpen(false), []);
  useEffect(() => {if (!diceAnimation) setAnimatedRoll(null);}, [diceAnimation]);
  const loginWithKey = (key: string) => gmKeyLogin(key, setSetupKey);

  useEffect(() => {
    const current = captureSession();
    let cancelled = false;
    void (async () => {
      try {
        if (GM_KEY_FROM_URL) {
          const error = await loginWithKey(GM_KEY_FROM_URL);
          if (!error) return;
          if (cancelled || !current()) return;
          setLoginNotice(error);
        }
        const res = await fetch("/api/me");
        if (res.ok) {
          const user = await res.json();
          if (!cancelled && current()) acceptSession(user);
        } // null, если сессии нет
      } catch (e) {
        console.error("не проверил сессию", e);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {cancelled = true;};
  }, []);

  const { sceneId, setSceneId, openScene } = useCampaignScene(me, resetRolls, setLoginNotice);

  const { socket, handleReady } = useSceneConnection({
    sceneId, me, stageRef, seenRolls, setAnimatedRoll, setLoginNotice, setSceneId, openScene,
  });

  const error = useUi(selectError);
  const notice = useUi(selectNotice);
  const openCharacter = useUi((s) => (s.openCharacterId ? s.characters[s.openCharacterId] : null));

  // По ссылке-приглашению - её экран, даже если в браузере уже кто-то вошёл:
  // ссылку открыли, чтобы завести аккаунт, а не продолжить чужую сессию.
  if (inviteToken) {
    return (
      <AccessPage mode="invite"
        token={inviteToken}
        onDone={(u) => {
          setInviteToken(null);
          acceptSession(u);
        }}
      />
    );
  }
  if (checking) return <AccessPage mode="checking" />;
  if (!me && setupKey) return (
      <AccessPage mode="gm-setup"
        gmKey={setupKey}
        onDone={(u) => {
          // Аккаунт создан - ключ больше не нужен. Иначе после выхода
          // снова открылся бы экран "придумай имя и пароль".
          setSetupKey(null);
          acceptSession(u);
        }}
      />
    );
  if (!me) return <AccessPage mode="login" notice={loginNotice} onDone={(u) => acceptSession(u)} onGmKey={loginWithKey} />;
  if (!socket) return <AccessPage mode="scene-loading" />;

  return (
    <TablePage
      systemBindings={systemBindings}
      hideSidebar={hideSidebar} hideRail={hideRail}
      onToggleSidebar={() => {
        if (hideSidebar) uiActions.setSideTab("chat");
        setHideSidebar(!hideSidebar);
      }}
      onToggleRail={() => setHideRail(!hideRail)}
      onHideSidebar={() => setHideSidebar(true)}
      onDismissNotice={() => uiActions.dismissNotice()}
      socket={socket} sceneId={sceneId!} stageRef={stageRef} handleReady={handleReady}
      diceOpen={diceOpen} closeDice={closeDice} animatedRoll={animatedRoll} diceAnimation={diceAnimation}
      openScene={openScene} openCharacter={openCharacter} error={error} notice={notice}
    />
  );
}
