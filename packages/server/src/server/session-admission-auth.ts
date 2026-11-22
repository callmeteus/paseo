import { compare } from "bcryptjs";
import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import type { ApiTokenVerifier } from "./auth.js";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { matchesLocalCredential } from "./local-credential.js";
import type { SessionAdmission } from "./websocket-server.js";

export type AdmissionFailure = "password_required" | "incorrect_password";

type AdmissionResolution = { admission: SessionAdmission } | { rejection: AdmissionFailure };

const OWNER_ADMISSION: SessionAdmission = { principalId: "owner", permissions: OWNER_PERMISSIONS };

export async function resolveSessionAdmission(input: {
  credential: WSHelloMessage["auth"];
  passwordHash: string | undefined;
  localCredential: string | null;
  apiTokenVerifier?: ApiTokenVerifier;
}): Promise<AdmissionResolution> {
  const { credential, passwordHash, localCredential, apiTokenVerifier } = input;
  if (!passwordHash && !apiTokenVerifier?.hasTokens()) {
    return { admission: OWNER_ADMISSION };
  }
  if (!credential) {
    return { rejection: "password_required" };
  }
  if (credential.kind === "localCredential") {
    if (localCredential && matchesLocalCredential(localCredential, credential.token)) {
      return { admission: OWNER_ADMISSION };
    }
    return { rejection: "incorrect_password" };
  }
  if (apiTokenVerifier && (await apiTokenVerifier.verify(credential.password))) {
    return { admission: OWNER_ADMISSION };
  }
  if (passwordHash && (await compare(credential.password, passwordHash))) {
    return { admission: OWNER_ADMISSION };
  }
  return { rejection: "incorrect_password" };
}
