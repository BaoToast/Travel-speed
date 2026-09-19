/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-41：人工確認過的「方向對應不一致」要消得掉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附圖，追問兩次）：
 *   「調查員因為寫錯A資料的a路段名稱，在匯入時我已經指定系統，
 *     將a路段併入既有路段中，然後我在路段管理分頁中，
 *     將該路段統一了方向名稱，但做資料異常檢查時，
 *     它仍就把這個方向名稱不一致的問題點出來給我……
 *     變成我一定要去修改原始檔，重新匯入?」
 *
 * 他做的兩件事都碰不到那個檢查：檢查比對的是**原始報告上的方向文字**
 *（從 Excel 讀進來的），而「併入路段」改的是路段、「統一方向名稱」改的是
 * 顯示名稱。這一項因此永遠消不掉，唯一的出路變成回去改原始檔重匯——
 * 而原始檔是調查廠商交來的。
 *
 * 現在：**在「路段管理 → 方向顯示名稱」命過名，就視為人工確認，不再提醒。**
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資一定要真的觸發那一項**。兩季的方向文字必須不同，
 *     否則這一項本來就不會出現，整支恆真。所以先驗「命名之前它在」。
 * 二、**不可以把檢查整個拿掉**。命名的是方向1，就只有方向1 不再提醒；
 *     方向2 沒命名的話照樣要提醒——所以這一支只命名其中一個方向。
 * 三、要驗**訊息有告訴使用者出口在哪**。不講的話，使用者下一次還是卡住。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
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
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "DIRCONF");
await page.fill("#projectName", "方向確認守門");
await page.click("#saveProject");
await page.waitForTimeout(500);

/*
 * ⚠️ 測資自己產：同一條路段、兩季，**第二季的方向文字換了一種寫法**
 *   （使用者遇到的正是這個：國昌路 → 國強路，調查員打錯一個字）。
 *   fixtures 產生器只出一種寫法，所以這裡照它的版型自己組兩份。
 * ⚠️ 兩份的**路段名稱必須一樣**（同一條路段才會被拿來互比），
 *   只有方向文字不同——不然這一支測到的是別的東西。
 */
const directionBlock = ({ travel, running, roadDelay, junctionDelay, text }) => [
  ["旅次編號"],
  [`方向 往：${text}`],
  ["路段延滯"],
  [roadDelay],
  ["交叉口延滯"],
  [junctionDelay],
  ["平均總旅行速率", travel],
  ["平均總行駛速率", running],
  [],
];
const makeBook = (forward, backward) => {
  const sheet = () =>
    XLSX.utils.aoa_to_sheet([
      ...directionBlock({
        travel: 31.2,
        running: 38.4,
        roadDelay: 61,
        junctionDelay: 42,
        text: forward,
      }),
      ...directionBlock({
        travel: 28.6,
        running: 35.1,
        roadDelay: 74,
        junctionDelay: 51,
        text: backward,
      }),
    ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet(), "上午尖峰");
  XLSX.utils.book_append_sheet(book, sheet(), "下午尖峰");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
};
const importQuarter = async (quarterIndex, NAME, buf) => {
  await page.evaluate(() =>
    document.querySelector('[data-view="import"]').click(),
  );
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
  await page.setInputFiles("#files", [
    {
      name: NAME,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buf,
    },
  ]);
  await page.click("#preview");
  await page.waitForTimeout(3500);
  /*
   * ⚠️ 檔名與既有路段很像時，預覽會要求先決定「新增還是併入」——
   *   那正是使用者說的「匯入時我已經指定系統，將a路段併入既有路段中」。
   *   守門要走同一條路，不可以繞過去。
   */
  const decided = await page.evaluate(() => {
    let done = 0;
    for (const select of document.querySelectorAll(".view.active select")) {
      const merge = [...select.options].find((option) =>
        (option.textContent || "").startsWith("合併至："),
      );
      if (!merge) continue;
      select.value = merge.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      done += 1;
    }
    return done;
  });
  if (decided) await page.waitForTimeout(1200);
  await page.click("#commit");
  await page.waitForTimeout(1800);
};
/*
 * ⚠️ 重現使用者的真實情境：**調查員把路段名稱打錯**，所以那一份變成
 *   另一條路段；使用者用「合併重複路段」把它併回來。合併之後同一條路段
 *   底下就出現了兩種方向寫法——這才是「方向對應不一致」真正會發作的路徑。
 *
 * ⚠️ 用「同一條路段、不同季、不同方向寫法」是**測不到**的：
 *   匯入時 adoptDirectionNames() 會沿用第一次看到的寫法，兩季會一樣。
 *   （我第一版就是這樣寫的，實測 0 列，紀錄在這裡免得有人再走一次。）
 */
const NAME = "99999TS9-01-方向守門路段(甲路～乙路)-平日.xlsx";
/* 兩季都匯同一份檔，資料結構完全正常。 */
await importQuarter(1, NAME, makeBook("甲路口--->乙路口", "乙路口--->甲路口"));
await importQuarter(2, NAME, makeBook("甲路口--->乙路口", "乙路口--->甲路口"));

/*
 * ⚠️ 只把**第二季的方向文字**改成另一種寫法，其餘一個欄位都不動——
 *   那正是使用者遇到的事（調查員在某一季把路名打錯／換了寫法）。
 *
 * ⚠️ 為什麼不從 Excel 直接產兩種寫法：匯入時 `adoptDirectionNames()`
 *   會沿用第一次看到的寫法當顯示名稱，而合併／同季覆蓋又會讓第二份消失，
 *   兩條路都試過、都測不到（紀錄在這裡，免得有人再走一次）。
 *   直接改已經正常寫入的那一份，才是乾淨的做法。
 */
const seeded = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("TrafficLOSWebV2");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const state = await new Promise((resolve, reject) => {
    const request = db.transaction("app").objectStore("app").get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let touched = 0;
  const last = [...new Set(state.details.map((row) => row.period))].sort().pop();
  for (const row of state.details)
    if (row.period === last && row.directionText) {
      row.directionText = `${row.directionText}段`;
      touched += 1;
    }
  await new Promise((resolve, reject) => {
    const request = db
      .transaction("app", "readwrite")
      .objectStore("app")
      .put(state, "state");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return touched;
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const gotoView = async (view) => {
  await page.evaluate((id) => {
    document.querySelector(`[data-view="${id}"]`)?.click();
  }, view);
  await page.waitForTimeout(900);
};
/** 跑一次異常檢查，回傳「方向對應不一致」那幾列的文字。 */
const mismatchRows = async () => {
  await gotoView("maintenance");
  const run = page.locator("#runHealth");
  if (await run.count()) {
    await run.click();
    await page.waitForTimeout(1800);
  }
  return page.evaluate(() =>
    [...document.querySelectorAll("#healthRows tr")]
      .map((tr) => (tr.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => text.includes("方向對應不一致")),
  );
};

console.log("\n[診斷] 主工具列季度選項 =", await page.evaluate(()=>[...document.querySelectorAll('[data-testid="mt-period-from"] option')].map(o=>o.value)));
await page.evaluate(()=>document.querySelector('[data-view="detail"]')?.click());
await page.waitForTimeout(900);
console.log("[診斷] 尖峰明細列數 =", await page.evaluate(()=>document.querySelectorAll("#detailRows tr").length));
console.log("[診斷] 明細前兩列 =", await page.evaluate(()=>[...document.querySelectorAll("#detailRows tr")].slice(0,2).map(tr=>(tr.textContent||"").replace(/\s+/g," ").trim().slice(0,90))));

console.log("\n══ 一、命名之前，這一項要在 ══");
ok("前置：第二季的方向文字改成另一種寫法", seeded > 0, `改了 ${seeded} 列`);
const before = await mismatchRows();
console.log("[診斷] 檢查結果全部列：", await page.evaluate(()=>[...document.querySelectorAll("#healthRows tr")].map(tr=>(tr.textContent||"").replace(/\s+/g," ").trim().slice(0,70))));
ok(
  "⚠️ ① 命名之前確實列出「方向對應不一致」（不然後面恆真）",
  before.length >= 2,
  `${before.length} 列`,
);
ok(
  "① 訊息要告訴使用者出口在哪（不講的話下一次還是卡住）",
  before.some((text) => text.includes("方向顯示名稱")),
  before[0]?.slice(0, 120) ?? "",
);

/* ══ 二、只替方向1 命名 ══════════════════════════════════════ */
console.log("\n══ 二、替方向1 命名之後 ══");
await gotoView("roadadmin");
await page.waitForTimeout(600);
const road = await page.evaluate(() => {
  const select = document.getElementById("directionRoad");
  const value = select?.options[0]?.value ?? "";
  if (select) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return value;
});
ok("前置：選得到一條路段", Boolean(road), road);
await page.fill("#directionA", "北上");
await page.click("#saveDirections");
await page.waitForTimeout(1200);

const after = await mismatchRows();
ok(
  "⚠️ ② 按過「儲存方向名稱」之後，這條路段的「方向對應不一致」全部消失",
  after.length === 0,
  after.map((text) => text.slice(0, 40)).join(" ｜ ") || "（一列都沒有）",
);
/*
 * ⚠️ 反面：**不可以把整張檢查清單關掉**。
 *   我第一版用「方向名稱不是預設值」當判斷，結果因為匯入時會自動採用
 *   報告文字，整個檢查被關掉了——守門就是這樣抓到的。
 *   所以這裡驗其他類型的異常還在。
 */
const others = await page.evaluate(() =>
  [...document.querySelectorAll("#healthRows tr")]
    .map((tr) => (tr.textContent || "").replace(/\s+/g, " ").trim())
    .filter((text) => !text.includes("方向對應不一致")),
);
ok(
  "⚠️ ② 其他類型的異常照樣列出來（確認的是這一項，不是把檢查整個關掉）",
  others.some((text) => text.includes("速限未確認")) &&
    others.some((text) => text.includes("日別不完整")),
  others.map((text) => text.slice(0, 26)).join(" ｜ "),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 方向對應不一致：命名＝人工確認，消得掉；沒命名的照樣提醒");
