import { create } from "zustand";
import type { Character, Combat, InviteInfo, Message, SceneInfo, Token, Tool, UserInfo } from "../types";

/** Что нужно карточки токена. Без координат: они меняются на каждом кадре драга. */
export type SelectedToken = Pick<
  Token,
  "id" | "name" | "color" | "owner_id" | "size" | "character_id" | "image_url" | "layer" | "hp"
>;

interface UiState {
  /** Кто вошёл - по ответу сервера. null - экран входа. */
  me: UserInfo | null;
  /** Решает сервер (по сессии), здесь - только чтобы показать инструменты ГМ. */
  isGm: boolean;
  /** Аккаунты кампании: показать, чей токен, и список игроков у ГМ. */
  accounts: UserInfo[];
  /** Ожидающие приглашения - знает только ГМ. */
  invites: InviteInfo[];
  /** Только что созданная ссылка: код приходит один раз, в ответе на команду. */
  lastInvite: { token: string; user_id: string | null } | null;
  /** Листы, которые этому клиенту можно видеть: свои, у ГМ - все. */
  characters: Record<string, Character>;
  /** Открытый лист. */
  openCharacterId: string | null;
  /** Бой текущей сцены (трекер инициативы). */
  combat: Combat | null;
  /** Полный трекер боя открыт (очередь хода и так видна в шапке). */
  combatOpen: boolean;
  /** ГМ ставит новые токены сразу скрытыми от игроков (засада). */
  placeHidden: boolean;
  /** Что рисует инструмент "Стена": стену или дверь. */
  wallKind: "wall" | "door";
  /** ГМ бросает скрыто: панель кубов и броски из листа. */
  hiddenRolls: boolean;
  /** Вкладка правой колонки. */
  sideTab: SideTab;
  /** Масштаб сцены - только для индикатора, сам масштаб живёт в стейдже. */
  zoom: number;
  tool: Tool;
  messages: Message[];
  users: string[];
  connected: boolean;
  error: string | null;
  /** Сообщение-итог (не ошибка): отчёт импорта и подобное. */
  notice: string | null;
  sceneName: string;
  gridSize: number;
  background: string | null;
  chaining: boolean;
  selected: SelectedToken | null;
  activeSceneId: string | null;
  /** Все сцены кампании - знает только ГМ. */
  scenes: SceneInfo[];

  setMe: (me: UserInfo | null) => void;
  setTool: (t: Tool) => void;
  setMessages: (m: Message[]) => void;
  pushMessage: (m: Message) => void;
  setUsers: (u: string[]) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  /** Показать ошибку тостом на пару секунд. */
  flashError: (e: string) => void;
  /** Показать итог тостом - дольше ошибки: его читают. */
  flashNotice: (text: string) => void;
  setScene: (name: string, gridSize: number, background: string | null) => void;
  setChaining: (c: boolean) => void;
  setSelected: (t: SelectedToken | null) => void;
  setCampaign: (
    activeSceneId: string,
    scenes: SceneInfo[] | undefined,
    accounts: UserInfo[],
    invites: InviteInfo[] | undefined,
  ) => void;
  setLastInvite: (v: { token: string; user_id: string | null } | null) => void;
  setCharacters: (list: Character[]) => void;
  putCharacter: (c: Character) => void;
  dropCharacter: (id: string) => void;
  openCharacter: (id: string | null) => void;
  setCombat: (c: Combat | null) => void;
  setCombatOpen: (v: boolean) => void;
  setPlaceHidden: (v: boolean) => void;
  setWallKind: (v: "wall" | "door") => void;
  setHiddenRolls: (v: boolean) => void;
  setSideTab: (t: SideTab) => void;
  setZoom: (z: number) => void;
}

export type SideTab = "chat" | "scenes" | "players" | "characters";

/**
 * Здесь живёт ТОЛЬКО состояние интерфейса: чат, присутствие, активный
 * инструмент. Токены и стены сюда не кладём - они в PixiJS-сцене.
 * Гонять каждое перемещение токена через React-стейт означает ререндер
 * на каждый кадр драга.
 *
 * Исключение - selected: имя, цвет, размер и владелец выбранного токена для
 * карточки токена. Обновляется только при выборе и token.updated.
 */
export const useUi = create<UiState>((set) => ({
  me: null,
  isGm: false,
  accounts: [],
  invites: [],
  lastInvite: null,
  characters: {},
  openCharacterId: null,
  combat: null,
  combatOpen: false,
  placeHidden: false,
  wallKind: "wall",
  hiddenRolls: false,
  sideTab: "chat",
  zoom: 1,
  tool: "select",
  messages: [],
  users: [],
  connected: false,
  error: null,
  notice: null,
  sceneName: "",
  gridSize: 70,
  background: null,
  chaining: false,
  selected: null,
  activeSceneId: null,
  scenes: [],

  // Не ГМ (вышел, вошёл игроком) - инструменты мастера недоступны.
  setMe: (me) =>
    set((s) => {
      const isGm = me?.is_gm ?? false;
      return {
        me,
        isGm,
        tool: !isGm && (s.tool === "wall" || s.tool === "erase") ? "select" : s.tool,
        sideTab: !isGm && (s.sideTab === "scenes" || s.sideTab === "players") ? "chat" : s.sideTab,
      };
    }),
  setTool: (tool) => set({ tool }),
  setMessages: (messages) => set({ messages }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m].slice(-200) })),
  setUsers: (users) => set({ users }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  flashError: (error) => {
    set({ error });
    setTimeout(() => {
      // Не гасим более свежую ошибку, пришедшую за это время.
      if (useUi.getState().error === error) set({ error: null });
    }, 2500);
  },
  flashNotice: (notice) => {
    set({ notice });
    setTimeout(() => {
      if (useUi.getState().notice === notice) set({ notice: null });
    }, 8000);
  },
  setScene: (sceneName, gridSize, background) => set({ sceneName, gridSize, background }),
  setChaining: (chaining) => set({ chaining }),
  setSelected: (selected) => set({ selected }),
  setCampaign: (activeSceneId, scenes, accounts, invites) =>
    set(scenes ? { activeSceneId, scenes, accounts, invites: invites ?? [] } : { activeSceneId, accounts }),
  setLastInvite: (lastInvite) => set({ lastInvite }),
  setCharacters: (list) => set({ characters: Object.fromEntries(list.map((c) => [c.id, c])) }),
  putCharacter: (c) => set((s) => ({ characters: { ...s.characters, [c.id]: c } })),
  dropCharacter: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.characters;
      return { characters: rest, openCharacterId: s.openCharacterId === id ? null : s.openCharacterId };
    }),
  openCharacter: (openCharacterId) => set({ openCharacterId }),
  setCombat: (combat) => set({ combat }),
  setCombatOpen: (combatOpen) => set({ combatOpen }),
  setPlaceHidden: (placeHidden) => set({ placeHidden }),
  setWallKind: (wallKind) => set({ wallKind }),
  setHiddenRolls: (hiddenRolls) => set({ hiddenRolls }),
  setSideTab: (sideTab) => set({ sideTab }),
  setZoom: (zoom) => set({ zoom }),
}));
