/**
 * 端對端：路段有效期間的季度輸入（v2.20.30）。
 *
 * 這一支重現的是複查時實測出來的問題：
 *
 * 「路段管理 → 路段有效期間」的兩個季度欄位是自由文字，舊版只用
 * `validPeriod()`（`/^\d{2,4}Q[1-4]$/`）檢查形狀，於是
 *   2026Q1、89Q1、201Q4、2000Q1、2112Q1、9999Q1
 * 全部照收、**原樣存**，而提示卻寫著「季度格式應為民國年加 Q1～Q4」。
 *
 * 實測後果（舊版）：開始季度少按一個鍵打成 `9999Q1`，`periodIndex()` 算出
 * 32353，該路段在所有真的有資料的季度都被判成「不在有效期間」，於是
 * **悄悄從品質總覽與成果範圍消失，而且沒有任何警告**。
 *
 * 這一支量四件事：
 *   ・合法的西元寫法會換算成民國年再存（不再出現同一季兩種寫法）
 *   ・超出可換算範圍的年份會當場擋下，訊息與匯入路徑同一句
 *   ・形狀錯誤仍然擋下
 *   ・即使資料裡真的留著不可用的界線，路段也**看得見**（退化成沒有設定）
 *
 * 測資是本包自產的匿名資料，不含任何正式調查資料。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
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

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

const go = async (view) => {
  await page.evaluate((v) => {
    if (typeof go === "function") go(v);
    else document.querySelector(`[data-view="${v}"]`)?.click();
  }, view);
  await page.waitForTimeout(350);
};

/* ── 建立計畫並塞一筆匿名明細，讓路段下拉有東西 ─────────── */
await go("setup");
await page.fill("#projectCode", "99001");
await page.fill("#projectName", "有效期間輸入測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);
await page.evaluate(async () => {
  state.details.push({
    projectCode: state.activeCode,
    period: "115Q1",
    road: "測試路段(甲路～乙路)",
    direction: "方向1",
    travelSpeed: 30,
    runSpeed: 35,
    delay: 10,
    limit: 50,
    id: "e2e-road-period-1",
  });
  await save();
  renderAll();
});
await go("roadadmin");
await page.waitForTimeout(400);

const trySave = (value) =>
  page.evaluate(async (val) => {
    const sel = document.getElementById("periodRoad");
    if (sel && sel.options.length) {
      sel.value = sel.options[0].value;
      sel.onchange && sel.onchange();
    }
    document.getElementById("roadStartPeriod").value = val;
    document.getElementById("roadEndPeriod").value = "";
    document.getElementById("saveRoadPeriod").click();
    await new Promise((r) => setTimeout(r, 300));
    const meta = Object.values(state.roadMeta)[0] || {};
    return {
      stored: meta.startPeriod ?? null,
      shown: document.getElementById("roadStartPeriod").value,
      toast: (document.querySelector("#toast") || {}).textContent || "",
    };
  }, value);

/* ── 合法的西元寫法要換算成民國年 ─────────────────────── */
let r = await trySave("2026Q1");
ok("西元寫法會換算成民國年再存", r.stored === "115Q1", `存下 ${r.stored}`);
ok("輸入框同步顯示換算後的值", r.shown === "115Q1", `畫面 ${r.shown}`);
ok("會告訴使用者做了換算", /換算成民國年/.test(r.toast), r.toast.slice(0, 40));

r = await trySave("115Q2");
ok("民國寫法原樣存", r.stored === "115Q2", `存下 ${r.stored}`);

/* ── 超出可換算範圍的一律擋下，且不得改動既有值 ─────────── */
for (const bad of ["89Q1", "201Q4", "2000Q1", "2112Q1", "9999Q1"]) {
  const before = "115Q2";
  const out = await trySave(bad);
  ok(
    `「${bad}」要被擋下且不改動既有值`,
    out.stored === before && /無法使用/.test(out.toast),
    `存下 ${out.stored}｜${out.toast.slice(0, 34)}`,
  );
  ok(
    `「${bad}」的訊息要與匯入路徑同一句`,
    /民國年請填\s*90～200/.test(out.toast),
    out.toast.slice(0, 46),
  );
}

/* ── 形狀錯誤仍要擋下 ───────────────────────────────── */
const shape = await trySave("115Q9");
ok(
  "形狀錯誤仍擋下",
  shape.stored === "115Q2" && /季度格式請輸入/.test(shape.toast),
  shape.toast.slice(0, 34),
);

/* ── 舊資料若留著不可用的界線，路段必須仍然看得見 ─────────── */
const legacy = await page.evaluate(async () => {
  const key = Object.keys(state.roadMeta)[0];
  state.roadMeta[key].startPeriod = "9999Q1"; // 模擬舊版存下來的壞資料
  await save();
  const road = state.details[0].road;
  return {
    仍算有效: roadIsActive(road, "115Q1"),
    界線排序鍵: periodBoundIndex("9999Q1"),
    原本的排序鍵: periodIndex("9999Q1"),
  };
});
ok(
  "不可用的界線退化成「沒有設定」，路段不會消失",
  legacy.仍算有效 === true && legacy.界線排序鍵 === -1,
  `periodBoundIndex=${legacy.界線排序鍵}（舊的 periodIndex=${legacy.原本的排序鍵}）`,
);

/* ── 重新載入時，合法但寫成西元的舊資料會被正規化 ─────────── */
await page.evaluate(async () => {
  const key = Object.keys(state.roadMeta)[0];
  state.roadMeta[key].startPeriod = "2025Q4";
  state.roadMeta[key].endPeriod = "2026Q1";
  await save();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
const migrated = await page.evaluate(() => {
  const meta = Object.values(state.roadMeta)[0] || {};
  return { start: meta.startPeriod, end: meta.endPeriod };
});
ok(
  "既有的西元寫法在載入時統一成民國年",
  migrated.start === "114Q4" && migrated.end === "115Q1",
  JSON.stringify(migrated),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
