/*
 * 端對端：預覽表顯示的速限與 LOS，必須就是實際寫進去的那一組。
 *
 * 起因：使用者只有預覽這一個核對機會（手冊也寫「寫入前請務必核對」）。
 * parseFile 是用**檔案裡那個路段名**查速限算 LOS 的；選「合併至既有路段」
 * 之後，真正生效的是目標路段的速限，但那要等 commit 時 remapPending 才換，
 * 寫入後 rebuild 還會再依速限版本重算一次。
 *
 * 實測（修正前）：目標路段速限 80、來源退回預設 50
 *   預覽 → 0.4220 → LOS D
 *   寫入 → 0.2638 → LOS E
 * 四筆全部差一級。寫進去的數字是對的，說謊的是預覽。
 *
 * ⚠️ 這一支最容易寫成假通過的地方：如果兩個速限剛好算出同一級 LOS，
 *    那不管程式有沒有修好都會通過。所以先驗「這組速限確實會算出不同等級」，
 *    不成立就直接讓測試紅字，而不是靜靜通過。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(here, p);
  if (!existsSync(f)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
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
const one = readdirSync(SAMPLE_DIR).filter((n) => /\.xlsx?$/i.test(n))[0];
const buf = readFileSync(join(SAMPLE_DIR, one));

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "PVLOS");
await page.fill("#projectName", "預覽與寫入一致性");
await page.click("#saveProject");
await page.waitForTimeout(500);

const readState = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("TrafficLOSWebV2", 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          const getAll = db.transaction("app", "readonly").objectStore("app").getAll();
          getAll.onsuccess = () =>
            resolve(
              (getAll.result || []).find((x) => x && Array.isArray(x.details)) || {
                details: [],
                limits: {},
              },
            );
          getAll.onerror = () => resolve(null);
        };
      }),
  );

const importOnce = async (quarterIndex, fileName) => {
  await page.evaluate(() => document.querySelector('[data-view="import"]').click());
  await page.fill("#rocYear", "115");
  await page.selectOption("#quarter", { index: quarterIndex });
  await page.setInputFiles("#files", [
    {
      name: fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buf,
    },
  ]);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("preview").click());
  await page.waitForTimeout(3500);
};

/* ── 第一季：建立既有路段 ── */
await importOnce(0, one);
await page.evaluate(() => {
  const c = document.getElementById("commit");
  if (c && !c.disabled) c.click();
});
await page.waitForTimeout(1600);
let st = await readState();
const road = st.details[0]?.road;
const travel = st.details[0]?.travel;
ok("前置：第一季確實寫進去了", Boolean(road) && st.details.length > 0, `路段「${road}」，${st.details.length} 筆`);

/*
 * 把目標路段的速限改成 80。這一步要驗「兩個速限真的會算出不同等級」，
 * 否則後面的比對會恆真。
 */
const distinct = await page.evaluate((t) => {
  if (t == null) return null;
  return { at50: losOf(t / 50), at80: losOf(t / 80) };
}, travel);
ok(
  "前置：50 與 80 兩種速限確實會算出不同的 LOS（否則下面是假檢查）",
  distinct && distinct.at50 !== distinct.at80,
  distinct ? `速限50→${distinct.at50}、速限80→${distinct.at80}` : "讀不到旅行速率",
);

await page.evaluate(
  ([r]) =>
    new Promise((resolve) => {
      const request = indexedDB.open("TrafficLOSWebV2", 1);
      request.onsuccess = () => {
        const db = request.result;
        const store = db.transaction("app", "readwrite").objectStore("app");
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => {
            const blobs = getAll.result || [];
            const keys = keysReq.result || [];
            const index = blobs.findIndex((x) => x && Array.isArray(x.details));
            if (index < 0) return resolve(false);
            const blob = blobs[index];
            for (const dir of ["方向1", "方向2"])
              blob.limits[`${blob.activeCode}|${r}|${dir}`] = 80;
            store.put(blob, keys[index]);
            resolve(true);
          };
        };
      };
    }),
  [road],
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/* ── 第二季：同一份檔案，改成別的路段名，預覽時選「合併至」既有路段 ── */
await importOnce(1, one.replace(/-平日(\.[^.]+)$/, "改名-平日$1"));
const picked = await page.evaluate((target) => {
  const select = document.querySelector("select.road-choice");
  if (!select) return { ok: false, reason: "預覽裡沒有出現路段選擇下拉" };
  const option = [...select.options].find((o) => o.value === target);
  if (!option) return { ok: false, reason: "下拉裡找不到目標路段", opts: [...select.options].map((o) => o.value) };
  select.value = target;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}, road);
ok(
  "前置：預覽裡選得到「合併至既有路段」",
  picked.ok,
  picked.ok ? `已選「${road}」` : `${picked.reason}${picked.opts ? "：" + picked.opts.join("、") : ""}`,
);
await page.waitForTimeout(800);

const previewRows = await page.evaluate(() => {
  const table = [...document.querySelectorAll("table")].find((t) =>
    /旅行速率/.test(t.innerText) && /LOS/.test(t.innerText),
  );
  if (!table) return [];
  return [...table.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.cells].map((c) => c.textContent.trim()),
  );
});
const previewLos = previewRows.map((r) => r[r.length - 2]).filter(Boolean);

await page.evaluate(() => {
  const c = document.getElementById("commit");
  if (c && !c.disabled) c.click();
});
await page.waitForTimeout(1800);
st = await readState();
const written = (st.details || []).filter((d) => d.quarter === 2);
const writtenLos = [...new Set(written.map((d) => d.los))];
const writtenLimits = [...new Set(written.map((d) => d.limit))];
const leakedParsedLimits = written.filter((d) => Object.hasOwn(d, "parsedLimit"));

ok(
  "前置：第二季確實寫進去了，而且併到同一個路段",
  written.length > 0 && written.every((d) => d.road === road),
  `${written.length} 筆，路段 ${[...new Set(written.map((d) => d.road))].join("、")}`,
);
ok(
  "寫入後的速限是目標路段的 80（不是來源的預設值）",
  writtenLimits.length === 1 && writtenLimits[0] === 80,
  `寫入速限 ${writtenLimits.join("、")}`,
);
ok(
  "預覽面板顯示的 LOS 與實際寫入的 LOS 一致",
  previewLos.length > 0 && previewLos.every((l) => writtenLos.includes(l)),
  `預覽「${previewLos.join("、") || "（讀不到）"}」／寫入「${writtenLos.join("、")}」`,
);
ok(
  "預覽專用的 parsedLimit 不會寫進正式明細",
  leakedParsedLimits.length === 0,
  `正式明細中有 ${leakedParsedLimits.length} 筆帶著 parsedLimit`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
