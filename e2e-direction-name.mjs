/*
 * 方向顯示名稱的端對端檢查（交通服務水準）。
 *
 * 使用者在「路段管理 → 方向顯示名稱」替某個路段的方向1、方向2 命名之後，
 * 全站每一個把方向寫給人看的地方都必須改用新名稱。v2.20.5 只有一半的地方
 * 有換：明細、彙總、速限、報告文字草稿是對的，Manager 比較、結論草稿產生器
 * 的方向勾選框、結論草稿的輸出、健康檢查的說明、匯出的 CSV 全部還印鍵值。
 *
 * 這一支要驗的就是「兩邊有沒有講同一句話」：
 *  ・命名後，每一個畫面都看得到新名稱
 *  ・命名後，該路段任何地方都不應該再出現裸的「方向1／方向2」
 *  ・鍵值沒有被換掉（篩選條件、速限鍵、資料 id 都還是照舊）
 *  ・別人的專案包匯進 Manager 之後，也看得到那個人取的名稱
 *
 * 使用交付包自行建立的匿名調查版型，不含任何正式計畫或使用者資料。
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
if (files.length !== 2) {
  console.log(`❌ 應有平日、假日各一份匿名測資，目前為 ${files.length} 份`);
  server.close();
  process.exit(1);
}

/* 刻意選一組看得出方位、又不可能和鍵值混淆的名稱。 */
const NAME_1 = "東-西(西行)";
const NAME_2 = "西-東(東行)";
/** 裸的鍵值：前後都不是別的字，才算「這裡沒有換成名稱」。 */
const BARE_KEY = /(^|[^一-鿿\w])方向[12]([^一-鿿\w]|$)/;

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "DIRN");
await page.fill("#projectName", "方向名稱測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

await page.evaluate(() => document.querySelector('[data-view="import"]').click());
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 0 });
await page.setInputFiles(
  "#files",
  files.map((name) => ({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLE_DIR, name)),
  })),
);
await page.click("#preview");
await page.waitForTimeout(3000);
await page.click("#commit");
await page.waitForTimeout(1500);

/*
 * 前提檢查：匯入時會依報告上的起訖文字自動命名（autoNameDirections），
 * 所以這裡本來就不是鍵值，而是自動名稱。這一支要驗的是「使用者自己改名之後
 * 全站有沒有跟著換」，因此得先確認自動名稱確實存在、而且不等於待會要填的名稱，
 * 否則後面每一項都會因為「本來就長那樣」而假通過。
 */
await page.evaluate(() => document.querySelector('nav [data-view="roadadmin"]').click());
await page.waitForTimeout(600);
const beforeRoster = await page.innerText("#roadAdminRows");
ok(
  "命名前已有自動名稱，且不等於待會要填的名稱（前提檢查）",
  beforeRoster.trim().length > 0 &&
    !beforeRoster.includes(NAME_1) &&
    !beforeRoster.includes(NAME_2),
  beforeRoster.replace(/\s+/g, " ").slice(0, 80),
);

/* ── 命名 ── */
const road = await page.$eval("#directionRoad", (el) => el.options[0]?.value || "");
ok("路段管理抓得到路段", !!road, road);
await page.selectOption("#directionRoad", road);
await page.waitForTimeout(300);
await page.fill("#directionA", NAME_1);
await page.fill("#directionB", NAME_2);
await page.click("#saveDirections");
await page.waitForTimeout(700);

const roster = await page.innerText("#roadAdminRows");
ok("路段清冊顯示新名稱", roster.includes(NAME_1) && roster.includes(NAME_2));
ok(
  "路段管理面板的欄位標題已統一為「方向1／方向2」",
  await page.evaluate(() => {
    const text = document.querySelector("#roadadmin").innerText;
    return (
      /方向1名稱/.test(text) &&
      /方向2名稱/.test(text) &&
      !/方向A/.test(text) &&
      !/方向B/.test(text)
    );
  }),
);

/** 切到某個分頁，回傳整段可見文字。 */
async function viewText(view, selector) {
  await page.evaluate((v) => {
    const button =
      document.querySelector(`nav [data-view="${v}"]`) ||
      document.querySelector(`[data-view="${v}"]`);
    if (button) button.click();
  }, view);
  await page.waitForTimeout(800);
  return page.innerText(selector);
}

/* ── 逐一檢查每個顯示方向的畫面 ── */
const surfaces = [
  ["尖峰明細", "detail", "#detail table"],
  ["尖峰彙總", "summary", "#summary table"],
  ["路段速限", "speed", "#speed"],
];
for (const [label, view, selector] of surfaces) {
  const text = await viewText(view, selector);
  ok(`${label}顯示新名稱`, text.includes(NAME_1) || text.includes(NAME_2));
  ok(`${label}沒有殘留裸的方向鍵值`, !BARE_KEY.test(text),
    (text.match(BARE_KEY)?.[0] || "").trim());
}

/* ── 結論草稿產生器：勾選框標籤 ＋ 產生出來的草稿 ── */
await page.evaluate(() => document.querySelector('[data-view="conclusion"]').click());
await page.waitForTimeout(800);
const dirChoices = await page.$$eval("#conclusionDirections label", (els) =>
  els.map((el) => el.innerText.trim()),
);
ok(
  "方向勾選框的標籤帶出新名稱",
  dirChoices.some((x) => x.includes(NAME_1)) && dirChoices.some((x) => x.includes(NAME_2)),
  dirChoices.join(" ／ "),
);
ok(
  "方向勾選框仍然看得到鍵值，使用者才知道自己在篩什麼",
  dirChoices.every((x) => /方向[12]/.test(x)),
  dirChoices.join(" ／ "),
);
await page.click("#conclusionGenerate");
await page.waitForTimeout(900);
const draft = await page.inputValue("#conclusionDraft");
ok("結論草稿寫的是新名稱", draft.includes(NAME_1) || draft.includes(NAME_2));
ok("結論草稿沒有殘留裸的方向鍵值", !BARE_KEY.test(draft),
  (draft.match(BARE_KEY)?.[0] || "").trim());

/* 只勾一個方向，筆數必須真的減半——證明鍵值篩選沒有被顯示名稱弄壞。 */
const allCount = Number((await page.textContent("#conclusionCount")).replace(/\D/g, ""));
await page.locator("#conclusionDirections input").first().click();
await page.waitForTimeout(500);
const oneCount = Number((await page.textContent("#conclusionCount")).replace(/\D/g, ""));
ok(
  "只勾一個方向時筆數確實變少（鍵值篩選沒被顯示名稱弄壞）",
  oneCount > 0 && oneCount < allCount,
  `${allCount} → ${oneCount}`,
);
await page.locator("#conclusionDirections input").first().click();
await page.waitForTimeout(400);

/* ── 成果交付：報告文字草稿 ── */
const delivery = await viewText("delivery", "#delivery").catch(() => "");
if (delivery) {
  ok("報告文字草稿頁沒有殘留裸的方向鍵值", !BARE_KEY.test(delivery),
    (delivery.match(BARE_KEY)?.[0] || "").trim());
}

/* ── 資料維護：健康檢查的問題說明 ── */
const maintenance = await viewText("maintenance", "#maintenance");
ok("資料維護頁沒有殘留裸的方向鍵值", !BARE_KEY.test(maintenance),
  (maintenance.match(BARE_KEY)?.[0] || "").trim());

/* ── 匯出的 CSV ── */
const csvText = await page.evaluate(async () => {
  let captured = "";
  const original = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    captured = blob;
    return original.call(URL, blob);
  };
  document.getElementById("exportDetail").click();
  await new Promise((r) => setTimeout(r, 400));
  URL.createObjectURL = original;
  return captured ? await captured.text() : "";
});
ok("尖峰明細 CSV 有帶出方向顯示名稱", csvText.includes(NAME_1) && csvText.includes(NAME_2),
  `${csvText.length} 字`);
ok("CSV 仍然保留原始方向鍵值欄位", /方向1/.test(csvText) && /方向2/.test(csvText));

/* ── Manager：把專案包丟進去，要看得到對方取的名稱 ── */
const packageJson = await page.evaluate(() => {
  let captured = null;
  const original = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    captured = blob;
    return original.call(URL, blob);
  };
  document.getElementById("downloadBackup").click();
  URL.createObjectURL = original;
  return captured ? captured.text() : "";
});
ok("下載得到 Project 專案包", packageJson.length > 100, `${packageJson.length} 字`);
const parsed = JSON.parse(packageJson);
ok(
  "專案包裡帶著方向名稱",
  JSON.stringify(parsed.roadMeta || {}).includes(NAME_1),
);

/* 清空本機資料再匯入 Manager，模擬「別人給的包」——
   否則會誤用本機 state.roadMeta 而看不出 Manager 有沒有真的接上包裡的名稱。 */
await page.evaluate(() => {
  window.__dirTestPackage = null;
});
await page.evaluate((json) => {
  window.__dirTestPackage = json;
}, packageJson);
await page.evaluate(() => document.querySelector('nav [data-view="manager"]').click());
await page.waitForTimeout(500);
await page.setInputFiles("#managerFiles", {
  name: "project.json",
  mimeType: "application/json",
  buffer: Buffer.from(packageJson, "utf8"),
});
await page.waitForTimeout(1200);
/* 把本機的方向名稱清掉，Manager 就只剩下包裡那一份可以用。 */
await page.evaluate((name) => {
  for (const key of Object.keys(window.state?.roadMeta || {})) {
    const meta = window.state.roadMeta[key];
    if (meta && (meta.directionA === name || meta.directionB === name)) {
      delete meta.directionA;
      delete meta.directionB;
    }
  }
}, NAME_1);
await page.evaluate(() => document.querySelector('nav [data-view="manager"]').click());
await page.waitForTimeout(800);
const managerText = await page.innerText("#managerRows");
ok("Manager 比較顯示專案包裡的方向名稱", managerText.includes(NAME_1) || managerText.includes(NAME_2),
  managerText.replace(/\s+/g, " ").slice(0, 120));
ok("Manager 比較沒有殘留裸的方向鍵值", !BARE_KEY.test(managerText),
  (managerText.match(BARE_KEY)?.[0] || "").trim());

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(
  problems.length ? `\n❌ ${problems.length} 項未通過\n` + problems.join("\n") : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
