import type { SessionSlice, SliceCreator } from "./model";

/** Existing session defaults/actions; cross-domain partial updates retain their original order. */
export const createSessionSlice: SliceCreator<SessionSlice> = (set) => ({
  me: null,
  isGm: false,
  connected: false,

  // Не ГМ (вышел, вошёл игроком) - инструменты мастера недоступны.
  setMe: (me) =>
    set((s) => {
      const isGm = me?.is_gm ?? false;
      return {
        me,
        isGm,
        ...(!isGm ? {scenes: [], folders: []} : {}),
        tool: !isGm && (s.tool === "token" || s.tool === "wall" || s.tool === "erase" || s.tool === "fog") ? "select" : s.tool,
        sideTab: !isGm && (s.sideTab === "scenes" || s.sideTab === "players") ? "chat" : s.sideTab,
      };
    }),
  setConnected: (connected) => set({ connected })
});
