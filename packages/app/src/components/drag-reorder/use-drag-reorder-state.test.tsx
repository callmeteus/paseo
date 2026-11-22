// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";
import { useDragReorderState } from "./use-drag-reorder-state";

interface Row {
  id: string;
}

const rows: Row[] = [{ id: "one" }, { id: "two" }, { id: "three" }];

function keyExtractor(item: Row): string {
  return item.id;
}

function dragStart(id: string): DragStartEvent {
  return { active: { id } } as DragStartEvent;
}

function dragEnd(activeId: string, overId: string): DragEndEvent {
  return { active: { id: activeId }, over: { id: overId } } as DragEndEvent;
}

describe("useDragReorderState", () => {
  it("removes a row that left the list while a drag was still open", () => {
    const onDragEnd = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useDragReorderState({ data, keyExtractor, onDragEnd }),
      { initialProps: { data: rows } },
    );

    act(() => {
      result.current.handlers.onDragStart(dragStart("three"));
    });

    const remaining = [rows[0], rows[1]];
    rerender({ data: remaining });

    expect(result.current.items.map((item) => item.id)).toEqual(["one", "two"]);
    expect(result.current.activeId).toBeNull();

    act(() => {
      result.current.handlers.onDragEnd(dragEnd("three", "one"));
    });

    expect(onDragEnd).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("reorders the current rows when the drag ends on the same list", () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() =>
      useDragReorderState({ data: rows, keyExtractor, onDragEnd }),
    );

    act(() => {
      result.current.handlers.onDragStart(dragStart("one"));
      result.current.handlers.onDragEnd(dragEnd("one", "three"));
    });

    expect(onDragEnd).toHaveBeenCalledWith([rows[1], rows[2], rows[0]], "one");
  });
});
