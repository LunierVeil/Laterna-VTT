import { useEffect, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { CombatEntry } from "../types";
import { SHEETS } from "../sheets/dnd5e";

/** Бонус инициативы из привязанного листа (путь - в схеме, token.initiative). */
function initiativeBonus(entry: CombatEntry): number {
  const c = entry.character_id ? useUi.getState().characters[entry.character_id] : undefined;
  const path = c ? SHEETS[c.system]?.token?.initiative : undefined;
  if (!c || !path) return 0;
  let node: any = c.data;
  for (const part of path.split(".")) node = node?.[part];
  return typeof node === "number" ? node : 0;
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
export function InitiativePanel({ socket }: { socket: SceneSocket }) {
  const combat = useUi((s) => s.combat);
  const open = useUi((s) => s.combatOpen);
  const isGm = useUi((s) => s.isGm);
  const me = useUi((s) => s.me);
  const selected = useUi((s) => s.selected);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!combat && !open) return null;
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
        <button className="tool initiative-close" title="свернуть" onClick={() => useUi.getState().setCombatOpen(false)}>
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
                title={`бросить 1d20${initiativeBonus(e) ? `${initiativeBonus(e) > 0 ? "+" : ""}${initiativeBonus(e)}` : ""} (бонус из листа)`}
                onClick={() => socket.send("combat.roll", { entry_id: e.id, bonus: initiativeBonus(e) })}
              >
                🎲
              </button>
            )}
            {e.roll && (
              <span className="muted init-roll" title={e.roll.formula}>
                d20: {e.roll.die}
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
