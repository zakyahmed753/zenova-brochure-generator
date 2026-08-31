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

/** JSON Schema string handed to WebLLM for grammar-constrained decoding. */
export const ASSISTANT_JSON_SCHEMA: string = JSON.stringify(
  z.toJSONSchema(assistantDraftSchema, { target: "draft-2020-12" }),
);

/* ------------------------------ Prompting ------------------------------ */

export const ASSISTANT_SYSTEM_PROMPT = `You turn a real-estate agent's free-text description into a structured brochure draft.

Rules:
- Output JSON only, matching the provided schema. No prose, no markdown.
- "listings" must have at least one entry. Split the text into one listing per distinct property.
- Every listing needs a short marketing "title". Use "propertyType" for the kind of property (Villa, Apartment, Land, Office...).
- Put concrete numbers in "features" as {label, value} pairs, e.g. {"label":"Bedrooms","value":"4"}, {"label":"Area","value":"320 m²"}.
- "highlights" are short selling-point phrases (3-8 words each).
- "pages": usually one page with heading "Overview" and a "body" of 2-4 sentences of appealing but truthful copy. Add more pages only if the description clearly has distinct sections (e.g. location, finishes, payment plan).
- NEVER invent prices, measurements, addresses or amenities the user did not state. Omit a field rather than guess.
- "coverTitle"/"coverSubtitle" only if the user gave a portfolio/collection name. "companyName" only if a firm is named.
- "template": "editorial" (default), "classic", or "bold". "pageSize": "A4" (default) or "Letter".`;

export function buildAssistantMessages(userText: string) {
  return [
    { role: "system" as const, content: ASSISTANT_SYSTEM_PROMPT },
    { role: "user" as const, content: userText.trim().slice(0, 8000) },
  ];
}

/**
 * Parse a model reply into a validated draft. Constrained decoding already
 * guarantees valid JSON, but we still guard against an empty/garbled reply.
 */
export function parseAssistantReply(raw: string): AssistantDraft {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("The assistant didn't return usable JSON — try rephrasing your description.");
  }
  const parsed = assistantDraftSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("The assistant's draft didn't match the expected shape — try again.");
  }
  return parsed.data;
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
