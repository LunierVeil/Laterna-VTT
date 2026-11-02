import { useUi } from "../state/store";
import type { SceneStage } from "../scene/stage";

/** Масштаб кнопками - колесо мыши есть не у всех (тачпад, планшет). */
export function ZoomControl({ stageRef }: { stageRef: React.MutableRefObject<SceneStage | null> }) {
  const zoom = useUi((s) => s.zoom);
  return (
    <div className="zoom">
      <button className="zoom-btn" aria-label="отдалить" onClick={() => stageRef.current?.zoomBy(1 / 1.25)}>
        −
      </button>
      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      <button className="zoom-btn" aria-label="приблизить" onClick={() => stageRef.current?.zoomBy(1.25)}>
        +
      </button>
    </div>
  );
}
