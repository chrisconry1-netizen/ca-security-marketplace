import { ARMED_CREDENTIAL_CODES } from "./constants";

export interface HeldCredential {
  code: string;
  status: string;
  expiresOn: string | null;
}

/** Mirrors app.eligibility_block. SQL remains the enforcement point. */
export function applyBlockReason(input: {
  armed: boolean;
  mandatoryCodes: string[];
  credentials: HeldCredential[];
  shiftDate: string;
}): "armed_blocked" | "credential_blocked" | null {
  const held = new Set(
    input.credentials
      .filter((credential) => credential.status === "verified" && (credential.expiresOn == null || credential.expiresOn >= input.shiftDate))
      .map((credential) => credential.code),
  );
  if (input.armed && ARMED_CREDENTIAL_CODES.some((code) => !held.has(code))) return "armed_blocked";
  if (input.mandatoryCodes.some((code) => !held.has(code))) return "credential_blocked";
  return null;
}
