import { useCallback, useReducer, useRef } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";
import { reorderItemsOnDragEnd } from "./reorder-items";

export interface DragReorderHandlers {
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface DragReorderState<T> {
  activeId: string | null;
  items: T[];
  handlers: DragReorderHandlers;
}

export function useDragReorderState<T>({
  data,
  keyExtractor,
  onDragEnd,
  onDragBegin,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onDragEnd?: (items: T[]) => void;
  onDragBegin?: () => void;
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer, undefined, dragStateInitial);
  const sourceKey = dragSourceKey(data, keyExtractor);
  // A drag used to freeze the rendered rows on a snapshot taken at drag start.
  // The composer queue drains while that drag is still open — the message text
  // is the handle, and a drag that never receives drag-end kept showing messages
  // that had already been sent. A late drop would also write those rows back.
  const dragSourceKeyRef = useRef<string | null>(null);
  if (dragSourceKeyRef.current !== null && dragSourceKeyRef.current !== sourceKey) {
    dragSourceKeyRef.current = null;
    if (state.activeId !== null) {
      dispatch({ type: "clear" });
    }
  }

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      dragSourceKeyRef.current = sourceKey;
      dispatch({ type: "start", id: String(event.active.id) });
      onDragBegin?.();
    },
    [disabled, onDragBegin, sourceKey],
  );

  const clearDragState = useCallback(() => {
    dragSourceKeyRef.current = null;
    dispatch({ type: "clear" });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const startedOnCurrentRows = dragSourceKeyRef.current === sourceKey;
      dragSourceKeyRef.current = null;
      dispatch({ type: "clear" });
      if (disabled || !startedOnCurrentRows) return;

      const reordered = reorderItemsOnDragEnd({
        items: data,
        activeId: String(active.id),
        overId: over ? String(over.id) : null,
        keyExtractor,
      });
      if (reordered) onDragEnd?.(reordered);
    },
    [data, disabled, keyExtractor, onDragEnd, sourceKey],
  );

  return {
    activeId: state.activeId,
    items: data,
    handlers: {
      onDragStart: handleDragStart,
      onDragCancel: clearDragState,
      onDragEnd: handleDragEnd,
    },
  };
}

function dragSourceKey<T>(
  data: readonly T[],
  keyExtractor: (item: T, index: number) => string,
): string {
  return data.map((item, index) => keyExtractor(item, index)).join("\0");
}
