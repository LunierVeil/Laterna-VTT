import { useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { Character } from "../types";
import { Icon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Сколько токенов на сценах привязано к листу - для текста подтверждения.
 * Сцены ГМ читает тем же /api/scenes/{id}, что и при открытии сцены:
 * сервер не меняется. Не получилось - числа не будет, удаление не держим.
 */
async function linkedTokens(characterId: string): Promise<number | null> {
  try {
    const scenes = useUi.getState().scenes;
    const counts = await Promise.all(
      scenes.map(async (s) => {
        const res = await fetch(`/api/scenes/${s.id}`);
        if (!res.ok) return 0;
        const scene = (await res.json()) as { tokens?: { character_id?: string | null }[] };
        return (scene.tokens ?? []).filter((t) => t.character_id === characterId).length;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

const tokensWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "токен" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "токена" : "токенов";

/**
 * Строка листа в списке: персонаж, моб, NPC. Одна на все списки: открыть
 * (иконка) и удалить (корзина, только тем, кому сервер разрешит - ГМ и
 * владельцу). Удаляет сервер командой character.delete, как и кнопка в листе.
 */
export function SheetRow({
  character,
  socket,
  children,
  extra,
  avatar,
}: {
  character: Character;
  socket: SceneSocket;
  /** Портрет или буква слева (у мобов). */
  avatar?: React.ReactNode;
  /** Подпись и подробности под именем или рядом. */
  children?: React.ReactNode;
  /** Дополнительные действия (у моба - «На карту», «Копия»). */
  extra?: React.ReactNode;
}) {
  const me = useUi((s) => s.me);
  const isGm = useUi((s) => s.isGm);
  const [confirm, setConfirm] = useState<{ tokens: number | null } | null>(null);
  const canDelete = isGm || (!!me && character.owner_id === me.id);
  const open = () => useUi.getState().openCharacter(character.id);

  const askDelete = async () => {
    setConfirm({ tokens: null });
    // Токены интересны только ГМ: сцены видит он, а игрок своих токенов
    // на чужих сценах всё равно не посчитает.
    if (isGm) {
      const tokens = await linkedTokens(character.id);
      setConfirm((c) => (c ? { tokens } : c));
    }
  };

  return (
    <li className="sheet-row" draggable onDragStart={(e) => {
      e.dataTransfer.setData("application/x-laterna-character", character.id);
      e.dataTransfer.effectAllowed = "copy";
    }}>
      {avatar}
      <div className="sheet-row-main">
        <span className="sheet-row-name" title={character.name}>
          {character.name}
        </span>
        {children}
      </div>
      {extra}
      <span className="sheet-row-actions">
        <button className="icon-btn icon-btn-box" title="Открыть" aria-label="Открыть" onClick={open}>
          <Icon name="sheet" size={18} />
        </button>
        {canDelete && (
          <button
            className="icon-btn icon-btn-box icon-btn-danger"
            title="Удалить"
            aria-label="Удалить"
            onClick={() => void askDelete()}
          >
            <Icon name="trash" size={18} />
          </button>
        )}
      </span>
      {confirm && (
        <ConfirmDialog
          title={`Удалить «${character.name}»?`}
          text={
            <>
              <p>Это нельзя отменить.</p>
              {confirm.tokens ? (
                <p>
                  {confirm.tokens} {tokensWord(confirm.tokens)} на сценах останутся без листа
                  {character.system === "mob" ? " и потеряют свои хиты" : ""}.
                </p>
              ) : null}
            </>
          }
          confirmLabel="Удалить"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            socket.send("character.delete", { id: character.id });
            setConfirm(null);
          }}
        />
      )}
    </li>
  );
}
