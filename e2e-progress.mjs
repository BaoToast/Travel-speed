/*
 * 判讀進度提示的端對端檢查（交通服務水準）。
 *
 * 使用者回報：「上傳了大量的檔案後，因為沒有『讀取中』等提示文字，
 * 會誤以為沒上傳成功。」
 *
 * 實測過原因：程式其實有反應，24 份 64KB 的檔案要 5.7 秒，這段期間
 * 右邊「辨識預覽」的小字確實顯示著「讀取中…」、畫面也沒卡死。
 * 問題是那行字在畫面另一側、很小、而且**一動也不動**，
 * 按鈕本身文字又完全沒變，看起來跟當掉一樣。
 *
 * 所以這一支驗的不是「有沒有寫 loading 字串」，而是：
 *  ・使用者按下的那顆按鈕上，真的看得到會**跳動**的進度
 *  ・進度中途被抓到過至少兩個不同的數字（證明畫面真的在重畫，
 *    不是整批卡到最後才一次跳完）
 *  ・讀完之後按鈕要變回原來的字，不能一直卡在「讀取中」
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((req, res) => {
  const path = join(
    here,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
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

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "PROG");
await page.fill("#projectName", "進度提示測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 0 });

/* 用同一批匿名測資湊成 18 份，模擬「一次上傳大量檔案」 */
const batch = [];
for (let round = 0; round < 3; round += 1)
  for (const name of names)
    batch.push({
      name: `${round + 1}_${name}`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLE_DIR, name)),
    });
await page.setInputFiles("#files", batch);
await page.waitForTimeout(300);

const idle = await page.evaluate(() => ({
  button: document.getElementById("preview").textContent.trim(),
  info: document.getElementById("fileInfo").textContent.trim(),
}));
ok(
  "前置：還沒開始讀時，按鈕是原本的字",
  idle.button === "讀取並預覽",
  `按鈕「${idle.button}」`,
);

/*
 * 在頁面裡以 10ms 取樣，記錄按鈕與檔案資訊列的每一次變化。
 * 取樣本身也要靠瀏覽器排程，取得到多個不同數字，就證明畫面真的在重畫。
 */
const trace = await page.evaluate(async () => {
  const seen = [];
  const snap = () => {
    const button = document.getElementById("preview");
    const entry = {
      t: Math.round(performance.now()),
      button: button.textContent.trim(),
      disabled: button.disabled,
      filesDisabled: document.getElementById("files").disabled,
      info: document.getElementById("fileInfo").textContent.trim(),
      status: document.getElementById("previewStatus").textContent.trim(),
    };
    const last = seen[seen.length - 1];
    if (
      !last ||
      last.button !== entry.button ||
      last.info !== entry.info ||
      last.status !== entry.status
    )
      seen.push(entry);
  };
  const timer = setInterval(snap, 10);
  snap();
  document.getElementById("preview").click();
  const started = performance.now();
  while (performance.now() - started < 20000) {
    await new Promise((r) => setTimeout(r, 50));
    if (!document.getElementById("preview").disabled && performance.now() - started > 300)
      break;
  }
  clearInterval(timer);
  snap();
  return seen;
});

const progressLabels = trace
  .map((s) => s.button)
  .filter((text) => /讀取中/.test(text));
const distinctProgress = [...new Set(progressLabels)];
ok(
  "按鈕上真的出現「讀取中」",
  progressLabels.length > 0,
  `按鈕出現過：${[...new Set(trace.map((s) => s.button))].join("｜")}`,
);
ok(
  "而且進度數字是會跳的（畫面真的在重畫，不是最後才一次跳完）",
  distinctProgress.length >= 3,
  `抓到 ${distinctProgress.length} 種不同的進度字樣：${distinctProgress.slice(0, 4).join("、")}${distinctProgress.length > 4 ? " …" : ""}`,
);
ok(
  "進度有標出總份數，使用者知道還剩多少",
  distinctProgress.some((text) => text.includes(`／${batch.length}`)),
  `共 ${batch.length} 份；按鈕字樣例：「${distinctProgress[1] || distinctProgress[0] || ""}」`,
);

const progressSnapshots = trace.filter((s) => /讀取中/.test(s.button));
ok(
  "判讀期間會鎖住原始檔選取框，避免中途換批造成畫面與實際檔案不一致",
  progressSnapshots.length > 0 && progressSnapshots.every((s) => s.filesDisabled),
  `進度快照 ${progressSnapshots.length} 筆`,
);

const infoDuring = trace.map((s) => s.info).filter((t) => /讀取中/.test(t));
ok(
  "檔案資訊列會顯示正在讀哪一個檔",
  infoDuring.length > 0,
  infoDuring[0] ? `例：「${infoDuring[0]}」` : "沒有出現",
);

const last = trace[trace.length - 1];
ok(
  "讀完之後按鈕要變回原本的字，不可以一直卡在讀取中",
  last.button === "讀取並預覽" && last.disabled === false && last.filesDisabled === false,
  `結束時按鈕「${last.button}」${last.disabled ? "（仍停用）" : ""}`,
);
ok(
  "讀完之後檔案資訊列也要回到正常",
  /已選取/.test(last.info),
  `結束時「${last.info}」`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
