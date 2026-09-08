/*
 * 端對端：資料讀不出來時，不可以靜靜清空、更不可以被下一次存檔覆蓋掉。
 *
 * 舊版 load() 的 catch 是 `state = emptyState()` 然後照常 renderAll()：
 * 畫面變成「尚未建立計畫」，沒有 toast、沒有例外、沒有任何訊息。
 * 使用者以為資料沒了，於是重建計畫或重新匯入——那個動作呼叫 save()，
 * 把空白 state 寫回 IndexedDB，**原始資料這時候才真的消失**，救不回來。
 *
 * 實測（種入一筆會讓 rebuild() 丟例外的壞紀錄）：
 *   重新載入 → 計畫選單「尚未建立計畫」、toast 空白、無頁面錯誤
 *   此時 DB 裡原始計畫其實還在
 *   按一次「儲存計畫設定」→ DB 只剩新計畫，原始計畫消失
 *
 * 路口轉向已修過同一個缺陷（loadError ＋ 整頁搶救指引），這一支比照。
 *
 * ⚠️ 假通過陷阱：如果種入的壞資料根本沒讓載入失敗，整支測試會變成
 *    「正常開啟也會通過」。所以一定要先驗「載入確實失敗了」——
 *    也就是搶救畫面真的出現、主畫面表單真的進不去。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(here, p);
  if (!existsSync(f)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((done) => server.listen(0, done));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
/*
 * 搶救畫面出現時，底下不可以有東西默默壞掉。
 *
 * showLoadError() 會把整個 .app 換掉，但 index.html 在 app.js 之後還載入
 * conclusion.js 與 quality-extension.js，那兩支在頂層就會去找主畫面裡的
 * 節點（例如 `q("roadAlert").after(importPanel)`）。換得太早就會丟
 * 「Cannot read properties of null (reading 'after')」。
 *
 * ⚠️ 誠實標註：**這一項在 v2.20.43 就是綠的**，因為這一支走的是「資料壞掉」
 *    那條路——它要先 reload、再等 IndexedDB 非同步讀完，那時候所有腳本
 *    早就跑完了。真正會踩到的是「儲存空間被封鎖」那條路（openDB 同步丟例外，
 *    catch 立刻執行），實測未修正版紅字，見 e2e-storage-blocked.mjs。
 *    這裡留著是**不許改壞的鎖**，不是問題重現。
 */
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const readDb = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("TrafficLOSWebV2", 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const getAll = request.result
            .transaction("app", "readonly")
            .objectStore("app")
            .getAll();
          getAll.onsuccess = () => resolve((getAll.result || [])[0] ?? null);
          getAll.onerror = () => resolve(null);
        };
      }),
  );

/* 先讓程式自己建立一份「使用者辛苦做出來的」資料 */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "REAL");
await page.fill("#projectName", "使用者的重要計畫");
await page.click("#saveProject");
await page.waitForTimeout(1200);
const before = await readDb();
ok(
  "前置：原始資料確實已經存進瀏覽器",
  Boolean(before) && (before.projects || []).some((p) => p.code === "REAL"),
  `計畫 ${(before?.projects || []).map((p) => p.code).join("、") || "（無）"}`,
);

/* 種一筆會讓 rebuild() 丟例外的壞紀錄，模擬資料格式不符 */
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open("TrafficLOSWebV2", 1);
      request.onsuccess = () => {
        const store = request.result
          .transaction("app", "readwrite")
          .objectStore("app");
        const read = store.get("state");
        read.onsuccess = () => {
          const blob = read.result;
          blob.details = [null];
          store.put(blob, "state");
          store.transaction.oncomplete = () => resolve(true);
        };
      };
    }),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const view = await page.evaluate(() => ({
  rescue: Boolean(document.querySelector(".load-error")),
  reachMain: Boolean(document.querySelector('[data-view="setup"]')),
  text: document.body.innerText.slice(0, 200),
}));
/* 前置：載入真的失敗了，否則下面幾項都不成立 */
ok(
  "前置：這份資料確實讓載入失敗了（搶救畫面有出現）",
  view.rescue,
  view.rescue ? "已顯示搶救畫面" : `畫面是「${view.text.replace(/\n/g, " ").slice(0, 60)}」`,
);
ok(
  "讀取失敗時不可以只是靜靜變空白——要換成搶救指引",
  view.rescue && !view.reachMain,
  view.reachMain ? "主畫面表單仍然進得去" : "主畫面已被搶救畫面取代",
);

const midway = await readDb();
ok(
  "此時原始資料仍完整留在瀏覽器裡（還沒被動到）",
  Boolean(midway) && (midway.projects || []).some((p) => p.code === "REAL"),
  `計畫 ${(midway?.projects || []).map((p) => p.code).join("、") || "（無）"}`,
);

/* 使用者以為資料沒了、做任何會存檔的動作——存檔必須被擋下 */
await page.evaluate(() => {
  try {
    if (typeof save === "function") save();
  } catch (error) {
    void error;
  }
});
await page.waitForTimeout(1200);
const after = await readDb();
ok(
  "讀取失敗之後任何存檔都不可以覆蓋掉原始資料",
  Boolean(after) && (after.projects || []).some((p) => p.code === "REAL"),
  `計畫 ${(after?.projects || []).map((p) => p.code).join("、") || "（無）"}、明細 ${(after?.details || []).length} 筆`,
);
ok(
  "搶救畫面要提供「下載原始資料備份」",
  await page.evaluate(() => Boolean(document.getElementById("rescueDownload"))),
);
ok(
  "顯示搶救畫面的過程中不可以有未捕捉的例外",
  pageErrors.length === 0,
  pageErrors.slice(0, 2).join(" | ") || "沒有例外",
);

const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#rescueDownload"),
]);
const downloadPath = await download.path();
const rescued = JSON.parse(readFileSync(downloadPath, "utf8"));
ok(
  "搶救下載必須真的包含原計畫與造成失敗的原始紀錄",
  (rescued.projects || []).some((p) => p.code === "REAL") &&
    Array.isArray(rescued.details) && rescued.details.length === 1 && rescued.details[0] === null,
  `計畫 ${(rescued.projects || []).map((p) => p.code).join("、") || "（無）"}、明細 ${(rescued.details || []).length} 筆`,
);

const writeDb = (value) =>
  page.evaluate(
    (next) =>
      new Promise((resolve) => {
        const request = indexedDB.open("TrafficLOSWebV2", 1);
        request.onsuccess = () => {
          const transaction = request.result.transaction("app", "readwrite");
          transaction.objectStore("app").put(next, "state");
          transaction.oncomplete = () => resolve(true);
        };
      }),
    value,
  );

/* 可讀取但完全不含計畫結構的根物件，不得被 emptyState 掩蓋。 */
await writeDb({ unexpected: "仍是原始內容" });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
ok(
  "根資料格式完全不符時也必須進入搶救模式，不可被空白預設值掩蓋",
  await page.evaluate(() => Boolean(document.querySelector(".load-error"))),
);

/* 合法的舊版單計畫根格式仍須正常移轉，不能被新檢查誤擋。 */
await writeDb({
  project: { code: "OLD", name: "舊版計畫" },
  details: [],
  limits: {},
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const legacyView = await page.evaluate(() => ({
  rescue: Boolean(document.querySelector(".load-error")),
  code: document.querySelector("#projectSwitch")?.value || "",
}));
ok(
  "舊版單計畫格式仍可正常移轉",
  !legacyView.rescue && legacyView.code === "OLD",
  `搶救畫面 ${legacyView.rescue ? "有" : "無"}、目前計畫 ${legacyView.code || "（無）"}`,
);

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
