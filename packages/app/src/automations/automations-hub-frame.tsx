import { useMemo } from "react";
import { WebView } from "react-native-webview";
import { automationsHubUrl } from "./automations-view";

const webViewStyle = { flex: 1 } as const;

/**
 * Embedded Hub for native. Desktop uses the web frame so login stays in the page.
 *
 * @param origin - Connected Hub origin
 * @param onEnrollmentToken - Unused on native. Desktop enrolls from the web frame.
 * @returns The triggers page
 */
export function AutomationsHubFrame({
  origin,
}: {
  origin: string;
  onEnrollmentToken?: (token: string) => Promise<void>;
}) {
  const source = useMemo(() => ({ uri: automationsHubUrl(origin) }), [origin]);
  return (
    <WebView
      source={source}
      style={webViewStyle}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      testID="automations-webview"
    />
  );
}
