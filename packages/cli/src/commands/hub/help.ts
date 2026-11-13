import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, PASEO_HUB_URL, active stored login, then https://hub.paseo.sh.\nHTTP is accepted for localhost, 127.0.0.1, and [::1]. Enable Allow HTTP in the host settings (hub.allowHttp) to use HTTP for other hosts.\nCredential precedence: --api-key, PASEO_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
