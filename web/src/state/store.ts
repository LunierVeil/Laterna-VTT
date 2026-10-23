import { create } from "zustand";
import type { Message, SceneInfo, Token, Tool } from "../types";

/** Что нужно панели свойств. Без координат: они меняются на каждом кадре драга. */
export type SelectedToken = Pick<Token, "id" | "name" | "color" | "owner" | "size">;

const GM_COOKIE = "lanterna_gm";

function readGmCookie(): string | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${GM_COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(GM_COOKIE.length + 1)) : null;
}

/**
 * Ключ ГМ приходит один раз в ссылке ?gm=... Кладём его в cookie (её браузер
 * сам шлёт при подключении сокета и загрузке файлов, а в логи сервера она
 * не попадает) и сразу убираем из адресной строки - чтобы не светить при
 * показе экрана.
 */
function takeGmKey(): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("gm");
  if (fromUrl) {
    document.cookie = `${GM_COOKIE}=${encodeURIComponent(fromUrl)}; path=/; max-age=31536000; samesite=strict`;
    url.searchParams.delete("gm");
    history.replaceState(null, "", url);
  }
  return readGmCookie();
}

interface UiState {
  user: string;
  gmKey: string | null;
  /** Решает сервер (по ключу), здесь - только чтобы показать инструменты ГМ. */
  isGm: boolean;
  tool: Tool;
  messages: Message[];
  users: string[];
  connected: boolean;
  error: string | null;
  sceneName: string;
  gridSize: number;
  background: string | null;
  chaining: boolean;
  selected: SelectedToken | null;
  activeSceneId: string | null;
  /** Все сцены кампании - знает только ГМ. */
  scenes: SceneInfo[];

  setUser: (u: string) => void;
  dropGmKey: () => void;
  setIsGm: (v: boolean) => void;
  setTool: (t: Tool) => void;
  setMessages: (m: Message[]) => void;
  pushMessage: (m: Message) => void;
  setUsers: (u: string[]) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  /** Показать ошибку тостом на пару секунд. */
  flashError: (e: string) => void;
  setScene: (name: string, gridSize: number, background: string | null) => void;
  setChaining: (c: boolean) => void;
  setSelected: (t: SelectedToken | null) => void;
  setCampaign: (activeSceneId: string, scenes: SceneInfo[] | undefined) => void;
}

/**
 * Здесь живёт ТОЛЬКО состояние интерфейса: чат, присутствие, активный
 * инструмент. Токены и стены сюда не кладём - они в PixiJS-сцене.
 * Гонять каждое перемещение токена через React-стейт означает ререндер
 * на каждый кадр драга.
 *
 * Исключение - selected: имя, цвет, размер и владелец выбранного токена для
 * панели свойств. Обновляется только при выборе и token.updated.
 */
export const useUi = create<UiState>((set) => ({
  user: localStorage.getItem("lanterna.user") || "",
  gmKey: takeGmKey(),
  isGm: false,
  tool: "select",
  messages: [],
  users: [],
  connected: false,
  error: null,
  sceneName: "",
  gridSize: 70,
  background: null,
  chaining: false,
  selected: null,
  activeSceneId: null,
  scenes: [],

  setUser: (user) => {
    localStorage.setItem("lanterna.user", user);
    set({ user });
  },
  dropGmKey: () => {
    document.cookie = `${GM_COOKIE}=; path=/; max-age=0`;
    set({ gmKey: null, isGm: false });
  },
  setIsGm: (isGm) => set({ isGm }),
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
  setScene: (sceneName, gridSize, background) => set({ sceneName, gridSize, background }),
  setChaining: (chaining) => set({ chaining }),
  setSelected: (selected) => set({ selected }),
  setCampaign: (activeSceneId, scenes) => set(scenes ? { activeSceneId, scenes } : { activeSceneId }),
}));
