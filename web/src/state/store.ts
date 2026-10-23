import { create } from "zustand";
import type { Message, Token, Tool } from "../types";

/** Что нужно панели свойств. Без координат: они меняются на каждом кадре драга. */
export type SelectedToken = Pick<Token, "id" | "name" | "color" | "owner" | "size">;

interface UiState {
  user: string;
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

  setUser: (u: string) => void;
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

  setUser: (user) => {
    localStorage.setItem("lanterna.user", user);
    set({ user });
  },
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
}));
