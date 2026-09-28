/* 端對端：IndexedDB 還沒讀完以前，save() 不得把啟動空白值寫回。
 * 反證（v2.20.75）：把 load() 延後 1.5 秒，期間呼叫 save()，原本 KEEP
 * 計畫會被空白 state 覆蓋；測試伺服器只注入讀取延遲，不改存檔路徑。 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  if (p === "/blank.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>blank</title>"); return;
  }
  const file = join(here, p);
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  let body = readFileSync(file);
  if (p === "/index.html" && process.env.NEGATIVE_UI_PROOF === "1")
    body = Buffer.from(body.toString("utf8").replace(
      "正在讀取這台電腦上的資料…", "尚未建立計畫"));
  if (p === "/app.js") {
    const source = body.toString("utf8");
    const marker = "async function load() {\n  try {";
    if (!source.includes(marker)) throw new Error("找不到 load() 注入點");
    let instrumented = source.replace(marker,
      "async function load() {\n  await new Promise((done) => setTimeout(done, 1500));\n  try {");
    /* 只供複查反證：刻意拆掉閘門時，本測試必須轉紅，證明不是恆真。 */
    if (process.env.NEGATIVE_PROOF === "1")
      instrumented = instrumented.replace('if (loadPhase !== "ready") {', "if (false) {");
    if (process.env.NEGATIVE_UI_PROOF === "1")
      instrumented = instrumented
        .replace("function setLoadUi(loading) {", "function setLoadUi(loading) { return;")
        .replaceAll('loadPhase === "loading"', "false");
    body = Buffer.from(instrumented);
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
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
await page.goto(`${base}blank.html`);
await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("TrafficLOSWebV2", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("app");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const tx = request.result.transaction("app", "readwrite");
    tx.objectStore("app").put({ version: 10,
      projects: [{ code: "KEEP", name: "不可遺失的原計畫" }], activeCode: "KEEP",
      details: [], yearStyle: "roc" }, "state");
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  };
}));
const readDb = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("TrafficLOSWebV2");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const get = request.result.transaction("app").objectStore("app").get("state");
    get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
  };
}));

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof save === "function");
const pendingUi = await page.evaluate(() => ({
  head: document.getElementById("headProject")?.textContent || "",
  busy: document.body.getAttribute("aria-busy"),
  saveProject: document.getElementById("saveProject")?.disabled,
  importFile: document.getElementById("files")?.disabled,
  preview: document.getElementById("preview")?.disabled,
  restore: document.getElementById("restoreFile")?.disabled,
  /*
   * ⚠️ 2026-09-27 加：閘門原本只列四塊，而 save() 有 31 個呼叫點、
   *   其中 23 個在 await save() 之後緊接著就報成功，且沒有一個檢查回傳值。
   *   於是「套用並重算 LOS」「判定標準／套用並重新計算」這類沒被列到的按鈕，
   *   在讀取期間按下去會看到成功訊息，而那一步其實沒有寫入、
   *   還會在 load() 完成時被整個換掉。所以這裡逐一釘住，
   *   並且另外數一次「還有幾個可用的控制項」——列清單一定會漏，數量不會。
   */
  applySpeed: document.getElementById("applySpeed")?.disabled,
  applyLosRules: document.getElementById("applyLosRules")?.disabled,
  viewControls: document.querySelectorAll(
    "main .view button, main .view input, main .view select, main .view textarea",
  ).length,
  enabledViewControls: [
    ...document.querySelectorAll(
      "main .view button, main .view input, main .view select, main .view textarea",
    ),
  ].filter((el) => !el.disabled).length,
}));
ok("讀取期間要明講正在讀取，不可斷定尚未建立計畫",
  pendingUi.head.includes("正在讀取") && !pendingUi.head.includes("尚未建立計畫"), pendingUi.head);
ok("讀取期間要標示頁面忙碌中", pendingUi.busy === "true", `aria-busy ${pendingUi.busy}`);
ok("讀取期間要停用建立、批次匯入與還原入口",
  pendingUi.saveProject && pendingUi.importFile && pendingUi.preview && pendingUi.restore,
  JSON.stringify(pendingUi));
ok("讀取期間要停用「套用並重算 LOS」與判定標準的套用鈕",
  pendingUi.applySpeed === true && pendingUi.applyLosRules === true,
  `applySpeed=${pendingUi.applySpeed} applyLosRules=${pendingUi.applyLosRules}`);
/* 前置檢查：真的掃到控制項，否則選擇器一改這一條就恆真。 */
ok("前置：掃得到畫面上的控制項", pendingUi.viewControls > 30,
  `掃到 ${pendingUi.viewControls} 個`);
ok("讀取期間不可以還有任何會改資料的控制項是可用的",
  pendingUi.enabledViewControls === 0,
  `還有 ${pendingUi.enabledViewControls} 個可用`);
const blocked = await page.evaluate(() => save());
ok("讀取期間的 save() 必須明確拒絕寫入", blocked === false, `回傳 ${String(blocked)}`);
const during = await readDb();
ok("讀取尚未完成時，IndexedDB 原計畫仍在", (during.projects || []).some((p) => p.code === "KEEP"));
await page.waitForFunction(() => document.querySelector("#projectSwitch")?.value === "KEEP", null,
  { timeout: 5000 });
const readyUi = await page.evaluate(() => ({
  head: document.getElementById("headProject")?.textContent || "",
  busy: document.body.getAttribute("aria-busy"),
  saveProject: document.getElementById("saveProject")?.disabled,
  importFile: document.getElementById("files")?.disabled,
  preview: document.getElementById("preview")?.disabled,
  restore: document.getElementById("restoreFile")?.disabled,
}));
ok("正常讀取完成後不可卡在載入畫面",
  readyUi.head.includes("KEEP") && readyUi.busy === "false" &&
    !readyUi.saveProject && !readyUi.importFile && !readyUi.preview && !readyUi.restore,
  JSON.stringify(readyUi));
const afterLoad = await readDb();
ok("讀取完成後，畫面與 IndexedDB 都保留原計畫",
  (afterLoad.projects || []).some((p) => p.code === "KEEP") &&
    await page.locator("#projectSwitch").inputValue() === "KEEP");
const savedAfterReady = await page.evaluate(async () => { state.yearStyle = "ad"; return save(); });
const finalState = await readDb();
ok("閘門只擋讀取期間，完成後仍可正常存檔",
  savedAfterReady === true && finalState.yearStyle === "ad",
  `回傳 ${String(savedAfterReady)}、yearStyle ${finalState.yearStyle}`);

await browser.close(); server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
