import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const html = readFileSync("scripts/out.html", "utf8");
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
const count = await page.$$eval(".page", (els) => els.length);
for (let i = 0; i < count; i++) {
  const el = (await page.$$(".page"))[i];
  await el.screenshot({ path: `scripts/page-${i + 1}.png` });
}
await browser.close();
console.log(`saved ${count} page screenshots`);
