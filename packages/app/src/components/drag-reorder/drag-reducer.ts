export interface DragState {
  activeId: string | null;
}

export type DragAction = { type: "start"; id: string } | { type: "clear" };

export function dragStateInitial(): DragState {
  return { activeId: null };
}

export function dragStateReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "start":
      return { activeId: action.id };
    case "clear":
      return { activeId: null };
  }
}
