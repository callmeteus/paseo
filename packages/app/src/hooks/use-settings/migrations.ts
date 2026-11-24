import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import { DEFAULT_UI_FONT_FAMILY } from "@/appearance/font-families";
import type { AppSettings, KeyValueStorage, PersistedAppSettings } from "./storage";

const AppliedMigrationsSchema = z.strictObject({ applied: z.array(z.string()) });

/**
 * `sendBehavior` defaulted to "interrupt" for the months before steering existed, and defaults
 * are materialized into storage on first load, so a stored "interrupt" cannot be told apart from
 * a deliberate one. This flips every stored "interrupt" to "steer" exactly once; picking
 * "interrupt" afterwards sticks.
 */
const STEER_DEFAULT_MIGRATION = "steer-default";

/** Existing mobile installs materialized the old 15px content default in storage. */
const MOBILE_CONTENT_16_MIGRATION = "mobile-content-16";

/**
 * The interface font used to default to the platform stack, stored as "".
 * Allo is the product default now. This rewrites a stored "" once; choosing
 * System afterwards stores "" and sticks.
 */
const ALLO_UI_FONT_MIGRATION = "allo-ui-font";

/**
 * Usage was briefly opt-in and a stored `visible: false` was materialized on those installs.
 * Usage is visible by default again; dropping the entry lets the new default apply.
 */
const USAGE_SIDEBAR_VISIBLE_MIGRATION = "usage-sidebar-visible";

/**
 * The first usage migration dropped `visible: false` from memory but `patchStoredSettings`
 * did not write `sidebarFooterItems` back, so the old entry returned on the next launch.
 * Re-run the same cleanup and persist it. Affected installs already carry the first marker,
 * which is why this needs its own id.
 */
const USAGE_SIDEBAR_VISIBLE_PERSIST_MIGRATION = "usage-sidebar-visible-persist";

/**
 * Brings stored settings up to date, returning what the caller should use. Owns both writes so
 * the marker can only ever be written after the settings it describes: a failed marker write
 * leaves the migration to re-run harmlessly, while a failed settings write must leave the marker
 * unwritten or the migration is lost for good.
 */
export async function migrateAppSettings(
  settings: AppSettings,
  storage: KeyValueStorage,
  stored?: PersistedAppSettings,
  options: { native?: boolean } = {},
): Promise<AppSettings> {
  const migrationMarker = await readValidatedJson(
    storage,
    SETTINGS_MIGRATIONS_KEY,
    AppliedMigrationsSchema,
  );
  const applied = new Set(migrationMarker?.applied ?? []);
  let addedMigration = false;

  let migrated = settings;
  if (!applied.has(STEER_DEFAULT_MIGRATION)) {
    migrated =
      migrated.sendBehavior === "interrupt" ? { ...migrated, sendBehavior: "steer" } : migrated;
    applied.add(STEER_DEFAULT_MIGRATION);
    addedMigration = true;
  }

  if (!applied.has(ALLO_UI_FONT_MIGRATION)) {
    migrated =
      migrated.uiFontFamily === ""
        ? { ...migrated, uiFontFamily: DEFAULT_UI_FONT_FAMILY }
        : migrated;
    applied.add(ALLO_UI_FONT_MIGRATION);
    addedMigration = true;
  }

  if (!applied.has(USAGE_SIDEBAR_VISIBLE_MIGRATION)) {
    if (migrated.sidebarFooterItems.some((item) => item.key === "usage")) {
      migrated = {
        ...migrated,
        sidebarFooterItems: migrated.sidebarFooterItems.filter((item) => item.key !== "usage"),
      };
    }
    applied.add(USAGE_SIDEBAR_VISIBLE_MIGRATION);
    addedMigration = true;
  }

  if (!applied.has(USAGE_SIDEBAR_VISIBLE_PERSIST_MIGRATION)) {
    if (migrated.sidebarFooterItems.some((item) => item.key === "usage")) {
      migrated = {
        ...migrated,
        sidebarFooterItems: migrated.sidebarFooterItems.filter((item) => item.key !== "usage"),
      };
    }
    applied.add(USAGE_SIDEBAR_VISIBLE_PERSIST_MIGRATION);
    addedMigration = true;
  }

  if (options.native && !applied.has(MOBILE_CONTENT_16_MIGRATION)) {
    migrated = migrated.contentFontSize === 15 ? { ...migrated, contentFontSize: 16 } : migrated;
    applied.add(MOBILE_CONTENT_16_MIGRATION);
    addedMigration = true;
  }

  if (!addedMigration) {
    return settings;
  }

  if (migrated !== settings) {
    const patched = await patchStoredSettings(storage, stored, settings, migrated);
    await storage.setItem(APP_SETTINGS_KEY, JSON.stringify(patched));
  }

  await storage.setItem(SETTINGS_MIGRATIONS_KEY, JSON.stringify({ applied: [...applied] }));
  return migrated;
}

async function patchStoredSettings(
  storage: KeyValueStorage,
  stored: PersistedAppSettings | undefined,
  previous: AppSettings,
  migrated: AppSettings,
): Promise<Record<string, unknown>> {
  const rawText = await storage.getItem(APP_SETTINGS_KEY);
  const raw: unknown = rawText ? JSON.parse(rawText) : null;
  const base: Record<string, unknown> =
    raw !== null && typeof raw === "object" ? { ...raw } : { ...stored };
  if (migrated.sendBehavior !== previous.sendBehavior) {
    base.sendBehavior = migrated.sendBehavior;
  }
  if (migrated.uiFontFamily !== previous.uiFontFamily) {
    base.uiFontFamily = migrated.uiFontFamily;
  }
  if (migrated.contentFontSize !== previous.contentFontSize) {
    base.contentFontSize = migrated.contentFontSize;
  }
  if (migrated.sidebarFooterItems !== previous.sidebarFooterItems) {
    base.sidebarFooterItems = migrated.sidebarFooterItems;
  }
  return base;
}
