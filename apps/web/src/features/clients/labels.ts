// Plain labels for stored values. Keep wording in one place.
import type { ClientFlag, Species, TemperamentFlag } from "@vetrix/domain";

export const CLIENT_FLAG_LABEL: Record<ClientFlag, string> = {
  vip: "VIP",
  payment_issue: "Payment issue",
  difficult: "Needs extra care",
  do_not_contact: "Do not contact",
  do_not_call: "Do not call",
};

export const SPECIES_LABEL: Record<Species, string> = {
  dog: "Dog",
  cat: "Cat",
  rabbit: "Rabbit",
  bird: "Bird",
  reptile: "Reptile",
  other: "Other",
};

export const TEMPERAMENT_LABEL: Record<TemperamentFlag, string> = {
  anxious: "Anxious",
  aggressive: "Can be aggressive",
  needs_muzzle: "Needs a muzzle",
  cat_carrier_required: "Cat carrier required",
  fear_free: "Fear Free handling",
};

export const CHANNEL_LABEL = { sms: "Text message", email: "Email", call: "Phone call" } as const;
