import { useEffect, useRef, useState } from "react";
import type { SceneSocket } from "../net/socket";
import { useUi } from "../state/store";
import type { Character } from "../types";
import type { Block, Counter, Field, RollSpec, SheetSchema, Total } from "./schema";
import { SHEETS } from "./dnd5e";
import { Cards, cardMatches } from "./Cards";
import { safeUpload, uploadImage } from "../net/upload";
import { blockTotal, checkBonus, computedBonus, computedRowBonus, hpChanges, profLevel } from "./bonus";

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
function FieldInput({ field, value, onCommit }: { field: Field; value: unknown; onCommit: (v: unknown) => void }) {
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
  if (field.kind === "prof") {
    return (
      <select
        aria-label={field.label}
        className="prof-select"
        value={String(profLevel(value))}
        onChange={(e) => onCommit(Number(e.target.value))}
      >
        <option value="0">нет</option>
        <option value="1">владение</option>
        <option value="2">мастерство</option>
      </select>
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

/** Блок в режиме редактирования: всё - поля ввода. */
function EditBlock({ block, data, set }: { block: Block; data: unknown; set: (path: string, value: unknown) => void }) {
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
          {block.total && <TotalLine total={block.total} data={data} />}
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
                      field={{ key: "save", label: `${a.label}: спасбросок`, kind: "prof" }}
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
                {block.bonus && <ComputedHint block={block} item={item} data={data} />}
              </div>
            ))}
          </div>
        </section>
      );

    case "cards":
      return <Cards block={block} data={data} set={set} />;

    case "deathSaves":
      return <DeathSaves block={block} data={data} set={set} />;

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
                      <button
                        className="tool"
                        title="удалить строку"
                        onClick={() => write(rows.filter((_, j) => j !== i))}
                      >
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

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

export type Edge = "normal" | "advantage" | "disadvantage";
export type RollFn = (formula: string, label: string) => void;

/**
 * Формула броска по строке. Бросает сервер - здесь только запись: какие
 * кубы и какое число к ним прибавить. null - бросать нечего.
 */
export function rollFormula(
  spec: RollSpec,
  row: Record<string, unknown>,
  edge: Edge = "normal",
  data?: unknown,
): string | null {
  const v = row[spec.key];
  if (!spec.d20) return typeof v === "string" && v.trim() ? v.trim() : null;
  // Бонус - число в начале ячейки: "+10", "5", "-1 (магия)". Пустая ячейка -
  // посчитанный бонус строки, если схема умеет; иначе просто d20.
  const m =
    typeof v === "number"
      ? String(v)
      : String(v ?? "")
          .trim()
          .match(/^[+-]?\d+/)?.[0];
  const empty = v == null || String(v).trim() === "";
  const bonus = m ? Number(m) : empty && data !== undefined ? (computedRowBonus(spec, row, data) ?? 0) : 0;
  const dice = spec.d20[edge];
  return bonus ? `${dice}${bonus > 0 ? "+" : ""}${bonus}` : dice;
}

/** Строка - счётчик, если у неё есть максимум. */
function isCounter(counter: Counter, row: Record<string, unknown>): boolean {
  return typeof row[counter.max] === "number";
}

function rowIndex(raw: unknown, row: unknown): number {
  return Array.isArray(raw) ? raw.indexOf(row) : -1;
}

/**
 * Ячейка таблицы в игре. Пустая ячейка броска с computed (атака оружия из
 * LSS без mod) - подсказка "посчитано +5", как у навыков; ручное главнее.
 */
function cellView(c: Field, row: Record<string, unknown>, rolls: RollSpec[] | undefined, data: unknown): React.ReactNode {
  const spec = rolls?.find((r) => r.key === c.key && r.computed);
  if (spec && isEmpty(row[c.key])) {
    const value = computedRowBonus(spec, row, data);
    if (value !== undefined) return <span className="muted" title="модификатор + мастерство при владении">посчитано {signed(value)}</span>;
  }
  return show(c, row[c.key]);
}

const EDGE_LABEL: Record<Edge, string> = { normal: "", advantage: " (преим.)", disadvantage: " (помеха)" };
const edgeOf = (e: React.MouseEvent): Edge => (e.shiftKey ? "advantage" : e.altKey ? "disadvantage" : "normal");

/** Значение для чтения: число со знаком там, где это бонус, подпись select. */
function show(field: Field, value: unknown): React.ReactNode {
  if (isEmpty(value)) return "—";
  if (field.kind === "checkbox") return value === true ? "●" : "○";
  if (field.kind === "select") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  if (field.kind === "prof") return ["нет", "владение", "мастерство"][profLevel(value)];
  if (field.kind === "link") return <SafeLink href={value}>открыть ↗</SafeLink>;
  return String(value);
}

/**
 * Спасброски от смерти: отметки ставит игрок (клик по кружку - столько
 * отметок; по последнему - на одну меньше), d20 бросает сервер.
 */
function DeathSaves({
  block,
  data,
  set,
  roll,
}: {
  block: Extract<Block, { kind: "deathSaves" }>;
  data: unknown;
  set: (path: string, value: unknown) => void;
  roll?: RollFn;
}) {
  const count = (path: string) => Math.max(0, Math.min(block.max, num(get(data, path)) ?? 0));
  const ok = count(block.successes);
  const bad = count(block.fails);
  const row = (label: string, path: string, n: number, cls: string) => (
    <div className="death-row">
      <span className="death-label">{label}</span>
      {Array.from({ length: block.max }, (_, i) => (
        <button
          key={i}
          className={i < n ? `death-mark ${cls}` : "death-mark"}
          aria-label={`${label}: ${i + 1}`}
          aria-pressed={i < n}
          onClick={() => set(path, n === i + 1 ? i : i + 1)}
        />
      ))}
    </div>
  );
  const status = bad >= block.max ? "мёртв" : ok >= block.max ? "стабилизирован" : block.dying && get(data, block.dying) === true ? "при смерти" : "";
  return (
    <section className="sheet-block death-block">
      <h3>{block.title}</h3>
      <div className="death-body">
        <div>
          {row("Успехи", block.successes, ok, "death-ok")}
          {row("Провалы", block.fails, bad, "death-bad")}
        </div>
        <div className="death-side">
          {status && <span className={bad >= block.max ? "death-status death-status-bad" : "death-status"}>{status}</span>}
          {roll && (
            <button className="btn" onClick={() => roll(block.roll.formula, block.roll.label)}>
              Бросить d20
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Итог блока (всего в зм) - подсказка, не хранится. */
function TotalLine({ total, data }: { total: Total; data: unknown }) {
  return (
    <p className="muted sheet-total">
      {total.label}: <b>{blockTotal(total, data).toLocaleString("ru-RU")}</b> {total.unit}
    </p>
  );
}

/** В режиме правки: сколько посчитано без ручного поля - видно, что оно перекрывает. */
function ComputedHint({
  block,
  item,
  data,
}: {
  block: Extract<Block, { kind: "checklist" }>;
  item: { key: string; ability?: string };
  data: unknown;
}) {
  if (!block.bonus) return null;
  const value = computedBonus(block.bonus, `${block.path}.${item.key}`, item.ability, data);
  return value === undefined ? null : <span className="muted">посчитано {signed(value)}</span>;
}

const signed = (v: unknown) => (typeof v === "number" ? (v >= 0 ? `+${v}` : `${v}`) : "");

/**
 * Блок в режиме "игра": чистые значения без рамок полей. Пустое не
 * показываем - иначе лист превращается в стену прочерков.
 * Возвращает null, если показать нечего.
 */
function ViewBlock({
  block,
  data,
  inSummary,
  set,
  roll,
  startEdit,
  say,
  who,
}: {
  block: Block;
  data: unknown;
  inSummary: Set<string>;
  set: (path: string, value: unknown) => void;
  roll: RollFn;
  /** Перейти в "Редактировать" - из пустой таблицы. */
  startEdit: () => void;
  /** Сообщение в чат от имени игрока: "короткий отдых - восстановлено ...". */
  say: (text: string) => void;
  /** Имя персонажа - для сообщений об отдыхе. */
  who: string;
}) {
  // Таблица уходит на сервер целиком, как и в "Редактировать".
  const bump = (path: string, rows: Record<string, unknown>[], i: number, c: Counter, delta: number) => {
    if (i < 0) return;
    const row = rows[i];
    const max = typeof row[c.max] === "number" ? (row[c.max] as number) : Infinity;
    const cur = typeof row[c.current] === "number" ? (row[c.current] as number) : 0;
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next !== cur)
      set(
        path,
        rows.map((r, j) => (j === i ? { ...r, [c.current]: next } : r)),
      );
  };
  const rest = (path: string, raw: unknown, c: Counter, r: Counter["rests"][number]) => {
    const rows = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
    const restored: string[] = [];
    const next = rows.map((row) => {
      const hit = r.restores.includes(String(row[c.rest] ?? ""));
      if (hit && typeof row[c.max] === "number" && row[c.current] !== row[c.max]) {
        restored.push(String(row[c.titleKey] ?? "?"));
        return { ...row, [c.current]: row[c.max] };
      }
      return row;
    });
    if (restored.length) set(path, next);
    // В чат - чтобы мастер видел, что персонаж отдохнул и что вернулось.
    say(
      `${who}: ${r.label.toLowerCase()}${restored.length ? ` - восстановлено: ${restored.join(", ")}` : " - восстанавливать нечего"}`,
    );
  };

  switch (block.kind) {
    case "fields": {
      // То, что уже в шапке, второй раз не показываем.
      const filled = block.fields.filter((f) => !inSummary.has(f.key) && !isEmpty(get(data, f.key)));
      if (!filled.length) return null;
      return (
        <section className="sheet-block">
          <h3>{block.title}</h3>
          {block.total && <TotalLine total={block.total} data={data} />}
          <dl className="view-fields">
            {filled.map((f) =>
              f.kind === "longtext" ? (
                <div key={f.key} className="view-long">
                  {String(get(data, f.key))}
                </div>
              ) : (
                <div key={f.key} className="view-field">
                  <dt className="muted">{f.label}</dt>
                  <dd>{show(f, get(data, f.key))}</dd>
                </div>
              ),
            )}
          </dl>
        </section>
      );
    }

    case "abilities":
      return (
        <section className="sheet-block">
          <h3>{block.title}</h3>
          <div className="view-abilities">
            {block.items.map((a) => {
              const score = get(data, `${block.path}.${a.key}.score`);
              const save = profLevel(get(data, `${block.path}.${a.key}.save`));
              return (
                <div key={a.key} className="view-ability" title={save ? "владение спасброском" : undefined}>
                  <span className="muted">{a.label}</span>
                  <span className="view-mod">{modText(score) || "—"}</span>
                  <span className="view-score">
                    {typeof score === "number" ? score : ""}
                    {save > 0 && <span className="view-dot"> {save === 2 ? "●● спас." : "● спас."}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      );

    case "checklist": {
      const [flag, num] = [
        block.fields.find((f) => f.kind === "checkbox" || f.kind === "prof"),
        block.fields.find((f) => f.kind === "number"),
      ];
      return (
        <section className="sheet-block sheet-block-wide">
          <h3>{block.title}</h3>
          <div className="view-checklist">
            {block.items.map((item) => {
              const rowPath = `${block.path}.${item.key}`;
              const level = flag ? profLevel(get(data, `${rowPath}.${flag.key}`)) : 0;
              const on = level > 0;
              // Схема умеет считать - модификатор + мастерство, ручное главнее;
              // не умеет - только ручное поле, как раньше.
              const manualValue = num ? get(data, `${rowPath}.${num.key}`) : undefined;
              const b = block.bonus
                ? checkBonus(block.bonus, rowPath, item.ability, data)
                : { value: typeof manualValue === "number" ? manualValue : undefined, manual: true };
              const rollSpec = block.roll;
              const title = (
                <>
                  <span>{item.label}</span>
                  {item.hint && <span className="muted">{item.hint}</span>}
                </>
              );
              return (
                <div key={item.key} className={on ? "view-check view-check-on" : "view-check"}>
                  <span
                    className={level === 2 ? "dot dot-on dot-expert" : on ? "dot dot-on" : "dot"}
                    aria-label={level === 2 ? "мастерство" : on ? "владение" : undefined}
                    title={level === 2 ? "мастерство" : on ? "владение" : undefined}
                  />
                  {rollSpec && b.value !== undefined ? (
                    <button
                      className="roll-name view-check-name"
                      title="бросить; Shift - с преимуществом, Alt - с помехой"
                      onClick={(e) => {
                        const edge = edgeOf(e);
                        roll(`${rollSpec.d20[edge]}${signed(b.value)}`, `${item.label} - ${rollSpec.label}${EDGE_LABEL[edge]}`);
                      }}
                    >
                      {title}
                    </button>
                  ) : (
                    title
                  )}
                  <span
                    className="view-bonus"
                    title={block.bonus ? (b.manual ? "свой бонус" : "модификатор + мастерство при владении") : undefined}
                  >
                    {signed(b.value)}
                    {block.bonus && b.manual && <span className="view-manual">*</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {block.bonus && (
            <p className="muted view-note">
              Клик по названию - бросок. ● владение, ◉ мастерство (бонус ×2). * - свой бонус вместо посчитанного.
            </p>
          )}
        </section>
      );
    }

    case "table": {
      const raw = get(data, block.path);
      const rows = (Array.isArray(raw) ? raw : []).filter((r) => r && Object.values(r).some((v) => !isEmpty(v)));
      if (!rows.length) {
        // Пустую таблицу не прячем: иначе игрок не узнает, что оружие и
        // ресурсы вообще есть и куда их вписать.
        return (
          <section className="sheet-block sheet-block-wide">
            <h3>{block.title}</h3>
            <p className="muted">Пока пусто.</p>
            <button
              className="tool"
              onClick={() => {
                // Сразу пустая строка - не заставлять жать "Добавить" второй раз.
                set(block.path, [{}]);
                startEdit();
              }}
            >
              {block.addLabel}
            </button>
          </section>
        );
      }
      return (
        <section className="sheet-block sheet-block-wide">
          <h3>{block.title}</h3>
          <div className="sheet-table-wrap">
            <table className="sheet-table view-table">
              <thead>
                <tr>
                  {block.columns
                    .filter((c) => !(block.counter && c.key === block.counter.max))
                    .map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  {block.rolls && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const spec = block.rolls;
                  const name = spec ? String(row[spec.titleKey] ?? "") || block.title : "";
                  const fire = (items: RollSpec[], edge: Edge) => {
                    for (const it of items) {
                      const f = rollFormula(it, row, edge, data);
                      if (f) roll(f, `${name} - ${it.label}${it.d20 ? EDGE_LABEL[edge] : ""}`);
                    }
                  };
                  const counter = block.counter;
                  if (counter && isCounter(counter, row)) {
                    // Строка-счётчик: вместо "Есть" и "Макс." - −/+ и "3 / 4".
                    return (
                      <tr key={i}>
                        {block.columns.map((c) =>
                          c.key === counter.max ? null : c.key === counter.current ? (
                            <td key={c.key} className="counter-cell">
                              <button
                                className="tool"
                                title="потратить"
                                aria-label={`${String(row[counter.titleKey] ?? "")}: потратить`}
                                onClick={() =>
                                  bump(block.path, raw as Record<string, unknown>[], rowIndex(raw, row), counter, -1)
                                }
                              >
                                −
                              </button>
                              <span className="counter-value">
                                {String(row[counter.current] ?? 0)}
                                <span className="muted"> / {String(row[counter.max] ?? "—")}</span>
                              </span>
                              <button
                                className="tool"
                                title="вернуть"
                                aria-label={`${String(row[counter.titleKey] ?? "")}: вернуть`}
                                onClick={() =>
                                  bump(block.path, raw as Record<string, unknown>[], rowIndex(raw, row), counter, 1)
                                }
                              >
                                +
                              </button>
                            </td>
                          ) : c.key === counter.rest && !isEmpty(row[c.key]) ? (
                            // Какой отдых восстанавливает - плашкой, как в макете.
                            <td key={c.key}>
                              <span className={`rest-chip rest-${String(row[c.key])}`}>{show(c, row[c.key])}</span>
                            </td>
                          ) : (
                            <td key={c.key}>{show(c, row[c.key])}</td>
                          ),
                        )}
                      </tr>
                    );
                  }
                  return (
                    <tr key={i}>
                      {block.columns
                        .filter((c) => !(counter && c.key === counter.max))
                        .map((c) =>
                          spec && c.key === spec.titleKey ? (
                            <td key={c.key}>
                              <button
                                className="roll-name"
                                title="бросить всё сразу; Shift - с преимуществом, Alt - с помехой"
                                onClick={(e) => fire(spec.items, edgeOf(e))}
                              >
                                🎲 {show(c, row[c.key])}
                              </button>
                            </td>
                          ) : (
                            <td key={c.key}>{cellView(c, row, spec?.items, data)}</td>
                          ),
                        )}
                      {spec && (
                        <td className="roll-buttons">
                          {spec.items.map((it) =>
                            rollFormula(it, row, "normal", data) ? (
                              <button
                                key={it.key}
                                className="tool"
                                title={it.d20 ? "Shift - с преимуществом, Alt - с помехой" : rollFormula(it, row, "normal", data)!}
                                onClick={(e) => fire([it], edgeOf(e))}
                              >
                                {it.label}
                              </button>
                            ) : null,
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {block.counter && (
            <div className="rest-buttons">
              {block.counter.rests.map((r) => (
                <button key={r.label} className="tool" onClick={() => rest(block.path, raw, block.counter!, r)}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </section>
      );
    }

    case "cards":
      // Карточки одинаковы в обоих режимах: добавить предмет посреди сессии
      // можно без "Редактировать". И они никогда не "пусто" - есть кнопка "+".
      return <Cards block={block} data={data} set={set} />;

    case "deathSaves":
      // Всегда на виду, как карточки: отмечают посреди боя, без "Редактировать".
      return <DeathSaves block={block} data={data} set={set} roll={roll} />;
  }
}

/**
 * Поиск по всему листу сразу: карточки (название, поля, описание), строки
 * таблиц, навыки, поля. Результаты - по вкладкам, чтобы было видно, где это.
 */
function SearchResults({
  schema,
  data,
  q,
  set,
}: {
  schema: SheetSchema;
  data: unknown;
  q: string;
  set: (path: string, value: unknown) => void;
}) {
  const has = (v: unknown) => v != null && String(v).toLowerCase().includes(q);
  const groups = schema.tabs
    .map((tab) => {
      const found: React.ReactNode[] = [];
      for (const b of tab.blocks) {
        if (b.kind === "cards") {
          const raw = get(data, b.path);
          const cards = (Array.isArray(raw) ? raw : []) as { id: string; [k: string]: unknown }[];
          if (cards.some((c) => c && cardMatches(c, b, q))) {
            found.push(<Cards key={b.title} block={b} data={data} set={set} query={q} />);
          }
        } else if (b.kind === "table") {
          const raw = get(data, b.path);
          const rows = (Array.isArray(raw) ? raw : []).filter((r) => r && b.columns.some((c) => has(r[c.key])));
          for (const [i, r] of rows.entries()) {
            found.push(
              <div key={`${b.title}-${i}`} className="search-hit">
                <span className="muted">{b.title}:</span>{" "}
                {b.columns
                  .map((c) => show(c, r[c.key]))
                  .filter((x) => x !== "—")
                  .map((x, j) => (
                    <span key={j}>{x} </span>
                  ))}
              </div>,
            );
          }
        } else if (b.kind === "checklist") {
          for (const item of b.items.filter((it) => has(it.label))) {
            // Поиск показывает то же, что и вкладка: уровень и итоговый бонус.
            const flag = b.fields.find((f) => f.kind === "prof" || f.kind === "checkbox");
            const level = flag ? profLevel(get(data, `${b.path}.${item.key}.${flag.key}`)) : 0;
            const manual = b.fields.find((f) => f.kind === "number");
            const bonus = b.bonus
              ? checkBonus(b.bonus, `${b.path}.${item.key}`, item.ability, data).value
              : manual
                ? get(data, `${b.path}.${item.key}.${manual.key}`)
                : undefined;
            found.push(
              <div key={`${b.path}.${item.key}`} className="search-hit">
                <span className="muted">{b.title}:</span> {level === 2 ? "◉ " : level ? "● " : "○ "}
                {item.label} {signed(bonus)}
              </div>,
            );
          }
        } else if (b.kind === "fields") {
          for (const f of b.fields.filter((f) => has(f.label) || has(get(data, f.key)))) {
            found.push(
              <div key={f.key} className="search-hit">
                <span className="muted">{f.label}:</span> {show(f, get(data, f.key))}
              </div>,
            );
          }
        }
      }
      return { tab, found };
    })
    .filter((g) => g.found.length);

  if (!groups.length) return <p className="muted sheet-empty">Ничего не нашлось.</p>;
  return (
    <div className="search-results">
      {groups.map(({ tab, found }) => (
        <section key={tab.id}>
          <h4 className="search-tab">{tab.title}</h4>
          {found}
        </section>
      ))}
    </div>
  );
}

/**
 * Урон и лечение: −, поле «±N», +. Лечение не выше максимума. Общее для
 * листа и карточки токена (у моба хиты пишутся в токен - onSet другой).
 */
export function HpControls({ current, max, onSet }: { current?: number; max?: number; onSet: (v: number) => void }) {
  const [amount, setAmount] = useState("");
  const change = (delta: number) => {
    const base = current ?? max ?? 0;
    let next = base + delta;
    if (max !== undefined) next = Math.min(next, max);
    onSet(Math.max(-999, next));
  };
  return (
    <div className="hp-controls">
      <button className="tool" title="−1 хит" aria-label="−1 хит" onClick={() => change(-1)}>
        −
      </button>
      <input
        className="hp-amount"
        placeholder="±N"
        aria-label="изменить хиты на"
        title="−7 - урон, 5 - лечение; Enter"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const n = Number(amount.trim());
          if (Number.isInteger(n) && n !== 0) change(n);
          setAmount("");
        }}
      />
      <button className="tool" title="+1 хит" aria-label="+1 хит" onClick={() => change(1)}>
        +
      </button>
    </div>
  );
}

const num = (v: unknown) => (typeof v === "number" ? v : undefined);



/** Плитка хитов в шапке листа: число, полоска, урон и лечение. */
function HpTile({
  schema,
  data,
  setMany,
}: {
  schema: SheetSchema;
  data: unknown;
  setMany: (changes: Record<string, unknown>) => void;
}) {
  const hp = schema.summary.hp;
  if (!hp) return null;
  const cur = num(get(data, hp.current));
  const max = num(get(data, hp.max));
  const temp = hp.temp ? num(get(data, hp.temp)) : undefined;
  const ratio = cur !== undefined && max ? Math.max(0, Math.min(1, cur / max)) : 0;
  return (
    <div className="tile tile-hp">
      <span className="tile-label">Хиты</span>
      <span className="tile-value">
        {cur ?? "—"}
        <span className="tile-max"> / {max ?? "—"}</span>
        {temp !== undefined && temp > 0 && <span className="hp-temp"> +{temp}</span>}
      </span>
      <div className="hp-bar">
        <div
          className={ratio > 0.5 ? "hp-fill" : ratio > 0.25 ? "hp-fill hp-fill-mid" : "hp-fill hp-fill-low"}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <HpControls current={cur} max={max} onSet={(v) => setMany(hpChanges(schema, data, v))} />
    </div>
  );
}

/** Портрет: в режиме правки - загрузить или убрать. */
function Portrait({
  url,
  name,
  editing,
  onChange,
}: {
  url: string | null;
  name: string;
  editing: boolean;
  onChange: (url: string | null) => void;
}) {
  const isGm = useUi((s) => s.isGm);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File) => {
    setBusy(true);
    try {
      // Лимиты - как у картинки токена (server/app/config.py).
      const { url } = await uploadImage(f, { maxBytes: (isGm ? 25 : 5) * 1024 * 1024, maxSide: 2048, what: "портрет" });
      onChange(url);
    } catch (e) {
      useUi.getState().flashError(e instanceof Error ? e.message : "загрузка не удалась");
    } finally {
      setBusy(false);
    }
  };
  const face = url ? <img src={url} alt="" /> : <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
  if (!editing) return <div className="portrait">{face}</div>;
  return (
    <div className="portrait-edit">
      <button className="portrait" title="загрузить портрет" disabled={busy} onClick={() => file.current?.click()}>
        {face}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {url && (
        <button className="tool" onClick={() => onChange(null)}>
          Убрать
        </button>
      )}
    </div>
  );
}

const TAB_KEY = "lanterna.sheetTab";

/** Лист персонажа поверх сцены. Сам ничего не хранит: правки - командами. */
export function CharacterSheet({ character, socket }: { character: Character; socket: SceneSocket }) {
  const accounts = useUi((s) => s.accounts);
  const isGm = useUi((s) => s.isGm);
  const schema = SHEETS[character.system];
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(() => localStorage.getItem(TAB_KEY) || "main");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => useUi.getState().openCharacter(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // В полях и в редакторе описаний Esc - их дело, а не закрыть лист.
      if (e.key === "Escape" && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (path: string, value: unknown) =>
    socket.send("character.update", { id: character.id, set: { [path]: value } });
  const setMany = (changes: Record<string, unknown>) =>
    socket.send("character.update", { id: character.id, set: changes });
  // Бросок из листа: формула и подпись - на сервер, число выпадает там.
  // У ГМ галочка "скрыто" в панели кубов действует и на броски из листа:
  // атака монстра не должна светить игрокам бонус и урон.
  const roll: RollFn = (formula, label) =>
    socket.send("dice.roll", { formula, label, hidden: useUi.getState().isGm && useUi.getState().hiddenRolls });

  const owner = accounts.find((a) => a.id === character.owner_id)?.name;
  const current = schema?.tabs.find((t) => t.id === tab) ?? schema?.tabs[0];
  const subtitle = schema?.summary.subtitle
    .map((p) => get(character.data, p))
    .filter((v) => !isEmpty(v))
    .join(" ");

  // Функцией, а не <ViewBlock/>: нужно знать, вернул ли блок null (пусто),
  // чтобы показать подсказку. Хуков в ViewBlock нет, так можно.
  const inSummary = new Set(
    schema
      ? ([...schema.summary.stats.map((f) => f.key), schema.summary.hp?.current, schema.summary.hp?.max].filter(
          Boolean,
        ) as string[])
      : [],
  );
  const views = current?.blocks.map((b) => ({
    b,
    view: editing
      ? null
      : ViewBlock({
          block: b,
          data: character.data,
          inSummary,
          set,
          roll,
          startEdit: () => setEditing(true),
          say: (text) => socket.send("chat.say", { text }),
          who: character.name,
        }),
  }));
  const nothingToShow = !editing && views?.every((v) => v.view === null);

  return (
    <div className="sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-label={`Лист: ${character.name}`}>
        <header className="sheet-head">
          {schema?.portrait && (
            <Portrait
              url={safeUpload(get(character.data, schema.portrait))}
              name={character.name}
              editing={editing}
              onChange={(url) => set(schema.portrait!, url)}
            />
          )}
          <div className="sheet-title">
            {editing ? (
              <FieldInput
                field={{ key: "name", label: "Имя персонажа", kind: "text" }}
                value={character.name}
                onCommit={(v) => socket.send("character.update", { id: character.id, name: v ?? "" })}
              />
            ) : (
              <h2>{character.name}</h2>
            )}
            <span className="sheet-sub">{subtitle || schema?.title || character.system}</span>
            {/* Моб всегда мастерский - подпись "игрок" ему ни к чему. */}
            {isGm && owner && character.system !== "mob" && <span className="muted sheet-owner">Игрок: {owner}</span>}
          </div>
          <span className="sheet-head-actions">
            <button className={editing ? "tool tool-active" : "tool"} onClick={() => setEditing((e) => !e)}>
              {editing ? "Готово" : "Редактировать"}
            </button>
            <button className="tool" onClick={close}>
              Закрыть
            </button>
          </span>
        </header>

        {schema && (
          <div className="sheet-tiles">
            <HpTile schema={schema} data={character.data} setMany={setMany} />
            {schema.summary.stats.map((f) => (
              <div key={f.key} className="tile">
                <span className="tile-label">{f.label}</span>
                <span className={f.key === "vitals.initiative" ? "tile-value tile-accent" : "tile-value"}>
                  {f.key === "vitals.initiative"
                    ? signed(get(character.data, f.key)) || "—"
                    : show(f, get(character.data, f.key))}
                </span>
              </div>
            ))}
          </div>
        )}

        {schema ? (
          <>
            <input
              className="sheet-search"
              type="search"
              placeholder="Поиск по листу: умение, предмет, навык..."
              aria-label="Поиск по листу"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim() ? (
              <SearchResults schema={schema} data={character.data} q={query.trim().toLowerCase()} set={set} />
            ) : (
              <>
                <nav className="sheet-tabs" role="tablist">
                  {schema.tabs.map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={t.id === current?.id}
                      className={t.id === current?.id ? "sheet-tab sheet-tab-on" : "sheet-tab"}
                      onClick={() => {
                        setTab(t.id);
                        try {
                          localStorage.setItem(TAB_KEY, t.id);
                        } catch {
                          /* не запомнили вкладку - не страшно */
                        }
                      }}
                    >
                      {t.title}
                    </button>
                  ))}
                </nav>
                <div className="sheet-body">
                  {editing
                    ? current?.blocks.map((b) => <EditBlock key={b.title} block={b} data={character.data} set={set} />)
                    : views?.map(
                        ({ b, view }) =>
                          view && (
                            <div key={b.title} className="sheet-cell">
                              {view}
                            </div>
                          ),
                      )}
                  {nothingToShow && <p className="muted sheet-empty">Здесь пока пусто. «Редактировать» - заполнить.</p>}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="muted">Неизвестная система листа: {character.system}</p>
        )}

        {editing && (
          <footer className="sheet-foot">
            {character.source_format &&
              (confirmReimport ? (
                <button
                  className="tool tool-danger"
                  title="значения из файла (хиты, характеристики, оружие и ресурсы из файла) заменятся; своё - тексты «О персонаже», заметки, портрет, свои бонусы и карточки - останется"
                  onClick={() => {
                    socket.send("character.reimport", { id: character.id });
                    setConfirmReimport(false);
                  }}
                >
                  Значения из файла заменятся - точно?
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
              <button
                className="tool tool-danger"
                onClick={() => socket.send("character.delete", { id: character.id })}
              >
                Удалить лист?
              </button>
            ) : (
              <button className="tool" title="удалить персонажа" onClick={() => setConfirmDelete(true)}>
                Удалить персонажа
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
