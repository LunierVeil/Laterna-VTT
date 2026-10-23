export interface Token {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  color: string;
  image_url: string | null;
  layer: string;
  owner: string | null;
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
  owner: string | null;
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
}

export interface Message {
  id: string;
  author: string;
  text: string;
  kind: "text" | "roll";
  roll: Roll | null;
  created_at: string | null;
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
  tokens: Token[];
  walls: Wall[];
  messages: Message[];
}

export type ServerMessage =
  // you есть только в снапшоте из сокета; при resync через REST его нет.
  | { type: "snapshot"; seq: number; scene: Scene; you?: { name: string; is_gm: boolean } }
  | { type: "event"; seq: number; name: string; payload: any; cmd_id: string | null }
  | { type: "error"; message: string; cmd_id: string | null }
  | { type: "presence"; users: string[] };

export type Tool = "select" | "wall" | "token" | "erase";
