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
    /*
     * 只供複查反證：拆掉整頁遮罩（但保留控制項停用），
     * 下面「讀取期間不可以看到 0 與『尚未建立計畫』」那幾條必須轉紅。
     * 拆不掉的話就是恆真，那比沒有守門更糟。
     */
    if (process.env.NEGATIVE_CURTAIN_PROOF === "1")
      instrumented = instrumented.replace(
        "function setLoadCurtain(loading) {",
        "function setLoadCurtain(loading) { return;",
      );
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
  /*
   * ⚠️ 2026-09-29 加（使用者裁示：比照路口轉向整頁擋掉）。
   *   停用控制項只擋得住「按下去」，擋不住「看下去」：實測讀取那幾秒，
   *   計畫下拉寫「尚未建立計畫」、首頁四張卡全是 0、下一步寫
   *   「建立第一個計畫」——而那台電腦裡其實有資料。使用者看到這個畫面
   *   會去還原舊備份或重新匯入，那是存檔閘門擋不住的。
   *   所以這裡不是問「有沒有遮罩」，而是問「使用者到底看不看得到那些數字」。
   */
  curtain: (() => {
    const el = document.getElementById("loadCurtain");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      covers: rect.width >= window.innerWidth && rect.height >= window.innerHeight,
      fixed: style.position === "fixed",
      z: Number(style.zIndex) || 0,
      text: el.innerText,
    };
  })(),
  /*
   * 「使用者到底看不看得到」要用**命中測試**，不是看 display／visibility：
   * 被蓋住的元素照樣是 display:block。這裡對每一個含有誤導字樣的元素取中心點，
   * 問 document.elementFromPoint() 那個點上最上層的是誰——是過場就代表被蓋住了。
   */
  misleadingVisible: (() => {
    const words = ["尚未建立計畫", "建立第一個計畫", "尚無資料"];
    const curtainEl = document.getElementById("loadCurtain");
    const seen = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length) continue;
      const text = el.textContent.trim();
      const word = words.find((w) => text.includes(w));
      if (!word) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      const coveredByCurtain = Boolean(curtainEl && top && curtainEl.contains(top));
      if (!coveredByCurtain && top && (top === el || el.contains(top) || top.contains(el)))
        seen.push(word);
    }
    return [...new Set(seen)];
  })(),
}));
ok("讀取期間要有一張蓋滿整個視窗的過場（position:fixed、蓋滿、疊在最上層）",
  Boolean(pendingUi.curtain) && pendingUi.curtain.covers && pendingUi.curtain.fixed
    && pendingUi.curtain.z >= 1000,
  JSON.stringify(pendingUi.curtain && {
    covers: pendingUi.curtain.covers, fixed: pendingUi.curtain.fixed, z: pendingUi.curtain.z,
  }));
ok("過場上要寫明正在讀取，而且要講「不會顯示空白的主畫面」",
  Boolean(pendingUi.curtain) && pendingUi.curtain.text.includes("正在讀取這台電腦上的資料")
    && pendingUi.curtain.text.includes("不會顯示空白的主畫面"),
  pendingUi.curtain ? pendingUi.curtain.text.replace(/\s+/g, " ").slice(0, 60) : "沒有過場");
/*
 * ⚠️ 這一條才是真正要守的東西：不是「有沒有遮罩」，是「使用者看不看得到
 *   那些會被誤讀成『資料不見了』的字」。用可見文字量，而不是列元素清單——
 *   列清單一定會漏，這一組系統已經為了同一個理由改過一次。
 */
ok("讀取期間使用者看不到「資料不見了」那一類字樣（命中測試，不是看 display）",
  pendingUi.misleadingVisible.length === 0,
  `看得到的：${pendingUi.misleadingVisible.join("、") || "（無）"}`);
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
  /* 讀完之後過場一定要收掉，否則就是把使用者永遠關在外面。 */
  curtain: Boolean(document.getElementById("loadCurtain")),
}));
ok("讀取完成後過場要收掉", readyUi.curtain === false, `還在：${readyUi.curtain}`);
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
