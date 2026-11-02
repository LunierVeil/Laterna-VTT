import type { Roll } from "../types.ts";

export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const MAX_MENU_DICE = 100; // server/app/dice.py MAX_DICE, one dice term
export function diceFormula(sides: number, count: number, mod: number): string {
  return `${count}d${sides}${mod < 0 ? mod : `+${mod}`}`;
}

/** Render server values only; cap visual work, never recompute the result. */
export function displayDice(roll: Roll, limit = 12) {
  const dice: {value: number; sides: number; dropped: boolean; negative: boolean}[] = [];
  let count = 0;
  for (const term of roll.terms) {
    if (term.kind !== "dice") continue;
    const sides = Number(/d(\d+)/i.exec(term.text)?.[1]);
    const kept = [...term.kept];
    for (const value of term.rolls) {
      count++;
      const i = kept.indexOf(value);
      if (i >= 0) kept.splice(i, 1);
      if (dice.length < limit) dice.push({value, sides, dropped: i < 0, negative: term.sign < 0});
    }
  }
  return {dice, remaining: count - dice.length};
}
