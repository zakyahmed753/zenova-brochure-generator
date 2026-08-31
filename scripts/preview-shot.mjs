import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
await page.goto("http://localhost:3010", { waitUntil: "networkidle0" });

// Step 1 — brand
await page.type('input[placeholder="Skyline Real Estate"]', "Skyline Real Estate");
await page.click('button ::-p-text(Continue)');
await page.waitForSelector('input[placeholder="Modern 4-Bedroom Villa with Sea View"]');

// Step 2 — one listing with a headline + price + a page heading
await page.type('input[placeholder="Modern 4-Bedroom Villa with Sea View"]', "Modern 4-Bedroom Villa with Sea View");
await page.type('input[placeholder="Villa"]', "Villa");
await page.type('input[placeholder="EGP 12,500,000"]', "EGP 12,500,000");
await page.type('input[placeholder="Palm Hills, New Cairo"]', "Palm Hills, New Cairo");
await page.type('textarea[placeholder^="Page text"]', "A bright, contemporary villa set over three levels with a landscaped garden.");

await new Promise((r) => setTimeout(r, 800)); // let the debounced preview settle
await page.screenshot({ path: "scripts/preview-listings.png" });

// Step 3 — generate
await page.click('button ::-p-text(Continue)');
await page.waitForSelector('input[placeholder="Autumn Portfolio 2026"]');
await page.type('input[placeholder="Autumn Portfolio 2026"]', "Autumn Portfolio 2026");
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: "scripts/preview-generate.png" });

await browser.close();
console.log("saved scripts/preview-listings.png, scripts/preview-generate.png");
