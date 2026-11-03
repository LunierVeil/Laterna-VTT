import { useCallback, useEffect, useRef, useState } from "react";
import { TablePage } from "../pages/table/ui/TablePage";
import type { SceneStage } from "../widgets/scene-canvas/lib/stage";
import { useUi } from "../state/store";
import { AccessPage } from "../pages/access/ui/AccessPage";
import type { Message } from "../shared/api/protocol";

import { GM_KEY_FROM_URL, INVITE_FROM_URL, gmKeyLogin } from "./session/access";

import { useCampaignScene } from "./session/useCampaignScene";
import { useSceneConnection } from "./session/useSceneConnection";

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
      <AccessPage mode="invite"
        token={inviteToken}
        onDone={(u) => {
          setInviteToken(null);
          useUi.getState().setMe(u);
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
          useUi.getState().setMe(u);
        }}
      />
    );
  if (!me) return <AccessPage mode="login" notice={loginNotice} onDone={(u) => useUi.getState().setMe(u)} onGmKey={loginWithKey} />;
  if (!socket) return <AccessPage mode="scene-loading" />;

  return (
    <TablePage
      hideSidebar={hideSidebar} hideRail={hideRail}
      onToggleSidebar={() => {
        if (hideSidebar) useUi.getState().setSideTab("chat");
        setHideSidebar(!hideSidebar);
      }}
      onToggleRail={() => setHideRail(!hideRail)}
      onHideSidebar={() => setHideSidebar(true)}
      onDismissNotice={() => useUi.setState({ notice: null })}
      socket={socket} sceneId={sceneId!} stageRef={stageRef} handleReady={handleReady}
      diceOpen={diceOpen} closeDice={closeDice} animatedRoll={animatedRoll} diceAnimation={diceAnimation}
      openScene={openScene} openCharacter={openCharacter} error={error} notice={notice}
    />
  );
}
