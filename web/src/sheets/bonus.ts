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
import type { CheckBonus } from "./schema";

function at(data: unknown, path: string): unknown {
  let node = data as any;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
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
  const owned = at(data, `${rowPath}.${bonus.flag}`) === true;
  return mod + (owned && typeof prof === "number" ? prof : 0);
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
