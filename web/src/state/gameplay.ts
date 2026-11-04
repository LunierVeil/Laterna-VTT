import type { GameplaySlice, SliceCreator } from "./model";

/** Existing gameplay defaults/actions; cross-domain partial updates retain their original order. */
export const createGameplaySlice: SliceCreator<GameplaySlice> = (set) => ({
  characters: {},
  combat: null,
  messages: [],
  sceneName: "",
  gridSize: 70,
  background: null,
  setMessages: (messages) => set({ messages }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m].slice(-200) })),
  setScene: (sceneName, gridSize, background) => set({ sceneName, gridSize, background }),
  setCharacters: (list) => set({ characters: Object.fromEntries(list.map((c) => [c.id, c])) }),
  putCharacter: (c) => set((s) => ({ characters: { ...s.characters, [c.id]: c } })),
  dropCharacter: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.characters;
      return { characters: rest, openCharacterId: s.openCharacterId === id ? null : s.openCharacterId };
    }),
  setCombat: (combat) => set({ combat })
});
