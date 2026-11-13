// Replies to the texts Vetrix sends (pack retention.json inbound_reply_handling).
// A one-word keyword acts directly (C, R, REFILL, YES, HELP); a death or a
// worry after surgery is caught by meaning; anything else goes to the AI
// front desk as a normal conversation. STOP and START are handled before this.
import { normalizeUtterance } from "./triage";

export type ReplyIntent =
  | "confirm"
  | "reschedule"
  | "refill"
  | "fasting_confirmed"
  | "help"
  | "deceased"
  | "moved"
  | "post_op_concern"
  | "conversation";

export interface ReplyRules {
  deceased_phrases: string[];
  moved_phrases: string[];
  concern_phrases_on_post_op: string[];
}

const word = (text: string) => normalizeUtterance(text).trim();

/**
 * What a reply means, given the last text we sent this client (its template).
 * Keywords only count as the whole reply ("C", "c.", "Yes!"), so a sentence
 * that happens to contain "c" is a conversation.
 */
export function classifyReply(text: string, lastTemplate: string | null, rules: ReplyRules): ReplyIntent {
  const w = word(text);
  const has = (phrases: string[]) => phrases.some((p) => ` ${w} `.includes(` ${normalizeUtterance(p).trim()} `));
  if (w === "help" || w === "info") return "help";
  if (w === "c" || w === "confirm" || w === "confirmed") return "confirm";
  if (w === "r" || w === "reschedule") return "reschedule";
  if (w === "refill" || w === "refill please") return "refill";
  if (lastTemplate === "fasting_check_evening" && /^(yes|y|yep|yeah|ok|okay|will do|got it|confirmed)$/.test(w)) return "fasting_confirmed";
  // Past tense only: "we had him put down last week" is a death, not a request.
  if (has(rules.deceased_phrases.filter((p) => !/^put /.test(p))) || /\b(was|had (?:him|her)|got (?:him|her)) put (?:down|to sleep)\b/.test(w)) return "deceased";
  if (has(rules.moved_phrases) && /\b(moved|new vet|another vet|somewhere else|switched)\b/.test(w)) return "moved";
  if (lastTemplate === "post_op_day1" && has(rules.concern_phrases_on_post_op)) return "post_op_concern";
  return "conversation";
}
