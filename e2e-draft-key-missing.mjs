/*
 * ══════════════════════════════════════════════════════════════════════
 *  報告文字草稿：舊鍵值讀得回來、讀不到的欄位寫「—」、真實的 0 照樣寫 0
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支（2026-09-26 新增）：
 *
 * `draft-key-and-missing.test.mjs` 守的是同樣這兩件事，但它是**來源掃描**
 *（`assert.match(source, /…/)`）。獨立複查指出那還不夠：
 *   「舊草稿鍵／缺值與真實 0 的測試仍只有靜態掃碼，缺少真實畫面流程。」
 * 來源掃描只能證明「程式裡寫著那個樣子」，證明不了
 *   ・使用者存過的草稿**在畫面上真的讀得回來**
 *   ・讀不到的欄位**在文字框裡真的寫成「—」**
 * 而這兩件的症狀都只出現在畫面上（「我存的草稿不見了」「延滯寫成 0」）。
 *
 * ── 這一支守什麼 ────────────────────────────────────────────────
 *
 * ① **鍵值格式**：只設「方向」時，鍵值必須維持 v2.20.68 的
 *    `計畫|季別區間|方向|尖峰` 四段式。無條件加上路段與日別會變成六段，
 *    使用者先前存過的草稿就全部找不到。
 *    ⚠️ 這一條是**從實際寫進 IndexedDB 的鍵**量出來的，不是讀原始碼。
 * ② **舊草稿讀得回來**：把一份草稿直接寫進①量到的那個鍵，重新載入、
 *    設回同一個方向，文字框裡必須出現那一份草稿。
 * ③ **讀不到寫「—」、真實 0 寫 0**：同一份草稿裡，一條路段的行駛速率是
 *    空字串（讀不到），另一條是數字 0（現場確實量到 0）。
 *    前者必須寫「—」，後者必須寫「0.0 km/h」。
 *    ⚠️ 兩者要**同時**驗：只驗前者的話，「一律寫「—」」也會通過，
 *      而那會把真實的 0 也藏掉。
 *
 * ⚠️ 每一段都有前置檢查（量不到東西時當場紅），否則整支會變成恆真。
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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());

/* ── IndexedDB 直讀直寫：舊草稿要從儲存層塞進去才算「使用者先前存過的」 ── */
const DB = "TrafficLOSWebV2";
const STORE = "app";
const KEY = "state";
const readState = () =>
  page.evaluate(
    ([db, store, key]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onsuccess = () => {
          const get = request.result
            .transaction(store)
            .objectStore(store)
            .get(key);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
    [DB, STORE, KEY],
  );
const writeState = (next) =>
  page.evaluate(
    ([db, store, key, value]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onsuccess = () => {
          const put = request.result
            .transaction(store, "readwrite")
            .objectStore(store)
            .put(value, key);
          put.onsuccess = () => resolve(true);
          put.onerror = () => reject(put.error);
        };
        request.onerror = () => reject(request.error);
      }),
    [DB, STORE, KEY, next],
  );

const goto = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(800);
};

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await goto("setup");
await page.fill("#projectCode", "DRAFTKEY");
await page.fill("#projectName", "草稿鍵值與缺值守門");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(index) {
  await goto("import");
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index });
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
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}
await importQuarter(0);
await importQuarter(1);

/* ══ 一、只設「方向」時，鍵值要維持 v2.20.68 的四段式 ══════════ */
console.log("\n══ 一、只設「方向」時的鍵值格式（舊草稿能不能讀回來全看這一條）══");
await goto("delivery");
const directions = await page.evaluate(() =>
  [...document.querySelectorAll("#deliveryDirection option")]
    .map((option) => option.value)
    .filter(Boolean),
);
ok(
  "前置：方向下拉有可選的方向（0 個的話下面全部恆真）",
  directions.length > 0,
  `${directions.length} 個：${directions.join("、")}`,
);
const DIRECTION = directions[0];
if (DIRECTION) {
  await page.selectOption("#deliveryDirection", DIRECTION);
  await page.waitForTimeout(600);
  await page.click("#generateDraft");
  await page.waitForTimeout(600);
  const generated = await page.inputValue("#reportDraft");
  ok(
    "前置：草稿真的產生了內容",
    generated.trim().length > 30,
    `${generated.length} 字`,
  );
  await page.click("#saveDraft");
  await page.waitForTimeout(800);

  const saved = await readState();
  const keys = Object.keys(saved?.reportDrafts || {}).filter((key) =>
    key.startsWith("DRAFTKEY|"),
  );
  ok(
    "前置：草稿真的寫進 IndexedDB 了",
    keys.length > 0,
    keys.join(" ／ ") || "（一個鍵都沒有）",
  );
  const written = keys.find((key) => saved.reportDrafts[key] === generated);
  ok(
    "前置：找得到剛才那一份草稿對應的鍵",
    Boolean(written),
    written || "（對不到）",
  );
  if (written) {
    const parts = written.split("|");
    /*
     * 四段式＝`計畫|季別區間|方向|尖峰`（尖峰沒設所以是空字串）。
     * 六段式＝多了路段與日別，那就是 v2.20.71 那個把舊草稿弄丟的寫法。
     */
    ok(
      "⚠️ 只設方向時鍵值必須是四段式（多了路段與日別就會讀不到舊草稿）",
      parts.length === 4,
      `${parts.length} 段：${written}`,
    );
    ok(
      "四段式的第三段是方向、第四段（尖峰）是空的",
      parts[2] === DIRECTION && parts[3] === "",
      `方向「${parts[2]}」、尖峰「${parts[3]}」`,
    );

    /* ══ 二、把舊草稿直接塞進儲存層，畫面要讀得回來 ══════════ */
    console.log("\n══ 二、使用者先前存過的草稿，重新載入之後要讀得回來 ══");
    const OLD_TEXT = "這是 v2.20.68 存下來的舊草稿，必須讀得回來。";
    const next = { ...saved, reportDrafts: { ...saved.reportDrafts } };
    next.reportDrafts[written] = OLD_TEXT;
    await writeState(next);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await goto("delivery");
    await page.selectOption("#deliveryDirection", DIRECTION);
    await page.waitForTimeout(900);
    const reloaded = await page.inputValue("#reportDraft");
    ok(
      "⚠️ 設回同一個方向時，先前存過的草稿要出現在文字框裡",
      reloaded === OLD_TEXT,
      reloaded.slice(0, 40),
    );
  }
}

/* ══ 三、讀不到的欄位寫「—」，真實的 0 照樣寫 0 ══════════════ */
console.log("\n══ 三、同一份草稿裡：讀不到寫「—」、真實 0 寫 0 ══");
const before = await readState();
const mine = (before?.details || []).filter(
  (row) => row.projectCode === "DRAFTKEY",
);
const roads = [...new Set(mine.map((row) => row.road))].sort();
ok(
  "前置：這個計畫至少有兩條路段（只有一條的話沒辦法同時驗兩種）",
  roads.length >= 2,
  `${roads.length} 條：${roads.join("、")}`,
);
if (roads.length >= 2) {
  const [MISSING_ROAD, ZERO_ROAD] = roads;
  const mutated = {
    ...before,
    details: before.details.map((row) => {
      if (row.projectCode !== "DRAFTKEY") return row;
      /*
       * 同一條路段的**每一列**都改，不必去猜代表紀錄會挑到哪一列。
       *   ・空字串＝讀不到（Number("") 是 0，這正是踩過的雷）
       *   ・數字 0＝現場確實量到 0，必須照樣印出來
       */
      if (row.road === MISSING_ROAD) return { ...row, running: "" };
      if (row.road === ZERO_ROAD) return { ...row, running: 0 };
      return row;
    }),
  };
  await writeState(mutated);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await goto("delivery");
  if (DIRECTION) {
    await page.selectOption("#deliveryDirection", DIRECTION);
    await page.waitForTimeout(600);
  }
  await page.click("#generateDraft");
  await page.waitForTimeout(900);
  const text = await page.inputValue("#reportDraft");
  const lineFor = (road) =>
    text.split("\n").find((line) => line.includes(road)) || "";
  const missingLine = lineFor(MISSING_ROAD);
  const zeroLine = lineFor(ZERO_ROAD);
  ok(
    `前置：草稿裡找得到「${MISSING_ROAD}」那一行`,
    missingLine.length > 0,
    missingLine.slice(0, 60),
  );
  ok(
    `前置：草稿裡找得到「${ZERO_ROAD}」那一行`,
    zeroLine.length > 0,
    zeroLine.slice(0, 60),
  );
  ok(
    "⚠️ 讀不到的行駛速率要寫「—」，不可以寫 0",
    /行駛速率\s*—/.test(missingLine),
    missingLine.match(/行駛速率[^、]*/)?.[0] || "（找不到行駛速率那一段）",
  );
  ok(
    "⚠️ 真實量到的 0 要照樣寫 0，不可以也變成「—」",
    /行駛速率\s*0(\.0+)?\s*km\/h/.test(zeroLine),
    zeroLine.match(/行駛速率[^、]*/)?.[0] || "（找不到行駛速率那一段）",
  );
}

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.join(" ／ "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  for (const item of problems) console.error(`   ・${item}`);
  process.exit(1);
}
console.log("\n✅ 草稿鍵值相容、缺值寫「—」、真實 0 寫 0 全部通過");
