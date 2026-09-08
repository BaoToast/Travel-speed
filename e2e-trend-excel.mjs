/*
 * 端對端：趨勢圖的「可編輯 Excel」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者要的東西講得很清楚：
 *   「我下載下來，形成可編輯的圖，excel 裡面圖本身就是圖，文字說明可以放在
 *    excel 其他欄位，使用者可以針對圖做修正或直接拿去簡報使用。如果 A 圖只能
 *    變成高清晰圖片下載，無法提供可編輯 excel，那該圖片只需要 A 圖本身就好，
 *    下面不應該有解說文字。」
 *
 * 所以要驗三件事：
 *   一、圖是**原生 Excel 折線圖**，不是貼一張圖片進去。
 *   二、數值可以改，而且圖是**指向那些儲存格**的（改了圖才會跟著動）。
 *   三、說明文字在**另一張工作表**，不在圖上。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、**只驗「有下載到檔案」不算數。** 一個空的 zip 也下載得到。
 *     要把 xlsx 解開，逐一確認 chart XML、工作表、儲存格內容都在。
 * 二、**只驗「chart1.xml 存在」不算數。** 一張沒有數列的空圖表也存在。
 *     要驗 `c:lineChart` 裡有 `c:ser`，而且 `c:f` 真的指向資料工作表的
 *     儲存格範圍——指向別的地方或寫死快取，改儲存格圖就不會動。
 * 三、**只驗「說明工作表存在」不算數。** 空白的也存在。
 *     要驗裡面真的有講稿的句子。
 * 四、**只驗「圖表說明有字」不算數。** 還要反過來驗**圖上沒有那些字**——
 *     這正是使用者要求的重點。所以要確認 chart XML 裡不含講稿的句子。
 * 五、舊版 Excel 相容性：不可以出現 `chartex`／`x14`／`x15`。
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
await new Promise((ok) => server.listen(0, ok));
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
const files = readdirSync(SAMPLE_DIR).filter((name) => /報告測試路段/.test(name));

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "XLSX");
await page.fill("#projectName", "趨勢Excel測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

async function importQuarter(year, quarterIndex) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", String(year));
  await page.selectOption("#quarter", { index: quarterIndex });
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
  await page.waitForTimeout(2600);
  await page.click("#commit");
  await page.waitForTimeout(1300);
}
for (const [y, q] of [
  [113, 0],
  [113, 1],
  [113, 2],
  [114, 0],
]) await importQuarter(y, q);

await page.evaluate(() => document.querySelector('[data-view="charts"]').click());
await page.waitForTimeout(1200);

/*
 * 勾「平均旅行速率」（km/h），並取消預設的佔比指標。
 * ⚠️ 勾選是用 data-trend-metric 認的，不是 value——舊寫法用 value 找不到
 * 任何一顆，於是這支腳本會退回預設的佔比指標，「縱軸帶單位 km/h」那一項
 * 就變成永遠紅字，而且原因看起來像程式壞了。
 */
await page.evaluate(() => {
  const box = (key) =>
    document.querySelector(`#trendMetricBoxes input[data-trend-metric="${key}"]`);
  const travel = box("travel");
  if (travel && !travel.checked) travel.click();
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const box = (key) =>
    document.querySelector(`#trendMetricBoxes input[data-trend-metric="${key}"]`);
  const share = box("congestedShare");
  if (share && share.checked) share.click();
});
await page.waitForTimeout(800);
const picked = await page.evaluate(() =>
  [...document.querySelectorAll("#trendMetricBoxes input:checked")].map(
    (b) => b.dataset.trendMetric,
  ),
);
ok(
  "前置：要真的勾到「平均旅行速率」（否則單位那一項會驗到別的指標）",
  picked.length === 1 && picked[0] === "travel",
  picked.join("、"),
);

/* 取得畫面上那份 series 的值，稍後要與 Excel 裡的儲存格逐一比對。 */
const onScreen = await page.evaluate(() => {
  const list = trendSeriesList();
  return list.map((series) => ({
    label: series.label,
    unit: series.unit,
    ordinal: Boolean(series.ordinal),
    values: series.points.map((point) => point.value),
    periods: series.points.map((point) => point.period),
  }));
});
ok(
  "前置：畫面上至少要有一個數值型指標",
  onScreen.some((s) => !s.ordinal),
  onScreen.map((s) => s.label).join("、"),
);

const download = page.waitForEvent("download", { timeout: 25000 });
await page.click("#trendDownloadXlsx");
const file = await download;
const target = "/tmp/e2e-trend-excel.xlsx";
await file.saveAs(target);
ok("按下「下載可編輯 Excel」要真的下載到檔案", existsSync(target));

/* ── 解開 xlsx 逐一確認 ── */
const parts = await page.evaluate(async (bytes) => {
  const zip = await JSZip.loadAsync(new Uint8Array(bytes));
  const out = {};
  for (const name of Object.keys(zip.files))
    if (!zip.files[name].dir) out[name] = await zip.files[name].async("string");
  return out;
}, [...readFileSync(target)]);

const names = Object.keys(parts);
ok(
  "活頁簿要有三張工作表（資料／圖表／說明）",
  ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"].every(
    (n) => names.includes(n),
  ),
  names.filter((n) => n.includes("worksheets")).join("、"),
);
const workbook = parts["xl/workbook.xml"] || "";
for (const sheet of ["歷季趨勢資料", "歷季趨勢圖表", "圖表說明"])
  ok(`工作表名稱要有「${sheet}」`, workbook.includes(sheet));

const chartSheet = parts["xl/worksheets/sheet2.xml"] || "";
ok(
  "圖表工作表的 pageMargins 必須排在 drawing 前，避免舊版 Excel 修復或拒開",
  chartSheet.indexOf("<pageMargins") >= 0 &&
    chartSheet.indexOf("<pageMargins") < chartSheet.indexOf("<drawing"),
);

const chartNames = names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
ok("要有原生圖表（chart XML）", chartNames.length >= 1, `${chartNames.length} 張`);

const chart = parts[chartNames[0]] || "";
ok("圖表要是原生折線圖 c:lineChart", chart.includes("<c:lineChart>"));
ok(
  "折線圖裡要有數列（空圖表也會有 lineChart）",
  chart.includes("<c:ser>"),
);
/*
 * ⚠️ 一定要抓 <c:val> 裡面那一個參照，不可以只驗「圖表裡有指到資料表的
 * 儲存格」。類別軸（<c:cat>）本來就指向季度欄 A，所以那種寬鬆的寫法即使
 * 把數值參照整個改成別的工作表也照樣綠燈——實測過，改成 Sheet9!$Z$1:$Z$9
 * 之後這一項仍然通過。那等於什麼都沒驗到。
 */
const valueRef = (chart.match(/<c:val><c:numRef><c:f>([^<]*)<\/c:f>/) || [])[1] || "";
ok(
  "數列的值要指向資料工作表的儲存格（改了才會跟著動）",
  /^&apos;歷季趨勢資料&apos;!\$[B-Z]\$\d+:\$[B-Z]\$\d+$/.test(valueRef),
  valueRef || "找不到 <c:val> 的參照",
);
ok(
  "類別軸要指向季度欄（A 欄）",
  /<c:f>&apos;歷季趨勢資料&apos;!\$A\$\d+:\$A\$\d+<\/c:f>/.test(chart),
);
ok("縱軸要有名稱且帶單位", /<a:t>[^<]*（km\/h）<\/a:t>/.test(chart), "");
ok("橫軸要有名稱「季度」", chart.includes("<a:t>季度</a:t>"));
ok(
  "缺值要斷線，不可以連過去",
  chart.includes('<c:dispBlanksAs val="gap"/>'),
);

/* ── 舊版 Excel 相容 ── */
const allXml = names.map((n) => parts[n]).join("");
for (const forbidden of ["chartex", "x14:", "x15:", "cx:"])
  ok(
    `不可以用到新版 Excel 才看得懂的 ${forbidden}`,
    !allXml.includes(forbidden),
  );

/* ── 數值要與畫面一致 ── */
const dataSheet = parts["xl/worksheets/sheet1.xml"] || "";
const numeric = onScreen.find((s) => !s.ordinal);
const cellValues = [...dataSheet.matchAll(/<c r="B(\d+)"[^>]*><v>([^<]+)<\/v><\/c>/g)].map(
  (m) => Number(m[2]),
);
const expected = (numeric?.values || []).filter((v) => v != null);
ok(
  "Excel 裡的數值要與畫面上那張圖逐一相同",
  cellValues.length === expected.length &&
    cellValues.every((v, i) => Math.abs(v - expected[i]) < 1e-9),
  `Excel ${cellValues.join("、")}｜畫面 ${expected.join("、")}`,
);
/*
 * 缺值要留白，不可以寫 0。
 *
 * ⚠️ 真實測資每一季都有值，所以「拿真實資料驗」是恆真的——實測把 numCell
 * 改成一律輸出 Number(value)||0 之後，這一項照樣綠。要驗這件事只能餵一份
 * **含 null 的合成資料**進同一支產生器，再看儲存格在不在。
 */
const blankProbe = await page.evaluate(async () => {
  const blob = await TrendExcel.build(
    [{ label: "測試指標", unit: "km/h", values: [10, null, 30] }],
    ["113Q1", "113Q2", "113Q3"],
    ["113Q1", "113Q2", "113Q3"],
    [{ title: "測試", lines: ["測試"] }],
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  return {
    b4: /<c r="B4"[^>]*><v>([^<]+)<\/v>/.exec(sheet)?.[1] ?? null,
    b5: /<c r="B5"[^>]*><v>([^<]+)<\/v>/.exec(sheet)?.[1] ?? null,
    b6: /<c r="B6"[^>]*><v>([^<]+)<\/v>/.exec(sheet)?.[1] ?? null,
  };
});
ok(
  "前置：有值的季度要寫得出來（否則下一項會變成恆真）",
  blankProbe.b4 === "10" && blankProbe.b6 === "30",
  JSON.stringify(blankProbe),
);
ok(
  "算不出來的季度要留白，不可以寫 0",
  blankProbe.b5 === null,
  `B5 = ${blankProbe.b5}`,
);

/* ── 說明文字在說明工作表，而且不在圖上 ── */
const scriptSheet = parts["xl/worksheets/sheet3.xml"] || "";
ok(
  "說明工作表裡要有講稿文字",
  scriptSheet.includes("這張圖看的是") || /這個數字越高|代表整體/.test(scriptSheet),
  scriptSheet.slice(0, 0),
);
ok(
  "說明工作表要標明那些話是給簡報者講的",
  scriptSheet.includes("口述") || scriptSheet.includes("簡報者"),
);
/*
 * ⚠️ 這一項才是使用者要求的重點：文字要在別的欄位，**不可以印在圖上**。
 * 只驗「說明工作表有字」擋不住「圖上也有一份」。
 */
/*
 * 講稿裡真實出現過的句子，逐一確認**沒有一句**跑到圖表 XML 裡。
 * 用寫死的關鍵詞不夠：講稿改寫之後關鍵詞可能不再出現，這一項就會變成
 * 恆真。所以直接拿這一次產生的講稿內容去比對。
 */
const scriptLines = [...scriptSheet.matchAll(/<t xml:space="preserve">([^<]{12,})<\/t>/g)]
  .map((m) => m[1])
  .filter((line) => !/^(段落|內容)$/.test(line));
ok(
  "前置：要真的取得到講稿內容（取不到的話下一項會變成恆真）",
  scriptLines.length >= 3,
  `${scriptLines.length} 句`,
);
const leaked = scriptLines.filter((line) => chart.includes(line.slice(0, 12)));
ok(
  "圖表本身不可以印上說明文字",
  leaked.length === 0,
  leaked.slice(0, 2).join(" ／ "),
);
/*
 * 上面那一項是逐句比對，只擋得住「原封不動搬過去」。若有人把講稿改寫一下
 * 再塞進圖表標題，逐句比對就抓不到。所以再加一條結構性的規則：
 * **圖表裡的每一段文字都是標籤，不是句子。** 標籤（「平均旅行速率－歷季趨勢」
 * 「平均旅行速率（km/h）」「季度」）都很短；講稿一句動輒四五十個字。
 */
const chartTexts = [...chart.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
const longest = chartTexts.reduce((worst, t) => (t.length > worst.length ? t : worst), "");
ok(
  "前置：要真的讀得到圖表裡的文字",
  chartTexts.length >= 3,
  `${chartTexts.length} 段`,
);
ok(
  "圖表裡的每一段文字都應該是標籤而不是句子（40 字以內）",
  longest.length <= 40,
  `最長一段 ${longest.length} 字：${longest.slice(0, 40)}`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(
  problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
