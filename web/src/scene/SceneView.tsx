import { useEffect, useRef } from "react";
import { SceneStage, type CharacterStats } from "./stage";
import type { SceneSocket } from "../net/socket";
import { useUi } from "../state/store";
import { SHEETS } from "../sheets/dnd5e";
import type { Character } from "../types";

function at(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Хиты и КД для токенов - из листов, которые этому клиенту видны. Что брать,
 * говорит схема листа (token); чужих листов здесь нет, значит и полосок нет.
 */
function statsOf(characters: Record<string, Character>): Map<string, CharacterStats> {
  const out = new Map<string, CharacterStats>();
  for (const c of Object.values(characters)) {
    const view = SHEETS[c.system]?.token;
    if (!view) continue;
    const num = (p: string) => (typeof at(c.data, p) === "number" ? (at(c.data, p) as number) : undefined);
    const badge = at(c.data, view.badge.key);
    // Скорость в листе - текст ("30", "30 фт"): берём число в начале.
    const speedRaw = view.speed ? String(at(c.data, view.speed) ?? "").match(/^\s*(\d+)/)?.[1] : undefined;
    out.set(c.id, {
      hp: num(view.bar.current),
      max: num(view.bar.max),
      badge: badge == null || badge === "" ? undefined : String(badge),
      speed: speedRaw ? Number(speedRaw) : undefined,
    });
  }
  return out;
}

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
      onAddToken: (x, y) => {
        // Скрытым ставит только ГМ - сервер всё равно проверит.
        const hidden = useUi.getState().isGm && useUi.getState().placeHidden;
        socket.send("token.add", { x, y, name: "Токен", ...(hidden ? { layer: "gm" } : {}) });
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
                }
              : null,
          ),
      onChainChange: (active) => useUi.getState().setChaining(active),
      onOpenToken: (t) => {
        // Лист открывается, только если он этому клиенту виден.
        const ui = useUi.getState();
        if (t.character_id && ui.characters[t.character_id]) ui.openCharacter(t.character_id);
      },
    }, useUi.getState().me!.id);

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
        stage.setCharacterStats(statsOf(useUi.getState().characters));
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

  // Лист поменялся (урон, правка КД) - полоска на токене за ним.
  useEffect(() => {
    stageRef.current?.setCharacterStats(statsOf(characters));
  }, [characters, stageRef]);

  return <div className="scene" ref={host} />;
}
