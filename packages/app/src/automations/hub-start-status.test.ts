import { expect, test } from "vitest";
import {
  HUB_START_SLOWER_THAN_EXPECTED_MS,
  HUB_START_STILL_INITIALIZING_MS,
  HUB_START_STILL_TRYING_MS,
  hubStartStatusId,
} from "./hub-start-status";

test("hub start copy stays on the short label until the wait stretches", () => {
  expect(hubStartStatusId(0)).toBe("starting");
  expect(hubStartStatusId(HUB_START_STILL_INITIALIZING_MS - 1)).toBe("starting");
  expect(hubStartStatusId(HUB_START_STILL_INITIALIZING_MS)).toBe("stillStarting");
  expect(hubStartStatusId(HUB_START_SLOWER_THAN_EXPECTED_MS)).toBe("slowerThanExpected");
  expect(hubStartStatusId(HUB_START_STILL_TRYING_MS)).toBe("stillTrying");
});
