import { useEffect, useRef } from "react";
import { SceneStage } from "./stage";
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
      onAddToken: (x, y) => {
        socket.send("token.add", { x, y, name: "Токен" });
      },
      onRemoveToken: (id) => {
        socket.send("token.remove", { id });
      },
      onAddWall: (x1, y1, x2, y2) => socket.send("wall.add", { x1, y1, x2, y2 }),
      onRemoveWall: (id) => {
        socket.send("wall.remove", { id });
      },
      onSelect: (t) =>
        useUi
          .getState()
          .setSelected(t ? { id: t.id, name: t.name, color: t.color, owner: t.owner, size: t.size } : null),
      onChainChange: (active) => useUi.getState().setChaining(active),
    }, useUi.getState().user);

    // mount() асинхронный: PixiJS инициализируется не мгновенно.
    // В StrictMode эффект отрабатывает дважды, поэтому нужен свой флаг:
    // без него колбэк уже отменённого стейджа успевает записать себя в
    // stageRef, и следующее же обращение летит в разрушенный объект.
    let cancelled = false;

    const mounted = stage
      .mount(host.current!)
      .then(() => {
        if (cancelled || !stage.isAlive) return;
        stageRef.current = stage;
        stage.setTool(useUi.getState().tool);
        stage.setGm(useUi.getState().isGm);
        onReady(stage);
      })
      .catch((e) => console.error("не удалось поднять сцену", e));

    return () => {
      cancelled = true;
      if (stageRef.current === stage) stageRef.current = null;
      void mounted.finally(() => stage.destroy());
    };
  }, [socket, stageRef, onReady]);

  useEffect(() => {
    stageRef.current?.setTool(tool);
  }, [tool, stageRef]);

  useEffect(() => {
    stageRef.current?.setGm(isGm);
  }, [isGm, stageRef]);

  return <div className="scene" ref={host} />;
}
