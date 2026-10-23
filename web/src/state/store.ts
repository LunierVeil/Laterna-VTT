import { create } from "zustand";
import type { Message, Tool } from "../types";

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

  setUser: (u: string) => void;
  setTool: (t: Tool) => void;
  setMessages: (m: Message[]) => void;
  pushMessage: (m: Message) => void;
  setUsers: (u: string[]) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  setScene: (name: string, gridSize: number) => void;
  setChaining: (c: boolean) => void;
}

/**
 * Здесь живёт ТОЛЬКО состояние интерфейса: чат, присутствие, активный
 * инструмент. Токены и стены сюда не кладём - они в PixiJS-сцене.
 * Гонять каждое перемещение токена через React-стейт означает ререндер
 * на каждый кадр драга.
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
}));
