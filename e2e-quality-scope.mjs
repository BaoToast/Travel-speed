/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-27：「計畫資料品質總覽」的說明必須與實際行為一致
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊版在這一塊掛的是一句常駐說明：
 *   「這一塊**不受主工具列條件影響**：品質總覽一律檢查這個計畫的全部資料；
 *     要縮小範圍請用下方這一區**自己的**季度、路段與日別篩選。」
 *
 * 實測（我在做資料維護那一輪發現的，不是使用者回報的）：
 *   把主工具列的「季度（起）」拉到最後一季，這一塊的清單**真的會少幾列**，
 *   而且這一區「自己的」四個下拉其實是主工具列的鏡子。
 *
 * 兩層問題：
 *   ① 說明說謊。使用者照字面理解，會抄走一份其實已經被季度篩過的清單。
 *   ② 那一句標了 data-inapplicable="all"，逐塊守門讀到就當它「常駐不適用、
 *      免逐條件表態」——於是這一塊吃了條件卻永遠不必交代吃了哪些。
 *
 * 正確語意是**分母與分子不同**：
 *   ・分母（檢查本身）掃全部資料 → 「共 N 項」不隨主工具列變
 *   ・分子（清單列出哪幾項）跟著季度／路段／日別走
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗說明文字有沒有那幾個字**。字改對了、行為還是舊的，
 *     照樣全綠。所以先驗**行為**：拉季度 → 列數真的變。
 * 二、**要驗「共 N 項」那個總數不變**。兩個數字一起變的話，
 *     「分母不受影響」那半句就也是假的。
 * 三、測資要**真的有跨季的異常**，否則拉季度本來就不會少任何一列，
 *     第一條變成恆真。所以前置先確認「至少兩季、而且列數 ≥ 2」。
 * 四、**反面守門**：那一句不可以再標成 data-inapplicable="all"
 *     （標了就等於把這一塊從逐條件表態裡整個豁免掉）。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "QSCOPE");
await page.fill("#projectName", "品質總覽範圍守門");
await page.click("#saveProject");
await page.waitForTimeout(500);
/* ⚠️ 兩季，而且要有跨季的異常變化，拉季度才會真的少列。 */
for (const quarterIndex of [1, 2]) {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
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
  await page.waitForTimeout(2500);
}

const gotoView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};
await gotoView("maintenance");
const runButton = page.locator("#runHealth");
if (await runButton.count()) {
  await runButton.click();
  await page.waitForTimeout(2000);
}

/** 品質總覽目前的列數與右上角那句「顯示 X / 共 Y 項」。 */
const read = () =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll("#qualityRows tr")].filter(
      (tr) => !tr.querySelector(".empty"),
    ).length,
    shown: document.getElementById("qualityShown")?.textContent?.trim() ?? "",
    /* 「共 N 項」那個總數：分母，不可以跟著主工具列變。 */
    total: (
      document.getElementById("qualityShown")?.textContent?.match(/共\s*(\d+)/) ??
      []
    )[1],
  }));

console.log("\n══ 一、前置：測資真的驗得到東西 ══");
const before = await read();
ok(
  "前置：品質總覽列得出兩列以上（列不出來的話拉季度本來就不會少，整支恆真）",
  before.rows >= 2,
  `${before.rows} 列／${before.shown}`,
);
const periodOptions = await page.evaluate(() =>
  [
    ...(document.querySelector('[data-testid="mt-period-from"]')?.options ?? []),
  ].map((option) => option.value),
);
ok(
  "前置：主工具列的季度（起）有兩個以上的選項",
  periodOptions.length >= 2,
  periodOptions.join("、"),
);

if (before.rows >= 2 && periodOptions.length >= 2) {
  console.log("\n══ 二、行為：清單跟著主工具列的季度走 ══");
  await page.selectOption(
    '[data-testid="mt-period-from"]',
    periodOptions.at(-1),
  );
  await page.waitForTimeout(1200);
  const after = await read();
  ok(
    "⚠️ ① 把季度（起）拉到最後一季之後，清單**真的少了列**（這就是舊說明說謊的那件事）",
    after.rows < before.rows,
    `${before.rows} 列 → ${after.rows} 列`,
  );
  ok(
    "⚠️ ① 但「共 N 項」那個總數**不變**（分母掃全部資料，這一半原本就是對的）",
    after.total === before.total && Boolean(before.total),
    `共 ${before.total} → 共 ${after.total}`,
  );
  await page.selectOption('[data-testid="mt-period-from"]', periodOptions[0]);
  await page.waitForTimeout(1000);
  const back = await read();
  ok(
    "① 季度拉回來之後列數也回得來",
    back.rows === before.rows,
    `${after.rows} → ${back.rows}（原本 ${before.rows}）`,
  );
}

console.log("\n══ 三、說明文字要與行為一致 ══");
const note = await page.evaluate(() => {
  const panel = document.querySelector(".quality-panel");
  const element = panel?.querySelector(".chart-inapplicable");
  return {
    text: element?.textContent?.replace(/\s+/g, "") ?? "",
    inapplicable: element?.getAttribute("data-inapplicable") ?? "",
    always: element?.hasAttribute("data-inapplicable-always") ?? false,
    consumes: panel?.getAttribute("data-consumes") ?? "",
  };
});
ok(
  "⚠️ ② 說明**不可以**再寫「不受主工具列條件影響」（那句話是假的）",
  !note.text.includes("不受主工具列條件影響"),
  note.text.slice(0, 60),
);
ok(
  "⚠️ ② 說明要講出「共 N 項不隨主工具列變」這一半",
  note.text.includes("不隨主工具列變"),
  note.text.slice(0, 80),
);
ok(
  "⚠️ ② 說明要講出「清單會跟著季度、路段與日別走」這一半",
  note.text.includes("跟著季度") && note.text.includes("路段"),
  note.text.slice(0, 120),
);
ok(
  "⚠️ ② 那一句**不可以**再標成 data-inapplicable=\"all\"（標了就免逐條件表態）",
  note.inapplicable !== "all" && note.inapplicable.length > 0,
  `data-inapplicable=\"${note.inapplicable}\"`,
);
ok(
  "② 它仍然是常駐說明（這一塊本來就該一直講，不是篩到才講）",
  note.always === true,
);
ok(
  "⚠️ ② 這一塊要宣告它真的吃哪幾個條件（季度、路段、日別）",
  ["periodFrom", "periodTo", "roads", "day"].every((field) =>
    note.consumes.split(/\s+/).includes(field),
  ),
  `data-consumes=\"${note.consumes}\"`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 品質總覽：清單真的跟著主工具列走，而且畫面上把分母與分子分開講了");
