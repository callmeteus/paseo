/**
 * Models a person turned off for one provider. The catalogue and
 * `isSelectable` stay as the CLI reported them; only a choice list drops the id.
 */

export type DisabledModelIdsByProvider = Readonly<Record<string, readonly string[]>>;

export function omitDisabledModels<T extends { id: string }>(
  models: readonly T[] | null,
  disabledIds: readonly string[] | null | undefined,
): T[] | null {
  if (!models) return null;
  if (!disabledIds || disabledIds.length === 0) return models.slice();
  const disabled = new Set(disabledIds);
  return models.filter((model) => !disabled.has(model.id));
}

/**
 * A catalogue refresh must not trim this list. An id the CLI stopped returning
 * stays disabled, and comes back disabled if the CLI lists it again.
 */
export function retainDisabledModelIds(
  disabledIds: readonly string[],
  catalogModelIds: readonly string[],
): string[] {
  // Membership in the catalogue is not a reason to drop or restore an id.
  void catalogModelIds;
  return [...disabledIds];
}

export function disabledModelIdsByProviderFromConfig(
  providers:
    | Readonly<Record<string, { disabledModelIds?: readonly string[] | undefined } | undefined>>
    | null
    | undefined,
): DisabledModelIdsByProvider {
  const result: Record<string, readonly string[]> = {};
  if (!providers) return result;
  for (const [providerId, provider] of Object.entries(providers)) {
    const ids = provider?.disabledModelIds;
    if (ids && ids.length > 0) result[providerId] = ids;
  }
  return result;
}
