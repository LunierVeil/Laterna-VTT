import { useCallback, useEffect, useState } from "react";
import { useUi, selectSessionEpoch } from "../../state/public";
import { projectionActions } from "../../state/bridge";
import type { SceneInfo, UserInfo } from "../../shared/api/protocol";

const GM_SCENE = "lanterna.gmScene";

/** Cancellation saves work; the epoch also rejects responses that ignore abort. */
export function loadCampaignData(onScene: (id: string) => void): {cancel: () => void; settled: Promise<void>} {
  const controller = new AbortController();
  const current = projectionActions.captureSession();
  const active = () => !controller.signal.aborted && current();
  const read = async (url: string) => {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  };
  const characters = read("/api/characters")
    .then(list => {if (active()) projectionActions.setCharacters(list);})
    .catch(error => {if (active()) console.error("не получил листы", error);});
  const campaign = read("/api/campaign")
    .then((campaign: {active_scene_id: string; scenes?: SceneInfo[]}) => {
      if (!active()) return;
      const saved = localStorage.getItem(GM_SCENE);
      const allowed = campaign.scenes?.some(scene => scene.id === saved);
      onScene(allowed ? saved! : campaign.active_scene_id);
    })
    .catch(error => {if (active()) console.error("не получил кампанию", error);});
  return {cancel: () => controller.abort(), settled: Promise.all([characters, campaign]).then(() => {})};
}

/** The route belongs to a session epoch, not merely to a possibly reused user id. */
export function useCampaignScene(
  me: UserInfo | null,
  resetRolls: () => void,
  setLoginNotice: (notice: string | null) => void,
) {
  const epoch = useUi(selectSessionEpoch);
  const [route, setRoute] = useState<{epoch: number; id: string | null}>({epoch, id: null});
  const sceneId = me && route.epoch === epoch ? route.id : null;
  useEffect(() => {
    resetRolls();
    if (!me) {
      setRoute({epoch, id: null});
      return;
    }
    setLoginNotice(null);
    return loadCampaignData(id => setRoute({epoch, id})).cancel;
  }, [epoch]);

  const setSceneId = useCallback((id: string) => {
    if (useUi.getState().sessionEpoch === epoch && useUi.getState().me) setRoute({epoch, id});
  }, [epoch]);
  const openScene = useCallback((id: string) => {
    if (useUi.getState().sessionEpoch !== epoch || !useUi.getState().me) return;
    localStorage.setItem(GM_SCENE, id);
    setRoute({epoch, id});
  }, [epoch]);

  return { sceneId, setSceneId, openScene };
}
