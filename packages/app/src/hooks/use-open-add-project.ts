import { useCallback } from "react";
import { useActiveHostServerId } from "@/hooks/use-active-host-server-id";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";

export function useOpenAddProject(): (preferredHostId?: string) => void {
  const open = useAddProjectFlowStore((state) => state.open);
  const activeHostServerId = useActiveHostServerId();

  return useCallback(
    (preferredHostId?: string) => {
      // An explicit host (for example the one selected on /new) always wins.
      // Otherwise reuse the host the user is already looking at so the flow
      // skips the host chooser when it would be redundant.
      open(preferredHostId || activeHostServerId || undefined);
    },
    [open, activeHostServerId],
  );
}
