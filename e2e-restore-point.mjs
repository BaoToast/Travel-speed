/*
 * ══════════════════════════════════════════════════════════════════════
 *  還原點（版本差異與還原）：真的存了、真的還原得回來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「(甲) 補上，和另外兩支一樣（每次匯入／人工修改／刪除前自動留還原點，
 *     最多保留最近 30 次），要反覆確認功能正常，因為這類功能我無法替你
 *     確認是否正常，這類我無法驗證，要過很久才知道的功能，
 *     三項程式都要特別謹慎檢查。」
 *
 * ⚠️ 他說得對，而且這是這支測試存在的全部理由：
 *   **還原點壞掉的時候，平常完全看不出來。** 沒存到、存錯、或還原回去的
 *   內容不完整，都要等到真的出事、真的要救資料的那一天才會發現——
 *   而那一天已經來不及了。所以不可以只驗「按下去有反應」。
 *
 * 驗六件事：
 *   ① 匯入之前真的留了還原點（舊版這一條路徑完全沒有）
 *   ② 還原之後的資料與動手前**逐筆逐欄相同**，不是筆數對了就算
 *   ③ 快照裡確實含操作前的內容（不是事後才拍的）
 *   ④ 刪除還原點**不會動到現在的資料**（面板上就是這樣寫的，要成立）
 *   ⑤ 保留上限是 8（2026-09-16 由 30 降下來），而且丟掉的是**最舊的**
 *   ⑥ 還原點會跟著單一計畫的備份走（舊版只有全部計畫的備份有帶）
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(here, p);
  if (!existsSync(f)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((done) => server.listen(0, done));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const SAMPLE_DIR = join(here, "test-fixtures");
if (!existsSync(SAMPLE_DIR)) {
  console.log("❌ 找不到匿名回歸測資，請先執行 npm run fixtures");
  server.close();
  process.exit(1);
}
const names = readdirSync(SAMPLE_DIR).filter((n) => /\.xlsx?$/i.test(n));
const batch = names.map((name) => ({
  name,
  mimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(join(SAMPLE_DIR, name)),
}));

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/** 讀 IndexedDB 裡那一整包 state。 */
const readState = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("TrafficLOSWebV2");
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("app").objectStore("app").get("state");
          get.onsuccess = () => resolve(get.result || null);
          get.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
      }),
  );

/**
 * 一份可以逐欄比對的資料指紋。
 *
 * ⚠️ 不可以只比筆數。「筆數對了」完全不代表內容一樣——
 *   還原回去少了速限、少了路段名稱、LOS 沒重算，筆數都還是一樣的，
 *   而那些正是真的出事那天會害人的東西。
 */
const fingerprint = (state, code) => {
  if (!state) return null;
  const rows = (state.details || [])
    .filter((x) => x.projectCode === code)
    .map((x) => JSON.stringify(x))
    .sort();
  const bag = (name) =>
    Object.entries(state[name] || {})
      .filter(([k]) => k.startsWith(`${code}|`))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .sort();
  return JSON.stringify({
    rows,
    limits: bag("limits"),
    aliases: bag("aliases"),
    roadMeta: bag("roadMeta"),
    speedVersions: bag("speedVersions"),
    losRule: state.losRules?.[code] ?? null,
    bandRule: state.bandRules?.[code] ?? null,
  });
};

const CODE = "RESTORE";
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", CODE);
await page.fill("#projectName", "還原點測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

const runImport = async (quarterIndex) => {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
  await page.setInputFiles("#files", batch);
  await page.waitForTimeout(300);
  await page.click("#preview");
  await page.waitForFunction(
    () => !document.getElementById("preview").disabled,
    null,
    { timeout: 30000 },
  );
  await page.evaluate(() => {
    const commit = document.getElementById("commit");
    if (commit && !commit.disabled) commit.click();
  });
  /*
   * ⚠️ 要等還原點**真的寫進去**再往下走。
   *   監看器是輪詢的（一偵測到資料改變才記），固定等一個秒數會變成
   *   看時機的測試——在慢一點的機器上就紅。這裡等到 operations 長度變了為止。
   */
  await page
    .waitForFunction(
      (want) =>
        new Promise((resolve) => {
          const request = indexedDB.open("TrafficLOSWebV2");
          request.onsuccess = () => {
            const get = request.result
              .transaction("app")
              .objectStore("app")
              .get("state");
            get.onsuccess = () =>
              resolve((get.result?.operations || []).length >= want);
            get.onerror = () => resolve(false);
          };
          request.onerror = () => resolve(false);
        }),
      quarterIndex + 1,
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
};

/* ── 第一次匯入：建立基準資料 ── */
await runImport(0);
const afterFirst = await readState();
const baseline = fingerprint(afterFirst, CODE);
ok(
  "前置：第一次匯入真的寫進資料了（沒有的話下面全部會變成恆真）",
  (afterFirst?.details || []).filter((x) => x.projectCode === CODE).length > 0,
  `${(afterFirst?.details || []).filter((x) => x.projectCode === CODE).length} 筆`,
);

/* ── ① 匯入之前要留還原點 ── */
console.log("\n══ ① 匯入前自動留還原點 ══");
const opsAfterFirst = (afterFirst?.operations || []).filter(
  (x) => x.projectCode === CODE,
);
ok(
  "⚠️ ① 匯入之前自動留下了還原點（舊版這條路徑完全沒有，覆蓋掉就回不來）",
  opsAfterFirst.length >= 1,
  `${opsAfterFirst.length} 個還原點：${opsAfterFirst.map((x) => x.name).join("、") || "一個都沒有"}`,
);

/* ── ③ 快照是「動手前」的內容 ── */
console.log("\n══ ③ 快照拍的是動手前 ══");
const firstOp = opsAfterFirst[0];
ok(
  "⚠️ ③ 第一次匯入前的快照裡**沒有**這次匯入的資料（證明是動手前拍的，不是事後補拍）",
  firstOp && (firstOp.snapshot?.details || []).length === 0,
  firstOp
    ? `快照內含 ${(firstOp.snapshot?.details || []).length} 筆`
    : "沒有還原點可檢查",
);
ok(
  "③ 快照有把備份帶得走的東西都留住（分段規則、異常門檻、報告草稿、結論範本、匯入紀錄）",
  firstOp &&
    ["bandRule", "anomalyRule", "reportDrafts", "conclusionTemplates", "imports"].every(
      (key) => key in (firstOp.snapshot || {}),
    ),
  firstOp ? Object.keys(firstOp.snapshot || {}).join("、") : "—",
);

/* ── ② 第二次匯入 → 還原 → 逐欄相同 ── */
console.log("\n══ ② 還原之後逐欄相同 ══");
await runImport(1);
const afterSecond = await readState();
const secondFingerprint = fingerprint(afterSecond, CODE);
ok(
  "前置：第二次匯入真的改變了資料（沒改變的話「還原得回來」是恆真）",
  secondFingerprint !== baseline,
  secondFingerprint === baseline ? "兩次匯入之後資料一模一樣" : "資料確實不同了",
);
const opsAfterSecond = (afterSecond?.operations || []).filter(
  (x) => x.projectCode === CODE,
);
ok(
  "前置：第二次匯入也留了還原點",
  opsAfterSecond.length >= 2,
  `${opsAfterSecond.length} 個`,
);

/*
 * ── 2026-09-16：面板已經不在畫面上 ──────────────────────────
 *
 * 使用者：「這類版本差異與還原，只需要在程式碼裡給你看就好……
 *   畫面上不用再展示出來了，使用者不會使用，因為不確定按了結果會如何。」
 *
 * ⚠️ 拿掉的是**畫面**，還原能力必須完好。所以這一支反過來守兩件事：
 *   (a) 畫面上真的沒有那一塊（否則就是沒改到）
 *   (b) 還原點照常寫入、而且**真的還原得回來**（走 LosUndoRestore，
 *       那就是原本按鈕呼叫的同一支函式——不是守門自己另寫一套）
 */
await page.evaluate(() => document.querySelector('[data-view="backup"]').click());
await page.waitForTimeout(500);
ok(
  "⚠️ ⓪ 畫面上沒有「版本差異與還原」那一塊",
  (await page.locator("#undoPanel").count()) === 0 &&
    (await page.locator("#operationRows").count()) === 0 &&
    (await page.locator('.nav-section:has-text("版本差異與還原")').count()) === 0,
);
ok(
  "⚠️ ⓪ 但維護用的入口還在（砍掉就真的救不回來了）",
  (await page.evaluate(
    () =>
      typeof globalThis.LosUndoList === "function" &&
      typeof globalThis.LosUndoRestore === "function",
  )) === true,
);
/* 還原到「第二次匯入之前」。 */
const undone = await page.evaluate(async () => {
  const list = globalThis.LosUndoList().filter((x) => x.status === "可復原");
  if (!list.length) return "沒有可復原的還原點";
  await globalThis.LosUndoRestore(list[0].id);
  await new Promise((r) => setTimeout(r, 2500));
  return "clicked";
});
ok("前置：還原得回去（LosUndoRestore）", undone === "clicked", String(undone));
await page.waitForTimeout(1500);
const afterUndo = await readState();
ok(
  "⚠️ ② 還原之後與第二次匯入前**逐筆逐欄相同**（只比筆數會漏掉速限、路名、LOS 沒還原）",
  fingerprint(afterUndo, CODE) === baseline,
  fingerprint(afterUndo, CODE) === baseline
    ? "完全相同"
    : "還原後的內容與動手前不同",
);

/* ── ④ 刪除還原點不會動到資料 ── */
console.log("\n══ ④ 刪除還原點不動資料 ══");
const beforeDrop = fingerprint(afterUndo, CODE);
const dropped = await page.evaluate(async () => {
  const list = globalThis.LosUndoList();
  if (!list.length) return 0;
  const done = await globalThis.LosUndoDrop(list[0].id);
  await new Promise((r) => setTimeout(r, 1200));
  return done ? 1 : 0;
});
ok("前置：刪得掉一個還原點（LosUndoDrop）", dropped === 1, `${dropped}`);
const afterDrop = await readState();
ok(
  "⚠️ ④ 刪除還原點之後，現在的資料一個字都沒變（面板上就是這樣寫的）",
  fingerprint(afterDrop, CODE) === beforeDrop,
  fingerprint(afterDrop, CODE) === beforeDrop ? "資料未變動" : "資料被動到了",
);
ok(
  "④ 而且還原點真的少了一個",
  (afterDrop?.operations || []).filter((x) => x.projectCode === CODE).length <
    (afterUndo?.operations || []).filter((x) => x.projectCode === CODE).length,
  `${(afterUndo?.operations || []).filter((x) => x.projectCode === CODE).length} → ${(afterDrop?.operations || []).filter((x) => x.projectCode === CODE).length}`,
);

/* ── ⑤ 上限 8，丟的是最舊的 ── */
console.log("\n══ ⑤ 保留上限 8，丟最舊的 ══");
/*
 * ⚠️ 用 UI 連續操作 35 次太慢也太脆；這一條要驗的是**保留策略**，
 *   所以直接塞 35 筆可辨識的還原點進去，再觸發一次會寫入的操作，
 *   看留下來的是哪 8 筆。
 */
const trimmed = await page.evaluate(async () => {
  const openDb = () =>
    new Promise((resolve) => {
      const request = indexedDB.open("TrafficLOSWebV2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  const db = await openDb();
  if (!db) return null;
  const current = await new Promise((resolve) => {
    const get = db.transaction("app").objectStore("app").get("state");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => resolve(null);
  });
  if (!current) return null;
  /* 第 1 筆是最新、第 35 筆是最舊（unshift 的順序）。 */
  current.operations = Array.from({ length: 35 }, (_, i) => ({
    id: `SEED${i}`,
    name: `第${i + 1}新`,
    time: "seed",
    projectCode: "RESTORE",
    snapshot: { activeCode: "RESTORE", details: [] },
    status: "可復原",
  }));
  await new Promise((resolve) => {
    const put = db
      .transaction("app", "readwrite")
      .objectStore("app")
      .put(current, "state");
    put.onsuccess = () => resolve();
    put.onerror = () => resolve();
  });
  return current.operations.length;
});
ok("前置：塞得進 35 筆還原點", trimmed === 35, `${trimmed}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
/* 觸發一次會留還原點的操作（改分段規則），讓上限規則實際跑到。 */
await page.evaluate(() => document.querySelector('[data-view="standards"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById("applyBandRule")?.click());
await page.waitForTimeout(2500);
const afterTrim = await readState();
const kept = (afterTrim?.operations || []).filter((x) => x.projectCode === CODE);
/*
 * ⚠️ 這裡要驗**剛好 8**，不是「不超過 8」。
 *   寫成 `<= 8` 的話，上限被改成 1 也會全綠——而使用者（現在是維護）
 *   會少掉退回點，平常完全看不出來。
 *   前面塞了 35 筆，所以答案必須正好是 8。
 * ⚠️ 2026-09-16 由 30 降為 8：畫面上那一塊已經移除，這份紀錄變成純維護用，
 *   而每一筆快照都是整個計畫的資料、又會跟著專案包一起匯出。
 */
ok(
  "⚠️ ⑤ 塞 35 筆之後**剛好**留 8 個（寫成「不超過 8」的話，改成 1 也會全綠）",
  kept.length === 8,
  `留下 ${kept.length} 個`,
);
ok(
  "⚠️ ⑤ 丟掉的是**最舊的**（最舊那幾筆不在了，最新的還在）",
  kept.length > 0 &&
    !kept.some((x) => x.id === "SEED34") &&
    kept.some((x) => x.id === "SEED0"),
  `含最舊 SEED34：${kept.some((x) => x.id === "SEED34")}／含次新 SEED0：${kept.some((x) => x.id === "SEED0")}`,
);

/* ── ⑥ 還原點跟著單一計畫的備份走 ── */
console.log("\n══ ⑥ 備份帶不帶得走 ══");
const packaged = await page.evaluate(() => {
  /* projectPackage() 是 app.js 的區域函式，改從下載內容驗不了；
     這裡用原始碼層級的檢查：專案包裡要有 operations 這個鍵。 */
  return fetch("app.js")
    .then((r) => r.text())
    .then((src) => {
      const start = src.indexOf("function projectPackage(");
      const end = src.indexOf("function downloadProjectPackage(", start);
      const body = src.slice(start, end);
      return {
        inPackage: /operations:/.test(body),
        inRestore: /Array\.isArray\(x\.operations\)/.test(src),
      };
    });
});
ok(
  "⚠️ ⑥ 單一計畫的專案包會帶走還原點（舊版只有全部計畫的備份有帶）",
  packaged.inPackage,
  packaged.inPackage ? "有帶" : "projectPackage() 裡找不到 operations",
);
ok(
  "⚠️ ⑥ 而且還原那一端真的讀得回來（路口轉向踩過：匯出有帶、還原沒讀，換電腦就消失）",
  packaged.inRestore,
  packaged.inRestore ? "有讀回來" : "還原分支沒有處理 operations",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 還原點：存得到、還原得回來、刪了不動資料、上限正確、備份帶得走");
