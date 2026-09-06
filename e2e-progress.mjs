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

/*
 * ── 連按兩次選檔再取消，提示也要收得掉 ──
 *
 * 這是 v2.20.39 自己引進的問題：舊版每次按下選檔都無條件記錄
 * previousText，連按兩次時第二次會把提示字串本身記成「原本的文字」，
 * 計時器回寫之後畫面就永久停在「正在讀取…」，退路已經被拆掉。
 * 實測：連按兩次取消，等 3 秒仍在。
 */
{
  const hintNow = () =>
    page.evaluate(() => document.getElementById("fileInfo").textContent.trim());
  await page.evaluate(() => {
    document.getElementById("fileInfo").textContent = "尚未選取檔案";
  });
  const before = await hintNow();
  /* 兩次「按下選檔」中間夾一次 focus，模擬第一次取消還沒判定就又按一次 */
  await page.evaluate(() => document.getElementById("files").dispatchEvent(new Event("click")));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById("files").dispatchEvent(new Event("click")));
  const during = await hintNow();
  /* 第一輪 focus 排出的 1.2 秒計時器，不得在第二輪仍挑檔時誤觸。 */
  await page.waitForTimeout(1400);
  const duringSecondPicker = await hintNow();
  ok(
    "第一次取消的計時器不會誤判仍在進行的第二次選檔",
    /正在讀取/.test(duringSecondPicker),
    `第二次仍在選檔時「${duringSecondPicker}」`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2200);
  const after = await hintNow();
  ok(
    "前置：連按兩次選檔時，提示確實有出現過",
    /正在讀取/.test(during),
    `第二次按下時「${during}」`,
  );
  ok(
    "連按兩次選檔再取消，提示要收得掉（不可以永久卡住）",
    !/正在讀取/.test(after) && after === before,
    `原本「${before}」→ 最後「${after}」`,
  );
}

/* ── 分頁在背景時（requestAnimationFrame 不觸發）匯入不可以卡住 ── */
/*
 * 為了讓「讀取中」確實被畫出來，第一次解析前改成等兩個動畫影格。
 * 但分頁被切到背景時 requestAnimationFrame **完全不會觸發**——
 * 少了時間退路，匯入就會永遠停在那裡。這一項就是釘住那條退路。
 */
{
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
  await page.fill("#projectCode", "NORAF");
  await page.fill("#projectName", "背景分頁測試");
  await page.click("#saveProject");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  /* 模擬背景分頁：rAF 註冊了但永遠不回呼 */
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.setInputFiles("#files", batch.slice(0, 2));
  await page.waitForTimeout(300);
  await page.click("#preview");
  const finished = await page.evaluate(async () => {
    const started = performance.now();
    while (performance.now() - started < 15000) {
      await new Promise((r) => setTimeout(r, 100));
      if (!document.getElementById("preview").disabled) return Math.round(performance.now() - started);
    }
    return -1;
  });
  ok(
    "rAF 不觸發時（分頁在背景）匯入仍然會完成，不會永遠卡住",
    finished >= 0,
    finished >= 0 ? `${finished}ms 內完成` : "15 秒內沒有完成——退路失效了",
  );
  const status = await page.evaluate(() =>
    document.getElementById("previewStatus").textContent.trim(),
  );
  ok("而且真的讀出結果，不是空跑", /成功\s*2/.test(status), `狀態「${status}」`);
}

/* ── 選檔期間就要看得到提示，不是等到選完才出現 ── */
/*
 * 使用者回報「按下選擇檔案之後畫面什麼都沒有，等很久才跳出已選取 X 份」。
 * 實測過：change 一送到畫面 0ms 就更新——那段等待完全在瀏覽器那一側，
 * 我們的程式還沒被叫到。所以提示只能從「按下去」那一刻開始顯示。
 *
 * 這一項要驗三段，缺一段就會變成恆真：
 *   ・按下去之後、還沒選檔前 → 看得到「正在讀取」
 *   ・真的選了檔 → 換成「已選取 N 份」
 *   ・按了取消（沒有 change） → 提示要自己收掉，不可以一直掛著
 */
{
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
  await page.fill("#projectCode", "PICK");
  await page.fill("#projectName", "選檔提示測試");
  await page.click("#saveProject");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.waitForTimeout(300);

  const before = await page.evaluate(() =>
    document.getElementById("fileInfo").textContent.trim(),
  );
  ok("前置：還沒按選擇檔案時，是「尚未選取檔案」", /尚未選取/.test(before), `「${before}」`);

  /* 攔下瀏覽器的檔案對話框，模擬「已經按下去、還在挑檔案」的那一刻 */
  const chooserPromise = page.waitForEvent("filechooser");
  await page.click("label.drop");
  const chooser = await chooserPromise;
  await page.waitForTimeout(200);
  const whilePicking = await page.evaluate(() =>
    document.getElementById("fileInfo").textContent.trim(),
  );
  ok(
    "按下選擇檔案之後，馬上看得到「正在讀取」的提示",
    /正在讀取/.test(whilePicking),
    `「${whilePicking}」`,
  );

  await chooser.setFiles(
    batch.slice(0, 2).map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })),
  );
  await page.waitForTimeout(600);
  const afterPick = await page.evaluate(() =>
    document.getElementById("fileInfo").textContent.trim(),
  );
  ok(
    "真的選了檔之後，提示要換成「已選取 N 份」",
    /已選取 2 份/.test(afterPick),
    `「${afterPick}」`,
  );

  /* 取消：開了對話框卻不選檔，提示不可以一直掛著 */
  const cancelChooser = page.waitForEvent("filechooser");
  await page.click("label.drop");
  await cancelChooser;
  await page.waitForTimeout(200);
  const whilePicking2 = await page.evaluate(() =>
    document.getElementById("fileInfo").textContent.trim(),
  );
  ok("前置：再次按下去時提示有出現", /正在讀取/.test(whilePicking2), `「${whilePicking2}」`);
  /* 模擬使用者關掉對話框：視窗重新取得焦點，但沒有 change */
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1800);
  const afterCancel = await page.evaluate(() =>
    document.getElementById("fileInfo").textContent.trim(),
  );
  ok(
    "按了取消之後，「正在讀取」的提示要自己收掉",
    !/正在讀取/.test(afterCancel),
    `「${afterCancel}」`,
  );
}

/* ── 判讀後的整理階段出錯，也不可以把畫面卡死 ── */
/*
 * 迴圈裡每一份檔案都有自己的 try/catch，但迴圈**之後**的整理步驟
 * （期別比對、路段分析、重畫預覽）在 v2.20.36 之前沒有任何保護。
 * 那裡一丟例外，「讀取並預覽」就永遠停用、狀態欄卡在「讀取中…」，
 * 使用者只能重新整理頁面。這一項用注入例外的方式把它釘住。
 */
await page.reload({ waitUntil: "networkidle" });
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "STUCK");
await page.fill("#projectName", "整理階段例外測試");
await page.click("#saveProject");
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 0 });
/*
 * ⚠️ 這裡一定要**先跑一次成功的預覽**，再注入例外。
 *
 * 「取消匯入」在 HTML 裡的初始狀態就是 disabled，而它的啟用是在
 * renderPreview() 裡依 pending.length 設定的。如果直接注入例外、
 * 中間沒有成功預覽過，那顆按鈕從頭到尾都維持初始的 disabled ——
 * 於是「出錯後要停用取消匯入」這個斷言會**恆真**，等於沒驗到。
 *
 * 實測過：只注入例外時 cancel disabled=true（假通過）；
 * 先成功預覽一次再注入例外時 cancel disabled=false（抓得到）。
 * 後者才是使用者真正的操作順序。
 */
await page.setInputFiles("#files", batch.slice(0, 2));
await page.waitForTimeout(300);
await page.click("#preview");
await page.waitForTimeout(3000);
const beforeCrash = await page.evaluate(() => ({
  commitDisabled: document.getElementById("commit").disabled,
  cancelDisabled: document.getElementById("cancelPreview").disabled,
}));
/*
 * 前置只要求「取消匯入」是可按的——那才是這一輪要驗的那顆。
 *
 * 「確認寫入」在這裡本來就可能是停用的：本批都是新路段，還沒逐一確認，
 * 而 renderPreview() 的條件是 `!pending.some(x => x.ok) || unchecked > 0`。
 * 所以下面那項斷言裡「確認寫入=停用」這一半，在本情境下較弱；
 * 它的有效性由突變測試保證——把 catch 裡的 clearPendingPreview() 拿掉，
 * 「整理失敗後會清除未完成預覽」會確實紅字。
 */
ok(
  "前置：先成功預覽一次，「取消匯入」要是可按的（否則下面的斷言會恆真）",
  beforeCrash.cancelDisabled === false,
  `取消=${beforeCrash.cancelDisabled ? "停用" : "可按"}；（確認寫入=${beforeCrash.commitDisabled ? "停用，本批為新路段待確認" : "可按"}）`,
);

await page.evaluate(() => {
  globalThis.PeriodDate.checkPeriodAgainstDate = () => {
    throw new Error("模擬：判讀後整理階段的非預期例外");
  };
});
await page.setInputFiles("#files", batch.slice(0, 2));
await page.waitForTimeout(300);
await page.click("#preview");
await page.waitForTimeout(3000);
const afterCrash = await page.evaluate(() => ({
  button: document.getElementById("preview").textContent.trim(),
  buttonDisabled: document.getElementById("preview").disabled,
  filesDisabled: document.getElementById("files").disabled,
  selectedFiles: document.getElementById("files").files.length,
  status: document.getElementById("previewStatus").textContent.trim(),
  fileInfo: document.getElementById("fileInfo").textContent.trim(),
  commitDisabled: document.getElementById("commit").disabled,
  cancelDisabled: document.getElementById("cancelPreview").disabled,
  rows: document.getElementById("previewRows").textContent.trim(),
}));
ok(
  "整理階段丟例外時，「讀取並預覽」不可以永久停用",
  afterCrash.buttonDisabled === false,
  `按鈕「${afterCrash.button}」${afterCrash.buttonDisabled ? "（仍停用）" : "（可按）"}`,
);
ok(
  "整理階段丟例外時，檔案欄也要解鎖，使用者才能重試",
  afterCrash.filesDisabled === false && afterCrash.selectedFiles === 0,
  `檔案欄${afterCrash.filesDisabled ? "仍鎖住" : "已解鎖"}，已選 ${afterCrash.selectedFiles} 份`,
);
ok(
  "整理失敗後會清除未完成預覽，不會留下可誤按的寫入狀態",
  afterCrash.commitDisabled &&
    afterCrash.cancelDisabled &&
    /沒有資料被寫入/.test(afterCrash.rows),
  `確認寫入=${afterCrash.commitDisabled ? "停用" : "可按"}；取消=${afterCrash.cancelDisabled ? "停用" : "可按"}；內容「${afterCrash.rows}」`,
);
ok(
  "整理失敗後狀態欄會明確說明未寫入並提示重新選取",
  !/讀取中/.test(afterCrash.status) &&
    /未完成/.test(afterCrash.status) &&
    /重新選取/.test(afterCrash.fileInfo),
  `狀態「${afterCrash.status}」；檔案列「${afterCrash.fileInfo}」`,
);
ok("非預期整理錯誤已由畫面接住，沒有未處理的 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
