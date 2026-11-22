import { useCallback, useMemo, useReducer, useRef } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { dragStateInitial, dragStateReducer, type DroppedOrder } from "./drag-reducer";
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

/**
 * The owner's rows in the dropped order, or null once the owner's own order has changed since
 * the drop.
 */
function arrangeAsDropped<T>(
  data: T[],
  keys: string[],
  { order, replaces }: DroppedOrder,
): T[] | null {
  const ownerOrderUnchanged =
    keys.length === replaces.length && keys.every((key, index) => key === replaces[index]);
  if (!ownerOrderUnchanged) return null;

  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const arranged: T[] = [];
  for (const key of order) {
    const index = indexByKey.get(key);
    if (index !== undefined) arranged.push(data[index]);
  }
  return arranged.length === data.length ? arranged : null;
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
  onDragEnd?: (items: T[], movedKey: string) => void;
  onDragBegin?: () => void;
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer<T>, undefined, dragStateInitial<T>);
  const sourceKey = dragSourceKey(data, keyExtractor);
  // A drag that outlives a change to its rows must not write the stale order back. The composer
  // queue drains while a message is being dragged: the message text is the handle, so once a
  // queued message is sent the rows are no longer the ones the drag started on. Clear the drag
  // state in that case so the current rows render and a late drop is ignored.
  const dragSourceKeyRef = useRef<string | null>(null);
  if (dragSourceKeyRef.current !== null && dragSourceKeyRef.current !== sourceKey) {
    dragSourceKeyRef.current = null;
    if (state.activeId !== null) {
      dispatch({ type: "clear" });
    }
  }

  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor]);
  const held = useMemo(
    () => (state.dropped ? arrangeAsDropped(data, keys, state.dropped) : null),
    [data, keys, state.dropped],
  );
  // The owner's order changed, so the dropped order has nothing left to stand in for.
  if (state.dropped && !held) dispatch({ type: "clear" });
  const items = state.dragItems ?? held ?? data;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      dragSourceKeyRef.current = sourceKey;
      dispatch({ type: "start", id: String(event.active.id), items });
      onDragBegin?.();
    },
    [disabled, items, onDragBegin, sourceKey],
  );

  const clearDragState = useCallback(() => {
    dragSourceKeyRef.current = null;
    dispatch({ type: "clear" });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const startedOnCurrentRows = dragSourceKeyRef.current === sourceKey;
      dragSourceKeyRef.current = null;
      const reordered =
        disabled || !startedOnCurrentRows
          ? null
          : reorderItemsOnDragEnd({
              items,
              activeId,
              overId: over ? String(over.id) : null,
              keyExtractor,
            });
      if (!reordered) {
        dispatch({ type: "clear" });
        return;
      }
      // The owner's new order can arrive in a later render. Hold the dropped order until it does.
      dispatch({ type: "drop", dropped: { order: reordered.map(keyExtractor), replaces: keys } });
      onDragEnd?.(reordered, activeId);
    },
    [disabled, items, keyExtractor, keys, onDragEnd, sourceKey],
  );

  return {
    activeId: state.activeId,
    items,
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
