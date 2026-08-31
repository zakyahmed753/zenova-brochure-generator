import type { Brand, Options } from "./types";

/** Shared starting values + localStorage keys for the wizard and the AI flows. */

export const emptyBrand: Brand = {
  companyName: "",
  logoDataUrl: "",
  primaryColor: "#0f2f4f",
  accentColor: "#c9a24b",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  website: "",
  whatsapp: "",
};

export const defaultOptions: Options = {
  fileName: "",
  template: "editorial",
  pageSize: "A4",
  watermark: {
    enabled: false,
    type: "text",
    text: "",
    imageDataUrl: "",
    opacity: 0.12,
  },
};

export const DRAFT_KEY = "realty-brochure-draft-v2";
export const BRAND_KEY = "realty-brochure-brand-v1";

/** Read the user's saved brand default (set in the wizard) if there is one. */
export function loadSavedBrand(): Brand {
  const brand = { ...emptyBrand };
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (raw) Object.assign(brand, JSON.parse(raw));
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return brand;
}
