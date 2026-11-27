import srd51 from './srd51.json';
import { blankActions, emptyScene, type Actor, type Campaign, type Entry, type MapObject } from '../../entities/model';

export const makeActor = (id: string, name: string, title: string, kind: Actor['kind'], hp: number, ac: number, init: number, symbol: string, color: string): Actor => ({
  id, name, title, kind, hp, maxHp: hp, ac, init, symbol, color, actions: { ...blankActions },
  items: '', notes: '', resource: 2,
});

const elara = {
  ...makeActor('elara', 'Элара Вейл', 'Полуэльф', 'hero', 31, 15, 4, 'bow', '#81b9a3'),
  hp: 27,
  conditions: ['Сбит с ног'],
  progression: { className: 'Следопыт', level: 4, features: ['Избранный враг', 'Метка охотника'] },
  sheetProfile: { scores: [12, 18, 14, 10, 14, 10], speed: 30, proficiency: 2, saves: [0, 1], skills: ['Атлетика', 'Внимательность', 'Выживание', 'Скрытность'] },
  actions: { ...blankActions, attack: 'Длинный лук · +5 к атаке\nКинжал · +5 к атаке', bonus: 'Метка охотника', reaction: 'Провоцированная атака', spells: 'Лечение ран\nДобрые ягоды' },
  items: 'Длинный лук\nСтрелы × 18\nПлащ странника\nЛечебное зелье × 2',
  notes: 'Проводница из Грейвика. Узнаёт печать ордена Семи Фонарей.',
};
const brann: Actor = {
  ...makeActor('brann', 'Бранн Кремень', 'Дварф', 'hero', 38, 17, 1, 'shield', '#e1a575'),
  progression: { className: 'Воин', level: 4, features: ['Второе дыхание', 'Всплеск действий'], resources: [{ name: 'Второе дыхание', current: 1, max: 1, rest: 'short' }, { name: 'Всплеск действий', current: 1, max: 1, rest: 'short' }], subclass: 'Чемпион' },
  sheetProfile: { scores: [17, 12, 16, 10, 12, 9], speed: 25, proficiency: 2, saves: [0, 2], skills: ['Атлетика', 'Выживание'] },
  actions: { ...blankActions, attack: 'Длинный меч · +5 к атаке' }, items: 'Длинный меч\nЩит',
};
const mira: Actor = {
  ...makeActor('mira', 'Мира Сумрак', 'Человек', 'hero', 24, 13, 2, 'wand', '#c6a6e8'),
  progression: { className: 'Волшебник', level: 4, features: ['Магическое восстановление'] },
  sheetProfile: { scores: [8, 14, 12, 18, 12, 10], speed: 30, proficiency: 2, saves: [3, 4], skills: ['Магия', 'История'] },
  conditions: ['Концентрация'],
  actions: { ...blankActions, attack: 'Огненный снаряд · +6 к атаке', spells: 'Огненный снаряд\nЩит\nТуманный шаг' },
  spellSlots: { 1: { current: 4, max: 4 }, 2: { current: 3, max: 3 } },
  spells: [
    { id: 'fire-bolt', name: 'Огненный снаряд', level: 0, school: 'Воплощение', casting: '1 действие', range: '120 фт.', components: 'В, С', duration: 'Мгновенно', prepared: false, description: '' },
    { id: 'shield', name: 'Щит', level: 1, school: 'Ограждение', casting: '1 реакция', range: 'На себя', components: 'В, С', duration: '1 раунд', prepared: true, description: '' },
    { id: 'misty-step', name: 'Туманный шаг', level: 2, school: 'Вызов', casting: '1 бонусное действие', range: 'На себя', components: 'В', duration: 'Мгновенно', prepared: true, description: '' },
  ],
  notes: 'Изучает странные сигилы аббатства.',
};
const warden = { ...makeActor('warden', 'Пепельный страж', 'Нежить · Дозорный', 'monster', 27, 14, 2, 'skull', '#dd897f'), actions: { ...blankActions, attack: 'Ржавый клинок', reaction: 'Парирование' } };
const tokens: MapObject[] = [
  { id: 't-elara', kind: 'token', name: elara.name, actorId: elara.id, x: 465, y: 570, symbol: elara.symbol, color: elara.color },
  { id: 't-brann', kind: 'token', name: brann.name, actorId: brann.id, x: 525, y: 610, symbol: brann.symbol, color: brann.color },
  { id: 't-mira', kind: 'token', name: mira.name, actorId: mira.id, x: 407, y: 615, symbol: mira.symbol, color: mira.color },
  { id: 't-warden', kind: 'token', name: warden.name, actorId: warden.id, x: 717, y: 305, symbol: warden.symbol, color: warden.color, secret: true },
  { id: 'l-altar', kind: 'light', name: 'Алтарный огонь', x: 481, y: 241, radius: 152, color: '#f0b14a' },
  { id: 'l-study', kind: 'light', name: 'Фонарь в архиве', x: 723, y: 386, radius: 112, color: '#ed995b' },
  { id: 'l-gate', kind: 'light', name: 'Входной факел', x: 552, y: 561, radius: 108, color: '#ed995b' },
  { id: 'w-seed', kind: 'wall', name: 'Стена архива', x: 600, y: 296, end: { x: 600, y: 402 } },
  { id: 'd-seed', kind: 'door', name: 'Дверь в архив', x: 600, y: 402, end: { x: 600, y: 448 }, open: false },
  { id: 'o-seed', kind: 'window', name: 'Витраж', x: 410, y: 196, end: { x: 455, y: 196 } },
];
const abbey = { ...emptyScene('Затопленное аббатство', 'Акт I · Грейвик'), id: 'abbey', objects: tokens };
const crypt = { ...emptyScene('Крипта под алтарём', 'Акт I · Грейвик', 'crypt'), id: 'crypt', ambient: 47 };
const woods = { ...emptyScene('Старая переправа', 'Дорога к северу', 'woods'), id: 'woods', ambient: 90 };

export const demoCampaigns: Campaign[] = [
  {
    id: 'graywick', name: 'Тени Грейвика', subtitle: 'Семь фонарей · Акт I',
    activeScene: 'abbey', scenes: [abbey, crypt, woods],
    actors: [elara, brann, mira, warden, makeActor('keeper', 'Смотритель Орен', 'Человек · Хранитель ключей', 'npc', 16, 12, 0, 'user', '#cfb58a')],
    sceneFolders: ['Акт I · Грейвик', 'Дорога к северу'],
    materialFolders: ['История Грейвика', 'Раздаточные материалы', 'Подготовка'],
    assetFolders: ['Стартовый набор', 'Мои ассеты'],
    materials: [
      { id: 'letter', name: 'Письмо смотрителя', kind: 'letter', folder: 'Раздаточные материалы', pages: ['Элара,\n\nЕсли это письмо у тебя, значит, фонари на мосту погасли. В аббатстве всё ещё горит один огонь. Следуй за ним.\n\nНе открывай северную дверь после полуночи.\n\nОрен'], access: 'all', participants: [], pinned: true, shown: false },
      { id: 'log', name: 'Там, где гаснут фонари', kind: 'journal', folder: 'История Грейвика', pages: ['День первый. Отряд прибыл к старой переправе. Вода поднялась, и на другом берегу видны только огни аббатства.', 'День второй. На колокольне никто не дежурил. Следы вели из архива к алтарю.'], access: 'all', participants: [], pinned: false, shown: false },
      { id: 'secret', name: 'План следующей встречи', kind: 'note', folder: 'Подготовка', pages: ['Пепельный страж прячется в архиве. Орен выдаёт ключ, если игроки покажут письмо.'], access: 'gm', participants: [], pinned: true, shown: false },
      { id: 'order', name: 'Орден Семи Фонарей', kind: 'lore', folder: 'История Грейвика', pages: ['Семь огней зажигали перед каждым разливом. Местные верили, что их свет помогает лодкам добраться до берега.', 'Седьмой фонарь хранится под алтарём. Его свет виден только с воды.'], access: 'selected', participants: ['Элара'], pinned: false, shown: false },
    ],
    assets: [
      { id: 'a-tracks', name: 'Следы на земле', kind: 'Декали', folder: 'Стартовый набор', symbol: 'paw', color: '#b9a488' },
      { id: 'a-chest', name: 'Дубовый сундук', kind: 'Объекты', folder: 'Стартовый набор', symbol: 'chest', color: '#e1b680' },
      { id: 'a-lamp', name: 'Латунный фонарь', kind: 'Объекты', folder: 'Стартовый набор', symbol: 'lantern', color: '#efb45a' },
      { id: 'a-statue', name: 'Каменный идол', kind: 'Объекты', folder: 'Стартовый набор', symbol: 'statue', color: '#a0b0b1' },
      { id: 'a-ranger', name: 'Лесная следопытка', kind: 'Портреты', folder: 'Стартовый набор', symbol: 'bow', color: '#81b9a3' },
      { id: 'a-ghost', name: 'Пепельный страж', kind: 'Портреты', folder: 'Стартовый набор', symbol: 'skull', color: '#dd897f' },
    ],
  },
  {
    id: 'north', name: 'Северный дозор', subtitle: 'За Серой рекой · Акт I', activeScene: 'woods',
    scenes: [woods], actors: [elara], materials: [], assets: [], sceneFolders: ['Дорога к северу'], materialFolders: [], assetFolders: [],
  },
];

export const demoEntries: Entry[] = [
  { id: 'hello', kind: 'chat', author: 'Мастер', text: 'Вы слышите звон цепей из глубины аббатства.' },
  { id: 'perception', kind: 'roll', author: 'Элара', text: 'Внимательность · 1d20 + 3', value: 16 },
  { id: 'whisper', kind: 'event', author: 'Стол', text: 'Письмо смотрителя доступно игрокам.' },
  { id: 'brann', kind: 'chat', author: 'Бранн', text: 'Я прикрою вход. Элара, посмотри, что у алтаря.' },
];

const srdSymbols: Record<string, string> = { 'Зверь': 'paw', 'Нежить': 'skull', 'Гуманоид': 'user', 'Дракон': 'flame' };

export const srdActors: Actor[] = srd51.map(({ id, name, category, size, challenge, hp, ac, initiative, speed, page, actions }) => ({
  ...makeActor(id, name, `${category} · ПО ${challenge}`, 'monster', hp, ac, initiative, srdSymbols[category], '#c8b28e'),
  actions: { ...blankActions, attack: actions.join('\n') },
  srdProfile: { category, size, challenge, speed, page },
}));
