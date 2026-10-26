import "server-only";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import { createAdminClient } from "@/server/privileged/admin-client";

const CREDENTIAL_TTL_SECONDS = 60;
const AVATAR_TTL_SECONDS = 300;

async function signAsUser(bucket: "avatars" | "credential-documents", path: string, ttl: number): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function signOwnAvatar(path: string | null | undefined, ownerId: string): Promise<string | null> {
  if (!path?.startsWith(`${ownerId}/`)) return null;
  return signAsUser("avatars", path, AVATAR_TTL_SECONDS);
}

export async function signOwnCredentialDocument(path: string | null | undefined, ownerId: string, credentialId: string): Promise<string | null> {
  if (!path?.startsWith(`${ownerId}/`)) return null;
  const url = await signAsUser("credential-documents", path, CREDENTIAL_TTL_SECONDS);
  if (!url) return null;
  await audit({
    actorType: "user",
    actorId: ownerId,
    action: "credential.document_url_issued",
    entityType: "credential",
    entityId: credentialId,
    after: { ttl_seconds: CREDENTIAL_TTL_SECONDS },
  });
  return url;
}

/** Staff review only. service_role signs after an authorization check. The URL is not audited. */
export async function signCredentialDocumentForReview(credentialId: string): Promise<string | null> {
  const ctx = await requireRole(STAFF_ROLES, "/admin/verification");
  const supabase = await createClient();
  const { data: cred } = await supabase.from("credentials").select("id, document_path, worker_id").eq("id", credentialId).maybeSingle();
  if (!cred?.document_path || !String(cred.document_path).startsWith(`${cred.worker_id}/`)) return null;
  const { data, error } = await createAdminClient().storage.from("credential-documents").createSignedUrl(cred.document_path, CREDENTIAL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  await audit({
    actorType: "admin",
    actorId: ctx.userId,
    action: "credential.document_url_issued",
    entityType: "credential",
    entityId: cred.id,
    after: { ttl_seconds: CREDENTIAL_TTL_SECONDS, audience: "staff" },
  });
  return data.signedUrl;
}
