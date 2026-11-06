import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface WorkspaceTabLineChrome {
  /** True when the workspace has a single main tab line, so that row owns the chrome. */
  soleMainRow: boolean;
  /** The pane whose tab line owns the chrome once the workspace is split. */
  chromePaneId: string | null;
  trailing: ReactNode;
}

const EMPTY_TAB_LINE_CHROME: WorkspaceTabLineChrome = {
  soleMainRow: false,
  chromePaneId: null,
  trailing: null,
};

const WorkspaceTabLineChromeContext = createContext<WorkspaceTabLineChrome>(EMPTY_TAB_LINE_CHROME);

export function WorkspaceTabLineChromeProvider({
  soleMainRow,
  chromePaneId,
  trailing,
  children,
}: WorkspaceTabLineChrome & { children: ReactNode }) {
  const value = useMemo(
    () => ({ soleMainRow, chromePaneId, trailing }),
    [chromePaneId, soleMainRow, trailing],
  );
  return (
    <WorkspaceTabLineChromeContext.Provider value={value}>
      {children}
    </WorkspaceTabLineChromeContext.Provider>
  );
}

export function useWorkspaceTabLineChrome(): WorkspaceTabLineChrome {
  return useContext(WorkspaceTabLineChromeContext);
}
