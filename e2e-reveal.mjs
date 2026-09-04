/**
 * 端對端：按下按鈕之後，結果必須出現在使用者看得到的地方。
 *
 * 使用者的原話：
 *   「路段管理的功能頁面中，修改正式名稱／合併重複路段，按下預覽修改影響／
 *     顯示合併影響後，因為畫面停在原地，所以使用者不知道預覽畫面已經顯示在
 *     下方了，會誤以為程式沒任何反應。」
 *
 * 實測（視窗高 900px）修正前的位置：
 *   ・預覽修改影響 → #roadImpact 頂端在 1243px，比視窗下緣低 343px
 *   ・顯示合併影響 → #roadImpact 頂端在 1233px
 *   ・產生結論草稿 → #conclusionDraft 頂端在 1331px（同一類問題，使用者還沒遇到）
 *
 * 修正方式是 revealResult()：**只在結果看不到時才捲動**。
 * 所以這一支驗的是「按完之後看得到」，不是「一定要捲動」——
 * 結果本來就在畫面上時不捲動才是對的（使用者也特別交代過這一點）。
 *
 * 視窗高度用 900px；比這更矮的螢幕只會更嚴格，不會更寬鬆。
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
  const path = join(here, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html");
  if (!existsSync(path) || !path.startsWith(here)) return void res.writeHead(404).end("nf");
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/* ── 建計畫並塞多筆匿名明細，讓每個分頁都有東西可看 ─────────── */
await page.evaluate(() => go("setup"));
await page.fill("#projectCode", "99001");
await page.fill("#projectName", "捲動探測計畫");
await page.click("#saveProject");
await page.waitForTimeout(700);
await page.evaluate(async () => {
  let n = 0;
  for (const road of ["甲路段(A～B)", "乙路段(C～D)", "丙路段(E～F)"])
    for (const period of ["114Q4", "115Q1"])
      for (const dir of ["方向1", "方向2"])
        for (const peak of ["上午", "下午"]) {
          state.details.push({
            projectCode: state.activeCode,
            period,
            road,
            direction: dir,
            peak,
            day: "平日",
            travelSpeed: 28 + (n % 7),
            runSpeed: 33 + (n % 5),
            delay: 9 + (n % 4),
            limit: 50,
            id: "probe-" + n++,
          });
        }
  await save();
  renderAll();
});

const results = [];
async function probe(view, label, button, result, prep) {
  await page.evaluate((v) => go(v), view);
  await page.waitForTimeout(400);
  if (prep) await prep();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.scrollY);
  const exists = await page.evaluate((s) => !!document.querySelector(s), button);
  if (!exists) return void results.push({ view, label, skip: "按鈕不存在" });
  await page.click(button).catch(() => {});
  await page.waitForTimeout(600);
  const m = await page.evaluate(
    ([sel]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        visible: Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))),
        vh,
        scrollY: window.scrollY,
      };
    },
    [result],
  );
  if (!m) return void results.push({ view, label, skip: "結果容器不存在" });
  if (m.height < 24)
    return void results.push({ view, label, skip: `結果容器量不到高度（${m.height}px）——選擇器可能沒對上` });
  results.push({ view, label, button, result, ...m, scrolled: m.scrollY !== before });
}

/* 路段管理：使用者回報的那兩個 */
await probe("roadadmin", "預覽修改影響", "#previewRename", "#roadImpact", async () => {
  await page.selectOption("#renameRoad", { index: 0 });
  await page.fill("#formalRoadName", "甲路段改名後(A～B)");
});
await probe("roadadmin", "顯示合併影響", "#previewMerge", "#roadImpact", async () => {
  await page.selectOption("#mergeSource", { index: 0 });
  await page.selectOption("#mergeTarget", { index: 1 });
});
/* 其他「結果顯示在別處」的按鈕 */
await probe("maintenance", "執行健康檢查", "#runHealth", ".health-panel");
await probe("summary", "重建彙總", "#rebuild", "#summaryRows");
await probe("summary", "套用 LOS 門檻", "#applyLosRules", "#losRuleExplanation");
await probe("conclusion", "產生草稿", "#conclusionRegenerate", "#conclusionDraft");
await probe("speed", "套用並重算 LOS", "#applySpeed", "#speedRows");
await probe("manager", "重設篩選", "#resetManagerFilters", "#managerRows");

/*
 * ── 另一半同樣重要：結果已經看得到時，畫面**不准**跳 ──
 *
 * 使用者特別交代過：「除非是按下確認鍵修正後，修正的畫面就是在原地，
 * 那才不用跳開。」他後來又補了一次，講的是結論草稿的實際用法——
 * 「使用者必須先決定產生哪些結論出來，會一路往下滑，勾選要產生的監測結果，
 *   最後在最底下才會點選『重新產生』，直接原地看到結果，不需要跳轉。」
 *
 * revealResult() 因此是有條件的：只有結果不在視窗內才捲。這一段就是驗那個條件。
 *
 * ⚠️ 這裡有一個量測上的陷阱，v2.20.33 的版本踩到了：**直接捲到整頁最底下按，
 * 畫面本來就動不了**（已經到捲動極限），於是不管程式怎麼寫都會通過。
 * 實測把 revealResult() 改成無條件 `block: "start"`，這一項仍然是綠的——
 * 也就是說它當時擋不住任何東西。
 *
 * 改法：先在頁尾補一塊空白，讓「草稿框整個看得見」與「畫面還捲得動」同時成立，
 * 再把草稿框放到視窗中間；這時候只要程式擅自捲動就一定量得到。
 * 另外不用 Playwright 的 click()（它按之前會自己把元素捲進視窗），
 * 改成在頁面裡直接對按鈕發 click()，量到的才是程式自己的行為。
 * 前置條件本身也要驗，否則版面一改這一項又會悄悄變成恆真。
 */
await page.evaluate(() => go("conclusion"));
await page.waitForTimeout(400);
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.id = "reveal-probe-spacer";
  spacer.style.height = "1500px";
  document.body.appendChild(spacer);
  document.getElementById("conclusionDraft").scrollIntoView({ block: "center", behavior: "auto" });
});
await page.waitForTimeout(400);
const stayPre = await page.evaluate(() => {
  const r = document.getElementById("conclusionDraft").getBoundingClientRect();
  const vh = window.innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  return {
    y: Math.round(window.scrollY),
    fullyVisible: r.top >= 0 && r.bottom <= vh,
    canScroll: Math.round(window.scrollY) < Math.round(max) - 50,
  };
});
const stayY0 = stayPre.y;
await page.evaluate(() => document.getElementById("conclusionRegenerate")?.click());
await page.waitForTimeout(800);
const stayY1 = await page.evaluate(() => Math.round(window.scrollY));
await page.evaluate(() => document.getElementById("reveal-probe-spacer")?.remove());
results.push({
  view: "conclusion",
  label: "前置：看得見且捲得動",
  result: "#conclusionDraft",
  top: 0,
  height: 999,
  visible: 999,
  vh: 900,
  scrolled: !(stayPre.fullyVisible && stayPre.canScroll),
  mustNotScroll: true,
  detail: `整個看得見=${stayPre.fullyVisible}、還捲得動=${stayPre.canScroll}（scrollY=${stayPre.y}）`,
});
results.push({
  view: "conclusion",
  label: "已看得到就不跳",
  result: "#conclusionDraft",
  top: 0,
  height: 999,
  visible: 999,
  vh: 900,
  scrolled: stayY0 !== stayY1,
  mustNotScroll: true,
  detail: `捲動前 ${stayY0} → 捲動後 ${stayY1}`,
});

const problems = [];
for (const r of results) {
  if (r.mustNotScroll) {
    console.log(
      `${r.scrolled ? "❌" : "✅"} ${r.view.padEnd(11)} ${r.label.padEnd(14)} ${r.detail}`,
    );
    if (r.scrolled)
      problems.push(`${r.view}／${r.label}：結果本來就看得到，畫面卻跳了（${r.detail}）`);
    continue;
  }
  if (r.skip) {
    console.log(`❌ ${r.view}／${r.label} — ${r.skip}`);
    problems.push(`${r.view}／${r.label}：${r.skip}`);
    continue;
  }

  /*
   * 判準：光是「上緣在視窗內」不算看得到——上緣落在視窗下緣往上 60px 的地方，
   * 使用者只看得到一條邊，跟沒看到一樣。所以要求**實際可見高度**至少
   * 160px 或整個區塊的四分之一（取小者），這才是「按下去有看到結果」。
   */
    const need = Math.min(160, Math.round(r.height / 4));
  const seen = r.visible >= need;
  console.log(
    `${seen ? "✅" : "❌"} ${r.view.padEnd(11)} ${r.label.padEnd(14)} ${r.result.padEnd(18)} 可見 ${String(r.visible).padStart(4)}px／需 ${String(need).padStart(3)}px  top=${String(r.top).padStart(5)}px  自動捲動=${r.scrolled ? "有" : "沒有"}`,
  );
  if (!seen)
    problems.push(`${r.view}／${r.label}：只看得到 ${r.visible}px（需要 ${need}px，top=${r.top}px）`);
}
if (errors.length) problems.push("JS 例外：" + errors.slice(0, 2).join(" | "));
console.log(errors.length ? `❌ JS 例外：${errors.slice(0, 3).join(" | ")}` : "✅ 沒有 JS 例外");
await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過\n  ` + problems.join("\n  ") : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
