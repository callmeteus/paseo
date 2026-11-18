import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const HOST_TAB_ORDER_STORAGE_KEY = "paseo:host-tab-order";

const HostTabOrderSchema = z.strictObject({
  order: z.array(z.string()),
});

interface HostTabOrderStoreState {
  order: string[];
  setOrder: (order: string[]) => void;
}

/** The order the user dragged the host tabs into. Empty means local-first registry order. */
export const useHostTabOrderStore = create<HostTabOrderStoreState>()(
  persist(
    (set) => ({
      order: [],
      setOrder: (order) => set({ order }),
    }),
    {
      name: HOST_TAB_ORDER_STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, HostTabOrderSchema),
      partialize: (state) => ({ order: state.order }),
    },
  ),
);
