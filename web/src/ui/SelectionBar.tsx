import { useUi } from "../state/store";
import type { SceneStage } from "../scene/stage";

export function SelectionBar({stageRef}: {stageRef: React.MutableRefObject<SceneStage | null>}) {
  const count = useUi(s => s.selectionCount), editable = useUi(s => s.selectionEditable);
  if (count < 2) return null;
  return <div className="selection-bar" role="group" aria-label="Выбранные токены">
    <span role="status">Выбрано: {count}</span>
    <button className="btn btn-danger" disabled={!editable} onClick={() => stageRef.current?.removeSelected()}>Удалить выбранные ({editable})</button>
    {editable < count && <span className="muted">Чужие токены сохранятся</span>}
    <button className="tool" aria-label="Снять выделение токенов" onClick={() => stageRef.current?.clearSelection()}>×</button>
  </div>;
}
