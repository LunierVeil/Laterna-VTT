import type { SessionSlice, SliceCreator } from "./model";
import { campaignDefaults, gameplayDefaults, interactionDefaults } from "./defaults";

/** Identity boundary: one atomic reset, with device preferences deliberately preserved. */
export const createSessionSlice: SliceCreator<SessionSlice> = (set) => ({
  me: null,
  isGm: false,
  connected: false,
  sessionEpoch: 0,

  // Не ГМ (вышел, вошёл игроком) - инструменты мастера недоступны.
  setMe: (me) =>
    set((s) => {
      const isGm = me?.is_gm ?? false;
      if (!me || s.me?.id !== me.id || s.me.is_gm !== me.is_gm) {
        return {
          ...campaignDefaults(), ...gameplayDefaults(), ...interactionDefaults(),
          me, isGm, connected: false, sessionEpoch: s.sessionEpoch + 1,
        };
      }
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
