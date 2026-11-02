import { lazy, Suspense, useRef, useState } from "react";
import type { Block } from "./schema";
import { RichText, type ResourceInfo } from "./RichText";
import { docHasContent } from "./richDoc";
import { useSheetOps } from "./sheetOps";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/icons";

const DocEditor = lazy(() => import("./DocEditor"));

/**
 * Книга заклинаний по раскладке "круги сеткой" (как привыкли в Roll20),
 * но своей вёрсткой: десять блоков 0-9, в шапке номер круга и ячейки,
 * внизу "+". Всё меняют команды сервера: заклинание - character.list,
 * ячейку тратит character.counter, "всего"/"осталось" правятся полем.
 */

type Spell = {
  id: string;
  name?: string;
  level?: number;
  prepared?: boolean;
  /** Всегда подготовлено (доменные заклинания жреца, клятвы паладина). */
  always_prepared?: boolean;
  ritual?: boolean;
  concentration?: boolean;
  school?: string;
  cast_time?: string;
  range?: string;
  target?: string;
  comp_v?: boolean;
  comp_s?: boolean;
  comp_m?: boolean;
  material?: string;
  duration?: string;
  roll?: string;
  link?: string;
  doc?: unknown;
};

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function get(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/** Текстовые поля формы - порядок и подписи. */
const TEXT_FIELDS: { key: keyof Spell; label: string }[] = [
  { key: "school", label: "Школа" },
  { key: "cast_time", label: "Время накладывания" },
  { key: "range", label: "Дистанция" },
  { key: "target", label: "Цель" },
  { key: "duration", label: "Длительность" },
  { key: "roll", label: "Бросок (например 2к10+3)" },
];
const FLAGS: { key: keyof Spell; label: string }[] = [
  { key: "prepared", label: "Подготовлено" },
  { key: "always_prepared", label: "Всегда подготовлено" },
  { key: "ritual", label: "Ритуал" },
  { key: "concentration", label: "Концентрация" },
  { key: "comp_v", label: "В" },
  { key: "comp_s", label: "С" },
  { key: "comp_m", label: "М" },
];

/** Форма заклинания: добавление (короткая, "подробнее" свёрнуто) и правка. */
function SpellForm({
  initial,
  level,
  onSave,
  onCancel,
}: {
  initial?: Spell;
  level: number;
  onSave: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [more, setMore] = useState(!!initial);
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries([...TEXT_FIELDS.map((f) => f.key), "material"].map((k) => [k, String(initial?.[k as keyof Spell] ?? "")])),
  );
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FLAGS.map((f) => [f.key, initial?.[f.key] === true])),
  );
  const doc = useRef<unknown>(initial?.doc ?? null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) return setError("нужно название");
    const fields: Record<string, unknown> = { name: name.trim(), level };
    if (more) {
      for (const [k, v] of Object.entries(text)) fields[k] = v.trim() || null;
      for (const [k, v] of Object.entries(flags)) fields[k] = v;
      if (doc.current) fields.doc = doc.current;
    } else {
      fields.prepared = flags.prepared;
    }
    onSave(fields);
  };

  return (
    <div className="spell-form">
      <input
        autoFocus
        placeholder="Название"
        aria-label="Название заклинания"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !more && save()}
      />
      {!more && (
        <button type="button" className="gate-link" onClick={() => setMore(true)}>
          подробнее
        </button>
      )}
      {more && (
        <>
          <div className="spell-flags">
            {FLAGS.map((f) => (
              <label key={f.key} className="spell-flag">
                <input
                  type="checkbox"
                  checked={flags[f.key]}
                  onChange={(e) => setFlags({ ...flags, [f.key]: e.target.checked })}
                />
                {f.label}
              </label>
            ))}
          </div>
          <div className="spell-fields">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="sheet-field">
                <span className="muted">{f.label}</span>
                <input value={text[f.key]} onChange={(e) => setText({ ...text, [f.key]: e.target.value })} />
              </label>
            ))}
            {flags.comp_m && (
              <label className="sheet-field spell-field-wide">
                <span className="muted">Материал</span>
                <input value={text.material} onChange={(e) => setText({ ...text, material: e.target.value })} />
              </label>
            )}
          </div>
          <Suspense fallback={<p className="muted">Загрузка редактора...</p>}>
            <DocEditor initial={doc.current} onChange={(d) => (doc.current = d)} />
          </Suspense>
        </>
      )}
      {error && <p className="sheet-hint">{error}</p>}
      <div className="card-actions">
        <button className="tool" onClick={onCancel}>
          Отмена
        </button>
        <button className="tool tool-active" onClick={save}>
          {initial ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </div>
  );
}

function SpellRow({
  spell,
  path,
  slotsPath,
  resources,
}: {
  spell: Spell;
  path: string;
  slotsPath: string;
  resources: ResourceInfo[];
}) {
  const ops = useSheetOps();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const level = spell.level ?? 0;
  const update = (changes: object) => ops.list(path, "update", { item_id: spell.id, changes });

  if (editing) {
    return (
      <li className="spell-row spell-row-editing">
        <SpellForm
          initial={spell}
          level={level}
          onCancel={() => setEditing(false)}
          onSave={(fields) => {
            update(fields);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  const details: [string, string | undefined][] = [
    ["Школа", spell.school],
    ["Время", spell.cast_time],
    ["Дистанция", spell.range],
    ["Цель", spell.target],
    ["Длительность", spell.duration],
    ["Компоненты", [spell.comp_v && "В", spell.comp_s && "С", spell.comp_m && "М"].filter(Boolean).join(", ") || undefined],
    ["Материал", spell.comp_m ? spell.material : undefined],
    ["Бросок", spell.roll],
  ];

  return (
    <li className="spell-row">
      <div className="spell-line">
        {level > 0 && spell.always_prepared ? (
          // Всегда подготовлено - снять нельзя, снимается флагом в правке.
          <span className="spell-prep spell-prep-on spell-prep-always" role="img" aria-label="всегда подготовлено" title="всегда подготовлено" />
        ) : level > 0 ? (
          <button
            className={spell.prepared ? "spell-prep spell-prep-on" : "spell-prep"}
            aria-pressed={!!spell.prepared}
            aria-label={spell.prepared ? "подготовлено" : "не подготовлено"}
            title={spell.prepared ? "подготовлено - снять" : "подготовить"}
            onClick={() => update({ prepared: !spell.prepared })}
          />
        ) : (
          <span className="spell-prep-gap" />
        )}
        <span className="spell-name" title={spell.name}>
          {spell.name}
        </span>
        <span className="spell-badges">
          {spell.ritual && <abbr title="ритуал">Р</abbr>}
          {spell.concentration && <abbr title="концентрация">К</abbr>}
          {spell.comp_v && <abbr title="вербальный">В</abbr>}
          {spell.comp_s && <abbr title="соматический">С</abbr>}
          {spell.comp_m && <abbr title="материальный">М</abbr>}
        </span>
        <button
          className={open ? "spell-info spell-info-on" : "spell-info"}
          aria-expanded={open}
          aria-label="подробнее"
          title="подробнее"
          onClick={() => setOpen((o) => !o)}
        >
          i
        </button>
      </div>
      {open && (
        <div className="spell-card">
          <dl className="spell-details">
            {details
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {docHasContent(spell.doc) && <RichText doc={spell.doc} resources={resources} />}
          <div className="spell-actions">
            {level > 0 && (
              <button
                className="tool"
                title="списать одну ячейку этого круга"
                onClick={() => ops.counter(`${slotsPath}.${level}.left`, -1, `${slotsPath}.${level}.total`)}
              >
                Потратить ячейку
              </button>
            )}
            {spell.roll && ops.roll && (
              <button className="tool" onClick={() => ops.roll!(spell.roll!, spell.name ?? "заклинание")}>
                Бросок {spell.roll}
              </button>
            )}
            <span className="spell-actions-gap" />
            <button className="tool" onClick={() => setEditing(true)}>
              Правка
            </button>
            <button className="tool tool-danger" onClick={() => setConfirm(true)}>
              Удалить
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Удалить «${spell.name ?? "заклинание"}»?`}
          text={<p>Это нельзя отменить.</p>}
          confirmLabel="Удалить"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            ops.list(path, "remove", { item_id: spell.id });
            setConfirm(false);
          }}
        />
      )}
    </li>
  );
}

/** Поле ячеек в шапке круга: замок по умолчанию закрыт - случайно не сбить. */
function SlotInput({
  label,
  value,
  locked,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  locked: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  return (
    <label className="slot-field">
      <span className="slot-label">{label}</span>
      <input
        className="slot-input"
        aria-label={label}
        inputMode="numeric"
        disabled={locked}
        value={shown}
        placeholder="0"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const n = Number(draft.trim());
          if (draft.trim() === "") onCommit(null);
          else if (Number.isInteger(n) && n >= 0 && n <= 99) onCommit(n);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function Circle({
  level,
  spells,
  data,
  block,
  set,
  resources,
}: {
  level: number;
  spells: Spell[];
  data: unknown;
  block: Extract<Block, { kind: "spellbook" }>;
  set: (path: string, value: unknown) => void;
  resources: ResourceInfo[];
}) {
  const ops = useSheetOps();
  const [locked, setLocked] = useState(true);
  const [adding, setAdding] = useState(false);
  const total = num(get(data, `${block.slots}.${level}.total`));
  // "Осталось" пусто - все ячейки на месте (так же считает сервер при трате).
  const left = num(get(data, `${block.slots}.${level}.left`)) ?? total;

  return (
    <section className="spell-circle" aria-label={level === 0 ? "Заговоры" : `${level} круг`}>
      <header className="circle-head">
        <span className="circle-num">{level}</span>
        {level === 0 ? (
          <span className="circle-title">Заговоры</span>
        ) : (
          <>
            <SlotInput
              label="Всего ячеек"
              value={total}
              locked={locked}
              onCommit={(v) => set(`${block.slots}.${level}.total`, v)}
            />
            <SlotInput
              label="Осталось"
              value={left}
              locked={locked}
              onCommit={(v) => set(`${block.slots}.${level}.left`, v)}
            />
            <button
              className={locked ? "icon-btn circle-lock" : "icon-btn circle-lock circle-lock-open"}
              aria-pressed={!locked}
              aria-label={locked ? "разрешить правку ячеек" : "запретить правку ячеек"}
              title={locked ? "ячейки закрыты от правки - открыть" : "закрыть ячейки от правки"}
              onClick={() => setLocked((v) => !v)}
            >
              <Icon name={locked ? "lock" : "unlock"} size={16} />
            </button>
          </>
        )}
      </header>
      <ul className="spell-list">
        {spells.map((s) => (
          <SpellRow key={s.id} spell={s} path={block.path} slotsPath={block.slots} resources={resources} />
        ))}
      </ul>
      {adding ? (
        <SpellForm
          level={level}
          onCancel={() => setAdding(false)}
          onSave={(fields) => {
            ops.list(block.path, "add", { item: fields });
            setAdding(false);
          }}
        />
      ) : (
        <button
          className="circle-add"
          aria-label={level === 0 ? "добавить заговор" : `добавить заклинание ${level} круга`}
          title={level === 0 ? "добавить заговор" : `добавить заклинание ${level} круга`}
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}
    </section>
  );
}

export function SpellBook({
  block,
  data,
  set,
}: {
  block: Extract<Block, { kind: "spellbook" }>;
  data: unknown;
  set: (path: string, value: unknown) => void;
}) {
  const [onlyPrepared, setOnlyPrepared] = useState(false);
  const raw = get(data, block.path);
  const all = (Array.isArray(raw) ? raw : []).filter(
    (s): s is Spell => !!s && typeof s === "object" && typeof (s as Spell).id === "string",
  );
  const res = get(data, block.resourcesPath);
  const resources: ResourceInfo[] = Array.isArray(res) ? res : [];
  // Заговоры готовить не нужно, "всегда подготовлено" - уже - фильтр их не прячет.
  const visible = onlyPrepared ? all.filter((s) => (s.level ?? 0) === 0 || s.prepared || s.always_prepared) : all;

  return (
    <section className="sheet-block sheet-block-wide spellbook">
      <div className="spellbook-head">
        <h3>{block.title}</h3>
        <label className="side-check">
          <input type="checkbox" checked={onlyPrepared} onChange={(e) => setOnlyPrepared(e.target.checked)} />
          Только подготовленные
        </label>
      </div>
      <div className="spell-grid">
        {LEVELS.map((level) => (
          <Circle
            key={level}
            level={level}
            spells={visible.filter((s) => Math.max(0, Math.min(9, Math.trunc(s.level ?? 0))) === level)}
            data={data}
            block={block}
            set={set}
            resources={resources}
          />
        ))}
      </div>
    </section>
  );
}
