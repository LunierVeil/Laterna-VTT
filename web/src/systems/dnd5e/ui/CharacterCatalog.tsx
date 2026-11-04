import { useRef, useState } from "react";
import { safeUpload } from "../../../shared/api/upload";
import { at } from "../model/tokenStats";
import type { Character } from "../../../shared/api/protocol";
import type { CatalogRootProps, PlayerCatalogProps, MobCatalogProps } from "../../../entities/character/ui/catalog-slot";

/** Листы персонажей: свои; у ГМ - все, с подписью, чей. */
export function PlayerSheets({ list, accounts, isGm, renderRow, onCreate, onImport: importFile, onPlace }: PlayerCatalogProps) {
  const file = useRef<HTMLInputElement>(null);

  return (
    <>
      {list.length === 0 && <p className="muted side-note">Пока ни одного листа.</p>}
      <ul className="sheet-list">
        {list.map((c) => (
          renderRow({ character: c, extra: <button className="tool" onClick={() => onPlace(c)}>На карту</button>, children: (
            isGm && (
              <span className="muted sheet-row-sub">
                {accounts.find((a) => a.id === c.owner_id)?.name ?? "без владельца"}
              </span>
            )
          ) })
        ))}
      </ul>
      <button className="tool" onClick={onCreate}>
        Новый персонаж
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importFile(f);
        }}
      />
      <button className="tool" onClick={() => file.current?.click()}>
        Импорт из Long Story Short
      </button>
      <p className="muted side-note">JSON из кнопки «скачать» на mycharacterbuilder.com или из самого LSS.</p>
    </>
  );
}

/**
 * Мобы и NPC - только у ГМ. Лист - шаблон: «На карту» ставит экземпляр
 * со своими хитами и номером (Гоблин 1, Гоблин 2). Нужен другой вариант
 * («гоблин с луком») - «Копия», и правишь её.
 */
export function MobSheets({ list, placeHidden, renderRow, onCreate, onCopy, onPlace: place, onPlaceHidden }: MobCatalogProps) {
  const num = (c: Character, path: string) => {
    const v = at(c.data, path);
    return typeof v === "number" ? v : "—";
  };

  return (
    <>
      {list.length === 0 && <p className="muted side-note">Мобов пока нет. Заведи шаблон - и ставь на карту сколько нужно.</p>}
      <ul className="sheet-list">
        {list.map((c) => {
          const portrait = safeUpload(at(c.data, "portrait"));
          return (
            renderRow({
              character: c,
              deletionImpact: " и потеряют свои хиты",
              avatar: (
                <span className="mob-avatar">
                  {portrait ? <img src={portrait} alt="" /> : c.name.trim().charAt(0).toUpperCase() || "?"}
                </span>
              ),
              extra: (
                <span className="mob-actions">
                  <button className="tool" title="поставить в центр экрана" onClick={() => place(c)}>
                    На карту
                  </button>
                  <button
                    className="tool"
                    title="копия листа - другой вариант моба"
                    onClick={() => onCopy(c)}
                  >
                    Копия
                  </button>
                </span>
              ),
              children: <span className="muted sheet-row-sub">
                хиты {num(c, "hp.max")} · КД {num(c, "ac")}
                {typeof at(c.data, "cr") === "string" && at(c.data, "cr") !== "" && ` · опасность ${at(c.data, "cr")}`}
              </span>
            })
          );
        })}
      </ul>
      <button className="tool" onClick={onCreate}>
        Новый моб
      </button>
      <label className="side-check" title="новые токены сразу скрыты от игроков - засада">
        <input type="checkbox" checked={placeHidden} onChange={(e) => onPlaceHidden(e.target.checked)} />
        Ставить скрытыми
      </label>
      <p className="muted side-note">
        У каждого моба на карте свои хиты. Игроки видят токен, но не его хиты и не лист.
      </p>
    </>
  );
}

export function CharacterCatalog({ characters, isGm, renderPlayers, renderMobs }: CatalogRootProps) {
  const [kind, setKind] = useState<"pc" | "mob">("pc");
  const all = Object.values(characters);
  const mobs = all.filter((c) => c.system === "mob");
  const pcs = all.filter((c) => c.system !== "mob");

  return (
    <div className="side-panel">
      {isGm && (
        <div className="seg-group" role="tablist">
          <button role="tab" aria-selected={kind === "pc"} className={kind === "pc" ? "seg seg-on" : "seg"} onClick={() => setKind("pc")}>
            Персонажи игроков
          </button>
          <button role="tab" aria-selected={kind === "mob"} className={kind === "mob" ? "seg seg-on" : "seg"} onClick={() => setKind("mob")}>
            Мобы и NPC
          </button>
        </div>
      )}
      {isGm && kind === "mob" ? (
        renderMobs(mobs)
      ) : (
        renderPlayers(pcs)
      )}
    </div>
  );
}
