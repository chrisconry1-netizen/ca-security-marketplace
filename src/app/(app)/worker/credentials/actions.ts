"use server";

import { redirect } from "next/navigation";
import { emptyToNull, formString } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";
import { credentialSchema } from "@/lib/workers/validation";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";
import { uploadCredentialDocument } from "@/server/storage/uploads";

function back(path: string, code: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${code}`);
}

async function ownedCredential(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("credentials")
    .select("id, status, document_path, credential_type_id, credential_number, issuer, issued_on, expires_on")
    .eq("id", id)
    .maybeSingle();
  return { supabase, credential: data };
}

export async function saveCredential(fd: FormData) {
  const ctx = await requireArea("worker");
  const id = formString(fd, "credentialId");
  const parsed = credentialSchema.safeParse({
    credentialTypeId: formString(fd, "credentialTypeId"),
    credentialNumber: formString(fd, "credentialNumber"),
    issuer: formString(fd, "issuer"),
    issuedOn: formString(fd, "issuedOn"),
    expiresOn: formString(fd, "expiresOn"),
  });
  const failPath = id ? `/worker/credentials/${id}` : "/worker/credentials/new";
  if (!parsed.success) back(failPath, "invalid_input");

  const supabase = await createClient();
  const { data: typeRow } = await supabase
    .from("credential_types")
    .select("id, is_active")
    .eq("id", parsed.data!.credentialTypeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!typeRow) back(failPath, "invalid_input");

  const file = fd.get("document");
  let documentPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    documentPath = await uploadCredentialDocument(supabase, ctx.userId, file);
    if (!documentPath) back(failPath, "document_invalid");
  }

  const fields = {
    credential_number: emptyToNull(parsed.data!.credentialNumber),
    issuer: emptyToNull(parsed.data!.issuer),
    issued_on: parsed.data!.issuedOn || null,
    expires_on: parsed.data!.expiresOn || null,
  };

  if (!id) {
    const { data, error } = await supabase
      .from("credentials")
      .insert({
        worker_id: ctx.userId,
        credential_type_id: parsed.data!.credentialTypeId,
        document_path: documentPath,
        status: "unverified",
        ...fields,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("credential.insert_failed", error?.code);
      back(failPath, "generic");
    }
    redirect(`/worker/credentials/${data!.id}?notice=credential_saved`);
  }

  const { credential } = await ownedCredential(id);
  if (!credential) back(failPath, "not_found");
  if (credential!.status !== "unverified" && credential!.status !== "rejected") back(failPath, "credential_locked");
  const { error } = await supabase
    .from("credentials")
    .update({ ...fields, ...(documentPath ? { document_path: documentPath } : {}) })
    .eq("id", id);
  if (error) {
    console.error("credential.update_failed", error.code);
    back(failPath, error.code === "42501" ? "credential_locked" : "generic");
  }
  redirect(`/worker/credentials/${id}?notice=credential_saved`);
}

export async function submitCredential(fd: FormData) {
  await requireArea("worker");
  const id = formString(fd, "credentialId");
  if (!id) redirect("/worker/credentials?error=not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("submit_credential", {
    p_credential_id: id,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) {
    const document = /document required/i.test(error.message);
    redirect(`/worker/credentials/${id}?error=${document ? "document_required" : "not_submittable"}`);
  }
  redirect(`/worker/credentials/${id}?notice=credential_submitted`);
}

export async function deleteCredential(fd: FormData) {
  await requireArea("worker");
  const id = formString(fd, "credentialId");
  if (!id) redirect("/worker/credentials?error=not_found");
  const supabase = await createClient();
  const { data, error } = await supabase.from("credentials").delete().eq("id", id).select("id");
  if (error || !data?.length) redirect(`/worker/credentials/${id}?error=credential_locked`);
  redirect("/worker/credentials?notice=removed");
}
