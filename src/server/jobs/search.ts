import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/jobs/constants";
import { asNumber } from "@/lib/jobs/present";
import { parseJobSearch, searchQuery, toSearchRpc, type JobSearchInput } from "@/lib/jobs/search-params";
import { createClient } from "@/lib/supabase/server";

export interface MarketplaceJob {
  id: string;
  title: string;
  summary: string;
  job_type: string;
  category: string;
  is_armed: boolean;
  urgency: string;
  city: string | null;
  county: string | null;
  postal_code: string | null;
  shift_period: string | null;
  starts_at: string | null;
  ends_at: string | null;
  pay_type: string;
  pay_min_cents: number | null;
  pay_max_cents: number | null;
  workers_needed: number;
  min_years_experience: number | null;
  vehicle_required: boolean;
  organization_id: string;
  employer_name: string | null;
  employer_verified: boolean;
  distance_miles: number | null;
}

export async function loadMarketplace(sp: Record<string, string | string[] | undefined>, basePath: string) {
  const input = parseJobSearch(sp);
  const supabase = await createClient();
  const origin = await resolveOrigin(supabase, input);
  const { args, ignoredRadius } = toSearchRpc(input, origin?.point ?? null);
  const { data, error } = await supabase.rpc("search_jobs", args);
  if (error) console.error("jobs.search_failed", error.code);
  const rows = ((data ?? []) as MarketplaceJob[]).map((row) => ({
    ...row,
    pay_min_cents: asNumber(row.pay_min_cents),
    pay_max_cents: asNumber(row.pay_max_cents),
    distance_miles: asNumber(row.distance_miles),
    workers_needed: asNumber(row.workers_needed) ?? 1,
    min_years_experience: asNumber(row.min_years_experience),
    employer_verified: Boolean(row.employer_verified),
  }));
  const total = data && data.length ? Number((data[0] as { total_count?: number | string }).total_count ?? rows.length) : 0;
  return {
    input,
    rows,
    total: Number.isFinite(total) ? total : 0,
    pageSize: PAGE_SIZE,
    basePath,
    query: searchQuery(input),
    notice: !origin && input.near ? "unknown_place" : ignoredRadius ? "origin_required" : null,
    originLabel: origin?.label ?? null,
  };
}

async function resolveOrigin(supabase: SupabaseClient, input: JobSearchInput): Promise<{ point: { lat: number; lng: number }; label: string } | null> {
  const near = input.near.trim();
  if (!near) return null;
  if (/^\d{5}$/.test(near)) {
    const { data } = await supabase.from("place_centroids").select("lat, lng, label").eq("postal_code", near).maybeSingle();
    if (!data) return null;
    return { point: { lat: Number(data.lat), lng: Number(data.lng) }, label: data.label };
  }
  const { data } = await supabase.from("place_centroids").select("lat, lng, label, county").ilike("city", near).is("postal_code", null).limit(10);
  const rows = data ?? [];
  if (!rows.length) return null;
  const match = input.county ? rows.find((row) => row.county?.toLowerCase() === input.county.toLowerCase()) ?? rows[0] : rows[0];
  return { point: { lat: Number(match.lat), lng: Number(match.lng) }, label: match.label };
}
