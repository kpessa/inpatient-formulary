import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const OUT_DIR = process.env.PW_OUT_DIR ?? path.join(process.cwd(), "output", "playwright");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function main() {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    // Useful for debugging pointer events / logs
    // eslint-disable-next-line no-console
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  // Open Product Search modal from main toolbar search input.
  const globalSearchInput = page.getByText("Search for:").first().locator("..").locator("input");
  await globalSearchInput.fill("acetaminophen");
  await globalSearchInput.press("Enter");

  await page.getByText("Product Search").waitFor({ timeout: 15_000 });

  // Run search inside modal.
  const modalSearchRow = page
    .locator("div")
    .filter({ hasText: "Product Search" })
    .first();

  const modalSearchInput = page.getByText("Search for:").nth(1).locator("..").locator("input");
  await modalSearchInput.fill("acetaminophen");
  await page.getByRole("button", { name: "Search" }).click();

  // Wait for at least one result row (tbody tr).
  await page.locator("tbody tr").first().waitFor({ timeout: 15_000 });

  // Target the first resizable column header (skip the blank leading handle column).
  const th = page.locator("thead tr th").nth(1);
  const resizeHandle = th.locator("div.cursor-col-resize");

  // Capture width before.
  const col = page.locator("colgroup col").nth(1);
  const widthBefore = await col.evaluate((el) => getComputedStyle(el).width);

  await page.screenshot({ path: path.join(OUT_DIR, "search-columns_before.png"), fullPage: true });

  const box = await resizeHandle.boundingBox();
  if (!box) throw new Error("Resize handle not visible / no bounding box.");

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY, { steps: 12 });
  await page.mouse.up();

  // Give React a moment to commit state updates.
  await page.waitForTimeout(250);

  const widthAfter = await col.evaluate((el) => getComputedStyle(el).width);
  await page.screenshot({ path: path.join(OUT_DIR, "search-columns_after.png"), fullPage: true });

  // eslint-disable-next-line no-console
  console.log(`Column width before: ${widthBefore}`);
  // eslint-disable-next-line no-console
  console.log(`Column width after:  ${widthAfter}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

