import { useState } from "react";
import { WALL_KINDS, wallDefaults, type WallKind } from "../../../entities/scene/model/tool";
import type { Wall } from "../../../shared/api/protocol";
import { Checkbox } from "../../../shared/ui/Checkbox/Checkbox";
import { Dialog } from "../../../shared/ui/Dialog/Dialog";
import { Select } from "../../../shared/ui/Select/Select";

const DOOR_STATES = [
  { value: "closed", label: "Закрыта" },
  { value: "open", label: "Открыта" },
  { value: "locked", label: "Заперта" },
];

type WallPropertiesValue = Pick<Wall, "kind" | "door_state" | "blocks_sight" | "blocks_movement">;

export function WallProperties({ wall, onClose, onSave }: {
  wall: Wall;
  onClose: () => void;
  onSave: (value: WallPropertiesValue) => void;
}) {
  const [draft, setDraft] = useState<WallPropertiesValue>(() => ({
    kind: wall.kind,
    door_state: wall.door_state,
    blocks_sight: wall.blocks_sight,
    blocks_movement: wall.blocks_movement,
  }));
  const knownKind = WALL_KINDS.some(({ value }) => value === draft.kind);

  return <Dialog open title="Свойства препятствия" confirmLabel="Сохранить" onClose={onClose}
    onConfirm={() => {
      if (!knownKind) throw new Error("Выберите тип препятствия");
      onSave(draft);
    }}
    description={<>
      <Select label="Тип препятствия" value={knownKind ? draft.kind : ""}
        placeholder="Выберите тип" options={WALL_KINDS}
        onChange={event => {
          const kind = event.target.value as WallKind;
          // Возврат к исходному типу восстанавливает подтверждённые свойства.
          setDraft(kind === wall.kind ? {
            kind,
            door_state: wall.door_state,
            blocks_sight: wall.blocks_sight,
            blocks_movement: wall.blocks_movement,
          } : wallDefaults(kind));
        }} />
      {draft.kind === "door" ? <Select label="Состояние двери" options={DOOR_STATES}
        value={draft.door_state} onChange={event => setDraft({ ...draft, door_state: event.target.value })} />
        : knownKind && <>
          <Checkbox label="Блокирует обзор" checked={draft.blocks_sight}
            onChange={event => setDraft({ ...draft, blocks_sight: event.target.checked })} />
          <Checkbox label="Блокирует движение" checked={draft.blocks_movement}
            onChange={event => setDraft({ ...draft, blocks_movement: event.target.checked })} />
        </>}
    </>} />;
}
