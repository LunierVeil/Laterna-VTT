import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { SceneSocket } from "../../shared/api/scene-socket";
import type { Message, Scene, UserInfo } from "../../shared/api/protocol";
import type { SceneStage } from "../../widgets/scene-canvas/lib/stage";
import { useUi } from "../../state/public";
import { projectionActions } from "../../state/bridge";

/** Refs, setters и openScene сохраняют стабильную идентичность из App/campaign. */
export function useSceneConnection({
  sceneId, me, stageRef, seenRolls, setAnimatedRoll, setLoginNotice, setSceneId, openScene,
}: {
  sceneId: string | null;
  me: UserInfo | null;
  stageRef: MutableRefObject<SceneStage | null>;
  seenRolls: MutableRefObject<Set<string>>;
  setAnimatedRoll: (message: Message | null) => void;
  setLoginNotice: (notice: string | null) => void;
  setSceneId: (id: string) => void;
  openScene: (id: string) => void;
}) {
  // Сокет подключается быстрее, чем инициализируется PixiJS, поэтому
  // снапшот и события, пришедшие до готовности сцены, копим здесь и
  // проигрываем, когда стейдж поднялся. Иначе первый снапшот теряется
  // и сцена остаётся пустой навсегда.
  const buffered = useRef<{
    scene: Scene | null;
    events: { name: string; payload: any; cmdId: string | null }[];
  }>({ scene: null, events: [] });


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
    const ui = projectionActions;

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
      if (msg.type === "token_preview") {
        stageRef.current?.applyTokenPreview(msg);
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
        const currentName = msg.scenes?.find(s => s.id === sceneId)?.name ?? (msg.active_scene_id === sceneId ? msg.active_scene_name : undefined);
        if (currentName) ui.setScene(currentName, useUi.getState().gridSize, useUi.getState().background);
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
      projectionActions.setConnected(false);
    };
  }, [socket, sceneId, openScene]);


  return { socket, handleReady };
}
