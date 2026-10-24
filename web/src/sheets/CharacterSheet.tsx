import { useEffect, useRef, useState } from "react";
import type { SceneSocket } from "../net/socket";
import { useUi } from "../state/store";
import type { Character } from "../types";
import type { Block, Field } from "./schema";
import { SHEETS } from "./dnd5e";
import { RichText, type ResourceInfo } from "./RichText";

/** Значение по пути "a.b.c". */
function get(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Ссылка - только https. Проверяется там, где рисуется, а не где вводится:
 * лист приходит и из формы, и из импортированного файла игрока, и
 * `javascript:` в href выполнился бы у всех, кто откроет лист.
 */
export function safeHttps(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function SafeLink({ href, children }: { href: unknown; children: React.ReactNode }) {
  const url = safeHttps(href);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {children}
    </a>
  );
}

const modText = (score: unknown) => {
  if (typeof score !== "number") return "";
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

/**
 * Одно поле. Пока по нему печатают, держит свой черновик; когда фокуса
 * нет - показывает то, что прислал сервер (правку ГМ или вторую вкладку).
 * Сохраняет по уходу с поля и по Enter, флажки и списки - сразу.
 */
function FieldInput({
  field,
  value,
  onCommit,
}: {
  field: Field;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [bad, setBad] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  if (field.kind === "checkbox") {
    return (
      <input
        type="checkbox"
        aria-label={field.label}
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  }
  if (field.kind === "select") {
    return (
      <select aria-label={field.label} value={shown} onChange={(e) => onCommit(e.target.value || null)}>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    focused.current = false;
    if (draft === shown) return setBad(null);
    if (field.kind === "number") {
      if (draft.trim() === "") {
        setBad(null);
        return onCommit(null);
      }
      // Не сохраняем, а подсвечиваем: черновик остаётся, чтобы поправить.
      const n = Number(draft.trim().replace(",", ".").replace(/^\+/, ""));
      if (!Number.isInteger(n)) return setBad("целое число");
      const { min, max } = field;
      if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
        return setBad(`от ${min ?? "…"} до ${max ?? "…"}`);
      }
      setBad(null);
      return onCommit(n);
    }
    if (field.kind === "link" && draft.trim() && !safeHttps(draft)) {
      // Не сохраняем: ссылка только https. Черновик оставляем, чтобы поправить.
      setBad("только https://...");
      return;
    }
    setBad(null);
    onCommit(draft.trim() === "" ? null : draft);
  };

  const common = {
    "aria-label": field.label,
    value: draft,
    onFocus: () => (focused.current = true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
  };

  if (field.kind === "longtext") return <textarea className="sheet-longtext" rows={5} {...common} />;
  return (
    <span className="sheet-input-wrap">
      <input
        {...common}
        className={bad ? "sheet-bad" : undefined}
        title={bad ?? undefined}
        inputMode={field.kind === "number" ? "decimal" : undefined}
        style={field.width ? { width: `${field.width + 2}ch` } : undefined}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {field.kind === "link" && <SafeLink href={value}>↗</SafeLink>}
      {bad && <span className="sheet-hint">{bad}</span>}
    </span>
  );
}

function BlockView({
  block,
  data,
  set,
}: {
  block: Block;
  data: unknown;
  set: (path: string, value: unknown) => void;
}) {
  switch (block.kind) {
    case "fields":
      return (
        <section className="sheet-block">
          <h3>{block.title}</h3>
          <div className="sheet-fields">
            {block.fields.map((f) => (
              <label key={f.key} className={f.kind === "longtext" ? "sheet-field sheet-field-wide" : "sheet-field"}>
                <span className="muted">{f.label}</span>
                <FieldInput field={f} value={get(data, f.key)} onCommit={(v) => set(f.key, v)} />
              </label>
            ))}
          </div>
        </section>
      );

    case "abilities":
      return (
        <section className="sheet-block">
          <h3>{block.title}</h3>
          <div className="sheet-abilities">
            {block.items.map((a) => {
              const base = `${block.path}.${a.key}`;
              const score = get(data, `${base}.score`);
              return (
                <div key={a.key} className="sheet-ability">
                  <span className="muted">{a.label}</span>
                  <FieldInput
                    field={{ key: "score", label: a.label, kind: "number", width: 3, min: block.min, max: block.max }}
                    value={score}
                    onCommit={(v) => set(`${base}.score`, v)}
                  />
                  <span className="sheet-mod">{modText(score)}</span>
                  <label className="sheet-save">
                    <FieldInput
                      field={{ key: "save", label: `${a.label}: спасбросок`, kind: "checkbox" }}
                      value={get(data, `${base}.save`)}
                      onCommit={(v) => set(`${base}.save`, v)}
                    />
                    <span className="muted">спас.</span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      );

    case "checklist":
      return (
        <section className="sheet-block">
          <h3>{block.title}</h3>
          <div className="sheet-checklist">
            {block.items.map((item) => (
              <div key={item.key} className="sheet-check-row">
                {block.fields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={{ ...f, label: `${item.label}: ${f.label}` }}
                    value={get(data, `${block.path}.${item.key}.${f.key}`)}
                    onCommit={(v) => set(`${block.path}.${item.key}.${f.key}`, v)}
                  />
                ))}
                <span>{item.label}</span>
                {item.hint && <span className="muted">({item.hint})</span>}
              </div>
            ))}
          </div>
        </section>
      );

    case "texts": {
      const texts = get(data, block.path);
      if (!texts || typeof texts !== "object") return null;
      const entries = Object.entries(texts as Record<string, { label?: unknown; doc?: unknown }>);
      if (!entries.length) return null;
      const res = get(data, block.resourcesPath);
      const resources: ResourceInfo[] = Array.isArray(res) ? res : [];
      return (
        <section className="sheet-block sheet-block-wide">
          <h3>{block.title}</h3>
          {entries.map(([key, entry]) => (
            // Свёрнуты: текстов бывает на несколько экранов.
            <details key={key} className="sheet-text">
              <summary>{typeof entry?.label === "string" ? entry.label : key}</summary>
              <RichText doc={entry?.doc} resources={resources} />
            </details>
          ))}
        </section>
      );
    }

    case "table": {
      const raw = get(data, block.path);
      const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
      // Таблица уходит на сервер целиком: строки - это порядок и состав.
      const write = (next: Record<string, unknown>[]) => set(block.path, next);
      return (
        <section className="sheet-block sheet-block-wide">
          <h3>{block.title}</h3>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  {block.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {block.columns.map((c) => (
                      <td key={c.key}>
                        <FieldInput
                          field={c}
                          value={row?.[c.key]}
                          onCommit={(v) => write(rows.map((r, j) => (j === i ? { ...r, [c.key]: v } : r)))}
                        />
                      </td>
                    ))}
                    <td>
                      <button className="tool" title="удалить строку" onClick={() => write(rows.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="tool" onClick={() => write([...rows, {}])}>
            {block.addLabel}
          </button>
        </section>
      );
    }
  }
}

/** Лист персонажа поверх сцены. Сам ничего не хранит: правки - командами. */
export function CharacterSheet({ character, socket }: { character: Character; socket: SceneSocket }) {
  const accounts = useUi((s) => s.accounts);
  const isGm = useUi((s) => s.isGm);
  const schema = SHEETS[character.system];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const close = () => useUi.getState().openCharacter(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (path: string, value: unknown) =>
    socket.send("character.update", { id: character.id, set: { [path]: value } });

  const owner = accounts.find((a) => a.id === character.owner_id)?.name;

  return (
    <div className="sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-label={`Лист: ${character.name}`}>
        <header className="sheet-head">
          <FieldInput
            field={{ key: "name", label: "Имя персонажа", kind: "text" }}
            value={character.name}
            onCommit={(v) => socket.send("character.update", { id: character.id, name: v ?? "" })}
          />
          <span className="muted">
            {schema?.title ?? character.system}
            {isGm && owner ? ` · игрок ${owner}` : ""}
          </span>
          <span className="sheet-head-actions">
            {character.source_format &&
              (confirmReimport ? (
                <button
                  className="tool tool-danger"
                  title="лист заполнится заново из сохранённого файла - ручные правки пропадут"
                  onClick={() => {
                    socket.send("character.reimport", { id: character.id });
                    setConfirmReimport(false);
                  }}
                >
                  Правки пропадут - точно?
                </button>
              ) : (
                <button
                  className="tool"
                  title="заново прочитать сохранённый файл импорта"
                  onClick={() => setConfirmReimport(true)}
                >
                  Переимпортировать
                </button>
              ))}
            {confirmDelete ? (
              <button className="tool tool-danger" onClick={() => socket.send("character.delete", { id: character.id })}>
                Удалить лист?
              </button>
            ) : (
              <button className="tool" title="удалить персонажа" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            )}
            <button className="tool" onClick={close}>
              Закрыть
            </button>
          </span>
        </header>
        {schema ? (
          <div className="sheet-body">
            {schema.blocks.map((b) => (
              <BlockView key={b.title} block={b} data={character.data} set={set} />
            ))}
          </div>
        ) : (
          <p className="muted">Неизвестная система листа: {character.system}</p>
        )}
      </div>
    </div>
  );
}
