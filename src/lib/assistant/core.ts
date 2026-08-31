import { z } from "zod";
import {
  brochureRequestSchema,
  type Brand,
  type BrochureRequest,
  type Options,
} from "../types";

/**
 * Shared, model-agnostic logic for the in-browser AI assistant.
 *
 * The assistant only ever produces a lightweight *draft* — plain text fields,
 * no images, no brand colours. `draftToBrochureRequest` folds that draft onto a
 * real brand + options object so the rest of the app (preview, /api/generate)
 * is unchanged. Inference itself lives in `assistant/engine.ts` (client-only).
 */

/* ----------------------------- Draft schema ----------------------------- */

const featureSchema = z.object({
  label: z.string().max(40),
  value: z.string().max(40),
});

const draftListingSchema = z.object({
  title: z.string().max(120),
  subtitle: z.string().max(160).optional(),
  price: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  propertyType: z.string().max(40).optional(),
  features: z.array(featureSchema).max(8).optional(),
  highlights: z.array(z.string().max(120)).max(10).optional(),
  pages: z
    .array(
      z.object({
        heading: z.string().max(120).optional(),
        body: z.string().max(3000).optional(),
      }),
    )
    .max(6)
    .optional(),
});

export const assistantDraftSchema = z.object({
  companyName: z.string().max(80).optional(),
  coverTitle: z.string().max(120).optional(),
  coverSubtitle: z.string().max(160).optional(),
  template: z.enum(["editorial", "classic", "bold"]).optional(),
  pageSize: z.enum(["A4", "Letter"]).optional(),
  listings: z.array(draftListingSchema).min(1).max(10),
});

export type AssistantDraft = z.infer<typeof assistantDraftSchema>;
export type DraftListing = z.infer<typeof draftListingSchema>;

/* ------------------------------ Prompting ------------------------------ */

export const ASSISTANT_SYSTEM_PROMPT = `Turn the property description into ONE JSON object, nothing else. Format:
{"listings":[{"title":"short headline","subtitle":"area","price":"as written","propertyType":"Villa/Apartment/Land","features":[{"label":"Bedrooms","value":"4"},{"label":"Area","value":"320 m2"}],"highlights":["selling point"],"pages":[{"heading":"Overview","body":"2-3 appealing true sentences"}]}]}
Rules: one listing per property. Omit any field you have no value for. Never invent prices/sizes/amenities not stated. Keep strings short.`;

export function buildAssistantMessages(userText: string) {
  return [
    { role: "system" as const, content: ASSISTANT_SYSTEM_PROMPT },
    { role: "user" as const, content: userText.trim().slice(0, 8000) },
  ];
}

/**
 * Parse a model reply into a validated draft. Without grammar-constrained
 * decoding the model can be a little sloppy, so this repairs common shape
 * mistakes (draft not wrapped in `listings`, a bare object, stray text) before
 * validating.
 */
export function parseAssistantReply(raw: string): AssistantDraft {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("The assistant didn't return usable JSON — try rephrasing, or the Fastest model.");
  }

  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;

  // Accept a few shapes: {listings:[…]}, a bare listing object, or {property:{…}}.
  let listings: unknown =
    obj.listings ?? obj.properties ?? (obj.title || obj.propertyType ? [obj] : obj.property ? [obj.property] : []);
  if (!Array.isArray(listings)) listings = [listings];

  const candidate = {
    companyName: str(obj.companyName),
    coverTitle: str(obj.coverTitle ?? obj.title),
    coverSubtitle: str(obj.coverSubtitle),
    template: ["editorial", "classic", "bold"].includes(str(obj.template))
      ? (obj.template as string)
      : undefined,
    pageSize: str(obj.pageSize) === "Letter" ? "Letter" : undefined,
    listings: (listings as unknown[])
      .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
      .filter((l) => str(l.title) || str(l.propertyType) || str(l.subtitle))
      .map((l) => ({
        title: str(l.title) || str(l.name) || str(l.headline) || "Property",
        subtitle: str(l.subtitle) || undefined,
        price: str(l.price) || undefined,
        address: str(l.address) || undefined,
        propertyType: str(l.propertyType) || str(l.type) || undefined,
        features: Array.isArray(l.features)
          ? (l.features as unknown[])
              .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
              .filter((f) => str(f.label) && str(f.value))
              .map((f) => ({ label: str(f.label), value: str(f.value) }))
          : undefined,
        highlights: Array.isArray(l.highlights)
          ? (l.highlights as unknown[]).map(str).filter(Boolean)
          : undefined,
        pages: Array.isArray(l.pages)
          ? (l.pages as unknown[])
              .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
              .map((p) => ({ heading: str(p.heading) || undefined, body: str(p.body) || undefined }))
          : undefined,
      })),
  };

  const parsed = assistantDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("Couldn't turn that into a brochure draft — try rephrasing your description.");
  }
  return parsed.data;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

/* --------------------------- Draft → request --------------------------- */

/**
 * Fold a draft onto a concrete brand + options object to get a request the
 * PDF generator accepts. Brand identity (colours, logo, contact details) always
 * comes from `brand` — the model never touches it.
 */
export function draftToBrochureRequest(
  draft: AssistantDraft,
  brand: Brand,
  options: Options,
): BrochureRequest {
  const mergedBrand: Brand = {
    ...brand,
    companyName: (brand.companyName || draft.companyName || "").trim() || "My Company",
  };

  const candidate = {
    brand: mergedBrand,
    cover: {
      title: (draft.coverTitle || "").trim(),
      subtitle: (draft.coverSubtitle || "").trim(),
    },
    listings: draft.listings.map((l) => ({
      title: (l.title || "Property").trim() || "Property",
      subtitle: (l.subtitle || "").trim(),
      price: (l.price || "").trim(),
      address: (l.address || "").trim(),
      propertyType: (l.propertyType || "").trim(),
      features: (l.features ?? [])
        .filter((f) => f.label?.trim() && f.value?.trim())
        .map((f) => ({ label: f.label.trim(), value: f.value.trim() })),
      highlights: (l.highlights ?? []).map((h) => h.trim()).filter(Boolean),
      pages: draftPages(l),
    })),
    options: {
      ...options,
      template: draft.template ?? options.template,
      pageSize: draft.pageSize ?? options.pageSize,
    },
  };

  return brochureRequestSchema.parse(candidate);
}

function draftPages(l: DraftListing): { heading: string; body: string; photos: [] }[] {
  const pages = (l.pages ?? [])
    .map((p) => ({
      heading: (p.heading || "").trim(),
      body: (p.body || "").trim(),
      photos: [] as [],
    }))
    .filter((p) => p.heading || p.body);
  if (pages.length) return pages;
  return [{ heading: "Overview", body: (l.subtitle || l.title || "").trim(), photos: [] }];
}
