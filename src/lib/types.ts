import { z } from "zod";

/**
 * Shared data contract between the wizard (client) and the PDF generator (server).
 * A brochure holds one shared brand + cover and any number of property listings;
 * each listing is a sequence of pages, and each page carries its own photos so the
 * user controls exactly what appears where. Images travel as data URLs — fine for
 * the MVP; a later version should upload to object storage first.
 */

export const featureSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(40),
});

export const brandSchema = z.object({
  companyName: z.string().min(1).max(80),
  logoDataUrl: z.string().startsWith("data:").max(4_000_000).optional().or(z.literal("")),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{6})$/),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{6})$/),
  contactName: z.string().max(80).optional().default(""),
  contactPhone: z.string().max(40).optional().default(""),
  contactEmail: z.string().max(120).optional().default(""),
  website: z.string().max(120).optional().default(""),
  /** WhatsApp number for the "chat with the creator" link at the end of the PDF;
   * falls back to contactPhone when blank. Any format — digits are extracted server-side. */
  whatsapp: z.string().max(40).optional().default(""),
});

export const photoSchema = z.object({
  dataUrl: z.string().startsWith("data:").max(12_000_000),
  caption: z.string().max(120).optional().default(""),
});

export const listingPageSchema = z.object({
  heading: z.string().max(120).optional().default(""),
  body: z.string().max(4000).optional().default(""),
  photos: z.array(photoSchema).max(24).default([]),
});

export const listingSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(160).optional().default(""),
  price: z.string().max(40).optional().default(""),
  address: z.string().max(200).optional().default(""),
  propertyType: z.string().max(40).optional().default(""),
  features: z.array(featureSchema).max(12).default([]),
  highlights: z.array(z.string().min(1).max(120)).max(12).default([]),
  pages: z.array(listingPageSchema).min(1).max(20),
});

export const coverSchema = z.object({
  title: z.string().max(120).optional().default(""),
  subtitle: z.string().max(160).optional().default(""),
  photo: photoSchema.optional(),
});

/**
 * A single document-wide watermark, stamped on every page when `enabled`.
 * It's one toggle for the whole brochure — not a per-page setting — and the mark
 * is either the `text` string or the uploaded `imageDataUrl`, per `type`.
 */
export const watermarkSchema = z
  .object({
    enabled: z.boolean().default(false),
    type: z.enum(["text", "image"]).default("text"),
    text: z.string().max(60).optional().default(""),
    imageDataUrl: z
      .string()
      .startsWith("data:")
      .max(4_000_000)
      .optional()
      .or(z.literal(""))
      .default(""),
    opacity: z.number().min(0.02).max(1).optional().default(0.12),
  })
  .default({ enabled: false, type: "text", text: "", imageDataUrl: "", opacity: 0.12 });

export const optionsSchema = z.object({
  fileName: z.string().min(1).max(120),
  template: z.enum(["classic", "editorial", "bold"]).default("editorial"),
  pageSize: z.enum(["A4", "Letter"]).default("A4"),
  watermark: watermarkSchema,
});

export const brochureRequestSchema = z.object({
  brand: brandSchema,
  cover: coverSchema.default({ title: "", subtitle: "" }),
  listings: z.array(listingSchema).min(1).max(20),
  options: optionsSchema,
});

export type Feature = z.infer<typeof featureSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type ListingPage = z.infer<typeof listingPageSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type Cover = z.infer<typeof coverSchema>;
export type Watermark = z.infer<typeof watermarkSchema>;
export type Options = z.infer<typeof optionsSchema>;
export type BrochureRequest = z.infer<typeof brochureRequestSchema>;

/** Sanitise a user-supplied name into a safe, predictable PDF file name. */
export function toSafeFileName(raw: string): string {
  const base = raw
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
  return `${base || "brochure"}.pdf`;
}
