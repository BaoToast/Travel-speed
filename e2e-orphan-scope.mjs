/*
 * ══════════════════════════════════════════════════════════════════════
 *  指到「已經不存在的路段」的覆寫：要看得見、要清得掉、要清得準
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼有這一支：
 *
 * 判定門檻（losRuleScopes）、三段分法（bandRuleScopes）與路段速限版本
 *（speedVersions）三組設定**都以路段名稱為鍵**。路段被改名、被合併、
 * 或那一段的資料整批被刪掉之後，這些設定會留在原地變成**孤兒**——
 * 它永遠命不中任何一筆資料，於是那幾季安靜地退回計畫預設值，
 * 服務水準等級跟著變，而畫面上一個字都沒說。
 *
 * ⚠️ 這一支守的是**雙向**，缺一邊都是假綠：
 *   ① 沒有孤兒時，那兩塊面板**完全不出現**（不是空面板、不是 0 列）
 *   ② 有孤兒時出現，而且**寫得出完整內容**（季別區間、路段、原本設的值）
 *   ③ 按下清除**真的清掉**（重畫之後面板消失、state 裡也沒了）
 *   ④ 清除**不可以順手清掉正常的覆寫**——這是最危險的一種錯，
 *      使用者按一下就把還在用的標準弄丟了，而且救不回來
 *   ⑤ 路段改名時，覆寫要**跟著搬過去**（一開始就不該產生孤兒）
 *
 * ⚠️ 只驗「面板出現了」是假綠：那證明不了它列得出內容，
 *   也證明不了按下去有作用。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(here, "test-fixtures");
const files = readdirSync(SAMPLE_DIR).filter((name) => name.endsWith(".xlsx"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const server = createServer((request, response) => {
  const path = join(
    here,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path) || !path.startsWith(here)) {
    response.writeHead(404).end("nf");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 950 },
    locale: "zh-TW",
    acceptDownloads: true,
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "ORPHAN");
await page.fill("#projectName", "孤兒覆寫守門");
await page.click("#saveProject");
await page.waitForTimeout(500);

async function importQuarter(index) {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index });
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
  await page.waitForTimeout(3000);
  await page.click("#commit");
  await page.waitForTimeout(1500);
}
await importQuarter(0);
await importQuarter(1);

const gotoStandards = async () => {
  await page.evaluate(() =>
    document.querySelector('[data-view="standards"]').click(),
  );
  await page.waitForTimeout(700);
};
const gotoSpeed = async () => {
  await page.evaluate(() => document.querySelector('[data-view="speed"]').click());
  await page.waitForTimeout(700);
};

await gotoStandards();
const roads = await page.evaluate(() =>
  [...document.querySelectorAll("#scopeRoad option")]
    .map((option) => option.value)
    .filter((value) => value !== "*"),
);
const periods = await page.evaluate(() =>
  [...document.querySelectorAll("#scopePeriodFrom option")]
    .map((option) => option.value)
    .filter((value) => value !== "*"),
);
ok(
  "前置：至少有一個實際路段與一個實際季別（0 個的話下面全部恆真）",
  roads.length >= 1 && periods.length >= 1,
  `路段 ${roads.length} 個、季別 ${periods.length} 個`,
);
const liveRoad = roads[0];
const livePeriod = periods[0];

/* ══ 一、先用真實介面設三條「指到存在路段」的正常覆寫 ══════════ */
console.log("\n══ 一、先設三條正常覆寫（指到還在的路段）══");
await page.selectOption("#scopePeriodFrom", livePeriod);
await page.selectOption("#scopePeriodTo", livePeriod);
await page.selectOption("#scopeRoad", liveRoad);
for (const [grade, value] of [
  ["A", "0.9"],
  ["B", "0.8"],
  ["C", "0.7"],
  ["D", "0.6"],
  ["E", "0.5"],
])
  await page.fill(`#scope${grade}`, value);
await page.click("#addRuleScope");
await page.waitForTimeout(900);

await page.selectOption("#bandScopePeriodFrom", livePeriod);
await page.selectOption("#bandScopePeriodTo", livePeriod);
await page.selectOption("#bandScopeRoad", liveRoad);
await page.selectOption("#bandScopeSmoothEnd", "A");
await page.selectOption("#bandScopeCongestedStart", "C");
await page.click("#addBandScope");
await page.waitForTimeout(900);

await gotoSpeed();
const versionKey = await page.evaluate(
  () => document.querySelector("#versionLimitKey option")?.value || "",
);
ok("前置：速限的路段／方向下拉列得出實際的值", Boolean(versionKey), versionKey);
await page.selectOption("#versionLimitKey", versionKey);
await page.fill("#versionSpeed", "70");
await page.fill("#versionStart", livePeriod);
await page.fill("#versionEnd", "");
await page.click("#saveSpeedVersion");
await page.waitForTimeout(1200);

const normalCounts = await page.evaluate(() => ({
  los: (state.losRuleScopes?.[state.activeCode] || []).length,
  band: (state.bandRuleScopes?.[state.activeCode] || []).length,
  version: Object.keys(state.speedVersions || {}).filter((key) =>
    key.startsWith(`${state.activeCode}|`),
  ).length,
}));
ok(
  "前置：三條正常覆寫都設進去了（沒設成功的話「不可以誤清」那一條恆真）",
  normalCounts.los >= 1 && normalCounts.band >= 1 && normalCounts.version >= 1,
  JSON.stringify(normalCounts),
);

/* ══ 二、沒有孤兒時，兩塊面板都不可以出現 ═══════════════════ */
console.log("\n══ 二、沒有孤兒時：兩塊面板完全不出現 ══");
await gotoStandards();
const quietStandards = await page.evaluate(() => {
  const host = document.getElementById("standards-orphan");
  return {
    found: Boolean(host),
    hidden: Boolean(host?.hidden),
    height: host ? Math.round(host.getBoundingClientRect().height) : -1,
  };
});
ok("前置：孤兒面板這個元素本身存在（不存在的話下面全部恆真）", quietStandards.found);
ok(
  "⚠️ ① 沒有孤兒時，判定標準頁的孤兒面板**不出現**（hidden 且量不到高度）",
  quietStandards.hidden && quietStandards.height === 0,
  `hidden=${quietStandards.hidden}、高度 ${quietStandards.height}px`,
);
const quietNav = await page.evaluate(() =>
  [...document.querySelectorAll(".nav-section")].map((item) =>
    (item.textContent || "").trim(),
  ),
);
ok(
  "⚠️ ① 側欄也不可以列出一個點了什麼都沒有的小分頁",
  !quietNav.some((label) => label.includes("不存在")),
  quietNav.join("／") || "（沒有小分頁）",
);
await gotoSpeed();
const quietSpeed = await page.evaluate(() => {
  const host = document.getElementById("speedVersionOrphan");
  return {
    found: Boolean(host),
    hidden: Boolean(host?.hidden),
    height: host ? Math.round(host.getBoundingClientRect().height) : -1,
  };
});
ok("前置：速限的孤兒面板這個元素本身存在", quietSpeed.found);
ok(
  "⚠️ ① 沒有孤兒時，路段速限頁的孤兒面板**不出現**",
  quietSpeed.hidden && quietSpeed.height === 0,
  `hidden=${quietSpeed.hidden}、高度 ${quietSpeed.height}px`,
);

/* ══ 三、種下孤兒 ═══════════════════════════════════════════ */
console.log("\n══ 三、種下孤兒（模擬還原舊備份／那一段的資料後來被刪掉）══");
/*
 * ⚠️ 這裡直接改 state，不是走介面——因為「路段改名」這條路現在**會把覆寫
 *   一起搬過去**（第五段驗的就是這件事），走它反而造不出孤兒。
 *   真實世界造出孤兒的路徑是「還原一份舊備份」或「那一段的資料整批被刪掉」，
 *   兩者留下來的 state 就長這樣。
 */
const GHOST_ROAD = "已經不存在的路段（甲街～乙街）";
await page.evaluate((ghost) => {
  const code = state.activeCode;
  state.losRuleScopes[code].push({
    periodFrom: "*",
    periodTo: "*",
    road: ghost,
    rules: { A: 0.95, B: 0.85, C: 0.75, D: 0.65, E: 0.55 },
  });
  state.bandRuleScopes[code].push({
    periodFrom: "*",
    periodTo: "*",
    road: ghost,
    rules: { smoothEnd: "B", congestedStart: "E" },
  });
  state.speedVersions[`${code}|${ghost}|1`] = [
    { id: "SVGHOST", speed: 88, start: "115Q1", end: "", note: "舊備份留下來的" },
  ];
  renderAll();
}, GHOST_ROAD);
await page.waitForTimeout(900);

await gotoStandards();
const loud = await page.evaluate(() => {
  const host = document.getElementById("standards-orphan");
  return {
    hidden: Boolean(host?.hidden),
    height: host ? Math.round(host.getBoundingClientRect().height) : -1,
    rows: [...document.querySelectorAll("#orphanScopeRows tr")].map((row) =>
      [...row.children].map((cell) => (cell.textContent || "").trim()).join("｜"),
    ),
    text: (host?.innerText || "").replace(/\s+/g, " "),
  };
});
ok(
  "⚠️ ② 有孤兒時，判定標準頁的孤兒面板**冒出來**（不是 hidden、量得到高度）",
  !loud.hidden && loud.height > 20,
  `hidden=${loud.hidden}、高度 ${loud.height}px`,
);
ok(
  "⚠️ ② 兩種覆寫（服務水準門檻＋三段分法）各列一條",
  loud.rows.length === 2,
  `${loud.rows.length} 列：${loud.rows.join(" ／ ")}`,
);
/*
 * ⚠️ 只數列數是假綠。使用者要判斷「這條能不能清」，靠的是**內容**：
 *   指到哪一段、涵蓋哪幾季、原本設的是什麼值。三者缺一都不夠。
 */
/*
 * ⚠️ `.every()` 在**空陣列**上永遠是 true。面板沒冒出來時 rows 是 0 筆，
 *   下面這幾條就會全部假綠——所以每一條都要先確認「真的有列」。
 */
ok(
  "⚠️ ② 列得出**指到的路段名稱**（不寫出來的話使用者沒辦法判斷該不該清）",
  loud.rows.length > 0 && loud.rows.every((row) => row.includes(GHOST_ROAD)),
  loud.rows.join(" ／ ") || "（一列都沒有）",
);
ok(
  "⚠️ ② 列得出**原本設的值**：服務水準那一條要看得到 A～E 的門檻",
  loud.rows.some((row) => /0\.95/.test(row) && /0\.55/.test(row)),
  loud.rows.find((row) => row.includes("服務水準")) || "",
);
ok(
  "⚠️ ② 列得出**原本設的值**：三段分法那一條要看得到分界（順暢到 B、壅塞從 E 起）",
  loud.rows.some((row) => /B/.test(row) && /E/.test(row) && row.includes("三段分法")),
  loud.rows.find((row) => row.includes("三段分法")) || "",
);
ok(
  "⚠️ ② 列得出**季別區間**，而且不可以印出原始的 `*`",
  loud.rows.length > 0 &&
    loud.rows.every((row) => row.includes("全季別")) &&
    !loud.text.includes("*"),
  loud.rows.join(" ／ ") || "（一列都沒有）",
);
ok(
  "⚠️ ② 面板上要講明白「清掉救不回來」（一鍵清除是不可逆的動作）",
  !loud.hidden && /救不回來/.test(loud.text),
  loud.text.slice(0, 120) || "（面板沒出現）",
);

await gotoSpeed();
const loudSpeed = await page.evaluate(() => {
  const host = document.getElementById("speedVersionOrphan");
  return {
    hidden: Boolean(host?.hidden),
    height: host ? Math.round(host.getBoundingClientRect().height) : -1,
    rows: [...document.querySelectorAll("#orphanVersionRows tr")].map((row) =>
      [...row.children].map((cell) => (cell.textContent || "").trim()).join("｜"),
    ),
  };
});
ok(
  "⚠️ ② 有孤兒時，路段速限頁的孤兒面板**冒出來**",
  !loudSpeed.hidden && loudSpeed.height > 20,
  `hidden=${loudSpeed.hidden}、高度 ${loudSpeed.height}px`,
);
ok(
  "⚠️ ② 速限那一條列得出完整內容（路段／方向、速限、季別區間、備註）",
  loudSpeed.rows.length === 1 &&
    loudSpeed.rows[0].includes(GHOST_ROAD) &&
    /88/.test(loudSpeed.rows[0]) &&
    /舊備份留下來的/.test(loudSpeed.rows[0]),
  loudSpeed.rows.join(" ／ "),
);
/*
 * ⚠️ 正常的那一條速限版本**不可以**被列進孤兒清單。
 *   列錯的話使用者會把還在用的速限一起清掉。
 */
ok(
  "⚠️ ④ 指到存在路段的那一條速限版本**沒有**被誤列成孤兒",
  !loudSpeed.rows.some((row) => /70/.test(row)),
  loudSpeed.rows.join(" ／ "),
);

/* ══ 四、按下清除 ═══════════════════════════════════════════ */
console.log("\n══ 四、按下清除：真的清掉，而且只清孤兒 ══");
/*
 * ⚠️ 用有時限的點擊。面板沒冒出來時按鈕是看不見的，
 *   直接 page.click 會卡滿 30 秒然後整支炸掉——那樣後面的斷言一條都跑不到，
 *   而「舊版會紅」的證明就只剩一堆超時訊息，看不出真正壞在哪。
 */
const clickOrFail = async (selector, label) => {
  try {
    await page.click(selector, { timeout: 5000 });
    await page.waitForTimeout(1200);
    return true;
  } catch {
    ok(label, false, "按鈕點不到（面板沒出現，或被蓋住）");
    return false;
  }
};
await clickOrFail("#clearOrphanVersions", "⚠️ ③ 速限的「清除孤兒」按鈕按得到");
await gotoSpeed();
const afterSpeed = await page.evaluate(() => {
  const host = document.getElementById("speedVersionOrphan");
  return {
    hidden: Boolean(host?.hidden),
    keys: Object.keys(state.speedVersions || {}).filter((key) =>
      key.startsWith(`${state.activeCode}|`),
    ),
  };
});
ok(
  "⚠️ ③ 清除之後速限的孤兒面板**收回去**",
  afterSpeed.hidden,
  `hidden=${afterSpeed.hidden}`,
);
ok(
  "⚠️ ③ state 裡那一組孤兒速限**真的不見了**（只收面板不算清）",
  !afterSpeed.keys.some((key) => key.includes(GHOST_ROAD)),
  afterSpeed.keys.join("、"),
);
ok(
  "⚠️ ④ 正常的那一組速限版本**一條都沒有被清掉**",
  afterSpeed.keys.length === normalCounts.version,
  `現在 ${afterSpeed.keys.length} 組、原本 ${normalCounts.version} 組`,
);

await gotoStandards();
await clickOrFail("#clearOrphanScopes", "⚠️ ③ 判定標準的「清除孤兒」按鈕按得到");
await gotoStandards();
const afterStandards = await page.evaluate(() => {
  const host = document.getElementById("standards-orphan");
  const code = state.activeCode;
  return {
    hidden: Boolean(host?.hidden),
    los: (state.losRuleScopes?.[code] || []).map((item) => item.road),
    band: (state.bandRuleScopes?.[code] || []).map((item) => item.road),
    losRows: document.querySelectorAll("#ruleScopeRows tr").length,
    bandRows: document.querySelectorAll("#bandScopeRows tr").length,
  };
});
ok(
  "⚠️ ③ 清除之後判定標準頁的孤兒面板**收回去**",
  afterStandards.hidden,
  `hidden=${afterStandards.hidden}`,
);
ok(
  "⚠️ ③ state 裡兩條孤兒覆寫**真的不見了**",
  !afterStandards.los.includes(GHOST_ROAD) &&
    !afterStandards.band.includes(GHOST_ROAD),
  `LOS：${afterStandards.los.join("、")}／三段：${afterStandards.band.join("、")}`,
);
/*
 * ⚠️ 這一條是整支最重要的：一鍵清除把還在用的覆寫也清掉的話，
 *   使用者按一下就把自己訂的標準弄丟了，而且救不回來。
 */
ok(
  "⚠️ ④ 指到存在路段的那兩條覆寫**一條都沒有被清掉**",
  afterStandards.los.includes(liveRoad) && afterStandards.band.includes(liveRoad),
  `LOS：${afterStandards.los.join("、")}／三段：${afterStandards.band.join("、")}`,
);
ok(
  "⚠️ ④ 兩張覆寫表上也還看得到那兩條（不是只有 state 裡還在）",
  afterStandards.losRows >= 1 && afterStandards.bandRows >= 1,
  `LOS 表 ${afterStandards.losRows} 列、三段表 ${afterStandards.bandRows} 列`,
);

/* ══ 五、路段改名時，覆寫要跟著搬 ═══════════════════════════ */
console.log("\n══ 五、路段改名：覆寫跟著搬，一開始就不該產生孤兒 ══");
/*
 * ⚠️ 舊版只搬了 limits／limitConfirmed／speedVersions／roadMeta，
 *   判定門檻與三段分法的覆寫**留在原地變成孤兒**——那幾季會安靜地
 *   退回計畫預設門檻，服務水準等級跟著變。這是會直接影響數字的錯。
 */
const NEW_NAME = "改名後的路段（丙街～丁街）";
await page.evaluate(() =>
  document.querySelector('[data-view="roadadmin"]')?.click(),
);
await page.waitForTimeout(700);
await page.selectOption("#renameRoad", liveRoad);
await page.fill("#formalRoadName", NEW_NAME);
await page.click("#previewRename");
await page.waitForTimeout(700);
await page.click("#confirmRoadChange");
await page.waitForTimeout(2500);

/*
 * ⚠️ 不可以拿「我填進去的那串字」直接比。
 *   路段名稱寫進資料前會先正規化（全形括號→半形等等），
 *   所以存起來的名稱和我輸入的**不會逐字相同**。
 *   要比的是：舊名稱不見了、而且覆寫指到的那個名稱**確實在現在的明細裡**。
 *   （這正是「孤兒」的定義，比對一個寫死的字串還準。）
 */
const renamed = await page.evaluate(() => {
  const code = state.activeCode;
  return {
    losRoads: (state.losRuleScopes?.[code] || []).map((item) => item.road),
    bandRoads: (state.bandRuleScopes?.[code] || []).map((item) => item.road),
    detailRoads: [
      ...new Set(
        state.details
          .filter((row) => row.projectCode === code)
          .map((row) => row.road),
      ),
    ],
  };
});
ok(
  "前置：改名真的做了（舊名稱已經不在明細裡）",
  !renamed.detailRoads.includes(liveRoad),
  renamed.detailRoads.join("、"),
);
ok(
  "⚠️ ⑤ 服務水準門檻的覆寫**跟著搬到新名稱**（沒搬的話那幾季會悄悄退回預設門檻）",
  renamed.losRoads.length === normalCounts.los &&
    !renamed.losRoads.includes(liveRoad) &&
    renamed.losRoads.every((road) => renamed.detailRoads.includes(road)),
  `覆寫指到：${renamed.losRoads.join("、")}／明細上的路段：${renamed.detailRoads.join("、")}`,
);
ok(
  "⚠️ ⑤ 三段分法的覆寫也**跟著搬到新名稱**",
  renamed.bandRoads.length === normalCounts.band &&
    !renamed.bandRoads.includes(liveRoad) &&
    renamed.bandRoads.every((road) => renamed.detailRoads.includes(road)),
  `覆寫指到：${renamed.bandRoads.join("、")}／明細上的路段：${renamed.detailRoads.join("、")}`,
);
await gotoStandards();
const afterRename = await page.evaluate(() =>
  Boolean(document.getElementById("standards-orphan")?.hidden),
);
ok(
  "⚠️ ⑤ 改完名之後孤兒面板**不可以**冒出來（搬對了就不該有孤兒）",
  afterRename,
  `hidden=${afterRename}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 孤兒覆寫：沒有時不出現、有時列得出完整內容、清得掉、而且不會誤清正常的；改名時會跟著搬",
);
