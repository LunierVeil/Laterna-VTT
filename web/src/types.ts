export interface Token {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  color: string;
  image_url: string | null;
  layer: string;
  /** id пользователя; null - общий. */
  owner_id: string | null;
  /** Лист, которого изображает токен. Хиты и КД - из него. */
  character_id: string | null;
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
}

export interface Message {
  id: string;
  /** Имя на момент сообщения. */
  author: string;
  author_id: string | null;
  text: string;
  kind: "text" | "roll";
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
  messages: Message[];
}

export type ServerMessage =
  // you есть только в снапшоте из сокета; при resync через REST его нет.
  | { type: "snapshot"; seq: number; scene: Scene; you?: UserInfo }
  | { type: "event"; seq: number; name: string; payload: any; cmd_id: string | null }
  | { type: "error"; message: string; cmd_id: string | null }
  | { type: "presence"; users: string[] }
  | { type: "chat"; message: Message }
  // scenes приходит только ГМ; игрок узнаёт лишь, какая сцена активна.
  // scenes и invites - только ГМ.
  | { type: "campaign"; active_scene_id: string; scenes?: SceneInfo[]; users: UserInfo[]; invites?: InviteInfo[] }
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
}

/** Ожидающее приглашение. user_id - сброс пароля этого игрока, null - новый игрок. */
export interface InviteInfo {
  id: string;
  user_id: string | null;
  expires_at: string;
}

export interface SceneInfo {
  id: string;
  name: string;
}

export type Tool = "select" | "wall" | "token" | "erase" | "ruler";
