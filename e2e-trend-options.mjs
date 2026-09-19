/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-39／X-40：歷季趨勢的兩個下拉，**選項不可以自我消失**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附兩張圖）：
 *   「選擇平日後，選項會剩下平日、平日+假日，假日的選項消失了，
 *     必須我重新點選平日+假日後，才能正常恢復。這類問題之前修過，
 *     不知為什麼又出現了」
 *   「同樣的圖，我選擇單一路段後，篩選也變成只剩下 全路段 和 單一路段」
 *
 * 成因：選單的選項是從**已經篩過**的那一份資料推出來的，
 * 篩完之後其他選項當然不存在了——使用者被自己的選擇鎖在裡面，
 * 只能靠「選回全部」才解得開。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**一定要真的選下去再讀一次**。只讀初始狀態的話，
 *     選項那時本來就還是完整的，這一支會恆真。
 * 二、**兩個維度都要驗**。只修一個（例如只修日別）也會讓另一半全綠。
 * 三、要驗**選項的內容**，不是只驗數量。數量一樣但內容被換掉
 *     （例如把「假日」換成另一個路段）照樣是壞的。
 * 四、季度區間縮小時，選項**應該**跟著少——那不是缺陷，是對的。
 *     所以這一支只固定在同一個季度區間內比較，不把季度攪進來。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "TRENDOPT");
await page.fill("#projectName", "趨勢選項守門");
await page.click("#saveProject");
await page.waitForTimeout(500);
await page.evaluate(() =>
  document.querySelector('[data-view="import"]').click(),
);
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 1 });
await page.setInputFiles(
  "#files",
  files.map((name) => ({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLE_DIR, name)),
  })),
);
await page.click("#preview");
await page.waitForTimeout(4000);
await page.click("#commit");
await page.waitForTimeout(2000);

const gotoView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};
await gotoView("trendChart");
await page.waitForTimeout(800);

/** 某個下拉目前列得出來的選項文字。 */
const optionsOf = (id) =>
  page.evaluate(
    (selectId) =>
      [...(document.getElementById(selectId)?.options ?? [])].map((option) =>
        (option.textContent || "").trim(),
      ),
    id,
  );
const pick = async (id, label) => {
  await page.evaluate(
    ({ selectId, wanted }) => {
      const select = document.getElementById(selectId);
      const option = [...(select?.options ?? [])].find(
        (item) => (item.textContent || "").trim() === wanted,
      );
      if (!select || !option) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selectId: id, wanted: label },
  );
  await page.waitForTimeout(1100);
};

console.log("\n══ 前置 ══");
const dayBefore = await optionsOf("trendDay");
const roadBefore = await optionsOf("trendRoad");
ok(
  "前置：日別下拉一開始列得出平日與假日（測資要兩種都有，否則整支恆真）",
  dayBefore.includes("平日") && dayBefore.includes("假日"),
  dayBefore.join(" ／ "),
);
ok(
  "前置：路段下拉一開始列得出兩條以上的路段",
  roadBefore.filter((text) => text !== "全部路段合計").length >= 2,
  roadBefore.join(" ／ "),
);
if (
  !(dayBefore.includes("平日") && dayBefore.includes("假日")) ||
  roadBefore.filter((text) => text !== "全部路段合計").length < 2
) {
  console.error("測資不足，後面會恆真，直接停。");
  await browser.close();
  server.close();
  process.exit(1);
}

/* ══ 一、選了「平日」之後，日別選項**不可以**少掉假日 ══════════ */
console.log("\n══ 一、日別（X-39）══");
await pick("trendDay", "平日");
const dayAfter = await optionsOf("trendDay");
ok(
  "⚠️ ① 選了「平日」之後，「假日」還要在選項裡（不然使用者被自己的選擇鎖住）",
  dayAfter.includes("假日"),
  dayAfter.join(" ／ "),
);
ok(
  "① 選項內容與選之前完全相同（不是只有數量一樣）",
  JSON.stringify(dayAfter) === JSON.stringify(dayBefore),
  `之前：${dayBefore.join("／")}　之後：${dayAfter.join("／")}`,
);
ok(
  "① 而且目前選中的確實是「平日」（選項沒少，但選擇要生效）",
  (await page.evaluate(
    () =>
      document.getElementById("trendDay")?.selectedOptions[0]?.textContent?.trim(),
  )) === "平日",
);

/* ══ 二、選了單一路段之後，路段選項**不可以**少掉其他路段 ══════ */
console.log("\n══ 二、路段（X-40）══");
const targetRoad = roadBefore.find((text) => text !== "全部路段合計");
await pick("trendRoad", targetRoad);
const roadAfter = await optionsOf("trendRoad");
ok(
  "⚠️ ② 選了單一路段之後，其他路段還要在選項裡",
  JSON.stringify(roadAfter) === JSON.stringify(roadBefore),
  `之前：${roadBefore.join("／")}　之後：${roadAfter.join("／")}`,
);
ok(
  "② 目前選中的確實是那一條路段",
  (await page.evaluate(
    () =>
      document
        .getElementById("trendRoad")
        ?.selectedOptions[0]?.textContent?.trim(),
  )) === targetRoad,
  targetRoad,
);

/* ══ 三、兩個一起選也不會互相吃掉 ══════════════════════════════ */
console.log("\n══ 三、兩個一起選 ══");
const dayBoth = await optionsOf("trendDay");
const roadBoth = await optionsOf("trendRoad");
ok(
  "⚠️ ③ 日別與路段都選了之後，兩邊的選項都還是完整的",
  JSON.stringify(dayBoth) === JSON.stringify(dayBefore) &&
    JSON.stringify(roadBoth) === JSON.stringify(roadBefore),
  `日別：${dayBoth.join("／")}　路段：${roadBoth.join("／")}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 歷季趨勢的兩個下拉：選了之後選項仍然完整，使用者換得回去");
