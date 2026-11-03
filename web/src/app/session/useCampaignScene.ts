import { useCallback, useEffect, useState } from "react";
import { useUi } from "../../state/store";
import type { SceneInfo, UserInfo } from "../../shared/api/protocol";

const GM_SCENE = "lanterna.gmScene";

/** resetRolls и setLoginNotice — стабильные callback/setter из App. */
export function useCampaignScene(
  me: UserInfo | null,
  resetRolls: () => void,
  setLoginNotice: (notice: string | null) => void,
) {
  const [sceneId, setSceneId] = useState<string | null>(null);
  // Игрок всегда в активной сцене. ГМ возвращается туда, где был.
  // Вышел - сцены больше нет, сокет закроется вместе с ней.
  useEffect(() => {
    if (!me) {
      setSceneId(null);
      resetRolls();
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

  return { sceneId, setSceneId, openScene };
}
