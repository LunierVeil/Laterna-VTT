export interface Token {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  color: string;
  image_url: string | null;
  portrait_url?: string | null;
  layer: string;
  /** id пользователя; null - общий. */
  owner_id: string | null;
  /** Лист, которого изображает токен. Хиты и КД - из него. */
  character_id: string | null;
  /** Свои хиты экземпляра моба. null - хиты из листа; игрокам приходит null. */
  hp: number | null;
  vision_range: number;
  emits_light: number;
}

export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: string;
  door_state: string;
  blocks_movement: boolean;
  blocks_sight: boolean;
  blocks_sound: boolean;
  owner_id: string | null;
}

export interface RollTerm {
  text: string;
  sign: number;
  kind: "dice" | "flat";
  rolls: number[];
  kept: number[];
  value: number;
}

export interface Roll {
  formula: string;
  total: number;
  terms: RollTerm[];
  /** Подпись броска из листа: "Цеп - атака". */
  label?: string;
  /** Скрытый бросок мастера - так его видит сам ГМ. */
  hidden?: boolean;
}

export interface Message {
  id: string;
  /** Имя на момент сообщения. */
  author: string;
  author_id: string | null;
  text: string;
  /** hidden_roll - скрытый бросок мастера глазами игрока: только "бросил". */
  kind: "text" | "roll" | "hidden_roll";
  roll: Roll | null;
  created_at: string | null;
}

/** Участник боя. Имя, владелец и лист сервер берёт с токена. */
export interface CombatEntry {
  id: string;
  token_id: string;
  name: string;
  init: number | null;
  owner_id?: string | null;
  character_id?: string | null;
  /** Последний бросок инициативы: что выпало на d20. */
  roll?: { formula: string; die: number };
}

/** Бой в сцене. current - id участника, чей ход; null - бой ещё не начат. */
export interface Combat {
  round: number;
  current: string | null;
  entries: CombatEntry[];
}

export interface Scene {
  id: string;
  seq: number;
  name: string;
  width: number;
  height: number;
  grid_size: number;
  grid_type: string;
  background_url: string | null;
  combat: Combat | null;
  tokens: Token[];
  walls: Wall[];
  /** Ручной туман: прямоугольники в пикселях сцены. */
  fog?: FogRect[];
  messages: Message[];
}

export interface FogRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TokenPreview {
  type: "token_preview";
  id: string; drag_id: string; step: number; base_seq: number;
  end: boolean; final?: boolean;
  x?: number; y?: number; origin_x?: number; origin_y?: number;
  author?: string; ttl_ms?: number;
}

export type ServerMessage =
  | TokenPreview
  // you есть только в снапшоте из сокета; при resync через REST его нет.
  | { type: "snapshot"; seq: number; scene: Scene; you?: UserInfo }
  | { type: "event"; seq: number; name: string; payload: any; cmd_id: string | null }
  | { type: "error"; message: string; cmd_id: string | null }
  | { type: "presence"; users: string[] }
  | { type: "chat"; message: Message }
  /** Пинг на карте: не событие сцены, без seq. */
  | { type: "ping"; x: number; y: number; author: string; color: string }
  // scenes приходит только ГМ; игрок узнаёт лишь, какая сцена активна.
  // scenes и invites - только ГМ.
  | { type: "campaign"; active_scene_id: string; active_scene_name?: string; scenes?: SceneInfo[]; folders?: SceneFolder[]; users: UserInfo[]; invites?: InviteInfo[] }
  // Сессии нет или она кончилась - на экран входа.
  | { type: "auth_required" }
  // Лист приходит только владельцу и мастерам.
  | { type: "character"; character: Character }
  | { type: "character_deleted"; id: string }
  | { type: "reply"; name: string; payload: any; cmd_id: string | null };

/** Лист персонажа. data - JSON по схеме листа (web/src/sheets). */
export interface Character {
  id: string;
  owner_id: string | null;
  name: string;
  system: string;
  data: Record<string, unknown>;
  source_format: string | null;
}

export interface UserInfo {
  id: string;
  name: string;
  is_gm: boolean;
  /** Адрес туннеля - только у ГМ, из снапшота сцены: для приглашений. */
  public_url?: string | null;
}

/** Ожидающее приглашение. user_id - сброс пароля этого игрока, null - новый игрок. */
export interface InviteInfo {
  reusable?: boolean;
  paused?: boolean;
  token?: string;
  id: string;
  user_id: string | null;
  expires_at: string;
}

export interface SceneFolder { id: string; name: string; }

export interface SceneInfo {
  folder_id?: string | null;
  preview_url?: string | null;
  id: string;
  name: string;
}

export type Tool = "ping" | "select" | "wall" | "token" | "erase" | "ruler" | "fog";
