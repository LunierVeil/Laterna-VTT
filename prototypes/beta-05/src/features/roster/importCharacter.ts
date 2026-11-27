import { blankActions, uid, type Actor } from '../../entities/model';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unwrap = (value: unknown) => record(value).value ?? value;
const string = (value: unknown) => typeof unwrap(value) === 'string' ? (unwrap(value) as string).trim() : '';
function integer(value: unknown, fallback: number, min: number, max: number) {
  const raw = unwrap(value);
  const number = typeof raw === 'number' || typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}
const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const skillNames: Record<string, string> = {
  acrobatics: 'Акробатика', investigation: 'Анализ', athletics: 'Атлетика', perception: 'Внимательность',
  survival: 'Выживание', performance: 'Выступление', intimidation: 'Запугивание', history: 'История',
  'sleight of hand': 'Ловкость рук', arcana: 'Магия', medicine: 'Медицина', deception: 'Обман',
  nature: 'Природа', insight: 'Проницательность', religion: 'Религия', stealth: 'Скрытность',
  persuasion: 'Убеждение', 'animal handling': 'Уход за животными',
};

export function importLss(text: string): Actor {
  const envelope = record(JSON.parse(text) as unknown);
  const data = record(typeof envelope.data === 'string' ? JSON.parse(envelope.data) as unknown : envelope.data ?? envelope);
  const name = string(data.name);
  const info = record(data.info);
  const vitality = record(data.vitality);
  const stats = record(data.stats);
  if (!name || !abilities.every(key => typeof record(stats[key]).score === 'number' || typeof record(stats[key]).score === 'string') || !('hp-max' in vitality)) {
    throw new Error('В JSON отсутствуют имя, характеристики или максимум HP листа Long Story Short.');
  }
  const edition = String(envelope.sheetEdition ?? envelope.edition ?? '');
  const importedEdition = edition.includes('2024') ? '2024' : undefined;
  const maxHp = integer(vitality['hp-max'], 1, 1, 999);
  const scores = abilities.map(key => integer(record(stats[key]).score, 10, 1, 30));
  const level = integer(info.level, 1, 1, 20);
  const notes = record(data.text);
  const className = string(info.charClass);
  const spellBook = record(envelope.spells);
  const known = Array.isArray(spellBook.book) ? spellBook.book.map(entry => string(record(entry).name) || string(entry)).filter(Boolean) : [];
  return {
    id: uid(), kind: 'hero', importedEdition, name, title: string(info.race), symbol: 'user', color: '#c8b28e',
    hp: integer(vitality['hp-current'], maxHp, 0, maxHp), maxHp,
    tempHp: integer(vitality['hp-temp'], 0, 0, 999), ac: integer(vitality.ac, 10, 0, 40),
    init: integer(vitality.initiative, Math.floor((scores[1] - 10) / 2), -10, 50),
    actions: { ...blankActions, spells: [...new Set(known)].join('\n') },
    items: string(notes.equipment), notes: string(notes.background), resource: 0,
    progression: className ? { className, level, subclass: string(info.charSubclass) || undefined, features: [] } : undefined,
    sheetProfile: { scores, speed: integer(vitality.speed, 30, 0, 250), proficiency: integer(data.proficiency, 2 + Math.floor((level - 1) / 4), 0, 10),
      saves: abilities.flatMap((key, i) => record(record(data.saves)[key]).isProf === true ? [i] : []),
      skills: Object.entries(skillNames).flatMap(([key, label]) => record(record(data.skills)[key]).isProf === true ? [label] : []) },
  };
}
