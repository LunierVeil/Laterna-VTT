import type { Actor, SheetSpell } from '../../entities/model';

export const srdSpellSource = 'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf';
export type CatalogSpell = SheetSpell & { classes: string[]; category: string };
const entries: [string, string, number, string, string, string[], string][] = [
  ['fire-bolt', 'Огненный снаряд', 0, 'Атака', 'Воплощение', ['wizard','sorcerer'], 'Дальнобойная атака огнём.'],
  ['light', 'Свет', 0, 'Разведка и помощь', 'Воплощение', ['wizard','sorcerer','cleric','bard'], 'Заставляет предмет светиться.'],
  ['guidance', 'Указание', 0, 'Разведка и помощь', 'Прорицание', ['druid','cleric'], 'Помогает цели с проверкой характеристики.'],
  ['cure-wounds', 'Лечение ран', 1, 'Лечение', 'Воплощение', ['ranger','druid','cleric','bard','paladin'], 'Восстанавливает хиты существу при касании.'],
  ['goodberry', 'Добрые ягоды', 1, 'Лечение', 'Преобразование', ['ranger','druid'], 'Создаёт ягоды, которые питают и восстанавливают хиты.'],
  ['hunters-mark', 'Метка охотника', 1, 'Атака', 'Прорицание', ['ranger'], 'Отмечает цель для дополнительного урона оружием.'],
  ['shield', 'Щит', 1, 'Защита', 'Ограждение', ['wizard','sorcerer'], 'Реакция создаёт кратковременную магическую защиту.'],
  ['magic-missile', 'Волшебная стрела', 1, 'Атака', 'Воплощение', ['wizard','sorcerer'], 'Создаёт несколько магических снарядов.'],
  ['bless', 'Благословение', 1, 'Разведка и помощь', 'Очарование', ['cleric','paladin'], 'Помогает союзникам с атаками и спасбросками.'],
  ['pass-without-trace', 'Бесследное передвижение', 2, 'Разведка и помощь', 'Ограждение', ['ranger','druid'], 'Помогает группе передвигаться скрытно.'],
  ['lesser-restoration', 'Малое восстановление', 2, 'Лечение', 'Ограждение', ['ranger','druid','cleric','bard','paladin'], 'Устраняет одно из предусмотренных состояний или болезнь.'],
  ['darkvision', 'Тёмное зрение', 2, 'Разведка и помощь', 'Преобразование', ['ranger','druid','wizard','sorcerer'], 'Позволяет цели видеть в темноте.'],
  ['misty-step', 'Туманный шаг', 2, 'Разведка и помощь', 'Вызов', ['wizard','sorcerer','warlock'], 'На короткое расстояние переносит заклинателя в видимое место.'],
  ['fireball', 'Огненный шар', 3, 'Атака', 'Воплощение', ['wizard','sorcerer'], 'Поражает огнём область вокруг выбранной точки.'],
];
const details: Record<string, [string, string, string, string]> = {
  'fire-bolt': ['1 действие','120 фт.','В, С','Мгновенно'],
  light: ['1 действие','Касание','В, М','1 час'],
  guidance: ['1 действие','Касание','В, С','Концентрация, до 1 минуты'],
  'cure-wounds': ['1 действие','Касание','В, С','Мгновенно'],
  goodberry: ['1 действие','Касание','В, С, М','Мгновенно'],
  'hunters-mark': ['1 бонусное действие','90 фт.','В','Концентрация, до 1 часа'],
  shield: ['1 реакция','На себя','В, С','1 раунд'],
  'magic-missile': ['1 действие','120 фт.','В, С','Мгновенно'],
  bless: ['1 действие','30 фт.','В, С, М','Концентрация, до 1 минуты'],
  'pass-without-trace': ['1 действие','На себя','В, С, М','Концентрация, до 1 часа'],
  'lesser-restoration': ['1 действие','Касание','В, С','Мгновенно'],
  darkvision: ['1 действие','Касание','В, С, М','8 часов'],
  'misty-step': ['1 бонусное действие','На себя','В','Мгновенно'],
  fireball: ['1 действие','150 фт.','В, С, М','Мгновенно'],
};
export const catalog: CatalogSpell[] = entries.map(([id,name,level,category,school,classes,description]) => ({ id,name,level,category,school,classes,description,prepared:false, casting: details[id][0], range: details[id][1], components: details[id][2], duration: details[id][3] }));
const aliases: Record<string,string> = { следопыт:'ranger', воин:'fighter', плут:'rogue', волшебник:'wizard', чародей:'sorcerer', жрец:'cleric', друид:'druid', бард:'bard', паладин:'paladin', колдун:'warlock' };

export function availableSpells(actor: Actor, level = actor.progression?.level ?? 0, subclass = actor.progression?.subclass ?? '') {
  if (actor.importedEdition || level < 1) return [];
  const name = actor.progression?.className.trim().toLowerCase() ?? '';
  const klass = aliases[name] ?? name;
  const thirdCaster = (klass === 'fighter' && /мистический рыцарь|eldritch knight/i.test(subclass)) ||
    (klass === 'rogue' && /мистический ловкач|arcane trickster/i.test(subclass));
  let ceiling = 0;
  let cantrips = true;
  if (thirdCaster) { if (level < 3) return []; ceiling = level >= 19 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : 1; }
  else if (['ranger','paladin'].includes(klass)) { if (level < 2) return []; ceiling = Math.min(5, Math.floor((level + 3) / 4)); cantrips = false; }
  else if (['wizard','sorcerer','druid','cleric','bard','warlock'].includes(klass)) ceiling = Math.min(9, Math.ceil(level / 2));
  else return [];
  return catalog.filter(spell => spell.classes.includes(thirdCaster ? 'wizard' : klass) && spell.level <= ceiling && (cantrips || spell.level > 0));
}
export function actorSpells(actor: Actor): SheetSpell[] {
  return actor.spells ?? actor.actions.spells.split('\n').map(name => name.trim()).filter(Boolean)
    .map((name, i) => { const entry = catalog.find(spell => spell.name === name); return entry ? { ...entry, id: `legacy-${i}` } : { id: `legacy-${i}`, name, level: 0, prepared: false, description: '' }; });
}
