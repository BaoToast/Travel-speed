/*
 * 拖曳上傳的端對端檢查（交通服務水準）。
 *
 * 使用者問的是「能不能用拖的把檔案丟進來」，所以這一支要驗的不是
 * 「程式裡有沒有寫 ondrop」，而是**真的拖一個檔案進去，資料有沒有進系統**。
 *
 * 三個放置區都驗：
 *   ・尖峰批次匯入（.xls/.xlsx/.xlsm，可多份）
 *   ・備份還原（.json，只收一份）
 *   ・Manager 匯入 Project 專案包（.json，可多份）
 *
 * 另外驗兩件容易被忽略、但錯了使用者一定會遇到的事：
 *   ・拖非指定副檔名的檔案要擋下來並說明，不可以安靜地少匯入
 *   ・檔案掉在放置區**外面**時不可以把使用者帶離頁面
 *     （瀏覽器預設會直接開啟那個檔案）
 *
 * ⚠️ 寫法上刻意不用 Playwright 的 setInputFiles()——那是直接塞給
 * <input>，根本不會經過 drop 事件，等於沒驗到拖曳。這裡是自己組
 * DataTransfer 再送真正的 dragenter/dragover/drop，跟使用者的動作一致。
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
const excelFiles = readdirSync(SAMPLE_DIR).filter((name) =>
  /報告測試路段/.test(name),
);
if (excelFiles.length !== 2) {
  console.log(`❌ 匿名測資應有平日、假日各一份，目前為 ${excelFiles.length} 份`);
  server.close();
  process.exit(1);
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
await page.goto(base, { waitUntil: "networkidle" });

/*
 * 在頁面裡組一個真的 DataTransfer，然後依序送 dragenter → dragover → drop。
 * 每個檔案用 base64 傳進去再還原成 File，避免中文檔名在傳輸中被改寫。
 */
async function dropOn(selector, payload) {
  return page.evaluate(
    ({ selector, payload }) => {
      const zone = document.querySelector(selector);
      if (!zone) return { error: `找不到放置區 ${selector}` };
      const dt = new DataTransfer();
      for (const item of payload) {
        const raw = atob(item.base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        dt.items.add(new File([bytes], item.name, { type: item.type || "" }));
      }
      const fire = (type) => {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        zone.dispatchEvent(event);
        return event;
      };
      fire("dragenter");
      const over = fire("dragover");
      const activeWhileOver = zone.classList.contains("drag-active");
      const drop = fire("drop");
      return {
        activeWhileOver,
        overPrevented: over.defaultPrevented,
        dropPrevented: drop.defaultPrevented,
        activeAfterDrop: zone.classList.contains("drag-active"),
      };
    },
    { selector, payload },
  );
}

const asPayload = (name, dir = SAMPLE_DIR) => ({
  name,
  base64: readFileSync(join(dir, name)).toString("base64"),
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

/* ── 準備一個計畫 ── */
await page.evaluate(() => document.querySelector('[data-view="setup"]').click());
await page.fill("#projectCode", "DROP");
await page.fill("#projectName", "拖曳測試計畫");
await page.click("#saveProject");
await page.waitForTimeout(400);

/* ── 一、尖峰批次匯入：拖兩份 Excel 進去 ── */
await page.evaluate(() => document.querySelector('[data-view="import"]').click());
await page.fill("#rocYear", "115");
await page.selectOption("#quarter", { index: 0 });
await page.waitForTimeout(200);

const importDrop = await dropOn(
  "label.drop",
  excelFiles.map((name) => asPayload(name)),
);
ok(
  "匯入區在拖曳經過時會亮起來",
  importDrop.activeWhileOver === true,
  `dragover 時 drag-active=${importDrop.activeWhileOver}`,
);
ok(
  "匯入區有接住 dragover（沒接住的話瀏覽器根本不會給 drop）",
  importDrop.overPrevented === true,
);
ok("放開之後高亮要收掉", importDrop.activeAfterDrop === false);

const nestedHighlight = await page.evaluate(() => {
  const zone = document.querySelector("label.drop");
  const child = zone.querySelector("b");
  const dt = new DataTransfer();
  dt.items.add(new File(["x"], "巢狀測試.xlsx"));
  const fire = (target, type) =>
    target.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  fire(zone, "dragenter");
  fire(child, "dragenter");
  fire(zone, "dragleave");
  const activeInside = zone.classList.contains("drag-active");
  fire(child, "dragleave");
  return { activeInside, activeAfterExit: zone.classList.contains("drag-active") };
});
ok(
  "游標移到放置區內文字時高亮不會提早消失",
  nestedHighlight.activeInside === true && nestedHighlight.activeAfterExit === false,
  JSON.stringify(nestedHighlight),
);

await page.waitForTimeout(500);
const pickedUp = await page.evaluate(() => ({
  count: document.getElementById("files").files.length,
  info: document.getElementById("fileInfo").textContent.trim(),
}));
ok(
  "拖進來的 2 份檔案真的進到匯入清單",
  pickedUp.count === 2,
  `input.files=${pickedUp.count}｜畫面顯示「${pickedUp.info}」`,
);

await page.click("#preview");
await page.waitForTimeout(1500);
const previewed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#previewRows tr")].filter(
    (tr) => !tr.querySelector(".empty"),
  );
  return {
    rows: rows.length,
    status: document.getElementById("previewStatus").textContent.trim(),
  };
});
ok(
  "拖進來的檔案讀得出內容（不是只把檔名塞進去）",
  previewed.rows === 2,
  `預覽 ${previewed.rows} 列｜${previewed.status}`,
);

/* ── 二、拖錯副檔名要擋下來並講出來 ── */
const beforeWrong = await page.evaluate(
  () => document.getElementById("files").files.length,
);
await dropOn("label.drop", [
  { name: "這不是試算表.txt", base64: btoaSafe("hello"), type: "text/plain" },
]);
await page.waitForTimeout(400);
const afterWrong = await page.evaluate(() => ({
  count: document.getElementById("files").files.length,
  toast: document.getElementById("toast").textContent.trim(),
}));
ok(
  "拖 .txt 進匯入區不會被收下",
  afterWrong.count === beforeWrong,
  `拖之前 ${beforeWrong} 份、拖之後 ${afterWrong.count} 份`,
);
ok(
  "而且要說清楚為什麼沒收",
  /只收/.test(afterWrong.toast),
  `提示：「${afterWrong.toast}」`,
);

/* ── 三、檔案掉在放置區外面，不可以把使用者帶離頁面 ── */
const strayUrlBefore = page.url();
const stray = await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(["x"], "亂丟的檔案.xlsx"));
  const target = document.querySelector(".topbar") || document.body;
  const over = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
  });
  target.dispatchEvent(over);
  const drop = new DragEvent("drop", {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
  });
  target.dispatchEvent(drop);
  return {
    overPrevented: over.defaultPrevented,
    dropPrevented: drop.defaultPrevented,
    effect: over.dataTransfer.dropEffect,
  };
});
await page.waitForTimeout(400);
ok(
  "檔案掉在放置區外面時，瀏覽器的預設開檔行為被擋掉",
  stray.overPrevented === true && stray.dropPrevented === true,
  `dragover 擋下=${stray.overPrevented}、drop 擋下=${stray.dropPrevented}`,
);
/*
 * 這裡本來還有一項「游標會顯示不可放置（dropEffect === "none"）」。
 * 突變測試時發現它**恆真**：沒有任何處理時 dropEffect 本來就是 "none"，
 * 拿掉全域防呆之後那一項仍然是綠的，等於擋不住東西。已經移除，
 * 不留一條永遠不會紅的檢查在這裡充數。實際擋住開檔的是上面兩個
 * defaultPrevented，那兩個在拿掉防呆時會確實紅字。
 */
ok("沒有因此離開系統頁面", page.url() === strayUrlBefore);

/* ── 四、備份還原：拖一個 JSON 進去 ── */
await page.evaluate(() => document.querySelector('[data-view="backup"]').click());
await page.waitForTimeout(300);
const backupJson = await page.evaluate(() => {
  const btn = document.getElementById("downloadBackup");
  return btn ? "ready" : "missing";
});
ok("備份頁打得開", backupJson === "ready");

const restoreZone = await page.evaluate(() =>
  document.getElementById("restoreFile").closest("label")
    ? "label.outline.upload"
    : "",
);
ok("備份還原的放置區找得到", restoreZone !== "");

/* 先做一份真的備份內容，拖進去看看還原走不走得通 */
const backupPayload = await page.evaluate(() => {
  const pack = {
    kind: "TLM_PROJECT_PACKAGE",
    project: { code: "DROPBK", name: "拖曳還原測試計畫" },
    details: [],
    imports: [],
    limits: {},
    aliases: {},
    roadMeta: {},
    losRules: {},
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(pack))));
});
const restoreDrop = await dropOn("label.outline.upload", [
  { name: "拖曳還原測試.json", base64: backupPayload, type: "application/json" },
]);
ok(
  "備份還原區在拖曳經過時會亮起來",
  restoreDrop.activeWhileOver === true,
  `dragover 時 drag-active=${restoreDrop.activeWhileOver}`,
);
await page.waitForTimeout(900);
const restored = await page.evaluate(() =>
  [...document.querySelectorAll("#projectPicker option")].map((o) => o.textContent),
);
ok(
  "拖進來的備份真的還原成一個計畫",
  restored.some((t) => /拖曳還原測試計畫/.test(t)),
  `目前計畫清單：${restored.join("、") || "（空）"}`,
);

/* ── 五、Manager 匯入 ── */
await page.evaluate(() => document.querySelector('[data-view="manager"]')?.click());
await page.waitForTimeout(400);
const managerZoneExists = await page.evaluate(
  () => !!document.getElementById("managerFiles"),
);
if (managerZoneExists) {
  const managerPack = await page.evaluate(() => {
    const pack = {
      kind: "TLM_PROJECT_PACKAGE",
      project: { code: "MGRDROP", name: "拖曳 Manager 測試計畫" },
      details: [],
      summaries: [],
      roadMeta: {},
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(pack))));
  });
  const managerDrop = await dropOn("label.primary.upload", [
    { name: "拖曳Manager測試.json", base64: managerPack, type: "application/json" },
  ]);
  ok(
    "Manager 匯入區在拖曳經過時會亮起來",
    managerDrop.activeWhileOver === true,
    `dragover 時 drag-active=${managerDrop.activeWhileOver}`,
  );
  await page.waitForTimeout(900);
  const managerRows = await page.evaluate(
    () => document.getElementById("managerProjects")?.textContent.trim() || "0",
  );
  ok(
    "拖進來的 Project 專案包真的被 Manager 收下",
    Number(managerRows) >= 1,
    `已載入計畫 ${managerRows} 個`,
  );
} else {
  ok("Manager 匯入區找得到", false, "頁面上沒有 #managerFiles");
}

/* ── 六、全域防呆只能攔檔案，不可以連一般文字拖曳都擋掉 ── */
/*
 * 先前版本的防呆少了「是不是拖檔案」這一層判斷，於是把使用者
 * 在頁面內拖動選取文字也一起擋掉了：拖一段字到搜尋框、計畫名稱欄
 * 或結論草稿的文字框全都放不下去。這一項就是釘住那個分界。
 */
const textDrag = await page.evaluate(() => {
  const probe = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { missing: true };
    const dt = new DataTransfer();
    dt.setData("text/plain", "一段被拖曳的文字");
    const over = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    el.dispatchEvent(over);
    return { blocked: over.defaultPrevented };
  };
  return {
    input: probe("#projectCode"),
    search: probe('input[placeholder*="搜尋"]'),
    table: probe(".table-wrap"),
  };
});
for (const [label, key] of [["計畫編號輸入框", "input"], ["搜尋框", "search"], ["表格區域", "table"]])
  ok(
    `拖一般文字到${label}不會被擋掉`,
    !textDrag[key].missing && textDrag[key].blocked === false,
    textDrag[key].missing ? "（頁面上沒有這個元素）" : `被擋=${textDrag[key].blocked}`,
  );

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);

function btoaSafe(text) {
  return Buffer.from(text, "utf8").toString("base64");
}
