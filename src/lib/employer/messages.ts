/** Fixed catalogue. Database and query text are not rendered. */
export const EMPLOYER_MESSAGES: Record<string, string> = {
  invalid_input: "Check the form and try again.",
  not_allowed: "You cannot do that.",
  saved: "Saved.",
  created: "Organization created. It is unverified until a moderator records a decision.",
  submitted: "Submitted for verification. A person reviews it. The license number is not checked automatically.",
  reviewed: "Decision recorded.",
  review_failed: "Could not record that decision. A note is required, and you cannot review your own organization.",
  invited: "Invite created. Share the accept link. No email was sent.",
  revoked: "Invite revoked.",
  joined: "You joined the organization.",
  removed: "Member removed.",
  role_saved: "Role updated.",
  last_owner: "The organization needs at least one Owner/Admin.",
  license_required: "This organization type needs a license number before it can be submitted. GuardGig does not check it with BSIS.",
  email_required: "Add a contact email before submitting for verification.",
  already_member: "That person is already a member.",
  invite_email: "Sign in with the email address the invite was created for.",
  employer_required: "Accepting an invite requires an employer account.",
  invite_invalid: "That invite is expired, revoked, or no longer available.",
  job_saved: "Job saved as a draft.",
  job_pending: "The organization is not verified, so this job is pending review instead of published.",
  job_published: "Job published.",
  status_updated: "Application updated.",
  job_incomplete: "Add a public city, a pay rate, and the schedule this job type needs before publishing.",
  job_transition: "That status change is not available.",
  upload_failed: "That logo could not be saved. Use a JPG, PNG, or WebP under 2 MB.",
  generic: "Something went wrong. Please try again.",
};

export function employerErrorCode(message: string | undefined): string {
  const text = message ?? "";
  if (text.includes("last owner")) return "last_owner";
  if (text.includes("license number required")) return "license_required";
  if (text.includes("contact email required")) return "email_required";
  if (text.includes("already a member")) return "already_member";
  if (text.includes("invite email mismatch")) return "invite_email";
  if (text.includes("employer account required")) return "employer_required";
  if (text.includes("invite invalid")) return "invite_invalid";
  if (text.includes("job is incomplete")) return "job_incomplete";
  if (text.includes("illegal job transition") || text.includes("status is server-managed")) return "job_transition";
  if (text.includes("not permitted") || text.includes("not authenticated") || text.includes("account not active")) return "not_allowed";
  return "invalid_input";
}
