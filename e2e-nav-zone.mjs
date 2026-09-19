/*
 * ══════════════════════════════════════════════════════════════════════
 *  分類標題可以整區收合，而且字級夠大（三支同步）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「交通服務水準的分類標題（一、二、三…）文字也是太小了」
 *   「請讓交通服務水準的分類標題和全日交通/路口轉向一樣，
 *     具有展開/收合效果，且文字一樣適中，不要現在這樣小」
 *
 * ⚠️ 字級驗「不可以再變小」，不釘死某一個數字——釘死的話日後合理地
 *   再調大一點也會被擋下來。
 * ⚠️ 收合要驗**四件事**，少一件都可能「看起來會動、其實壞了」：
 *   收得起來、別區不受影響、記得住、**展得開**。
 *   只驗收合的話，展開壞掉不會紅。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((request, response) => {
  const path = join(
    here,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    response.writeHead(404).end("nf");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const zones = await page.evaluate(() =>
  [...document.querySelectorAll("nav .nav-zone-toggle")].map((toggle) => ({
    zone: toggle.dataset.zoneToggle,
    label: (toggle.textContent || "").trim(),
    expanded: toggle.getAttribute("aria-expanded"),
    size: Math.round(parseFloat(getComputedStyle(toggle).fontSize)),
  })),
);
const tabSize = await page.evaluate(() => {
  const button = document.querySelector("nav button[data-view]");
  return button ? Math.round(parseFloat(getComputedStyle(button).fontSize)) : 0;
});
ok("前置①：分類標題是可以點的", zones.length >= 3, `${zones.length} 區`);
ok("前置②：量得到大分頁的字級（量到 0 的話下面那條恆真）", tabSize > 0, `${tabSize}px`);
/*
 * ⚠️ 這裡驗的是**相對關係**，不是某一個數字。
 *
 *   使用者 2026-09-14：「目前交通服務水準的分類標題文字比大分頁還小，
 *     看起來有點不舒適」。
 *
 *   我第一版把門檻寫成「至少 13px」——那是只想著「比原本的 10.5px 大就好」，
 *   結果 13px 仍然比 16px 的分頁小，使用者再回報一次。
 *   **單看一個數字看不出「比下層還小」**，一定要拿兩者相比。
 *   分類標題是分頁的上一層，字級不可以小於它底下的分頁。
 */
ok(
  `分類標題不可以比它底下的分頁還小（分頁 ${tabSize}px）`,
  zones.every((zone) => zone.size >= tabSize),
  zones.map((z) => `${z.label}=${z.size}px`).join("、"),
);
ok(
  "前置③：預設全部展開（預設收起來的話下面的比對會失真）",
  zones.every((zone) => zone.expanded === "true"),
  zones.map((z) => `${z.label}=${z.expanded}`).join("、"),
);

const shownIn = (zone) =>
  page.evaluate(
    (name) =>
      [
        ...document.querySelectorAll(`nav button[data-view][data-nav-zone]`),
      ].filter(
        (button) =>
          button.dataset.navZone === name &&
          (button.closest(".nav-row") || button).getBoundingClientRect()
            .height > 2,
      ).length,
    zone,
  );

if (zones.length >= 2) {
  const first = zones[0];
  const opened = await shownIn(first.zone);
  ok(`前置④：第一區「${first.label}」底下真的有分頁`, opened > 0, `${opened} 顆`);
  await page.click(`.nav-zone-toggle[data-zone-toggle="${first.zone}"]`);
  await page.waitForTimeout(300);
  ok(
    `收起來之後這一區的分頁就看不到了`,
    (await shownIn(first.zone)) === 0,
    `${opened} → ${await shownIn(first.zone)}`,
  );
  ok(
    `只收這一區，別區不受影響：「${zones[1].label}」`,
    (await shownIn(zones[1].zone)) > 0,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok("重新整理之後還記得收合狀態", (await shownIn(first.zone)) === 0);
  await page.click(`.nav-zone-toggle[data-zone-toggle="${first.zone}"]`);
  await page.waitForTimeout(300);
  ok(
    "再點一次要展開回來",
    (await shownIn(first.zone)) === opened,
    `${await shownIn(first.zone)} / ${opened}`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 分類標題字級夠大，而且可以整區收合、記得住、也展得開");
