import { describe, expect, it } from "vitest";
import {
  HubAutomationRequestError,
  listHubAutomations,
  saveHubAutomation,
  type HubAutomationAccess,
} from "./automation-client.js";

const access: HubAutomationAccess = {
  origin: "http://127.0.0.1:25000",
  daemonId: "daemon-1",
  credential: "secret",
};

describe("Hub automation client", () => {
  it("lists trigger documents with the daemon credential", async () => {
    let authorization = "";
    let daemonId = "";
    const documents = await listHubAutomations(access, async (input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      daemonId = new Headers(init?.headers).get("x-paseo-daemon-id") ?? "";
      expect(requestUrl(input)).toBe("http://127.0.0.1:25000/api/v1/triggers");
      return Response.json({
        triggers: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "channel",
            enabled: true,
            format: "single_run",
            yaml: "name: channel\n",
          },
        ],
      });
    });

    expect(authorization).toBe("Bearer secret");
    expect(daemonId).toBe("daemon-1");
    expect(documents).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "channel",
        enabled: true,
        format: "single_run",
        yaml: "name: channel\n",
      },
    ]);
  });

  it("saves a trigger and returns the active revision", async () => {
    const saved = await saveHubAutomation(access, "name: channel\n", async () =>
      Response.json(
        {
          triggerId: "11111111-1111-4111-8111-111111111111",
          name: "channel",
          revisionId: "22222222-2222-4222-8222-222222222222",
          version: 2,
          active: true,
        },
        { status: 201 },
      ),
    );

    expect(saved).toEqual({
      triggerId: "11111111-1111-4111-8111-111111111111",
      name: "channel",
      revisionId: "22222222-2222-4222-8222-222222222222",
      version: 2,
      active: true,
    });
  });

  it("surfaces Hub's refusal when the YAML is invalid", async () => {
    await expect(
      saveHubAutomation(access, "name:\n", async () =>
        Response.json(
          { title: "Invalid trigger", detail: "Correct the trigger YAML." },
          { status: 422 },
        ),
      ),
    ).rejects.toMatchObject({
      name: "HubAutomationRequestError",
      status: 422,
      message: "Correct the trigger YAML.",
    } satisfies Partial<HubAutomationRequestError>);
  });
});

/**
 * @param input - Fetch target the client built
 * @returns The URL string
 */
function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  return input;
}
