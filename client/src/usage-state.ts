import { create } from "zustand";
import type { PlanUsage } from "@sdp/shared";
import { api } from "./api";

type UsageState = {
  /** Null until the first answer. */
  usage: PlanUsage | null;
  /** `fresh` skips the server's short cache, for right after Claude answers. */
  refresh(fresh?: boolean): Promise<void>;
};

export const useUsage = create<UsageState>((set) => ({
  usage: null,
  async refresh(fresh = false) {
    try {
      set({ usage: await api.usage(fresh) });
    } catch {
      // Keep the last numbers rather than hiding the panel over one failed request.
      set((s) => ({ usage: s.usage ?? { available: false } }));
    }
  },
}));
