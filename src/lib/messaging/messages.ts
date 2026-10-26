/** Fixed catalogue. Query-string codes never render database or user text. */
export const MESSAGING_MESSAGES: Record<string, string> = {
  invalid_input: "Check the message and try again.",
  not_permitted: "You cannot do that.",
  not_found: "That conversation is not available.",
  no_relationship: "Messaging is available after an application, an assignment, or when the organization reaches a worker who opted in to search.",
  blocked: "Messaging is blocked between these accounts.",
  inactive: "This account cannot send messages.",
  rate_limit: "You are sending messages too quickly. Wait and try again.",
  conversation_limit: "You have started too many conversations today.",
  outreach_limit: "This organization has reached today's limit for new outreach.",
  job_unavailable: "That shift cannot be shared in this conversation.",
  attachment_invalid: "That file cannot be attached. Use a PDF, JPEG, PNG, or WebP under 10 MB.",
  reported: "Report received. A person reviews reports. Nothing is removed automatically.",
  archived: "Conversation archived on your account.",
  unarchived: "Conversation returned to your inbox.",
  blocked_user: "You blocked this person. You can still read the thread.",
  unblocked_user: "Block removed.",
  generic: "Something went wrong. Please try again.",
};

export function messagingErrorCode(message: string | undefined): string {
  const text = message ?? "";
  if (/message rate limit/i.test(text)) return "rate_limit";
  if (/outreach rate limit/i.test(text)) return "outreach_limit";
  if (/conversation rate limit/i.test(text)) return "conversation_limit";
  if (/job not shareable/i.test(text)) return "job_unavailable";
  if (/attachment invalid/i.test(text)) return "attachment_invalid";
  if (/no relationship/i.test(text)) return "no_relationship";
  if (/account not active/i.test(text)) return "inactive";
  if (/\bblocked\b/i.test(text)) return "blocked";
  if (/not found/i.test(text)) return "not_found";
  if (/invalid input|messages are immutable|membership is immutable/i.test(text)) return "invalid_input";
  if (/not permitted|not authenticated/i.test(text)) return "not_permitted";
  return "generic";
}
