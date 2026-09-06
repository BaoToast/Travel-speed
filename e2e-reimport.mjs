/*
 * 端對端：使用者以為沒匯入成功、又把同一批檔案匯一次，系統要擋得住。
 *
 * 起因是使用者的顧慮（原話）：
 *   「我怕如果使用者誤以為沒匯入到資料，然後重複匯入相同資料，
 *     系統卻沒有阻止，這樣才是異常。」
 *
 * 驗四件事：
 *  一、判讀期間「讀取並預覽」與檔案欄要真的停用，而且連點不會觸發第二次。
 *  二、第二次預覽時，狀態列要**在寫入之前**就寫出「重複 N」。
 *      使用者按確認之前就看得到自己在重覆匯入，這才叫擋得住。
 *  三、同一批檔案寫入第二次，明細筆數**不可以翻倍**。
 *  四、id 必須唯一——同一份調查存成兩筆的儲存層徵兆。
 *
 * ⚠️ 假通過陷阱：如果第一次匯入根本沒寫進去，第三項會變成 0→0 全綠。
 *    所以一定要有「第一次寫入之後確實有資料」這個前置檢查。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

const SAMPLE_DIR = join(here, "test-fixtures");
if (!existsSync(SAMPLE_DIR)) {
  console.log("❌ 找不到匿名回歸測資，請先執行 npm run fixtures");
  server.close();
  process.exit(1);
}
const names = readdirSync(SAMPLE_DIR).filter((n) => /\.xlsx?$/i.test(n));
const batch = names.map((name) => ({
  name,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(join(SAMPLE_DIR, name)),
}));

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "REIMPORT");
await page.fill("#projectName", "重複匯入測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

/*
 * 跑一輪「選檔 → 預覽 → 寫入」。
 * 預覽期間順便連點按鈕：使用者以為當掉時會做的就是這件事。
 */
const runImport = async () => {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  await page.setInputFiles("#files", batch);
  await page.waitForTimeout(300);

  const probe = await page.evaluate(async () => {
    const button = document.getElementById("preview");
    const input = document.getElementById("files");
    let samples = 0;
    let lockedButton = 0;
    let lockedInput = 0;
    const timer = setInterval(() => {
      samples += 1;
      if (!button.disabled) return;
      lockedButton += 1;
      if (input.disabled) lockedInput += 1;
    }, 10);
    button.click();
    const started = performance.now();
    while (performance.now() - started < 20000) {
      await new Promise((r) => setTimeout(r, 50));
      if (!button.disabled && performance.now() - started > 300) break;
    }
    clearInterval(timer);
    return {
      samples,
      lockedButton,
      lockedInput,
      status: document.getElementById("previewStatus").textContent.trim(),
    };
  });

  /* 寫入 */
  await page.evaluate(() => {
    const commit = document.getElementById("commit");
    if (commit && !commit.disabled) commit.click();
  });
  await page.waitForTimeout(1200);
  return probe;
};

/*
 * 資料存在 IndexedDB（TrafficLOSWebV2／app），不是 localStorage。
 * 明細的 id 是 計畫|年|季|路段|日別|尖峰|方向，upsert() 用它當 Map 的鍵，
 * 所以「同一份調查匯兩次」在儲存層應該是覆蓋同一個 id。
 */
const countDetails = async () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("TrafficLOSWebV2", 1);
        request.onerror = () => resolve({ details: -1, ids: -1, roads: -1, error: "開不了 DB" });
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("app"))
            return resolve({ details: 0, ids: 0, roads: 0, error: "沒有 app 資料表" });
          const getAll = db.transaction("app", "readonly").objectStore("app").getAll();
          getAll.onsuccess = () => {
            const blobs = getAll.result || [];
            const state =
              blobs.find((b) => b && Array.isArray(b.details)) || { details: [] };
            const details = state.details || [];
            resolve({
              details: details.length,
              ids: new Set(details.map((d) => d.id)).size,
              roads: new Set(details.map((d) => d.road)).size,
            });
          };
          getAll.onerror = () => resolve({ details: -1, ids: -1, roads: -1, error: "讀不到" });
        };
      }),
  );

/* ── 第一次 ── */
const first = await runImport();
ok(
  "判讀期間「讀取並預覽」按鈕確實停用",
  first.lockedButton > 0,
  `取樣 ${first.samples} 次、停用 ${first.lockedButton} 次`,
);
ok(
  "判讀期間檔案欄也一起停用（不然還能再選一批進來）",
  first.lockedButton > 0 && first.lockedInput === first.lockedButton,
  `按鈕停用 ${first.lockedButton} 次、其中檔案欄同時停用 ${first.lockedInput} 次`,
);
/*
 * ⚠️ 這裡原本是「判讀中對按鈕呼叫 click()，驗證觸發 0 次」。
 *    那是**恆真的假檢查**：依 HTML 規範，停用中的表單控制項呼叫 click()
 *    本來就不會派送事件，量到 0 與程式寫得對不對無關。
 *    實測：對一顆無關的空白按鈕做同樣的事，停用時 0 次、啟用時 5 次。
 *    真正的檢查是「檔案欄也一起停用」那一項——它不是恆真的
 *    （拿掉 fileInput.disabled = true 就會紅）。
 */
ok(
  "第一次預覽的狀態列寫的是「新增」，重複 0",
  /新增\s*\d+/.test(first.status) && /重複\s*0\b/.test(first.status),
  `狀態列「${first.status}」`,
);

const afterFirst = await countDetails();
ok(
  "第一次寫入之後確實有資料",
  afterFirst.details > 0,
  `明細 ${afterFirst.details} 筆、路段 ${afterFirst.roads} 個`,
);

/* ── 第二次：一模一樣的檔案再匯一次 ── */
const second = await runImport();
/*
 * 這一項是使用者真正在意的：重複匯入時系統要**在寫入之前**就講出來。
 * 交通服務水準是在預覽的狀態列寫「新增 0，重複 N」。
 */
ok(
  "第二次預覽的狀態列要明講「重複」，而且新增 0",
  /新增\s*0\b/.test(second.status) && !/重複\s*0\b/.test(second.status),
  `狀態列「${second.status}」`,
);

const afterSecond = await countDetails();
ok(
  "同一批檔案匯第二次，明細筆數不可以翻倍",
  afterSecond.details === afterFirst.details,
  `第一次 ${afterFirst.details} 筆 → 第二次 ${afterSecond.details} 筆`,
);
ok(
  "同一批檔案匯第二次，路段數不可以增加",
  afterSecond.roads <= afterFirst.roads,
  `第一次 ${afterFirst.roads} 個 → 第二次 ${afterSecond.roads} 個`,
);
ok(
  "每一筆明細的 id 都是唯一的（沒有同一份調查存成兩筆）",
  afterSecond.ids === afterSecond.details,
  `明細 ${afterSecond.details} 筆、相異 id ${afterSecond.ids} 個`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
