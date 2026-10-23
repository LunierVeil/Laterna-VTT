import { create } from "zustand";
import type { Message, Token, Tool } from "../types";

/** Что нужно панели свойств. Без координат: они меняются на каждом кадре драга. */
export type SelectedToken = Pick<Token, "id" | "name" | "color" | "owner">;

interface UiState {
  user: string;
  tool: Tool;
  messages: Message[];
  users: string[];
  connected: boolean;
  error: string | null;
  sceneName: string;
  gridSize: number;
  chaining: boolean;
  selected: SelectedToken | null;

  setUser: (u: string) => void;
  setTool: (t: Tool) => void;
  setMessages: (m: Message[]) => void;
  pushMessage: (m: Message) => void;
  setUsers: (u: string[]) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  setScene: (name: string, gridSize: number) => void;
  setChaining: (c: boolean) => void;
  setSelected: (t: SelectedToken | null) => void;
}

/**
 * Здесь живёт ТОЛЬКО состояние интерфейса: чат, присутствие, активный
 * инструмент. Токены и стены сюда не кладём - они в PixiJS-сцене.
 * Гонять каждое перемещение токена через React-стейт означает ререндер
 * на каждый кадр драга.
 *
 * Исключение - selected: имя, цвет и владелец выбранного токена для
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
  setScene: (sceneName, gridSize) => set({ sceneName, gridSize }),
  setChaining: (chaining) => set({ chaining }),
  setSelected: (selected) => set({ selected }),
}));
