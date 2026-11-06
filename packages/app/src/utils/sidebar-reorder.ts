export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}

/**
 * Writes the dragged keys back into the positions those keys already occupy.
 *
 * A host section only drags the workspaces (or projects) on that server. The
 * flat list uses {@link mergeWithRemainder}, which places the dragged keys
 * first and would slide every other server to the end. Keys that were not
 * dragged stay in their slots. Dragged keys that are not stored yet are
 * appended, in the new order.
 */
export function reorderVisibleSubset(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const placed = new Set<string>();
  const result: string[] = [];
  let nextVisible = 0;

  for (const key of input.currentOrder) {
    if (placed.has(key)) continue;
    if (!visibleSet.has(key)) {
      placed.add(key);
      result.push(key);
      continue;
    }

    const replacement = input.reorderedVisibleKeys[nextVisible];
    nextVisible += 1;
    if (!replacement || placed.has(replacement)) continue;
    placed.add(replacement);
    result.push(replacement);
  }

  for (const key of input.reorderedVisibleKeys) {
    if (placed.has(key)) continue;
    placed.add(key);
    result.push(key);
  }

  return result;
}

/**
 * Order to persist after a sidebar drag, or null when the visible sequence
 * did not change.
 *
 * `preserveOtherSlots` is for a drag inside one server. The flat list leaves
 * it off so rows hidden by a filter stay after the rows that were on screen.
 */
export function applyDraggedOrder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
  preserveOtherSlots: boolean;
}): string[] | null {
  if (
    !hasVisibleOrderChanged({
      currentOrder: input.currentOrder,
      reorderedVisibleKeys: input.reorderedVisibleKeys,
    })
  ) {
    return null;
  }

  return input.preserveOtherSlots ? reorderVisibleSubset(input) : mergeWithRemainder(input);
}
