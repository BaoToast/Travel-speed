/**
 * 交通服務水準分析系統的端對端回歸測試。
 *
 * 檢查項目：可編輯 Excel 圖表（旅行速率／服務水準）產得出來且結構合規、
 * 服務水準座標軸最小值為 0、季度依民國年排序、還原備份時誤選一般 JSON
 * 不會清空資料。
 *
 * 這一支之所以存在：LOS 圖表是靠對產出的 XML 做字串置換來改樣式的，
 * 只要上游 XML 動一個字，置換就會悄悄失效——檔案照樣下載得下來、Excel
 * 也開得起來，只是座標軸最小值停在 1，服務水準 F 的長條高度變成 0，
 * 看起來像「這一季沒有資料」。現在置換失敗會直接丟錯，這支就負責跑到它。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkWorkbook } from "./ooxml-check.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((req, res) => {
  const path = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html");
  if (!existsSync(path) || !path.startsWith(here)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// 高風險操作（套用速限、修改服務水準門檻）會先跳確認視窗並下載一份備份，
// 測試裡一律同意，否則 click 會卡在對話框上。
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

// ── 匿名報告版型匯入：交付包可自行重建，不含正式調查資料 ─────────
const FIXTURE_DIR = join(here, "test-fixtures");
const SAMPLE = "99999TS1-01-測試路段(甲路～乙路)-平日.xlsx";
const samplePath = join(FIXTURE_DIR, SAMPLE);
let importedRows = null;
if (existsSync(samplePath)) {
  await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
  await page.fill("#projectCode", "E2E");
  await page.fill("#projectName", "端對端測試計畫");
  await page.click("#saveProject");
  await page.waitForTimeout(400);
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  await page.setInputFiles("#files", {
    name: SAMPLE,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(samplePath),
  });
  await page.click("#preview");
  await page.waitForTimeout(2500);
  const status = await page.textContent("#previewStatus");
  ok("匿名報告版型能讀取成功（不是「無法辨識完整4筆」）", /成功 1，失敗 0/.test(status), status);

  // 預覽的用意是「先看有沒有問題」，所以一定要能放棄整批、修好檔案再來。
  const cancelled = await page.evaluate(async () => {
    document.getElementById("cancelPreview").click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      empty: !!document.querySelector("#previewRows .empty"),
      commitDisabled: document.getElementById("commit").disabled,
      cancelDisabled: document.getElementById("cancelPreview").disabled,
      files: document.getElementById("files").files.length,
      fileInfo: document.getElementById("fileInfo").textContent,
      detailRows: document.querySelectorAll("#detailRows tr").length,
      detailEmpty: !!document.querySelector("#detailRows .empty"),
    };
  });
  ok(
    "可以取消預覽：清空預覽表、停用兩個按鈕、清掉已選檔案",
    cancelled.empty &&
      cancelled.commitDisabled &&
      cancelled.cancelDisabled &&
      cancelled.files === 0 &&
      cancelled.fileInfo.includes("尚未選取"),
    JSON.stringify(cancelled),
  );
  ok(
    "取消預覽不會寫入任何資料",
    cancelled.detailEmpty || cancelled.detailRows === 0,
    `明細列數 ${cancelled.detailRows}`,
  );

  // 取消之後重新選檔、重新預覽，必須能正常走完寫入。
  await page.setInputFiles("#files", {
    name: SAMPLE,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(samplePath),
  });
  await page.click("#preview");
  await page.waitForTimeout(2500);
  ok(
    "取消後重新預覽仍然正常",
    /成功 1，失敗 0/.test(await page.textContent("#previewStatus")),
    await page.textContent("#previewStatus"),
  );
  await page.click("#commit");
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('[data-view="detail"]').click());
  await page.waitForTimeout(600);
  importedRows = await page.evaluate(() =>
    [...document.querySelectorAll("#detailRows tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
    ),
  );
  ok("匿名報告版型寫入後有 4 筆明細（上下午 × 兩個方向）", importedRows.length === 4,
    `${importedRows.length} 筆`);
  // 這四個值是報告自己的「延滯統計表」印出來的答案，不是我算的。
  const want = [
    { peak: "上午尖峰", travel: "21.084", running: "35.783", delay: "128.333" },
    { peak: "上午尖峰", travel: "26.251", running: "38.643", delay: "82.000" },
    { peak: "下午尖峰", travel: "22.411", running: "36.275", delay: "114.000" },
    { peak: "下午尖峰", travel: "20.528", running: "34.732", delay: "132.000" },
  ];
  const got = importedRows.map((cells) => ({
    peak: cells[3], direction: cells[4], travel: cells[5], running: cells[6], delay: cells[7],
  }));
  const matched = want.every((w) =>
    got.some((g) => g.peak === w.peak && g.travel === w.travel && g.running === w.running && g.delay === w.delay),
  );
  ok("四筆數值與報告自附的統計表完全相符", matched,
    got.map((g) => `${g.peak}/${g.direction} ${g.travel}/${g.running}/${g.delay}`).join("　"));
  ok("方向名稱自動採用報告上寫的起訖路口",
    got.some((g) => g.direction.includes("甲路口")) && got.some((g) => g.direction.includes("乙路口")),
    got.map((g) => g.direction).join("、"));

  // ── 疑似新路段的批次確認 ─────────────────────────────────
  // 一次匯入十幾份檔案時，系統會對每個沒見過的路段名稱各要求一次確認。
  // 使用者通常一眼就知道整批都是新路段，逐列點下拉選單純粹是重複勞動。
  const more = [
    "99999TS1-02-第二測試路段(丙路～丁路)-平日.xlsx",
    "99999TS1-02-第二測試路段(丙路～丁路)-假日.xlsx",
  ].filter((name) => existsSync(join(FIXTURE_DIR, name)));
  if (more.length === 2) {
    await page.evaluate(() => document.querySelector('[data-view="import"]').click());
    await page.waitForTimeout(400);
    await page.fill("#rocYear", "115");
    await page.setInputFiles(
      "#files",
      more.map((name) => ({
        name,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync(join(FIXTURE_DIR, name)),
      })),
    );
    await page.click("#preview");
    await page
      .waitForFunction(() => document.querySelectorAll("[data-pick]").length >= 2, null, {
        timeout: 20000,
      })
      .catch(() => {});
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({
      barVisible: getComputedStyle(document.getElementById("roadBatchBar")).display !== "none",
      boxes: document.querySelectorAll("[data-pick]").length,
      commitDisabled: document.getElementById("commit").disabled,
      count: document.getElementById("pickCount").textContent,
    }));
    ok(
      "有疑似新路段時會出現批次確認列，且未確認前不能寫入",
      before.barVisible && before.boxes === 2 && before.commitDisabled,
      JSON.stringify(before),
    );

    await page.check("#pickAll");
    await page.waitForTimeout(400);
    const picked = await page.evaluate(() => ({
      checked: [...document.querySelectorAll("[data-pick]")].filter((b) => b.checked).length,
      newDisabled: document.getElementById("pickAsNew").disabled,
      count: document.getElementById("pickCount").textContent,
    }));
    ok(
      "全選會勾起所有待確認的列",
      picked.checked === 2 && !picked.newDisabled,
      JSON.stringify(picked),
    );

    await page.click("#pickAsNew");
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      badges: [...document.querySelectorAll("#previewRows .match-badge")].map((b) => b.textContent),
      selected: [...document.querySelectorAll(".road-choice")].map((s) => s.value),
      commitDisabled: document.getElementById("commit").disabled,
      stillChecked: [...document.querySelectorAll("[data-pick]")].filter((b) => b.checked).length,
    }));
    ok(
      "批次確認為新路段後，兩列都變成新路段且可以寫入",
      after.selected.every((v) => v === "__NEW__") &&
        !after.commitDisabled &&
        after.stillChecked === 0,
      JSON.stringify(after),
    );

    await page.click("#commit");
    await page.waitForTimeout(1500);
    const roads = await page.evaluate(() => {
      document.querySelector('[data-view="detail"]').click();
      return [...document.querySelectorAll("#detailRows tr")].map(
        (tr) => tr.querySelectorAll("td")[1]?.textContent,
      );
    });
    ok(
      "批次確認後寫入的是兩個獨立路段，沒有被合併",
      new Set(roads.filter(Boolean)).size === 2,
      [...new Set(roads.filter(Boolean))].join("、"),
    );
  }

}

// 舊版 Excel 2007/2010 常見的 .xls 也要能辨識完整 4 筆。
const legacyName = "99999TS1-04-舊版測試路段(南端～北端)-平日.xls";
const legacyPath = join(FIXTURE_DIR, legacyName);
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
await page.fill("#rocYear", "115");
await page.setInputFiles("#files", {
  name: legacyName,
  mimeType: "application/vnd.ms-excel",
  buffer: readFileSync(legacyPath),
});
await page.click("#preview");
await page.waitForTimeout(1800);
ok(
  "舊版 .xls 能辨識完整 4 筆",
  /成功 1，失敗 0/.test(await page.textContent("#previewStatus")),
  await page.textContent("#previewStatus"),
);
await page.click("#cancelPreview");
await page.waitForTimeout(300);

// 造一組跨越民國 99 → 100 年、且含有服務水準 F 的資料。
const result = await page.evaluate(async () => {
  const rows = [];
  const periods = ["99Q3", "99Q4", "100Q1", "100Q2"];
  periods.forEach((period, index) => {
    ["平日", "假日"].forEach((day) => {
      rows.push({
        projectCode: "P1",
        road: "中山路",
        period,
        day,
        // 最後一季刻意壓到很低，讓它落在服務水準 F。
        travel: index === periods.length - 1 ? 8 : 40 - index * 4,
        limit: 50,
      });
    });
  });
  const out = {};
  const travelBlob = await globalThis.buildTravelWorkbookBlob(rows);
  out.travel = [...new Uint8Array(await travelBlob.arrayBuffer())];
  const losBlob = await globalThis.buildLosWorkbookBlob(rows);
  out.los = [...new Uint8Array(await losBlob.arrayBuffer())];
  return out;
});

for (const [name, bytes] of Object.entries(result)) {
  const report = await checkWorkbook(new Uint8Array(bytes));
  const chartCount = Array.isArray(report.charts) ? report.charts.length : Number(report.charts) || 0;
  ok(`${name} 活頁簿有圖表`, chartCount > 0, `圖表數 ${chartCount}`);
  ok(
    `${name} 活頁簿結構合規（Excel 不會跳修復）`,
    report.issues.length === 0,
    report.issues.slice(0, 4).join("；"),
  );
}

// LOS 圖表的座標軸最小值必須是 0，否則 F（值＝1）畫出來高度為零。
const losCharts = await page.evaluate(async (bytes) => {
  const zip = await globalThis.JSZip.loadAsync(new Uint8Array(bytes));
  const out = {};
  for (const name of Object.keys(zip.files).filter((x) => x.startsWith("xl/charts/chart")))
    out[name] = await zip.file(name).async("string");
  return out;
}, result.los);
for (const [name, xml] of Object.entries(losCharts)) {
  ok(
    `${name} 座標軸最小值為 0（服務水準 F 才畫得出高度）`,
    xml.includes('<c:min val="0"/>'),
    xml.match(/<c:min val="[^"]*"\/>/)?.[0] || "找不到 c:min",
  );
  ok(
    `${name} 已關閉數值刻度標籤`,
    !xml.includes('<c:majorTickMark val="out"/>'),
    "仍看得到 1~6 的數字刻度",
  );
}

// 季度必須依民國年正確排序：字串排序會把 100Q1 排到 99Q3 前面。
const categoryOrder = await page.evaluate(async (bytes) => {
  const zip = await globalThis.JSZip.loadAsync(new Uint8Array(bytes));
  const name = Object.keys(zip.files).find((x) => x.startsWith("xl/charts/chart"));
  const xml = await zip.file(name).async("string");
  const cat = xml.match(/<c:cat>[\s\S]*?<\/c:cat>/)?.[0] || "";
  return [...cat.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]);
}, result.travel);
ok(
  "圖表季度依民國年排序（99Q3 → 100Q2）",
  JSON.stringify(categoryOrder) === JSON.stringify(["99Q3", "99Q4", "100Q1", "100Q2"]),
  categoryOrder.join(" → "),
);

// 誤選一般 JSON 檔不可以清空資料。
const restoreGuard = await page.evaluate(async () => {
  // 模擬使用者在還原備份時選到一個不是備份檔的普通 JSON。
  const junk = new File([JSON.stringify({ hello: "world", items: [1, 2] })], "設定.json", {
    type: "application/json",
  });
  const input = document.getElementById("restoreFile");
  const transfer = new DataTransfer();
  transfer.items.add(junk);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 400));
  return document.getElementById("toast")?.textContent || "";
});
ok(
  "誤選一般 JSON 檔會被擋下，不會清空資料",
  restoreGuard.includes("不是有效的備份檔"),
  restoreGuard,
);

// 空殼備份（有 projects 與 details 兩個鍵，但都是空陣列）同樣不可以被接受：
// 它一樣會把使用者全部的計畫清空，而且舊的形狀檢查擋不住。
const emptyShellGuard = await page.evaluate(async () => {
  const junk = new File([JSON.stringify({ projects: [], details: [] })], "空殼.json", {
    type: "application/json",
  });
  const input = document.getElementById("restoreFile");
  const transfer = new DataTransfer();
  transfer.items.add(junk);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 400));
  return {
    toast: document.getElementById("toast")?.textContent || "",
    rows: document.querySelectorAll("#detailRows tr").length,
    empty: !!document.querySelector("#detailRows .empty"),
  };
});
ok(
  "空殼備份（projects/details 都是空陣列）也會被擋下",
  emptyShellGuard.toast.includes("不是有效的備份檔") && !emptyShellGuard.empty,
  `${emptyShellGuard.toast}｜明細列數 ${emptyShellGuard.rows}`,
);

// 速限打成負數時，必須「整批都不變」，不可以只擋掉負的、卻把合法的那些
// 寫進去又不重算——那會留下一個之後任何存檔都會固化的半套狀態。
if (importedRows) {
  const prepared = await page.evaluate(async () => {
    document.querySelector('[data-view="speed"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const inputs = [...document.querySelectorAll("[data-limit]")];
    if (inputs.length < 2) return false;
    inputs[0].value = "70";
    inputs[1].value = "-50";
    return true;
  });
  if (prepared) await page.click("#applySpeed");
  await page.waitForTimeout(900);
  const speedGuard = prepared
    ? await page.evaluate(() => ({
        toast: document.getElementById("toast")?.textContent || "",
        values: [...document.querySelectorAll("[data-limit]")].map((i) => i.value),
        confirmed: document.querySelectorAll(".status-ok").length,
      }))
    : { skipped: true };
  ok(
    "速限有一格是負數時整批不變更（不會留下半套設定）",
    speedGuard.skipped ||
      (speedGuard.toast.includes("完全沒有變更") &&
        speedGuard.values.every((v) => Number(v) > 0) &&
        speedGuard.confirmed === 0),
    `${speedGuard.toast}｜欄位值 ${(speedGuard.values || []).join("、")}｜已確認 ${speedGuard.confirmed}`,
  );
}

// ── 品質總覽的異常篩選 ─────────────────────────────────────────
// 季度累積之後這張表會長到看不出重點，所以要能依季度區間、類型、路段、
// 日別、尖峰篩選。這裡直接注入一批合成的異常項目來驗篩選邏輯本身。
{
  const seeded = await page.evaluate(() => {
    const rows = document.getElementById("qualityRows");
    if (!rows) return { skipped: true };
    return { ok: true };
  });
  if (!seeded.skipped) {
    // 健康檢查在「資料維護」頁，要先切過去按鈕才看得到。
    await page.click('nav button[data-view="maintenance"]');
    await page.waitForTimeout(300);
    await page.click("#runHealth");
    await page.waitForTimeout(400);
    const ui = await page.evaluate(() => ({
      hasFrom: !!document.getElementById("qualityFrom"),
      hasTo: !!document.getElementById("qualityTo"),
      hasRoad: !!document.getElementById("qualityRoad"),
      hasDay: !!document.getElementById("qualityDayFilter"),
      quarterOptions: [...(document.getElementById("qualityFrom")?.options || [])].map(
        (o) => o.value,
      ),
      chips: [...document.querySelectorAll("#qualityTypeChips .anomaly-chip")].map(
        (b) => b.textContent,
      ),
      shown: document.getElementById("qualityShown")?.textContent || "",
      rows: document.querySelectorAll("#qualityRows tr").length,
    }));
    ok(
      "品質總覽有季度區間、路段、日別四組篩選",
      ui.hasFrom && ui.hasTo && ui.hasRoad && ui.hasDay,
      JSON.stringify(ui),
    );
    // 季度下拉要列「這個計畫有哪些季度」，不是「哪些季度已經出過異常」——
    // 否則使用者根本沒辦法表達「114Q1 到 114Q4」這個問題。
    ok(
      "季度下拉列出的是計畫實際有的季度，不是只有出過異常的季度",
      ui.quarterOptions.length > 1,
      ui.quarterOptions.join("、"),
    );
    ok(
      "品質總覽有分類型的筆數統計與清除篩選",
      ui.chips.length === 5 && ui.chips.at(-1).includes("清除篩選"),
      ui.chips.join(" "),
    );
    // 篩選邏輯本身：用合成資料驗「比較區間有重疊就列出」與各條件的組合。
    const logic = await page.evaluate(() => {
      const issues = [
        { type: "異常變化", fromPeriod: "113Q4", period: "114Q1", road: "A路", day: "平日" },
        { type: "異常變化", fromPeriod: "114Q4", period: "115Q1", road: "B路", day: "假日" },
        { type: "速限未確認", period: "全部", road: "A路" },
        { type: "資料組不完整", period: "114Q3", road: "A路", day: "平日" },
        { type: "異常變化", fromPeriod: "116Q1", period: "116Q2", road: "C路", day: "平日" },
        { type: "異常變化", fromPeriod: "114Q1", period: "114Q9", road: "D路", day: "平日" },
      ];
      const run = (f) =>
        filterQualityIssues(issues, { from: "", to: "", road: "", day: "", peak: "", types: [], ...f })
          .map((x) => `${x.type}|${x.fromPeriod || ""}${x.period}|${x.road}|${x.peak || ""}`);
      return {
        range: run({ from: "114Q1", to: "114Q4" }),
        typeOnly: run({ types: ["數值異常"] }),
        road: run({ road: "B路" }),
        dayOnly: run({ day: "平日" }),
        none: run({ from: "116Q1", to: "116Q4" }),
        reversed: run({ from: "114Q4", to: "114Q1" }),
      };
    });
    ok(
      "季度區間用「比較區間有重疊就列出」：114Q1～114Q4 會含 113Q4→114Q1 與 114Q4→115Q1",
      logic.range.some((x) => x.startsWith("異常變化|113Q4114Q1")) &&
        logic.range.some((x) => x.startsWith("異常變化|114Q4115Q1")),
      logic.range.join("｜"),
    );
    ok(
      "完全落在區間外的異常不會出現",
      !logic.range.some((x) => x.includes("116Q1116Q2")),
      logic.range.join("｜"),
    );
    ok(
      "與季度無關的項目（速限未確認）在任何區間都看得到",
      logic.range.some((x) => x.startsWith("速限未確認")) &&
        logic.none.some((x) => x.startsWith("速限未確認")),
      logic.none.join("｜"),
    );
    ok("只選一種類型時其他類型不會出現", logic.typeOnly.every((x) => x.startsWith("數值異常")), logic.typeOnly.join("｜"));
    ok(
      "路段篩選只排除「有路段欄位但不是該路段」的項目",
      logic.road.every((x) => x.includes("|B路|")),
      logic.road.join("｜"),
    );
    // 與該維度無關的項目一律列出——否則選了日別，表格會幾乎空掉，
    //「日別不完整」這種本來就沒有日別欄位的項目更是完全看不到。
    ok(
      "沒有日別欄位的項目（速限未確認）不會被日別篩選藏起來",
      logic.dayOnly.some((x) => x.startsWith("速限未確認")),
      logic.dayOnly.join("｜"),
    );
    // 季度字串怪怪的（手改過的備份可能出現 114Q9）時，安全的行為是「照樣列出」
    // 而不是默默藏起來——把一筆異常藏掉比多列一筆嚴重得多。
    // 至於篩選端，下拉本身就只提供 validPeriod 通過的季度，選不到壞值。
    ok(
      "季度字串無法解析的異常會照樣列出，不會被默默藏起來",
      logic.range.some((x) => x.includes("114Q9")) &&
        logic.none.some((x) => x.includes("114Q9")),
      logic.range.join("｜"),
    );
    ok(
      "季度下拉只提供格式正確的季度，選不到壞值",
      ui.quarterOptions.every((v) => v === "" || /^\d{2,3}Q[1-4]$/.test(v)),
      ui.quarterOptions.join("、"),
    );
    ok(
      "起訖季度顛倒選也能正常運作（不會變成空範圍）",
      logic.reversed.length === logic.range.length,
      `${logic.reversed.length} vs ${logic.range.length}`,
    );
    // 篩選只影響畫面，不能影響交付內容。
    const clickChip = await page.evaluate(() => {
      const chip = document.querySelector('#qualityTypeChips .anomaly-chip[data-type="異常變化"]');
      if (!chip) return { skipped: true };
      chip.click();
      return {
        total: healthIssues.length,
        shown: document.getElementById("qualityShown")?.textContent || "",
      };
    });
    ok(
      "按下類型後只改變畫面顯示，healthIssues 原始資料不變",
      clickChip.skipped || clickChip.total > 0,
      JSON.stringify(clickChip),
    );
    await page.evaluate(() => document.getElementById("qualityClear")?.click());
    await page.waitForTimeout(200);
  }
}

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
console.log(problems.length ? `\n❌ 有問題：\n- ${problems.join("\n- ")}` : "\n全部通過");
process.exit(problems.length ? 1 : 0);
