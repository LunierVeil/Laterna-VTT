export type Role = 'gm' | 'player';
export type Page = 'scenes' | 'assets' | 'spells' | 'roster' | 'hero-create' | 'sheet' | 'journal' | 'settings' | 'import' | null;
export type Tool = 'select' | 'pan' | 'wall' | 'door' | 'window' | 'light' | 'fog' | 'measure';
export interface Point { x: number; y: number }
export type ObjectKind = 'token' | 'prop' | 'wall' | 'door' | 'window' | 'light' | 'fog';
export const tokenSizes = { small: "Маленький", medium: "Средний", large: "Большой", giant: "Гигантский" } as const;
export type TokenSize = keyof typeof tokenSizes;
export type WallMode = 'line' | 'curve' | 'rectangle' | 'circle' | 'ellipse';
export interface DecalPattern { kind: 'tracks' | 'stones' | 'cracks' | 'leaves' | 'embers'; size: number; rotation: number; variant: number }
export interface MapObject extends Point {
  id: string;
  kind: ObjectKind;
  name: string;
  end?: Point;
  control?: Point;
  flicker?: boolean;
  locked?: boolean;
  lightEnabled?: boolean;
  intensity?: number;
  opacity?: number;
  flickerSpeed?: number;
  flickerStrength?: number;
  lightPreset?: string;
  showGeometryIcon?: boolean;
  radius?: number;
  open?: boolean;
  secret?: boolean;
  color?: string;
  symbol?: string;
  actorId?: string;
  size?: TokenSize;
  hp?: number;
  image?: string;
  decal?: DecalPattern;
}
export interface Scene {
  id: string;
  name: string;
  folder: string;
  art: 'abbey' | 'crypt' | 'woods';
  background?: Point & { image: string; width: number; height: number };
  grid: number;
  showGrid: boolean;
  ambient: number;
  vision: boolean;
  explored: boolean;
  objects: MapObject[];
}
export interface SheetItem { id: string; name: string; quantity: number; category: string; equipped: boolean; description: string; attack?: string; damage?: string }
export interface SheetSpell { id: string; name: string; level: number; prepared: boolean; equipped?: boolean; description: string; school?: string; casting?: string; range?: string; components?: string; duration?: string }
export interface Actor {
  id: string;
  name: string;
  kind: 'hero' | 'npc' | 'monster';
  title: string;
  hp: number;
  maxHp: number;
  ac: number;
  init: number;
  color: string;
  symbol: string;
  actions: Record<'attack' | 'bonus' | 'reaction' | 'legendary' | 'lair' | 'spells', string>;
  items: string;
  equipment?: SheetItem[];
  spells?: SheetSpell[];
  spellSlots?: Record<number, { current: number; max: number }>;
  materialIds?: string[];
  biography?: { goals: string; languages: string; publicNotes: string; personalNotes: string };
  reactionUsed?: boolean;
  bonusUsed?: boolean;
  characterIdentity?: { portrait?: string; background?: string; alignment?: string; proficiencies?: string };
  sheetLayout?: 'full' | 'compact';
  deathSaves?: { successes: number; failures: number; roll?: number };
  tempHp?: number;
  featureNotes?: Record<string, string>;
  notes: string;
  resource: number;
  srdProfile?: { category: string; size: string; challenge: string; speed: number; page: number };
  conditions?: string[];
  creatureProfile?: { type: string; size: string; challenge: string; speed: string; scores: number[];
    defenses: string; senses: string; languages: string; saves: string };
  importedEdition?: '2024';
  progression?: { className: string; level: number; features: string[]; subclass?: string;
    resources?: { name: string; current: number; max: number; rest?: 'short' | 'long' }[] };
  companion?: { controllerId?: string };
  npcProfile?: { chapter: 'Союзники' | 'Нейтральные' | 'Враги'; appearance: string; personality: string; biography: string };
  skillOverrides?: Record<string, { ability: number; training: 0 | 1 | 2; modifier?: number }>;
  sheetProfile?: { scores: number[]; speed: number; proficiency: number; saves: number[]; skills: string[] };
}
export type Access = 'gm' | 'all' | 'selected';
export interface Material {
  id: string;
  name: string;
  kind: 'letter' | 'note' | 'journal' | 'lore';
  folder: string;
  pages: string[];
  template?: 'blank' | 'contract' | 'scroll' | 'note' | 'letter' | 'map' | 'illustration' | 'poster' | 'book' | 'diary' | 'tag';
  access: Access;
  participants: string[];
  pinned: boolean;
  shown: boolean;
}
export interface Asset {
  id: string;
  name: string;
  kind: 'Объекты' | 'Декали' | 'Портреты';
  folder: string;
  symbol: string;
  color: string;
  image?: string;
  source?: string;
}
export interface DemoSettings {
  connection: 'LAN' | 'Porthole';
  connected: boolean;
  storage: 'local' | 'portable';
  automaticBackups: boolean;
  showAllyHp?: boolean;
  backups: string[];
}
export const defaultSettings: DemoSettings = {
  connection: 'LAN', connected: false, storage: 'local', automaticBackups: true,
  backups: ['Перед обновлением · пример'],
};

export interface Campaign {
  playerHeroId?: string;
  id: string;
  name: string;
  subtitle: string;
  demoSettings?: DemoSettings;
  scenes: Scene[];
  activeScene: string;
  gmScene?: string;
  actors: Actor[];
  materials: Material[];
  assets: Asset[];
  sceneFolders: string[];
  materialFolders: string[];
  assetFolders: string[];
}
export interface Entry {
  id: string;
  kind: 'chat' | 'event' | 'roll';
  author: string;
  text: string;
  value?: number;
  roll?: { sides: number; dice: number[]; bonus: number; mode: 'normal' | 'advantage' | 'disadvantage' };
  secret?: boolean;
}
export interface CombatParticipant { id: string; initiative: number }
export interface Combat { order: string[]; initiative: Record<string, number>; turn: number; round: number }
export interface Placement { name: string; kind: 'prop' | 'token'; symbol: string; color: string; actorId?: string; image?: string; decal?: DecalPattern }

export const uid = () => crypto.randomUUID();
export const participant = 'Элара';
export const canRead = (material: Material, role: Role) =>
  role === 'gm' || material.shown || material.access === 'all' ||
  (material.access === 'selected' && material.participants.includes(participant));
export const materialKinds = { letter: 'Письмо', note: 'Заметка', journal: 'Журнал', lore: 'Лор' };
export const objectKinds = { token: 'Токен', prop: 'Объект', wall: 'Стена', door: 'Дверь', window: 'Окно', light: 'Источник света', fog: 'Туман' };
export const blankActions: Actor['actions'] = { attack: '', bonus: '', reaction: '', legendary: '', lair: '', spells: '' };
export const actionLabels = { attack: 'Действия и атаки', bonus: 'Бонусные действия', reaction: 'Реакции', legendary: 'Легендарные действия', lair: 'Действия логова', spells: 'Заклинания' };
export const emptyScene = (name: string, folder: string, art: Scene['art'] = 'abbey'): Scene => ({
  id: uid(), name, folder, art, grid: 48, showGrid: true, ambient: 70, vision: true, explored: true, objects: [],
});

export function playerHeroId(campaign: Campaign) {
  return campaign.playerHeroId ?? 'elara';
}

export function controlsActor(actor: Actor | undefined, heroId: string) {
  return Boolean(actor && (actor.id === heroId || actor.companion?.controllerId === heroId));
}
