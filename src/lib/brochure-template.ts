import type { BrochureRequest, Listing, ListingPage, Watermark } from "./types";

/**
 * Renders the whole brochure as one self-contained HTML document (no external
 * requests) that Puppeteer prints to PDF. Every page is a fixed-size `.page`
 * block, so pagination stays predictable no matter how many listings or photos
 * the user adds. Each listing contributes one page per authored page; photos are
 * placed only where the user assigned them, and the photo grid flexes to fill
 * whatever space the page's text leaves behind.
 */

const PAGE = {
  A4: { w: "210mm", h: "297mm" },
  Letter: { w: "215.9mm", h: "279.4mm" },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** WhatsApp glyph — inline so the PDF stays self-contained (no external requests). */
const WA_ICON = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
  <path fill="#fff" d="M16 3.2A12.7 12.7 0 0 0 4.9 22.3L3.2 28.8l6.7-1.8A12.7 12.7 0 1 0 16 3.2Zm0 2.3a10.4 10.4 0 0 1 8.9 15.8 10.4 10.4 0 0 1-13.9 3.6l-.5-.3-4 1 1.1-3.9-.3-.5A10.4 10.4 0 0 1 16 5.5Z"/>
  <path fill="#fff" d="M12.3 9.6c-.24-.55-.5-.56-.73-.57h-.62c-.22 0-.57.08-.87.4-.3.33-1.14 1.11-1.14 2.71 0 1.6 1.17 3.15 1.33 3.37.16.22 2.26 3.62 5.58 4.93 2.76 1.09 3.32.87 3.92.82.6-.06 1.94-.79 2.21-1.56.27-.77.27-1.43.19-1.57-.08-.14-.3-.22-.62-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.73.16-.22.33-.84 1.07-1.03 1.29-.19.22-.38.25-.7.08-.33-.16-1.39-.51-2.64-1.63-.98-.87-1.64-1.95-1.83-2.28-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.58.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.58-.08-.16-.72-1.78-1-2.44Z"/>
</svg>`;

function waLink(brand: BrochureRequest["brand"]): string {
  const digits = (brand.whatsapp || brand.contactPhone || "").replace(/\D/g, "");
  if (!digits) return "";
  return `<a class="wa-link" href="https://wa.me/${digits}">
    <span class="wa-badge">${WA_ICON}</span>
    <span class="wa-text">Chat on WhatsApp with ${esc(brand.contactName || brand.companyName)}</span>
  </a>`;
}

/** One document-wide watermark layer, dropped into every `.page`. */
function watermarkLayer(wm: Watermark | undefined): string {
  if (!wm || !wm.enabled) return "";
  const style = `--wm-opacity:${wm.opacity}`;
  if (wm.type === "image") {
    if (!wm.imageDataUrl) return "";
    return `<div class="watermark" style="${style}"><img src="${wm.imageDataUrl}" alt="" /></div>`;
  }
  const text = (wm.text || "").trim();
  if (!text) return "";
  return `<div class="watermark" style="${style}"><span>${esc(text)}</span></div>`;
}

function photoGrid(photos: ListingPage["photos"]): string {
  if (!photos.length) return "";
  const cols = photos.length === 1 ? 1 : photos.length <= 4 ? 2 : 3;
  return `<div class="photo-grid cols-${cols}">
    ${photos
      .map(
        (p) => `<figure>
          <img src="${p.dataUrl}" alt="" />
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}
        </figure>`,
      )
      .join("")}
  </div>`;
}

function listingHead(listing: Listing): string {
  const facts = listing.features
    .map((f) => ({ label: (f.label ?? "").trim(), value: (f.value ?? "").trim() }))
    .filter((f) => f.label || f.value);
  const features = facts.length
    ? `<div class="features">
        ${facts
          .map(
            (f) => `<div class="feature">
              ${f.value ? `<div class="feature-value">${esc(f.value)}</div>` : ""}
              ${f.label ? `<div class="feature-label">${esc(f.label)}</div>` : ""}
            </div>`,
          )
          .join("")}
      </div>`
    : "";
  const highlights = listing.highlights.length
    ? `<ul class="highlights">
        ${listing.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}
      </ul>`
    : "";
  return `<div class="listing-head ${listing.price ? "has-price" : ""}">
    ${
      listing.price
        ? `<div class="price-box">
            <div class="price-label">Price</div>
            <div class="price-value">${esc(listing.price)}</div>
          </div>`
        : ""
    }
    ${listing.propertyType ? `<div class="type-tag">${esc(listing.propertyType)}</div>` : ""}
    <h1>${esc(listing.title)}</h1>
    ${listing.subtitle ? `<div class="subtitle">${esc(listing.subtitle)}</div>` : ""}
    ${listing.address ? `<div class="address">${esc(listing.address)}</div>` : ""}
    ${features}
    ${highlights}
  </div>`;
}

function listingSection(listing: Listing, logo: string, wm: string): string {
  return listing.pages
    .map((page, i) => {
      const headerLabel = i === 0 ? listing.subtitle || listing.address || "For sale" : listing.title;
      return `<section class="page listing-page">
        ${wm}
        <header class="mini-header">
          <span>${esc(headerLabel)}</span>
          ${logo}
        </header>
        <div class="page-body">
          ${i === 0 ? listingHead(listing) : ""}
          ${page.heading ? `<h2>${esc(page.heading)}</h2>` : ""}
          ${page.body ? `<div class="prose">${esc(page.body)}</div>` : ""}
          ${photoGrid(page.photos)}
        </div>
      </section>`;
    })
    .join("");
}

export function buildBrochureHtml(req: BrochureRequest): string {
  const { brand, cover, listings, options } = req;
  const size = PAGE[options.pageSize];
  const wm = watermarkLayer(options.watermark);

  // Template-specific accents.
  const heading =
    options.template === "editorial"
      ? `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`
      : options.template === "classic"
        ? `Georgia, 'Times New Roman', serif`
        : `'Helvetica Neue', Arial, sans-serif`;
  const coverTitleSize = options.template === "bold" ? "46px" : "38px";

  const logo = brand.logoDataUrl
    ? `<img class="logo" src="${brand.logoDataUrl}" alt="${esc(brand.companyName)}" />`
    : `<div class="logo-text">${esc(brand.companyName)}</div>`;

  const contactBits = [
    brand.contactPhone && `<span>${esc(brand.contactPhone)}</span>`,
    brand.contactEmail && `<span>${esc(brand.contactEmail)}</span>`,
    brand.website && `<span>${esc(brand.website)}</span>`,
  ]
    .filter(Boolean)
    .join('<span class="dot">•</span>');

  const count = `${listings.length} ${listings.length === 1 ? "property" : "properties"}`;
  const coverSection = `<section class="page cover ${cover.photo ? "" : "cover-plain"}">
    ${cover.photo ? `<img class="hero" src="${cover.photo.dataUrl}" alt="" /><div class="scrim"></div>` : ""}
    ${wm}
    <div class="top">
      ${logo}
    </div>
    <div class="bottom">
      <h1>${esc(cover.title || brand.companyName)}</h1>
      ${cover.subtitle ? `<div class="subtitle">${esc(cover.subtitle)}</div>` : ""}
      <div class="count">${count}</div>
    </div>
  </section>`;

  const listingsHtml = listings.map((l) => listingSection(l, logo, wm)).join("");

  const contactSection = `<section class="page contact">
    ${wm}
    ${logo}
    <h3>${esc(brand.contactName || "Get in touch")}</h3>
    <p>${contactBits || esc(brand.companyName)}</p>
    <div class="rule"></div>
    <ul class="contact-list">
      ${listings
        .map(
          (l) =>
            `<li><span>${esc(l.title)}</span>${l.price ? `<span class="cl-price">${esc(l.price)}</span>` : ""}</li>`,
        )
        .join("")}
    </ul>
    ${waLink(brand)}
    <div class="fine">Prepared by ${esc(brand.companyName)}</div>
  </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root {
    --primary: ${brand.primaryColor};
    --accent: ${brand.accentColor};
    --ink: #1c1c1c;
    --muted: #6b6b6b;
    --line: #e4e4e4;
    --heading: ${heading};
    --body: 'Helvetica Neue', Arial, 'Segoe UI', sans-serif;
  }
  @page { size: ${options.pageSize}; margin: 0; }
  html, body { font-family: var(--body); color: var(--ink); }
  .page {
    position: relative;
    width: ${size.w};
    height: ${size.h};
    overflow: hidden;
    page-break-after: always;
    background: #fff;
    display: flex;
    flex-direction: column;
  }
  .page:last-child { page-break-after: auto; }

  /* ---------- Watermark (one toggle, every page) ---------- */
  .watermark { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; }
  .watermark span { font: 800 66px/1 var(--body); letter-spacing: .12em; text-transform: uppercase; color: #000; opacity: var(--wm-opacity, .12); transform: rotate(-30deg); white-space: nowrap; }
  .watermark img { width: 62%; max-height: 62%; object-fit: contain; opacity: var(--wm-opacity, .12); transform: rotate(-30deg); }
  .cover .watermark span { color: #fff; }
  .contact .watermark span { color: #fff; }

  /* ---------- Cover ---------- */
  .cover { color: #fff; }
  .cover.cover-plain { background: var(--primary); }
  .cover .hero { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cover .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0) 46%, rgba(0,0,0,.8) 100%); }
  .cover .top { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between; padding: 20mm 18mm 0; }
  .cover .bottom { position: relative; z-index: 3; margin-top: auto; padding: 0 18mm 22mm; }
  /* White chip behind the logo so it reads on the dark cover no matter what
     colours or transparency the uploaded file has (an invert filter turned
     opaque logos into a white square). */
  .cover .logo { max-height: 14mm; max-width: 54mm; object-fit: contain; background: #fff; padding: 2.5mm 3mm; border-radius: 3px; }
  .cover .logo-text { font: 600 18px/1.2 var(--heading); letter-spacing: .04em; }
  .cover h1 { font: 700 ${coverTitleSize}/1.1 var(--heading); max-width: 150mm; margin-bottom: 10px; }
  .cover .subtitle { font-size: 14px; opacity: .92; margin-bottom: 10px; }
  .cover .count { font: 600 11px/1 var(--body); letter-spacing: .22em; text-transform: uppercase; opacity: .85; }

  /* ---------- Listing pages ---------- */
  .mini-header { position: relative; z-index: 3; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 12mm 18mm 6mm; border-bottom: 1px solid var(--line); }
  .mini-header span { font: 600 10px/1 var(--body); letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
  .mini-header .logo { max-height: 9mm; max-width: 40mm; object-fit: contain; }
  .mini-header .logo-text { font: 600 12px/1 var(--heading); color: var(--primary); }

  .page-body { position: relative; z-index: 3; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 7mm; padding: 12mm 18mm 16mm; }

  .listing-head { position: relative; }
  .listing-head.has-price { padding-right: 50mm; }
  .listing-head .type-tag { display: inline-block; font: 600 9.5px/1 var(--body); letter-spacing: .22em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
  .listing-head .price-box {
    position: absolute; top: 0; right: 0;
    width: 46mm; min-height: 24mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--accent); color: #fff;
    border: 2px solid var(--accent); border-radius: 4px;
    padding: 10px 8px; text-align: center;
    box-shadow: 0 10px 24px rgba(0,0,0,.20);
  }
  .listing-head .price-box .price-label { font: 700 8px/1 var(--body); letter-spacing: .24em; text-transform: uppercase; opacity: .85; }
  .listing-head .price-box .price-value { font: 800 16px/1.2 var(--body); letter-spacing: .01em; margin-top: 6px; overflow-wrap: break-word; }
  .listing-head h1 { font: 700 28px/1.15 var(--heading); color: var(--primary); margin-bottom: 6px; }
  .listing-head .subtitle { font-size: 13px; color: var(--muted); }
  .listing-head .address { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-top: 4px; }

  /* Key facts — raised 3D tiles (soft float + beveled top + solid bottom edge). */
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(34mm, 1fr)); gap: 4mm; margin-top: 16px; margin-bottom: 4px; }
  /* the facts sit below the absolutely-positioned price box, so reclaim the gutter */
  .listing-head.has-price .features { margin-right: -50mm; }
  .feature {
    position: relative;
    padding: 13px 7px 12px;
    text-align: center;
    border-radius: 10px;
    background: linear-gradient(180deg, #ffffff 0%, #eef1f5 100%);
    border: 1px solid rgba(20, 30, 48, 0.06);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      inset 0 -6px 10px rgba(20, 30, 48, 0.05),
      0 3px 0 rgba(20, 30, 48, 0.10),
      0 6px 10px rgba(20, 30, 48, 0.12),
      0 16px 28px rgba(20, 30, 48, 0.10);
    break-inside: avoid;
  }
  /* accent lip along the top for a beveled, machined look */
  .feature::before {
    content: "";
    position: absolute;
    left: 14px; right: 14px; top: 0;
    height: 3px;
    border-radius: 0 0 3px 3px;
    background: var(--accent);
    opacity: 0.85;
  }
  .feature { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 19mm; }
  .feature-value { font: 800 20px/1.1 var(--body); color: var(--primary); letter-spacing: .01em; }
  .feature-label {
    margin-top: 5px;
    font: 700 9px/1.3 var(--body);
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .highlights { list-style: none; columns: 2; column-gap: 12mm; margin-top: 10px; }
  .highlights li { font-size: 11.5px; line-height: 1.5; padding: 5px 0 5px 14px; position: relative; break-inside: avoid; }
  .highlights li::before { content: ""; position: absolute; left: 0; top: 10px; width: 6px; height: 6px; background: var(--accent); }

  .page-body h2 { font: 700 20px/1.25 var(--heading); color: var(--primary); }
  .page-body .prose { font-size: 12px; line-height: 1.8; color: #333; white-space: pre-wrap; }

  .photo-grid { flex: 1 1 auto; min-height: 55mm; display: grid; gap: 4mm; grid-auto-rows: 1fr; }
  .photo-grid.cols-1 { grid-template-columns: 1fr; }
  .photo-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .photo-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .photo-grid figure { position: relative; min-height: 0; overflow: hidden; background-color: #f0f0f0; }
  .photo-grid figure img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .photo-grid figcaption { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; padding: 5px 9px; background: linear-gradient(transparent, rgba(0,0,0,.65)); color: #fff; font-size: 9px; letter-spacing: .04em; }

  /* ---------- Contact ---------- */
  .contact { justify-content: center; padding: 24mm; background: var(--primary); color: #fff; }
  .contact > *:not(.watermark) { position: relative; z-index: 3; }
  .contact .logo { max-height: 18mm; max-width: 64mm; object-fit: contain; background: #fff; padding: 3mm 4mm; border-radius: 4px; margin-bottom: 16mm; }
  .contact .logo-text { font: 600 22px/1 var(--heading); margin-bottom: 16mm; }
  .contact h3 { font: 400 22px/1.3 var(--heading); margin-bottom: 8px; }
  .contact p { font-size: 12px; line-height: 1.9; opacity: .9; }
  .contact .dot { margin: 0 8px; opacity: .45; }
  .contact .rule { width: 40mm; height: 2px; background: var(--accent); margin: 12mm 0; }
  .contact .contact-list { list-style: none; }
  .contact .contact-list li { display: flex; justify-content: space-between; gap: 12mm; font-size: 11.5px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.16); opacity: .92; }
  .contact .cl-price { opacity: .8; white-space: nowrap; }
  .contact .wa-link { display: inline-flex; align-items: center; gap: 10px; margin-top: 12mm; padding: 10px 18px 10px 10px; background: #25d366; color: #fff; border-radius: 999px; text-decoration: none; align-self: flex-start; }
  .contact .wa-link .wa-badge { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 999px; background: rgba(255,255,255,.18); }
  .contact .wa-link .wa-text { font: 700 11px/1.2 var(--body); letter-spacing: .04em; }
  .contact .fine { margin-top: 14mm; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; opacity: .6; }
</style>
</head>
<body>
  ${coverSection}
  ${listingsHtml}
  ${contactSection}
</body>
</html>`;
}
