/**
 * Бонус строки списка (навык, спасбросок): модификатор характеристики +
 * мастерство, если стоит владение. Ручное поле главнее: заполнено - берём
 * его (экспертиза, предмет, хоумбрю - лист не знает правил, игрок знает).
 *
 * Это подсказка формы, а не правило ядра: считает клиент по схеме, сервер
 * хранит только флаги и числа. Кубы по-прежнему бросает сервер.
 *
 * Без зависимостей от React - чтобы гонять тестом прямо в node.
 */
import type { CheckBonus, RollSpec, SheetSchema, Total } from "./schema";

function at(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/** Уровень владения 0/1/2 из того, что лежит в листе: true/false старых листов, числа, "1" из select. */
export function profLevel(value: unknown): 0 | 1 | 2 {
  if (value === true) return 1;
  const n = typeof value === "string" ? Number(value) : value;
  return n === 2 ? 2 : n === 1 ? 1 : 0;
}

export const abilityMod = (score: unknown): number | undefined =>
  typeof score === "number" ? Math.floor((score - 10) / 2) : undefined;

export interface Bonus {
  /** undefined - посчитать не из чего (нет значения характеристики). */
  value: number | undefined;
  /** Взято из ручного поля, а не посчитано. */
  manual: boolean;
}

/** Посчитанное - без учёта ручного поля. */
export function computedBonus(
  bonus: CheckBonus,
  rowPath: string,
  ability: string | undefined,
  data: unknown,
): number | undefined {
  const mod = ability ? abilityMod(at(data, `${bonus.abilities}.${ability}.${bonus.score}`)) : undefined;
  if (mod === undefined) return undefined;
  const prof = at(data, bonus.proficiency);
  // Мастерство - удвоенный бонус: уровень 2 умножает мастерство на 2.
  const level = profLevel(at(data, `${rowPath}.${bonus.flag}`));
  return mod + (typeof prof === "number" ? prof * level : 0);
}

/** Что показывать и бросать: ручное поле, если заполнено, иначе посчитанное. */
export function checkBonus(
  bonus: CheckBonus,
  rowPath: string,
  ability: string | undefined,
  data: unknown,
): Bonus {
  const manual = at(data, `${rowPath}.${bonus.manual}`);
  if (typeof manual === "number") return { value: manual, manual: true };
  return { value: computedBonus(bonus, rowPath, ability, data), manual: false };
}

/** Бонус атаки строки оружия, если ячейка пустая: модификатор + мастерство при владении. */
export function computedRowBonus(spec: RollSpec, row: Record<string, unknown>, data: unknown): number | undefined {
  const c = spec.computed;
  const ability = c ? row[c.ability] : undefined;
  if (!c || typeof ability !== "string") return undefined;
  const mod = abilityMod(at(data, `${c.abilities}.${ability}.${c.score}`));
  if (mod === undefined) return undefined;
  const prof = at(data, c.proficiency);
  return mod + (typeof prof === "number" ? prof * profLevel(row[c.flag]) : 0);
}

/** Итог блока полей (всего в зм): сумма значений с весами, до сотых. */
export function blockTotal(total: Total, data: unknown): number {
  const sum = total.terms.reduce((acc, t) => {
    const v = at(data, t.key);
    return acc + (typeof v === "number" ? v * t.factor : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Новые хиты одной правкой: вылечили с 0 и ниже - заодно сбросить то, что
 * схема велит (resetOnHeal: отметки спасбросков от смерти). Одной командой,
 * чтобы хиты и отметки не разъехались.
 */
export function hpChanges(schema: SheetSchema, data: unknown, next: number): Record<string, unknown> {
  const hp = schema.summary.hp;
  if (!hp) return {};
  const changes: Record<string, unknown> = { [hp.current]: next };
  const raw = at(data, hp.current);
  const cur = typeof raw === "number" ? raw : undefined;
  if (next > 0 && cur !== undefined && cur <= 0) {
    for (const path of hp.resetOnHeal ?? []) changes[path] = typeof at(data, path) === "boolean" ? false : 0;
  }
  return changes;
}

/** Вес снаряжения: сумма вес × количество (нет количества - 1 штука). */
export function totalWeight(cards: unknown, weightKey: string, qtyKey: string): number {
  if (!Array.isArray(cards)) return 0;
  const sum = cards.reduce((acc: number, c) => {
    const w = (c as Record<string, unknown>)?.[weightKey];
    const q = (c as Record<string, unknown>)?.[qtyKey];
    return acc + (typeof w === "number" ? w * (typeof q === "number" ? q : 1) : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}
