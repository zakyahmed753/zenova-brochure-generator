// Standalone smoke test: builds the brochure HTML and renders a PDF without Next.
// Run: node --experimental-strip-types scripts/smoke.mjs
import { writeFileSync } from "node:fs";

// tiny placeholder images in different colours
const px = (hex) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="${hex}"/></svg>`,
  ).toString("base64")}`;

const shot = (hex, caption) => ({ dataUrl: px(hex), caption });

const req = {
  brand: {
    companyName: "Skyline Real Estate",
    logoDataUrl: "",
    primaryColor: "#0f2f4f",
    accentColor: "#c9a24b",
    contactName: "Jordan Lee",
    contactPhone: "+20 100 000 0000",
    contactEmail: "jordan@skyline.example",
    website: "skyline.example",
  },
  cover: {
    title: "Autumn Portfolio 2026",
    subtitle: "Selected homes and land across New Cairo",
    photo: shot("#1f2d3d", ""),
  },
  listings: [
    {
      title: "Modern 4-Bedroom Villa with Sea View",
      subtitle: "Palm Hills, New Cairo",
      price: "EGP 12,500,000",
      address: "Villa 21, Palm Hills, New Cairo",
      propertyType: "Villa",
      features: [
        { label: "Bedrooms", value: "4" },
        { label: "Bathrooms", value: "5" },
        { label: "Area", value: "420 m²" },
        { label: "Parking", value: "2" },
      ],
      highlights: ["Private garden and pool", "Rooftop terrace", "Smart-home system", "Maid's room"],
      pages: [
        {
          heading: "",
          body: "",
          photos: [shot("#334155", "Front elevation"), shot("#475569", "Living room")],
        },
        {
          heading: "Gallery",
          body: "",
          photos: [
            shot("#64748b", "Kitchen"),
            shot("#94a3b8", "Master suite"),
            shot("#a8b3c2", "Garden"),
            shot("#c0c9d6", "Pool"),
          ],
        },
        {
          heading: "About this property",
          body: "A bright, contemporary villa set over three levels with an open-plan living space, chef's kitchen and a landscaped garden.\n\nWalking distance to the clubhouse and international schools.",
          photos: [],
        },
      ],
    },
    {
      title: "City-Centre 2-Bedroom Apartment",
      subtitle: "Downtown, Cairo",
      price: "EGP 4,200,000",
      address: "14th floor, Nile Tower, Cairo",
      propertyType: "Apartment",
      features: [
        { label: "Bedrooms", value: "2" },
        { label: "Bathrooms", value: "2" },
        { label: "Area", value: "135 m²" },
        { label: "Floor", value: "14" },
      ],
      highlights: ["Panoramic river views", "Concierge building", "Walk to metro"],
      pages: [
        {
          heading: "",
          body: "Turn-key apartment with floor-to-ceiling glazing and a wrap-around balcony.",
          photos: [shot("#5b6b82", "Balcony view"), shot("#7c8aa0", "Open kitchen")],
        },
        {
          heading: "More photos",
          body: "",
          photos: [shot("#8a97a8", "Bedroom"), shot("#adb8c6", "Bathroom"), shot("#6f7d92", "Lobby")],
        },
      ],
    },
  ],
  options: { fileName: "Skyline-Portfolio-Autumn", template: "editorial", pageSize: "A4" },
};

const { buildBrochureHtml } = await import("../src/lib/brochure-template.ts").catch(() => {
  throw new Error("run with: node --experimental-strip-types scripts/smoke.mjs");
});

const html = buildBrochureHtml(req);
writeFileSync("scripts/out.html", html);

const puppeteer = (await import("puppeteer")).default;
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
writeFileSync("scripts/out.pdf", pdf);
await browser.close();
console.log(`OK  html=${html.length}b  pdf=${pdf.length}b  -> scripts/out.pdf`);
