import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffAvatar, sniffDocument } from "@/lib/storage/files";

async function bytesOf(file: File): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

export async function uploadAvatar(supabase: SupabaseClient, userId: string, file: File): Promise<string | null> {
  const bytes = await bytesOf(file);
  if (!bytes) return null;
  const sniffed = sniffAvatar(bytes);
  if (!sniffed) return null;
  const path = `${userId}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, bytes, { contentType: sniffed.mime, upsert: false });
  if (error) {
    console.error("storage.avatar_upload_failed", error.message);
    return null;
  }
  return path;
}

export async function uploadOrgLogo(supabase: SupabaseClient, organizationId: string, file: File): Promise<string | null> {
  const bytes = await bytesOf(file);
  if (!bytes) return null;
  const sniffed = sniffAvatar(bytes);
  if (!sniffed) return null;
  const path = `${organizationId}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await supabase.storage.from("org-logos").upload(path, bytes, { contentType: sniffed.mime, upsert: false });
  if (error) {
    console.error("storage.org_logo_upload_failed", error.message);
    return null;
  }
  return path;
}

export async function uploadCredentialDocument(supabase: SupabaseClient, userId: string, file: File): Promise<string | null> {
  const bytes = await bytesOf(file);
  if (!bytes) return null;
  const sniffed = sniffDocument(bytes);
  if (!sniffed) return null;
  const path = `${userId}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await supabase.storage.from("credential-documents").upload(path, bytes, {
    contentType: sniffed.mime,
    upsert: false,
  });
  if (error) {
    console.error("storage.credential_upload_failed", error.message);
    return null;
  }
  return path;
}
