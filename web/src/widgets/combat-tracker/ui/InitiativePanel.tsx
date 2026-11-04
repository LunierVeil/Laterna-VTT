import { useEffect, useState } from "react";
import { useUi, uiActions, selectCombat, selectCombatOpen, selectIsGm, selectMe, selectSelected } from "../../../state/public";
import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { CombatEntry } from "../../../shared/api/protocol";
import type { CharacterPresentation } from "../../../entities/character/model/definition";
type InitiativePresentation = Pick<CharacterPresentation, "initiativeBonus" | "initiativeTitle" | "initiativeResult">;

/** Бонус инициативы из привязанного листа (путь - в схеме, token.initiative). */
function initiativeBonus(entry: CombatEntry, presentation: InitiativePresentation): number {
  const c = entry.character_id ? useUi.getState().characters[entry.character_id] : undefined;
  return presentation.initiativeBonus(c);
}

/** Поле инициативы: сохраняет по Enter и уходу с поля. */
function InitInput({ entry, onCommit }: { entry: CombatEntry; onCommit: (v: number | null) => void }) {
  const shown = entry.init == null ? "" : String(entry.init);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <input
      className="init-input"
      aria-label={`${entry.name}: инициатива`}
      value={draft}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        if (draft === shown) return;
        const n = Number(draft.trim());
        if (draft.trim() === "") onCommit(null);
        else if (Number.isInteger(n)) onCommit(n);
        else setDraft(shown);
      }}
    />
  );
}

/**
 * Трекер инициативы. Ничего не решает сам: все действия - команды combat.*,
 * порядок и чей ход считает сервер. Игрок правит и бросает только свою
 * строку и заканчивает только свой ход.
 */
export function InitiativePanel({ socket, presentation }: { socket: SceneSocket; presentation: InitiativePresentation }) {
  const combat = useUi(selectCombat);
  const open = useUi(selectCombatOpen);
  const isGm = useUi(selectIsGm);
  const me = useUi(selectMe);
  const selected = useUi(selectSelected);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Очередь видна в шапке; полный трекер - по кнопке или клику по очереди.
  if (!open) return null;
  const entries = combat?.entries ?? [];
  const mine = (e: CombatEntry) => isGm || (!!me && e.owner_id === me.id);
  const current = entries.find((e) => e.id === combat?.current);
  const started = !!current;
  // Добавить можно выбранный токен: ГМ - любой, игрок - свой.
  const canAdd =
    selected &&
    !entries.some((e) => e.token_id === selected.id) &&
    (isGm || (!!me && selected.owner_id === me.id));

  return (
    <div className="initiative">
      <header className="initiative-head">
        <strong>Бой</strong>
        <span className="muted">{started ? `раунд ${combat!.round}` : entries.length ? "не начат" : "пусто"}</span>
        <button className="tool initiative-close" title="свернуть" onClick={() => uiActions.setCombatOpen(false)}>
          ×
        </button>
      </header>
      {entries.length === 0 && (
        <p className="muted initiative-hint">Выбери токен на карте и нажми «В бой».</p>
      )}
      <ol className="initiative-list">
        {entries.map((e) => (
          <li key={e.id} className={e.id === combat?.current ? "init-row init-row-current" : "init-row"}>
            <span className="init-marker">{e.id === combat?.current ? "▶" : ""}</span>
            <span className="init-name" title={e.name}>
              {e.name}
            </span>
            {mine(e) ? (
              <InitInput entry={e} onCommit={(v) => socket.send("combat.set", { entry_id: e.id, init: v })} />
            ) : (
              <span className="init-value">{e.init ?? "—"}</span>
            )}
            {mine(e) && (
              <button
                className="tool"
                title={presentation.initiativeTitle(initiativeBonus(e, presentation))}
                onClick={() => socket.send("combat.roll", { entry_id: e.id, bonus: initiativeBonus(e, presentation) })}
              >
                🎲
              </button>
            )}
            {e.roll && (
              <span className="muted init-roll" title={e.roll.formula}>
                {presentation.initiativeResult(e.roll)}
              </span>
            )}
            {mine(e) && (
              <button className="tool" title="убрать из боя" onClick={() => socket.send("combat.remove", { entry_id: e.id })}>
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="initiative-actions">
        {canAdd && (
          <button className="tool" onClick={() => socket.send("combat.add", { token_id: selected!.id })}>
            В бой: {selected!.name}
          </button>
        )}
        {isGm && entries.length > 0 && (
          <button className="tool tool-active" onClick={() => socket.send("combat.next", {})}>
            {started ? "Следующий ход" : "Начать бой"}
          </button>
        )}
        {!isGm && current && mine(current) && (
          <button className="tool tool-active" onClick={() => socket.send("combat.next", {})}>
            Закончить ход
          </button>
        )}
        {isGm &&
          entries.length > 0 &&
          (confirmEnd ? (
            <button
              className="tool tool-danger"
              onClick={() => {
                socket.send("combat.end", {});
                setConfirmEnd(false);
              }}
            >
              Закончить бой?
            </button>
          ) : (
            <button className="tool" onClick={() => setConfirmEnd(true)}>
              Закончить
            </button>
          ))}
      </div>
    </div>
  );
}
