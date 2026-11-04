import { campaignDefaults } from "./defaults";
import type { CampaignSlice, SliceCreator } from "./model";

/** Existing campaign defaults/actions; cross-domain partial updates retain their original order. */
export const createCampaignSlice: SliceCreator<CampaignSlice> = (set) => ({
  ...campaignDefaults(),
  setCampaign: (activeSceneId, scenes, accounts, invites, folders) =>
    set(scenes ? { activeSceneId, scenes, accounts, invites: invites ?? [], folders: folders ?? [] } : { activeSceneId, accounts, scenes: [], folders: [] }),
  setUsers: (users) => set({ users }),
  setLastInvite: (lastInvite) => set({ lastInvite })
});
