// The veterinary pack bundled with the app. It is validated once, on first
// use; an invalid pack stops the app instead of booking with bad rules.
import brand from "../veterinary/brand.json";
import faq from "../veterinary/faq.json";
import intake from "../veterinary/intake.json";
import labels from "../veterinary/labels.json";
import manifest from "../veterinary/manifest.json";
import resources from "../veterinary/resources.json";
import retention from "../veterinary/retention.json";
import services from "../veterinary/services.json";
import triage from "../veterinary/triage.json";
import type { Pack } from "./schema";
import { validatePack, type RawPack } from "./validate";

export const veterinaryRawPack: RawPack = {
  manifest,
  labels,
  services,
  resources,
  intake,
  triage,
  retention,
  faq,
  brand,
};

let cached: Pack | undefined;

export function getVeterinaryPack(): Pack {
  cached ??= validatePack(veterinaryRawPack);
  return cached;
}
