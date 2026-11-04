import type { Character, Combat, InviteInfo, Message, SceneFolder, SceneInfo, UserInfo } from "../shared/api/protocol";
import type { Tool } from "../entities/scene/model/tool";
import type { SelectedToken } from "../entities/token/model/selection";
import type { StateCreator } from "zustand";

export interface SessionSlice {
  /** Кто вошёл - по ответу сервера. null - экран входа. */
  me: UserInfo | null;
  /** Решает сервер (по сессии), здесь - только чтобы показать инструменты ГМ. */
  isGm: boolean;
  connected: boolean;

  setMe: (me: UserInfo | null) => void;
  setConnected: (c: boolean) => void;
}

export interface CampaignSlice {
  /** Аккаунты кампании: показать, чей токен, и список игроков у ГМ. */
  accounts: UserInfo[];
  /** Ожидающие приглашения - знает только ГМ. */
  invites: InviteInfo[];
  /** Только что созданная ссылка: код приходит один раз, в ответе на команду. */
  lastInvite: { token: string; user_id: string | null } | null;
  activeSceneId: string | null;
  /** Все сцены кампании - знает только ГМ. */
  scenes: SceneInfo[];
  folders: SceneFolder[];
  users: string[];
  setCampaign: (
    activeSceneId: string,
    scenes: SceneInfo[] | undefined,
    accounts: UserInfo[],
    invites: InviteInfo[] | undefined,
    folders?: SceneFolder[],
  ) => void;
  setUsers: (u: string[]) => void;
  setLastInvite: (v: { token: string; user_id: string | null } | null) => void;
}

export interface GameplaySlice {
  /** Листы, которые этому клиенту можно видеть: свои, у ГМ - все. */
  characters: Record<string, Character>;
  /** Бой текущей сцены (трекер инициативы). */
  combat: Combat | null;
  messages: Message[];
  sceneName: string;
  gridSize: number;
  background: string | null;
  setMessages: (m: Message[]) => void;
  pushMessage: (m: Message) => void;
  setScene: (name: string, gridSize: number, background: string | null) => void;
  setCharacters: (list: Character[]) => void;
  putCharacter: (c: Character) => void;
  dropCharacter: (id: string) => void;
  setCombat: (c: Combat | null) => void;
}

export interface UiSlice {
  /** Открытый лист. */
  openCharacterId: string | null;
  /** Полный трекер боя открыт (очередь хода и так видна в шапке). */
  combatOpen: boolean;
  /** ГМ ставит новые токены сразу скрытыми от игроков (засада). */
  placeHidden: boolean;
  /** Инструмент "Туман": рамка закрывает или открывает. */
  fogMode: "cover" | "reveal";
  /** Что рисует инструмент "Стена": стену или дверь. */
  wallKind: "wall" | "door";
  /** ГМ бросает скрыто: панель кубов и броски из листа. */
  hiddenRolls: boolean;
  /** Вкладка правой колонки. */
  sideTab: SideTab;
  /** Масштаб сцены - только для индикатора, сам масштаб живёт в стейдже. */
  zoom: number;
  tool: Tool;
  error: string | null;
  /** Сообщение-итог (не ошибка): отчёт импорта и подобное. */
  notice: string | null;
  chaining: boolean;
  selected: SelectedToken | null;
  selectionCount: number;
  selectionEditable: number;
  diceOpen: boolean;
  diceAnimation: boolean;
  setDiceOpen: (v: boolean) => void;
  setDiceAnimation: (v: boolean) => void;
  setTool: (t: Tool) => void;
  setError: (e: string | null) => void;
  /** Показать ошибку тостом на пару секунд. */
  flashError: (e: string) => void;
  /** Показать итог тостом - дольше ошибки: его читают. */
  flashNotice: (text: string) => void;
  setChaining: (c: boolean) => void;
  setSelected: (t: SelectedToken | null) => void;
  openCharacter: (id: string | null) => void;
  setCombatOpen: (v: boolean) => void;
  setPlaceHidden: (v: boolean) => void;
  setFogMode: (v: "cover" | "reveal") => void;
  setWallKind: (v: "wall" | "door") => void;
  setHiddenRolls: (v: boolean) => void;
  setSideTab: (t: SideTab) => void;
  setZoom: (z: number) => void;
}

export type UiState = SessionSlice & CampaignSlice & GameplaySlice & UiSlice;
export type UiData = Pick<UiState,
  "me" | "isGm" | "accounts" | "invites" | "lastInvite" | "characters" | "openCharacterId" | "combat" | "combatOpen" | "placeHidden" | "fogMode" | "wallKind" | "hiddenRolls" | "sideTab" | "zoom" | "tool" | "messages" | "users" | "connected" | "error" | "notice" | "sceneName" | "gridSize" | "background" | "chaining" | "selected" | "selectionCount" | "selectionEditable" | "activeSceneId" | "scenes" | "folders" | "diceOpen" | "diceAnimation"
>;
export type SliceCreator<T> = StateCreator<UiState, [], [], T>;
export type SideTab = "chat" | "scenes" | "players" | "characters";
