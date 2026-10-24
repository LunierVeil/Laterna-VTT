import { lazy, Suspense, useRef, useState } from "react";
import type { Block, Field } from "./schema";
import { RichText, type ResourceInfo } from "./RichText";
import { docText } from "./richDoc";

// Редактор (TipTap) - отдельным куском кода: грузится, только когда правят.
const DocEditor = lazy(() => import("./DocEditor"));

type CardsBlock = Extract<Block, { kind: "cards" }>;
type Card = { id: string; doc?: unknown; [key: string]: unknown };

function get(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

function safeHttps(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Подходит ли карточка под поиск: название, поля, текст описания. */
export function cardMatches(card: Card, block: CardsBlock, q: string): boolean {
  const hay = [card[block.titleKey], ...block.fields.map((f) => card[f.key]), docText(card.doc)]
    .filter((v) => v != null)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Проверка поля карточки перед сохранением. null - всё в порядке. */
function fieldError(f: Field, raw: string): string | null {
  if (!raw.trim()) return null;
  if (f.kind === "number") {
    const n = Number(raw.trim().replace(/^\+/, ""));
    if (!Number.isInteger(n)) return `${f.label}: целое число`;
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
      return `${f.label}: от ${f.min ?? "…"} до ${f.max ?? "…"}`;
    }
  }
  if (f.kind === "link" && !safeHttps(raw)) return `${f.label}: только https://...`;
  return null;
}

function newId(): string {
  return `c-${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * Карточки умений, предметов, заклинаний. Одинаково работают в обоих режимах
 * листа. Список уходит на сервер целиком: порядок и состав - это и есть
 * данные блока.
 */
export function Cards({
  block,
  data,
  set,
  query,
}: {
  block: CardsBlock;
  data: unknown;
  set: (path: string, value: unknown) => void;
  /** Поиск по листу: показать только подходящие, раскрытыми. */
  query?: string;
}) {
  const raw = get(data, block.path);
  // Строки, заполненные раньше через таблицу, - без id. Не теряем их: id по
  // позиции, при первом сохранении он запишется.
  const cards: Card[] = (Array.isArray(raw) ? raw : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c, i) => ({ ...c, id: typeof c.id === "string" ? c.id : `row-${i}` }));
  const res = get(data, block.resourcesPath);
  const resources: ResourceInfo[] = Array.isArray(res) ? res : [];

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Документ из редактора - в ref: перерисовывать карточку на каждую букву незачем.
  const doc = useRef<unknown>(null);

  const write = (next: Card[]) => set(block.path, next);
  const shown = query ? cards.filter((c) => cardMatches(c, block, query)) : cards;

  const startEdit = (card: Card | null) => {
    const id = card?.id ?? newId();
    const strings: Record<string, string> = { [block.titleKey]: String(card?.[block.titleKey] ?? "") };
    for (const f of block.fields) strings[f.key] = card?.[f.key] == null ? "" : String(card[f.key]);
    setDraft(strings);
    doc.current = card?.doc ?? null;
    setError(null);
    setEditingId(id);
  };

  const save = () => {
    const title = draft[block.titleKey]?.trim();
    if (!title) return setError("нужно название");
    for (const f of block.fields) {
      const e = fieldError(f, draft[f.key] ?? "");
      if (e) return setError(e);
    }
    const card: Card = { id: editingId!, [block.titleKey]: title };
    for (const f of block.fields) {
      const v = (draft[f.key] ?? "").trim();
      card[f.key] = v === "" ? null : f.kind === "number" ? Number(v.replace(/^\+/, "")) : v;
    }
    const old = cards.find((c) => c.id === editingId);
    card.doc = doc.current ?? old?.doc ?? null;
    if (old?.source) card.source = old.source;
    write(old ? cards.map((c) => (c.id === editingId ? card : c)) : [...cards, card]);
    setEditingId(null);
  };

  const editor = (
    <div className="card card-editing">
      <input
        autoFocus
        className="card-title-input"
        placeholder="Название"
        value={draft[block.titleKey] ?? ""}
        onChange={(e) => setDraft({ ...draft, [block.titleKey]: e.target.value })}
      />
      {block.fields.length > 0 && (
        <div className="card-fields">
          {block.fields.map((f) => (
            <label key={f.key} className="sheet-field">
              <span className="muted">{f.label}</span>
              <input
                value={draft[f.key] ?? ""}
                inputMode={f.kind === "number" ? "numeric" : undefined}
                style={f.width ? { width: `${f.width + 2}ch` } : undefined}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      <Suspense fallback={<p className="muted">Загрузка редактора...</p>}>
        <DocEditor initial={doc.current} onChange={(d) => (doc.current = d)} />
      </Suspense>
      {error && <p className="sheet-hint">{error}</p>}
      <div className="card-actions">
        <button className="tool" onClick={() => setEditingId(null)}>
          Отмена
        </button>
        <button className="tool tool-active" onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );

  return (
    <section className="sheet-block sheet-block-wide">
      <h3>{block.title}</h3>
      {!query && !shown.length && editingId === null && <p className="muted">Пока пусто.</p>}
      <div className="cards">
        {shown.map((card) => {
          if (card.id === editingId) return <div key={card.id}>{editor}</div>;
          const hasDoc = docText(card.doc).trim().length > 0;
          const isOpen = !!query || open.has(card.id);
          return (
            <div key={card.id} className="card">
              <div className="card-head">
                <button
                  className="card-toggle"
                  disabled={!hasDoc}
                  aria-expanded={isOpen}
                  onClick={() => {
                    const next = new Set(open);
                    if (next.has(card.id)) next.delete(card.id);
                    else next.add(card.id);
                    setOpen(next);
                  }}
                >
                  <span className="card-arrow">{hasDoc ? (isOpen ? "▾" : "▸") : "·"}</span>
                  <span className="card-title">{String(card[block.titleKey] ?? "")}</span>
                </button>
                {block.fields.map((f) => {
                  const v = card[f.key];
                  if (v == null || v === "") return null;
                  if (f.kind === "link") {
                    const url = safeHttps(v);
                    return url ? (
                      <a key={f.key} href={url} target="_blank" rel="noopener noreferrer" className="card-badge">
                        ↗ ссылка
                      </a>
                    ) : null;
                  }
                  return (
                    <span key={f.key} className="card-badge">
                      {f.label}: {String(v)}
                    </span>
                  );
                })}
                <span className="card-tools">
                  <button className="tool" title="править" onClick={() => startEdit(card)}>
                    ✎
                  </button>
                  {confirmDelete === card.id ? (
                    <button
                      className="tool tool-danger"
                      onClick={() => {
                        write(cards.filter((c) => c.id !== card.id));
                        setConfirmDelete(null);
                      }}
                    >
                      Удалить?
                    </button>
                  ) : (
                    <button className="tool" title="удалить" onClick={() => setConfirmDelete(card.id)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
              {isOpen && hasDoc && <RichText doc={card.doc} resources={resources} />}
            </div>
          );
        })}
        {editingId !== null && !cards.some((c) => c.id === editingId) && editor}
      </div>
      {!query && editingId === null && (
        <button className="tool card-add" onClick={() => startEdit(null)}>
          {block.addLabel}
        </button>
      )}
    </section>
  );
}
