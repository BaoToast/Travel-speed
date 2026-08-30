/**
 * 端對端：調查日期 × 季度檢查，以及期別顯示切換（v2.20.16）。
 *
 * 四段，全部用真的瀏覽器走完整條匯入路徑：
 *   A. 日期落在所選季度內   → 不打擾，直接寫入
 *   B. 日期不在所選季度內   → 預覽上方紅底提示；按「確認寫入」跳二次確認；
 *                             按「取消」不可以寫進去，按「確定」才寫得進去
 *   C. 表頭完全沒有日期     → **不阻擋**，只提醒使用者自行確認
 *   D. 期別顯示可以切成「實際調查月份」，而且切換不改變任何數字
 *
 * 對未修正的 v2.20.13 應該紅字——量的是畫面文字與寫入結果，
 * 不是「新函式在舊版不存在」那種假證明。
 *
 * 測資是這一支自己現產的匿名版型，不含任何正式調查資料。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
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
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 匿名報告版型。日期刻意放在第 3 列的第 28 欄（AB3）——不是固定位置，
 * 就是要證明系統讀的是整塊表頭、不是某一格。
 */
function directionBlock({ travel, running, directionText }) {
  return [
    ["旅次編號"],
    [`方向 往：${directionText}`],
    ["路段延滯"],
    [60],
    ["交叉口延滯"],
    [30],
    ["平均總旅行速率", travel],
    ["平均總行駛速率", running],
    [],
  ];
}
function peakSheet(rows, dateText) {
  const aoa = [
    ...directionBlock({ ...rows[0], directionText: "甲路口--->乙路口" }),
    ...directionBlock({ ...rows[1], directionText: "乙路口--->甲路口" }),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  if (dateText) sheet["AB3"] = { t: "s", v: dateText, w: dateText };
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  sheet["!ref"] = XLSX.utils.encode_range({
    s: range.s,
    e: { r: Math.max(range.e.r, 2), c: Math.max(range.e.c, 27) },
  });
  return sheet;
}
function makeFile(dateText, offset) {
  const am = [
    { travel: 21.08 + offset, running: 35.78 + offset },
    { travel: 26.25 + offset, running: 38.64 + offset },
  ];
  const pm = [
    { travel: 22.41 + offset, running: 36.27 + offset },
    { travel: 20.52 + offset, running: 34.73 + offset },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, peakSheet(am, dateText), "上午尖峰");
  XLSX.utils.book_append_sheet(wb, peakSheet(pm, dateText), "下午尖峰");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ locale: "zh-TW" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let dialogMode = "accept";
const dialogs = [];
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  if (dialogMode === "dismiss" && /調查日期與你選擇的期別不一致/.test(d.message()))
    await d.dismiss();
  else await d.accept();
});
await page.goto(base);
await page.waitForTimeout(700);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "E2E-PD");
await page.fill("#projectName", "期別檢查測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function preview(name, dateText, offset, quarterIndex = 0) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
  await page.setInputFiles("#files", {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: makeFile(dateText, offset),
  });
  await page.click("#preview");
  await page.waitForTimeout(2500);
  await resolveRoads();
}
/*
 * 路段名稱相近時，預覽會要求先確認「新路段還是併入」，沒確認前
 *「確認寫入」是停用的。這一支測的不是路段判斷，所以一律標成新路段。
 */
async function resolveRoads() {
  const bar = await page.evaluate(() => {
    const box = document.getElementById("roadAlert");
    return Boolean(box) && box.style.display !== "none";
  });
  if (!bar) return;
  await page.evaluate(() => {
    const all = document.getElementById("pickAll");
    if (all && !all.checked) {
      all.checked = true;
      all.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("pickAsNew")?.click());
  await page.waitForTimeout(600);
}
/*
 * 按「確認寫入」。按鈕停用時不硬等——舊版沒有二次確認，第一次點就寫進去了，
 * 預覽被清掉、按鈕跟著停用；那正是要量的行為，不該讓腳本卡死在這裡。
 */
async function clickCommit() {
  const disabled = await page.evaluate(
    () => document.getElementById("commit")?.disabled !== false,
  );
  if (disabled) return false;
  await page.click("#commit");
  return true;
}
const alertText = async () =>
  page.evaluate(() => {
    const box = document.getElementById("periodDateAlert");
    return box && !box.hidden ? box.innerText.replace(/\s+/g, " ") : "";
  });
/** 目前已寫入幾筆尖峰明細——量的是畫面上的狀態列。 */
const writtenCount = async () =>
  page.evaluate(() => {
    document.querySelector('[data-view="details"]')?.click();
    return document.querySelectorAll("#detailRows tr").length;
  });

/* ── A：日期落在所選季度內 ── */
await preview("A_1月_測試路段(甲路～乙路)-平日.xlsx", "日　　期：115年01月26日(平日)", 0);
ok("A 日期在季度內時預覽沒有任何期別提示", (await alertText()) === "", await alertText());
dialogs.length = 0;
await clickCommit();
await page.waitForTimeout(1500);
ok(
  "A 日期在季度內時「確認寫入」不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);

/* ── B：日期不在所選季度內 ── */
await preview("B_8月_第二測試路段(丙路～丁路)-平日.xlsx", "監測日期：115年08月05日(平日)", 1);
const bAlert = await alertText();
ok("B 預覽上方顯眼標示日期與季度不一致", /不一致/.test(bAlert), bAlert.slice(0, 200));
ok("B 提示裡寫出檔案裡的日期", /2026-08-05/.test(bAlert), bAlert.slice(0, 200));
ok("B 提示裡寫出日期屬於哪一季", /115Q3/.test(bAlert), bAlert.slice(0, 200));
ok("B 提示裡寫出來源儲存格", /上午尖峰!AB3/.test(bAlert), bAlert.slice(0, 200));

const beforeB = await writtenCount();
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
dialogs.length = 0;
dialogMode = "dismiss";
await clickCommit();
await page.waitForTimeout(1500);
ok(
  "B 按「確認寫入」會跳二次確認框",
  dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 160),
);
ok("B 二次確認按「取消」之後沒有寫進去", (await writtenCount()) === beforeB, `${beforeB} 筆`);

await page.evaluate(() => document.querySelector('[data-view="import"]').click());
dialogs.length = 0;
dialogMode = "accept";
await clickCommit();
await page.waitForTimeout(1800);
ok("B 二次確認按「確定」之後才寫得進去", (await writtenCount()) > beforeB, `${beforeB} → ?`);

/* ── C：表頭讀不到日期，不可以阻擋 ── */
await preview("C_沒有日期_報告測試路段(入口～出口)-平日.xlsx", "", 2);
const cAlert = await alertText();
ok(
  "C 讀不到日期時用使用者指定的字句提醒",
  /無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性/.test(cAlert),
  cAlert.slice(0, 220),
);
const beforeC = await writtenCount();
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
dialogs.length = 0;
await clickCommit();
await page.waitForTimeout(1800);
ok(
  "C 讀不到日期不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);
ok("C 讀不到日期照樣匯得進去（不阻擋）", (await writtenCount()) > beforeC, `${beforeC} → ?`);

/* ── D：期別顯示切換 ── */
await preview("D_3月_第四測試路段(戊路～己路)-平日.xlsx", "日　　期：115年03月09日(平日)", 3);
dialogMode = "accept";
await clickCommit();
await page.waitForTimeout(1800);

const toggleText = async () =>
  page.evaluate(() => {
    const b = document.getElementById("periodDisplayToggle");
    return b ? b.textContent.trim() : "（沒有這顆按鈕）";
  });
/*
 * 尖峰明細表整張讀成二維陣列。
 * 第 1 欄是期別（本來就會變），其餘每一格切換前後必須逐字相同——
 * 這才是「切換只換顯示文字、不改任何數字」真正該量的東西。
 */
const detailCells = async () =>
  page.evaluate(() => {
    document.querySelector('[data-view="details"]')?.click();
    return [...document.querySelectorAll("#detailRows tr")].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim()),
    );
  });
/** 第 1 欄（期別）目前顯示什麼。 */
const periodColumn = async () =>
  (await detailCells()).map((row) => row[0]).filter(Boolean);

ok(
  "有期別顯示切換鈕",
  await page.evaluate(() => Boolean(document.getElementById("periodDisplayToggle"))),
);
ok("預設顯示季別", /期別顯示：季別/.test(await toggleText()), await toggleText());
const before = await detailCells();
const beforePeriods = await periodColumn();
ok(
  "季別模式下明細表的期別欄顯示 115Q1",
  beforePeriods.length > 0 && beforePeriods.every((v) => v === "115Q1"),
  [...new Set(beforePeriods)].join("、"),
);

await page.evaluate(() => document.getElementById("periodDisplayToggle")?.click());
await page.waitForTimeout(900);
ok("切到「調查月份」", /期別顯示：調查月份/.test(await toggleText()), await toggleText());
const after = await detailCells();
const afterPeriods = await periodColumn();
/*
 * 這一季實際包含 1、3 月（正常匯入）與 8 月（B 那份刻意選錯季度、
 * 二次確認後仍以 115Q1 寫入的）。月份模式要把三個月都列出來——
 * 這正是它的用處：一眼看出這一季裡混進了不該在的月份。
 */
ok(
  "明細表的期別欄改成實際調查月份，三個月都列出來",
  afterPeriods.length > 0 && afterPeriods.every((v) => v === "115年1、3、8月"),
  [...new Set(afterPeriods)].join("、"),
);

/* 期別那一欄本來就會變，其餘每一格切換前後必須逐字相同。 */
const strip = (rows) => rows.map((row) => row.slice(1));
ok(
  "切換前後明細表每一格數字逐字相同（只有期別那一欄變了）",
  JSON.stringify(strip(before)) === JSON.stringify(strip(after)),
  (() => {
    const a = strip(before);
    const b = strip(after);
    const diff = [];
    for (let r = 0; r < Math.max(a.length, b.length); r += 1)
      if (JSON.stringify(a[r]) !== JSON.stringify(b[r]))
        diff.push(`第 ${r + 1} 列 ${JSON.stringify(a[r])} → ${JSON.stringify(b[r])}`);
    return diff.slice(0, 3).join("  ") || `${a.length} 列全部相同`;
  })(),
);
ok("明細表確實有資料可比（不是拿空表當通過）", before.length >= 4, `${before.length} 列`);

/* ── E：多計畫與 Manager 的月份來源不可互相污染 ── */
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("TrafficLOSWebV2", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const current = await new Promise((resolve, reject) => {
    const request = db.transaction("app").objectStore("app").get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const p1Details = current.details.filter((x) => x.projectCode === "E2E-PD");
  const p1Summaries = current.summaries.filter((x) => x.projectCode === "E2E-PD");
  const p2Details = p1Details.map((x, i) => ({
    ...x,
    id: `E2E-PD-2-${i}`,
    projectCode: "E2E-PD-2",
    surveyDate: "2026-02-05",
  }));
  const p2Summaries = p1Summaries.map((x, i) => ({
    ...x,
    id: `E2E-PD-2-S-${i}`,
    projectCode: "E2E-PD-2",
    surveyDate: "2026-02-05",
  }));
  current.projects = [
    { code: "E2E-PD", name: "期別檢查測試計畫" },
    { code: "E2E-PD-2", name: "二月測試計畫" },
  ];
  current.activeCode = "E2E-PD";
  current.details = [...p1Details, ...p2Details];
  current.summaries = [...p1Summaries, ...p2Summaries];
  current.periodDisplay = "month";
  current.manager = [
    {
      kind: "TLM_PROJECT_PACKAGE",
      project: current.projects[0],
      details: structuredClone(p1Details),
      summaries: structuredClone(p1Summaries),
      roadMeta: {},
    },
    {
      kind: "TLM_PROJECT_PACKAGE",
      project: current.projects[1],
      details: structuredClone(p2Details),
      summaries: structuredClone(p2Summaries),
      roadMeta: {},
    },
  ];
  await new Promise((resolve, reject) => {
    const request = db.transaction("app", "readwrite").objectStore("app").put(current, "state");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
await page.reload();
await page.waitForTimeout(1000);
const scopedProjectPeriods = await periodColumn();
ok(
  "目前 Project 的月份只取自目前計畫，不會混入另一計畫的二月",
  scopedProjectPeriods.length > 0 &&
    scopedProjectPeriods.every((v) => v === "115年1、3、8月") &&
    scopedProjectPeriods.every((v) => !v.includes("2月")),
  [...new Set(scopedProjectPeriods)].join("、"),
);
await page.evaluate(() => document.querySelector('[data-view="detail"]')?.click());
await page.fill("#detailSearch", "115年1、3、8月");
await page.waitForTimeout(300);
ok(
  "尖峰明細可用畫面顯示的月份搜尋",
  await page.evaluate(() => document.querySelectorAll("#detailRows tr").length > 0),
);
await page.fill("#detailSearch", "");

await page.evaluate(() => document.querySelector('[data-view="manager"]')?.click());
await page.selectOption("#managerProjectFilter", "E2E-PD");
await page.waitForTimeout(500);
const managerPeriodText = async () =>
  page.evaluate(() => [...document.querySelectorAll("#managerRows tr td:nth-child(2)")].map((x) => x.textContent.trim()));
const managerChartText = async () =>
  page.evaluate(() => [...document.querySelectorAll("#managerChartGrid .bar-group small")].map((x) => x.textContent.trim()));
const managerP1 = await managerPeriodText();
ok(
  "Manager 第一個專案的月份取自該匯入包",
  managerP1.length > 0 && managerP1.every((v) => v === "115年1、3、8月"),
  [...new Set(managerP1)].join("、"),
);
ok(
  "Manager 第一個專案的圖表月份也取自該匯入包",
  (await managerChartText()).every((v) => v === "115年1、3、8月"),
  [...new Set(await managerChartText())].join("、"),
);
await page.selectOption("#managerProjectFilter", "E2E-PD-2");
await page.waitForTimeout(500);
const managerP2 = await managerPeriodText();
ok(
  "Manager 第二個專案只顯示自己的二月，不借用目前 Project 的月份",
  managerP2.length > 0 && managerP2.every((v) => v === "115年2月"),
  [...new Set(managerP2)].join("、"),
);
ok(
  "Manager 第二個專案的圖表只顯示自己的二月",
  (await managerChartText()).every((v) => v === "115年2月"),
  [...new Set(await managerChartText())].join("、"),
);

/* 只改本機調查日期時，Manager 也要提示專案包已過期。 */
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("TrafficLOSWebV2", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const current = await new Promise((resolve, reject) => {
    const request = db.transaction("app").objectStore("app").get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  current.details = current.details.map((x) =>
    x.projectCode === "E2E-PD" ? { ...x, surveyDate: "2026-03-31" } : x,
  );
  await new Promise((resolve, reject) => {
    const request = db.transaction("app", "readwrite").objectStore("app").put(current, "state");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
await page.reload();
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('[data-view="manager"]')?.click());
ok(
  "只有調查日期變更時也會提示 Manager 專案包已過期",
  await page.evaluate(() => {
    const box = document.getElementById("managerStaleHint");
    return box && !box.classList.contains("hidden") && box.textContent.includes("E2E-PD");
  }),
);

/* 本機 Project 沒有日期、但 Manager 匯入包有日期時，切換鈕仍應可用。 */
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("TrafficLOSWebV2", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const current = await new Promise((resolve, reject) => {
    const request = db.transaction("app").objectStore("app").get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  current.details = current.details.map((x) => ({ ...x, surveyDate: "" }));
  await new Promise((resolve, reject) => {
    const request = db.transaction("app", "readwrite").objectStore("app").put(current, "state");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
await page.reload();
await page.waitForTimeout(700);
ok(
  "只有 Manager 專案包有日期時，調查月份切換仍可使用",
  await page.evaluate(() => document.getElementById("periodDisplayToggle")?.disabled === false),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
