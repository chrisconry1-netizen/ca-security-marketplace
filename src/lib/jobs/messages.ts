/** Fixed catalogue. Query-string codes never render database or user text. */
export const JOB_MESSAGES: Record<string, string> = {
  invalid_input: "Check the form and try again.",
  address_not_allowed: "City and county are public. Do not put a street address there.",
  pay_required: "Add a minimum pay amount before publishing. Pay is what the employer entered.",
  location_required: "Add a California city or ZIP that we can place, or an approximate map point.",
  start_required: "This shift needs a start time before it can be published.",
  unknown_place: "That city or ZIP is not in the California place list, so distance was not applied.",
  origin_required: "Choose a city or ZIP before using a radius.",
  draft_saved: "Draft saved. It is not public until you publish it.",
  pending_review: "Saved for review. This organization is not verified, so the shift is not public yet.",
  published: "The shift is public.",
  applied: "Application submitted. The employer decides what happens next.",
  withdrawn: "Application withdrawn. You cannot submit another application for this same shift.",
  saved: "Shift saved.",
  unsaved: "Removed from saved shifts.",
  status_updated: "Application updated.",
  accepted: "You accepted the offer. The site address is now available on this shift.",
  declined: "You declined the offer.",
  already_applied: "You already have an application for this shift.",
  armed_blocked: "Armed shifts stay closed until a person has verified your CA Guard Registration and Exposed Firearm Permit, and neither is expired on the shift date.",
  credential_blocked: "This shift requires verified credentials you do not have yet. Unverified or expired credentials do not count.",
  job_filled: "This shift has no open spots left.",
  job_expired: "This shift is past its end or its application deadline.",
  job_closed: "This shift is not open for applications.",
  illegal_transition: "That status change is not allowed.",
  not_a_member: "Only a member of this organization can do that.",
  verify_email: "Verify your email before continuing.",
  workers_only: "Only worker accounts can apply.",
  inactive: "This account cannot do that.",
  job_locked: "Published shifts keep their requirements. Create a new draft to change them.",
  not_found: "That shift is not available.",
  generic: "Something went wrong. Please try again.",
  org_created: "Organization created. It stays unverified until a person reviews it. Publishing a shift before that keeps the shift in review.",
};

export function marketplaceErrorCode(message: string | undefined): string {
  const text = message ?? "";
  if (/already applied/i.test(text)) return "already_applied";
  if (/armed credential missing/i.test(text)) return "armed_blocked";
  if (/mandatory credential missing/i.test(text)) return "credential_blocked";
  if (/job is filled/i.test(text)) return "job_filled";
  if (/job has expired/i.test(text)) return "job_expired";
  if (/job is not open/i.test(text)) return "job_closed";
  if (/illegal application transition/i.test(text)) return "illegal_transition";
  if (/not a member/i.test(text)) return "not_a_member";
  if (/email not verified/i.test(text)) return "verify_email";
  if (/street address/i.test(text)) return "address_not_allowed";
  if (/pay required|invalid pay/i.test(text)) return "pay_required";
  if (/location required/i.test(text)) return "location_required";
  if (/start time required/i.test(text)) return "start_required";
  if (/job is locked/i.test(text)) return "job_locked";
  if (/worker profile required/i.test(text)) return "workers_only";
  if (/account not active/i.test(text)) return "inactive";
  if (/note too long|notes are too long|invalid title|invalid description|invalid organization|unknown credential|invalid headcount|invalid experience|end must be after start|site pin|approximate point|too many credentials|invalid postal|location is too long|invalid local time/i.test(text)) {
    return "invalid_input";
  }
  return "generic";
}
