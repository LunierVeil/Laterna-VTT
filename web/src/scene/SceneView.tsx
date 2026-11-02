import { useEffect, useRef } from "react";
import { SceneStage } from "./stage";
import { statsOf } from "../sheets/tokenStats";
import type { SceneSocket } from "../net/socket";
import { useUi } from "../state/store";

export function SceneView({
  socket,
  stageRef,
  onReady,
}: {
  socket: SceneSocket;
  stageRef: React.MutableRefObject<SceneStage | null>;
  onReady: (stage: SceneStage) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tool = useUi((s) => s.tool);
  const isGm = useUi((s) => s.isGm);
  const characters = useUi((s) => s.characters);

  useEffect(() => {
    const stage = new SceneStage({
      onMoveToken: (id, x, y, prev) => {
        socket.send(
          "token.move",
          { id, x, y },
          {
            apply: () => stage.applyLocalMove(id, x, y),
            revert: () => stage.revertToken(id, prev.x, prev.y),
          },
        );
      },
      onPreview: (payload) => {socket.send("token.preview", {...payload, base_seq: socket.sequence});},
      onPreviewEnd: (drag_id) => {socket.send("token.preview.end", {drag_id});},
      onAddToken: (x, y) => {
        // Скрытым ставит только ГМ - сервер всё равно проверит.
        const hidden = useUi.getState().isGm && useUi.getState().placeHidden;
        socket.send("token.add", { x, y, name: "Токен", ...(hidden ? { layer: "gm" } : {}) });
      },
      onRemoveToken: (id) => {
        socket.send("token.remove", { id });
      },
      onAddWall: (x1, y1, x2, y2) => socket.send("wall.add", { x1, y1, x2, y2, kind: useUi.getState().wallKind }),
      onDoor: (id, state) => {
        socket.send("wall.door", { id, state });
      },
      onRemoveWall: (id) => {
        socket.send("wall.remove", { id });
      },
      onSelect: (t) =>
        useUi
          .getState()
          .setSelected(
            t
              ? {
                  id: t.id,
                  name: t.name,
                  color: t.color,
                  owner_id: t.owner_id,
                  size: t.size,
                  character_id: t.character_id,
                  image_url: t.image_url,
                  layer: t.layer,
                  hp: t.hp,
                }
              : null,
          ),
      onSelectionChange: (selectionCount, selectionEditable) => useUi.setState({selectionCount, selectionEditable}),
      onChainChange: (active) => useUi.getState().setChaining(active),
      onOpenToken: (t) => {
        // Лист открывается, только если он этому клиенту виден.
        const ui = useUi.getState();
        if (t.character_id && ui.characters[t.character_id]) ui.openCharacter(t.character_id);
      },
      onZoom: (scale) => useUi.getState().setZoom(scale),
      onPing: (x, y) => socket.send("ping", { x, y }),
      onFog: (mode, x, y, w, h) => socket.send(mode === "cover" ? "fog.cover" : "fog.reveal", { x, y, w, h }),
      onFogUndo: () => {
        socket.send("fog.undo", {});
      },
    }, useUi.getState().me!.id);

    const offDisconnect = socket.onDisconnect(() => stage.clearDragPreviews());

    // mount() асинхронный: PixiJS инициализируется не мгновенно.
    // В StrictMode эффект отрабатывает дважды, поэтому нужен свой флаг:
    // без него колбэк уже отменённого стейджа успевает записать себя в
    // stageRef, и следующее же обращение летит в разрушенный объект.
    let cancelled = false;

    // StrictMode disposes its first effect synchronously. Do not start an
    // expensive WebGL initialization for a stage that will never be shown.
    const mounted = Promise.resolve()
      .then(() => {if (!cancelled) return stage.mount(host.current!);})
      .then(() => {
        if (cancelled || !stage.isAlive) return;
        stageRef.current = stage;
        stage.setTool(useUi.getState().tool);
        stage.setGm(useUi.getState().isGm);
        stage.setFogMode(useUi.getState().fogMode);
        stage.setCharacterStats(statsOf(useUi.getState().characters));
        useUi.getState().setZoom(1);
        onReady(stage);
      })
      .catch((e) => console.error("не удалось поднять сцену", e));

    return () => {
      cancelled = true;
      offDisconnect();
      if (stageRef.current === stage) {stageRef.current = null; useUi.setState({selectionCount: 0, selectionEditable: 0});}
      void mounted.finally(() => stage.destroy());
    };
  }, [socket, stageRef, onReady]);

  useEffect(() => {
    stageRef.current?.setTool(tool);
  }, [tool, stageRef]);

  useEffect(() => {
    stageRef.current?.setGm(isGm);
  }, [isGm, stageRef]);

  const fogMode = useUi((s) => s.fogMode);
  useEffect(() => {
    stageRef.current?.setFogMode(fogMode);
  }, [fogMode, stageRef]);

  // Лист поменялся (урон, правка КД) - полоска на токене за ним.
  useEffect(() => {
    stageRef.current?.setCharacterStats(statsOf(characters));
  }, [characters, stageRef]);

  return <div className="scene" ref={host} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-laterna-character");
    const p = stageRef.current?.dropPoint(e.clientX, e.clientY);
    if (id && p) socket.send("token.add", { ...p, character_id: id });
  }} />;
}
