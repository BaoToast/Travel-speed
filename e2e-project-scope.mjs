/**
 * 端對端：計畫設定的編輯下拉與頁首作用中計畫必須清楚區分。
 * 測資由 generate-test-fixtures.mjs 產生，不含正式調查資料。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const types = {
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
  res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const fixtureDir = join(here, "test-fixtures");
const sample = "99999TS1-01-測試路段(甲路～乙路)-平日.xlsx";
if (!existsSync(join(fixtureDir, sample))) {
  console.error("❌ 找不到匿名測試版型，請先執行 npm run fixtures");
  server.close();
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base, { waitUntil: "networkidle" });

  const go = async (view) => {
    await page.evaluate((target) => {
      document.querySelector(`[data-view="${target}"]`).click();
    }, view);
    await page.waitForTimeout(400);
  };

  for (const [code, name] of [
    ["13545", "示範捷運線"],
    ["11017", "示範標案"],
  ]) {
    await go("setup");
    await page.fill("#projectCode", code);
    await page.fill("#projectName", name);
    await page.click("#saveProject");
    await page.waitForTimeout(700);
  }

  await page.evaluate(() => {
    const sw = document.getElementById("projectSwitch");
    sw.value = "13545";
    sw.onchange();
  });
  await page.waitForTimeout(800);
  await go("setup");

  ok(
    "標籤不再叫「目前計畫」",
    !(await page.locator('#setup .form label', { hasText: "目前計畫" }).count()),
  );
  ok(
    "標籤改成「要編輯的計畫」",
    (await page.locator('#setup .form label', { hasText: "要編輯的計畫" }).count()) > 0,
  );

  const hint = page.locator("#projectScopeHint");
  ok("兩邊一致時不顯示提示", !(await hint.isVisible()));

  await page.evaluate(() => {
    const picker = document.getElementById("projectPicker");
    picker.value = "11017";
    picker.onchange();
  });
  await page.waitForTimeout(400);

  const shown = await page.evaluate(() => ({
    header: document.getElementById("projectSwitch").value,
    picker: document.getElementById("projectPicker").value,
    formCode: document.getElementById("projectCode").value,
    active: state.activeCode,
  }));
  ok(
    "頁首 A、表單 B 時作用中仍是 A",
    shown.header === "13545" &&
      shown.picker === "11017" &&
      shown.formCode === "11017" &&
      shown.active === "13545",
    JSON.stringify(shown),
  );

  ok("不一致時提示會出現", await hint.isVisible());
  const hintText = ((await hint.textContent()) || "").replace(/\s+/g, "");
  ok(
    "提示指名作用中計畫",
    /目前作用中的是「13545示範捷運線」/.test(hintText),
    hintText.slice(0, 90),
  );
  ok(
    "提示指名表單編輯計畫",
    /這張表單編輯的是「11017」/.test(hintText),
    hintText.slice(0, 90),
  );
  ok("提示說明真正切換方式", /儲存計畫設定/.test(hintText) && /頁首/.test(hintText));

  await go("import");
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: 0 });
  await page.setInputFiles("#files", {
    name: sample,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(fixtureDir, sample)),
  });
  await page.click("#preview");
  await page.waitForTimeout(2500);
  if (await page.locator("#pickAll").isVisible().catch(() => false)) {
    await page.check("#pickAll");
    await page.waitForTimeout(300);
    await page.click("#pickAsNew");
    await page.waitForTimeout(500);
  }
  await page.click("#commit");
  await page.waitForTimeout(2000);

  const written = await page.evaluate(() => {
    const byProject = {};
    for (const detail of state.details)
      byProject[detail.projectCode] = (byProject[detail.projectCode] || 0) + 1;
    return { byProject, active: state.activeCode };
  });
  ok(
    "恰好 4 筆資料寫進作用中的 A，B 維持 0 筆",
    written.byProject["13545"] === 4 && !(written.byProject["11017"] || 0),
    JSON.stringify(written),
  );

  await go("setup");
  await page.evaluate(() => {
    const picker = document.getElementById("projectPicker");
    picker.value = "11017";
    picker.onchange();
  });
  await page.waitForTimeout(300);
  await page.click("#saveProject");
  await page.waitForTimeout(900);
  ok(
    "按下儲存之後作用中才切換成 B",
    (await page.evaluate(() => state.activeCode)) === "11017",
  );
  await go("setup");
  ok("切換完成後提示消失", !(await page.locator("#projectScopeHint").isVisible()));
  ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
