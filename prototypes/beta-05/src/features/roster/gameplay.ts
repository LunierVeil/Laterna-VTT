import type { Actor } from '../../entities/model';
import { skills } from './skills';

export function changeHp(actor: Actor, delta: number): Actor {
  const absorbed = delta < 0 ? Math.min(actor.tempHp ?? 0, -delta) : 0;
  const hp = Math.min(actor.maxHp, Math.max(0, actor.hp + delta + absorbed));
  return { ...actor, hp, tempHp: (actor.tempHp ?? 0) - absorbed,
    deathSaves: hp > 0 || actor.hp > 0 ? undefined : actor.deathSaves };
}

export function spendSpellSlot(actor: Actor, level: number): Actor | undefined {
  const slot = actor.spellSlots?.[level];
  if (!slot || slot.current <= 0) return;
  return { ...actor, spellSlots: { ...actor.spellSlots, [level]: { ...slot, current: slot.current - 1 } } };
}

export function attackRows(actor: Actor) {
  const equipment = actor.equipment ?? [];
  const linked = new Set(equipment.map(item => item.attack));
  return [
    ...actor.actions.attack.split('\n').filter(name => name.trim() && !linked.has(name)).map(name =>
      ({ id: name, name, damage: /кинжал/i.test(name) ? '1d4' : '1d8' })),
    ...equipment.flatMap(item => item.equipped && item.quantity && item.attack
      ? [{ id: item.id, name: item.attack, damage: item.damage || (/кинжал/i.test(item.attack) ? '1d4' : '1d8') }] : []),
  ];
}

export function damageRoll(formula: string) {
  const match = /^1?d(4|6|8|10|12|20)([+-][0-9]+)?$/.exec(formula);
  return match && { sides: Number(match[1]), bonus: Number(match[2] ?? 0) };
}

export function skillRows(actor: Actor) {
  const profile = actor.sheetProfile;
  if (!profile) return [];
  const names = new Map<string, number>(skills);
  Object.entries(actor.skillOverrides ?? {}).forEach(([name, override]) => names.set(name, override.ability));
  return Array.from(names, ([name, ability]) => {
    const setting = actor.skillOverrides?.[name] ?? { ability, training: +profile.skills.includes(name), modifier: undefined };
    const bonus = setting.modifier ?? (Math.floor((profile.scores[setting.ability] - 10) / 2) + setting.training * profile.proficiency);
    return { name, bonus, ability: setting.ability };
  });
}
