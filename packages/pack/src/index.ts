// Vertical configuration: loads and validates a pack (labels, services,
// resources, intake, triage, retention, faq, brand) and applies a location's
// overrides. The checksum helper is server-only: import "@vetrix/pack/checksum".
export * from "./schema";
export * from "./validate";
export * from "./references";
export * from "./labels";
export * from "./render";
export * from "./forbidden";
export * from "./overrides";
export { getVeterinaryPack, veterinaryRawPack } from "./veterinary";
