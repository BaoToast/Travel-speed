/*
 * 端對端：瀏覽器不讓網站用本機儲存空間時，搶救畫面不可以說謊。
 *
 * 起因（實測，v2.20.43）：把 window.indexedDB 改成「存取即拋錯」——
 * 也就是瀏覽器設定成「封鎖所有 Cookie／網站資料」時的實際行為——畫面顯示：
 *   「儲存在瀏覽器裡的資料有一部分格式不符…
 *     您的原始資料仍然完整保留在瀏覽器裡。」
 * 兩句話都不成立：資料沒有損壞，這台電腦上根本沒有本系統的資料。
 * 接著按「下載原始資料備份」→ 跳「備份下載失敗：IndexedDB 已被停用」。
 * 使用者不知道真正原因（瀏覽器封鎖網站資料），也不知道怎麼解。
 *
 * 三支系統在同一情境下的對照（都實測過）：
 *   全日交通量   → toast「IndexedDB 已被停用」，畫面正常、不假裝存檔成功
 *   路口轉向     → 整頁空白（v2.1.52 已修）
 *   交通服務水準 → 搶救畫面文案與現實相反　← 這一支要修的
 *
 * ⚠️ 假通過陷阱兩個：
 *  一、只驗「畫面不是空的」不夠——原本那個說謊的畫面也不是空的。
 *      所以要驗**指定的那段說明**，並且反面驗「不可以再出現那句話」。
 *  二、要順便驗「儲存空間正常時不可以誤跳這個畫面」，否則寫成無條件顯示
 *      也會通過。
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
  if (p === "/blank.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>blank</title>");
    return;
  }
  const f = join(here, p);
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((done) => server.listen(8243, done));
const base = "http://127.0.0.1:8243/";

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "\u2705" : "\u274c"} ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  if (!condition) problems.push(label);
};

const browser = await chromium.launch(launchOptions());

/* \u2500\u2500 \u4e00\u3001\u5132\u5b58\u7a7a\u9593\u88ab\u5c01\u9396 \u2500\u2500 */
const blockedCtx = await browser.newContext({ acceptDownloads: true });
const blocked = await blockedCtx.newPage();
const blockedErrors = [];
const alerts = [];
blocked.on("pageerror", (e) => blockedErrors.push(String(e.message)));
blocked.on("dialog", (d) => { alerts.push(d.message()); d.accept(); });
await blocked.addInitScript(() => {
  Object.defineProperty(window, "indexedDB", {
    get() { throw new DOMException("IndexedDB 已被停用", "SecurityError"); },
  });
});
await blocked.goto(base, { waitUntil: "networkidle" });
await blocked.waitForTimeout(1800);

const view = await blocked.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  hasDownload: Boolean(document.getElementById("rescueDownload")),
  hasReload: Boolean(document.getElementById("rescueReload")),
}));

ok("封鎖儲存空間時，畫面不可以是空白的", view.text.length > 30, `畫面有 ${view.text.length} 個字`);
ok("要明講是「瀏覽器不允許儲存」，不是資料損壞",
  /瀏覽器不允許這個網站儲存資料/.test(view.text), view.text.slice(0, 60));
ok("不可以再說「資料有一部分格式不符」", !/資料有一部分格式不符/.test(view.text));
ok("不可以再說「原始資料仍然完整保留在瀏覽器裡」", !/原始資料仍然完整保留/.test(view.text));
ok("要給得出處理方式（封鎖 Cookie／無痕／擴充套件）",
  /封鎖所有 Cookie/.test(view.text) && /無痕/.test(view.text) && /擴充套件/.test(view.text));
ok("不可以提供一定會失敗的「下載原始資料備份」", !view.hasDownload,
  view.hasDownload ? "下載鈕還在" : "已移除");
ok("要給一條出路（調整設定後重新載入）", view.hasReload);
ok("要提醒使用者現在不要匯入", /請不要匯入資料/.test(view.text));
ok("不可以留下未捕捉的例外", blockedErrors.length === 0, blockedErrors.slice(0, 2).join(" | ") || "沒有例外");
await blockedCtx.close();

/* 既有資料庫版本較高時仍要讀取，不可以把 VersionError 說成瀏覽器封鎖。 */
const versionedCtx = await browser.newContext();
const versioned = await versionedCtx.newPage();
const versionedErrors = [];
versioned.on("pageerror", (e) => versionedErrors.push(String(e.message)));
await versioned.goto(`${base}blank.html`);
await versioned.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("TrafficLOSWebV2", 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("app")) db.createObjectStore("app");
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction("app", "readwrite");
    tx.objectStore("app").put({
      version: 10,
      projects: [{ code: "HIGH", name: "較新版資料庫計畫" }],
      activeCode: "HIGH",
      details: [],
    }, "state");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}));
await versioned.goto(base, { waitUntil: "networkidle" });
await versioned.waitForTimeout(1800);
const versionedView = await versioned.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  hasLoadError: Boolean(document.querySelector(".load-error")),
  projectCodes: [...document.querySelectorAll("#projectSwitch option")].map((x) => x.value),
}));
ok("較高版本資料庫不可以誤判為瀏覽器封鎖",
  !/瀏覽器不允許這個網站儲存資料/.test(versionedView.text) && !versionedView.hasLoadError,
  versionedView.text.slice(0, 60));
ok("較高版本資料庫仍可載入原計畫",
  versionedView.projectCodes.includes("HIGH"),
  `計畫：${versionedView.projectCodes.join(", ") || "無"}`);
ok("較高版本資料庫情境不可以有未捕捉的例外",
  versionedErrors.length === 0, versionedErrors.slice(0, 2).join(" | ") || "沒有例外");
await versionedCtx.close();

/* \u2500\u2500 \u4e8c\u3001\u6b63\u5e38\u60c5\u5883 \u2500\u2500 */
const normalCtx = await browser.newContext();
const normal = await normalCtx.newPage();
const normalErrors = [];
normal.on("pageerror", (e) => normalErrors.push(String(e.message)));
await normal.goto(base, { waitUntil: "networkidle" });
await normal.waitForTimeout(1800);
const normalView = await normal.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  nav: document.querySelectorAll("nav button").length,
}));
ok("前置：儲存空間正常時是正常主畫面，不可以誤跳封鎖說明",
  normalView.nav > 3 && !/瀏覽器不允許這個網站儲存資料/.test(normalView.text),
  `導覽列 ${normalView.nav} 個項目`);
ok("正常情境也不可以有未捕捉的例外", normalErrors.length === 0, normalErrors.slice(0, 2).join(" | "));
await normalCtx.close();

await browser.close();
server.close();
console.log(problems.length ? `\n\u274c ${problems.length} 項未通過` : "\n\u2705 全部通過");
process.exit(problems.length ? 1 : 0);
