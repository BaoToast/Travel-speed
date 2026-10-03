/*
 * ══════════════════════════════════════════════════════════════════
 *  淺底上的文字一律要過 AA（4.5:1）——交通服務水準
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ **這一支以前不存在**（2026-09-15 補）。
 *   路口轉向與全日交通量都有同一套掃描，只有這一支沒有——
 *   而使用者的規則是「我們踩過的雷，請確保三份程式都不會再踩到」。
 *   那個雷是 2026-09-10 在路口轉向抓到的 43 處淺灰文字（最糟 2.24:1）。
 *
 * 規則與另外兩支完全相同：整份樣式表掃過每一個 `color:`（含
 * `color: var(--x)`），淺底一律要 ≥ 4.5:1；深底的選擇器要列進豁免清單
 * 並註明底色是什麼，不可以只寫選擇器了事；`:disabled` 一律豁免
 *（WCAG 1.4.3 明文排除，改亮反而讓人以為按得下去）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");

/*
 * ── ⚠️ 2026-09-15 補：`color: var(--x)` 以前完全掃不到 ──────────────
 *
 *   這一支原本只認 `color: #xxxxxx` 這種字面色。實測：路口轉向的
 *   `--muted: #6b7b80` 在白底上只有 **4.40:1**，而全站有幾十處
 *   `color: var(--muted)`——整個變數這條路從來沒有被量過。
 *   （`.trace-merged-into` 之所以被抓到，只是因為它剛好寫死了顏色。）
 *
 *   所以先把 `:root` 裡的自訂屬性讀出來，量的時候一併解析。
 * ⚠️ 只解析一層，而且只解析解得開的：解不開的（例如 var 套 var、
 *   或定義在別的選擇器裡）一律跳過，不要猜——猜錯會產生假紅。
 */
const CUSTOM_PROPERTIES = (() => {
  const out = new Map();
  /*
   * ⚠️ 一定要先把註解拿掉再切區塊。
   *   `:root { ... }` 裡面的說明文字含有 `scrollIntoView({block:"start"})`
   *   這種**帶大括號的程式碼片段**，`[^{}]*` 會在那裡斷掉，
   *   於是整個 :root 一個變數都讀不到——而測試會安靜地變成「沒有變數要檢查」。
   *   （第一版就是這樣：路口轉向讀到 0 個變數，全綠。）
   */
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.matchAll(/:root[^{]*\{([^{}]*)\}/g))
    for (const hit of block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g))
      out.set(hit[1], hit[2].toLowerCase());
  return out;
})();
/** 把一個 color 的值解析成 #rrggbb；解不開就回 null（跳過，不猜）。 */
function resolveColor(raw) {
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const varHit = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varHit) return CUSTOM_PROPERTIES.get(varHit[1]) || null;
  return null;
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
}

/*
 * 豁免：這些選擇器的底色**不是**淺色，所以不能拿白底去量。
 * 每一項都註明底色，日後有人要加進來也得先講清楚底是什麼。
 */
const DARK_GROUND = [
  ["aside", "側欄 --navy #17354d"],
  [".brand", "側欄品牌區，同上"],
  ["nav button", "側欄大分頁按鈕，同上"],
  [".nav-section", "側欄小分頁，同上"],
  [".nav-zone", "側欄分區小標，同上"],
  [".local", "側欄頁尾，同上"],
  [".hero", "深色漸層首屏"],
  [".rule-card", "首屏深底卡"],
  ["#toast", "深色浮出提示"],
  [".toast", "深色浮出提示"],
  [".danger-button", "深紅底按鈕"],
  [".primary", "--blue #1977b5 實心按鈕，白字"],
  [".success", "--green #168466 實心按鈕，白字"],
  [".los-", "服務水準等級徽章，各自有實心底色"],
  [".blank-badge", "淺綠底徽章，另有自己的色"],
  [".safe", "淺綠底徽章，同上"],
  [".nav-collapse", "側欄的小分頁收合鈕，底就是側欄 --navy #17354d"],
  ["::selection", "選取反白，底色由瀏覽器決定"],
];

/*
 * 有色底上的文字，逐組釘住實際的前景／背景。
 *
 * ⚠️ 上面那一支是拿**白底**掃整份樣式表，對「深底上的白字」量不準，
 *   所以那種只能豁免。但豁免不等於不用管——那正是最容易出事的地方：
 *   我 2026-09-11 做新車種徽章時用了 #d99a19 配白字，實測只有 2.45:1，
 *   字幾乎融進底色，而上面那一支因為豁免完全不會紅。
 *   所以凡是進豁免清單的有色底，都要在這裡補一組明確的前景／背景。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️⚠️ 2026-09-29：這份清單原本整份是**從路口轉向抄來的**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊版列的是「新車種徽章」「新車種列的主要文字」「季別衝突提示」
 * 以及底色 `#3a2350`（路口轉向側欄的深紫）的四組側欄項目。
 *
 * **這一支根本沒有那些東西**：沒有「新車種」那一套畫面，側欄底色是
 * `--navy: #17354d` 不是深紫。也就是說那 9 組斷言量的**不是這一支的任何一個
 * 真實顏色組合**——它們永遠是綠的，而這一整類問題在這一支從來沒有人守過。
 *
 * 這就是「守門釘在別人的資料上」的另一種形式，比沒有守門更糟：
 * 它讓人以為有人在看。
 *
 * 現在整份換成**這一支自己**的組合，而且下面多一條前置檢查：
 * 每一個底色都必須真的出現在 styles.css 裡。再抄一次就會紅。
 */
const ON_COLOR = [
  /* 側欄：底是 --navy #17354d */
  ["側欄分頁文字", "#d8e5ec", "#17354d"],
  ["側欄分頁文字（目前這一個）", "#ffffff", "#17354d"],
  ["側欄分類標題", "#eaf4fa", "#17354d"],
  ["側欄本機狀態", "#cbdce5", "#17354d"],
  /*
   * ⚠️ 側欄副標寫的是 `opacity` 而不是一個色碼。
   *   opacity 會把字和底色混合，所以這裡填的是**混合後**的實際顏色。
   *   直接拿 #ffffff 去量會量出 12.71:1 —— 那是一個好看但不存在的數字。
   *
   * ⚠️ 2026-09-30（#19）：原本是 `opacity:.65`，混合後 #aeb8c1 = 6.31:1，
   *   過 AA 但**不過 AAA(7:1)**，而側欄依 #19 要求 AAA。
   *   改成 `.72` → #bec6cd = 7.35:1。
   *   （為什麼不是剛好壓在 7.04 的 .70：留一點餘裕，免得下一次微調字色就掉下去。）
   */
  ["側欄副標（opacity .72 混合後）", "#bec6cd", "#17354d"],
  /* 首頁大圖：漸層 #15344c → #1a5c7b，兩端都要過 */
  ["首頁大圖說明（漸層淺端）", "#d7e6ee", "#1a5c7b"],
  /*
   * ⚠️ 原值 #8dd2f5 在漸層的**淺端** #1a5c7b 上只有 4.43:1（深端 7.79:1）。
   *   量深端會過、量淺端不過——漸層一定要量**比較亮的那一端**，
   *   那是最不利的情況。改成 #9edaf7（淺端 4.83:1、深端 8.50:1）。
   */
  ["首頁大圖眉標（漸層淺端）", "#9edaf7", "#1a5c7b"],
  ["首頁規則卡小字（漸層淺端）", "#bcd4e1", "#1a5c7b"],
  /*
   * LOS F 級徽章：白字。
   * ⚠️ 底色要用**後面那一條覆寫**的 #b83f3d，不是第一條的 #ce4d4b——
   *   白字配 #ce4d4b 只有 4.39:1，配 #b83f3d 是 5.50:1。
   *   拿第一條去量會得到一個假的紅（los-color-lock.test.mjs 解析的也是最後一條）。
   */
  ["LOS F 級徽章", "#ffffff", "#b83f3d"],
  /* 提示訊息與警告區 */
  ["提示訊息", "#ffffff", "#18384f"],
  ["警告區文字", "#755c46", "#fff6e8"],
];

test("前置：ON_COLOR 裡的每一個底色都要真的出現在這一支的 styles.css", () => {
  /*
   * ⚠️ 這一條就是為了擋「整份從別支抄過來」。
   *   舊版列的底色 #3a2350 是路口轉向側欄的深紫，這一支一個字都沒有，
   *   於是那 9 組斷言永遠是綠的——**比沒有守門更糟，因為它讓人以為有人在看**。
   *
   * ⚠️ 混合後的顏色（opacity）不會出現在樣式表裡，所以那幾組用註記標出來豁免，
   *   但豁免的那幾個必須在這裡列名，不可以整類跳過。
   */
  const blended = new Set(["#bec6cd"]);
  const missing = [];
  for (const [name, , bg] of ON_COLOR) {
    if (blended.has(bg.toLowerCase())) continue;
    if (!css.toLowerCase().includes(bg.toLowerCase())) missing.push(`${name}（${bg}）`);
  }
  assert.deepEqual(
    missing,
    [],
    "這幾組的底色在 styles.css 裡找不到——是不是從別支程式抄過來的？\n- " +
      missing.join("\n- "),
  );
});

test("有色底上的文字也要 ≥ 4.5:1（豁免不等於可以不管）", () => {
  const failures = [];
  for (const [name, fg, bg] of ON_COLOR) {
    const ratio = contrast(fg, bg);
    if (ratio < 4.5)
      failures.push(`${name}：${fg} 配 ${bg} 只有 ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(
    failures,
    [],
    `以下有色底上的文字未達 AA 的 4.5:1：\n- ${failures.join("\n- ")}`,
  );
});

test("前置：上面那一條真的算得出低對比（不然它是恆真的）", () => {
  /* 我實測踩過的那一組，必須被判成不合格。 */
  assert.ok(
    contrast("#ffffff", "#d99a19") < 4.5,
    "白字配 #d99a19 應該要算出低於 4.5:1，這條規則等於沒做",
  );
  assert.ok(contrast("#ffffff", "#8a5a08") >= 4.5, "改好的色卻算不過");
});
/* 停用中的控制項：WCAG 1.4.3 明文排除，而且改亮會讓人以為還能按。 */
const DISABLED = ":disabled";

/** 這一條規則要不要納入檢查。 */
function checked(selector) {
  if (selector.includes(DISABLED)) return false;
  return !DARK_GROUND.some(([needle]) => selector.includes(needle));
}

test("淺底上的每一個文字色都要 ≥ 4.5:1（整份樣式表掃過，不是抽樣）", () => {
  const failures = [];
  /*
   * ⚠️ 用「規則區塊」而不是整份字串上的正規表示式：
   *   要知道每一個顏色屬於哪一條選擇器，才判斷得出它的底是深是淺，
   *   也才能在紅字裡告訴人該去改哪一行。
   */
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  let inspected = 0;
  for (const rule of rules) {
    const selector = rule[1].trim().split("\n").pop().trim();
    if (!checked(selector)) continue;
    for (const hit of rule[2].matchAll(/(?<!-)color:\s*(#[0-9a-fA-F]{6}|var\(\s*--[\w-]+\s*\))/g)) {
      const value = resolveColor(hit[1]);
      if (!value) continue;
      inspected += 1;
      const ratio = contrast(value, "#ffffff");
      if (ratio < 4.5)
        failures.push(`${selector} 的 ${value} 只有 ${ratio.toFixed(2)}:1`);
    }
  }
  /*
   * ⚠️ 這一行是防「測試自己壞掉」的：正規表示式寫錯時，
   *   一個顏色都掃不到，failures 是空的，測試會**變成綠的**。
   *   釘一個下限，掃不到東西時要紅。
   */
  assert.ok(
    inspected >= 60,
    `只掃到 ${inspected} 個文字色，太少——選擇器解析是不是壞了？`,
  );
  assert.deepEqual(
    failures,
    [],
    `以下文字色在白底上未達 AA 的 4.5:1：\n- ${failures.join("\n- ")}`,
  );
});

test("豁免清單本身要合理：不可以把整份樣式表都豁免掉", () => {
  /*
   * 豁免是必要的（深底文字拿白底量會是假紅），但豁免清單如果無限膨脹，
   * 這一支就變成裝飾品。釘住「被檢查的規則要遠多於被豁免的」。
   */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) =>
    rule[1].trim().split("\n").pop().trim(),
  );
  const exempt = rules.filter((selector) => !checked(selector)).length;
  const total = rules.length;
  assert.ok(
    exempt < total * 0.25,
    `豁免了 ${exempt}／${total} 條規則，超過四分之一——豁免清單失控了`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  T15 附帶：同一條規則自己帶了底色的，就要拿**那個底**去量
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那一支一律拿白底量，於是這一種完全掃不到：
 *
 *     tr.issue-acked{background:#f7f9fa;color:#6b7780}
 *
 * `#6b7780` 在**白底**上是 4.59:1（過），但這條規則同時把底改成 `#f7f9fa`，
 * 在**它自己的底**上只有 **4.35:1**（不過 AA）。
 * 2026-09-29 做隔列底色時查到的，已經改成 `--row-bg:#eceff1` 配 `#57646f`（5.26:1）。
 *
 * ⚠️ 只量「解得開的」：底色寫 gradient、rgba、var 套 var 的一律跳過。
 *   猜一個底去量會製造假紅，而假紅比沒有檢查更貴。
 *
 * ⚠️ `--row-bg` 也算底色：隔列底色是用它帶的（見 styles.css 結尾的說明），
 *   不認它的話，凡是走自訂屬性上色的列規則就又整批掃不到了。
 */
test("自己帶底色的規則，文字要在**那個底**上 ≥ 4.5:1", () => {
  const failures = [];
  let inspected = 0;
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().split("\n").pop().trim();
    if (selector.includes(DISABLED)) continue;
    const body = rule[2];
    const bgHit = body.match(
      /(?:^|;)\s*(?:background|background-color|--row-bg)\s*:\s*([^;]+)/,
    );
    const fgHit = body.match(/(?<!-)color:\s*([^;]+)/);
    if (!bgHit || !fgHit) continue;
    const bg = resolveColor(bgHit[1]);
    const fg = resolveColor(fgHit[1]);
    if (!bg || !fg) continue;
    inspected += 1;
    const ratio = contrast(fg, bg);
    if (ratio < 4.5)
      failures.push(
        `${selector}：${fg} 配它自己的底 ${bg} 只有 ${ratio.toFixed(2)}:1`,
      );
  }
  /*
   * ⚠️ 防「測試自己壞掉」：正規表示式寫錯時一組都配不出來，
   *   failures 是空的、測試變綠。釘一個下限。
   */
  assert.ok(
    inspected >= 10,
    `只配出 ${inspected} 組「同一條規則裡的前景＋背景」，太少——比對是不是壞了？`,
  );
  assert.deepEqual(
    failures,
    [],
    `以下規則的文字在它自己宣告的底色上未達 AA 的 4.5:1：\n- ${failures.join("\n- ")}`,
  );
});

test("前置：上面那一條抓得到 2026-09-29 那個實例（不然它是恆真的）", () => {
  /*
   * 拿修好之前那條真的規則餵進同一段判斷。
   * 這是「守門真的會紅」的反證，不是重述修好的結果。
   */
  const before = contrast("#6b7780", "#f7f9fa");
  assert.ok(
    before < 4.5,
    `修好前那一組應該要算出不足 4.5:1，實際 ${before.toFixed(2)}:1——這條守門等於沒做`,
  );
  const after = contrast("#57646f", "#eceff1");
  assert.ok(
    after >= 4.5,
    `改好的那一組卻算不過（${after.toFixed(2)}:1）`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #16 的兩條驗收線（2026-09-10 使用者定案，2026-09-29 補上守門）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 定案文案給了兩條驗收線，而原本兩條都沒有守門：
 *   ① 全頁對比掃描要**真的量到斑馬列與 hover 狀態**，不是只量到白底那幾列。
 *   ② **斑馬底色與白底的亮度差 ≤ 5%**，超過就是「看起來有顏色」
 *     而不是「分得出行」。
 *
 * ⚠️ 第 ② 條當場抓到我自己：我第一版挑 `#f6f9fa`，亮度差 **5.75%**，
 *   超線。已改成 `#f8fafb`（**4.71%**）。
 *   ⚠️ 連定案文案自己寫的 `#f7f9fa` 都是 **5.57%**，也超線——
 *     所以這裡以「≤ 5%」那條**驗收線**為準，不是以那個色碼為準。
 *
 * ⚠️ hover（`#eef5f6`）**刻意不套第 ② 條**：驗收線寫的是「**斑馬底色**」。
 *   hover 是滑到才出現的暫態，要的就是「一眼看得出指到哪一列」；
 *   套同一條線會讓 hover 等於沒有。但 **AA 4.5:1 照樣要過**。
 */

/** 從樣式表讀出斑馬底色與 hover 底色，讀不到就紅（不可以寫死在測試裡）。 */
function tableGrounds() {
  const zebra = css.match(/--row-bg\s*:\s*(#[0-9a-fA-F]{6})\s*\}/);
  const hover = css.match(/tbody tr:hover td\s*\{\s*background\s*:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(zebra, "樣式表裡找不到斑馬底色（--row-bg）");
  assert.ok(hover, "樣式表裡找不到 hover 的底色（tbody tr:hover td）");
  return { zebra: zebra[1].toLowerCase(), hover: hover[1].toLowerCase() };
}

test("#16-① 斑馬底色與白底的亮度差 ≤ 5%", () => {
  const { zebra } = tableGrounds();
  const delta = (luminance("#ffffff") - luminance(zebra)) * 100;
  assert.ok(
    delta > 0,
    `斑馬底色 ${zebra} 不比白底暗，那就分不出行了（亮度差 ${delta.toFixed(2)}%）`,
  );
  assert.ok(
    delta <= 5,
    `斑馬底色 ${zebra} 與白底的亮度差是 ${delta.toFixed(2)}%，超過 5%——` +
      "那會變成「整張表看起來有顏色」而不是「分得出行」",
  );
});

test("#16-① 前置：這條線真的擋得住（不然它是恆真的）", () => {
  /* 我 2026-09-29 第一版挑的 #f6f9fa 與定案文案寫的 #f7f9fa 都必須被判成超線。 */
  for (const tooDark of ["#f6f9fa", "#f7f9fa"]) {
    const delta = (luminance("#ffffff") - luminance(tooDark)) * 100;
    assert.ok(
      delta > 5,
      `${tooDark} 的亮度差算出來是 ${delta.toFixed(2)}%，這條線等於沒做`,
    );
  }
  /* 而改好的那一階必須過。 */
  assert.ok((luminance("#ffffff") - luminance("#f8fafb")) * 100 <= 5);
});

test("#16-② 斑馬列與 hover 列上的文字都要 ≥ 4.5:1（不是只量白底那幾列）", () => {
  const { zebra, hover } = tableGrounds();
  /*
   * 表格裡真的會出現的前景色。
   * ⚠️ 連結色刻意列**表格內專用的那一個**（`:where(tbody tr) td .link-button`），
   *   不是全站的 --blue——因為 hover 底上過不了 AA 的正是 --blue，
   *   而解法是只改表格內的連結。這裡要量的就是實際會疊上去的那一組。
   */
  const tableLink = css.match(
    /:where\(tbody tr\) td \.link-button,\s*\n?:where\(tbody tr\) td a\s*\{\s*color\s*:\s*(#[0-9a-fA-F]{6})/,
  );
  assert.ok(tableLink, "找不到表格內連結的顏色宣告");
  const foregrounds = [
    ["內文", CUSTOM_PROPERTIES.get("--ink") || "#1d2a34"],
    ["次要文字", CUSTOM_PROPERTIES.get("--muted") || "#5d6c78"],
    ["表格內連結", tableLink[1].toLowerCase()],
    ["已確認列的文字", "#57646f"],
  ];
  const failures = [];
  for (const [ground, bg] of [["斑馬列", zebra], ["hover 列", hover]])
    for (const [label, fg] of foregrounds) {
      const ratio = contrast(fg, bg);
      if (ratio < 4.5)
        failures.push(`${ground}（${bg}）上的${label} ${fg} 只有 ${ratio.toFixed(2)}:1`);
    }
  assert.deepEqual(
    failures,
    [],
    "以下組合在斑馬列或 hover 列上未達 AA 的 4.5:1：\n- " + failures.join("\n- "),
  );
});

test("#16-② 前置：這條線真的量到了 hover（不然它只是重量了一次白底）", () => {
  const { zebra, hover } = tableGrounds();
  assert.notEqual(zebra, hover, "斑馬底與 hover 底相同，hover 等於沒做");
  /*
   * 全站的 --blue 在 hover 底上必須是**不足**的——這正是「只改表格內連結」
   * 這個解法存在的理由。哪天 --blue 自己變深了，這一條會紅，
   * 提醒人回來把表格內那一條特例拿掉（否則會留下一個沒有必要的例外）。
   */
  const brand = CUSTOM_PROPERTIES.get("--blue") || "#1977b5";
  assert.ok(
    contrast(brand, hover) < 4.5,
    `全站的 --blue（${brand}）在 hover 底上已經是 ` +
      `${contrast(brand, hover).toFixed(2)}:1（夠了），` +
      "那表格內那一條特例就沒有必要了，請拿掉它並刪掉這一條斷言",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄要過 AAA（7:1），不是 AA（2026-09-30，#19）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼側欄特別嚴：它是**每一頁都在畫面上**的東西，而且是深底淺字
 *（深底淺字在亮環境下的實際可讀性比量出來的數字更差）。
 *
 * ⚠️ 這一條與上面那條 AA 是**兩條**，不是把 4.5 改成 7：
 *   有色底還有漸層與徽章那些，它們依規定只要求 AA，
 *   一起拉到 7:1 會逼出一堆為了過測試而改的顏色。
 */
const SIDEBAR_GROUND = "#17354d";

test("側欄上的每一個文字色都要 ≥ 7:1（AAA）", () => {
  const items = ON_COLOR.filter(([, , bg]) => bg.toLowerCase() === SIDEBAR_GROUND);
  /* 前置：真的挑到側欄那幾組，否則這一條恆綠。 */
  assert.ok(items.length >= 4, `只挑到 ${items.length} 組側欄色——ON_COLOR 改過了嗎？`);
  const failures = [];
  for (const [name, fg, bg] of items) {
    const ratio = contrast(fg, bg);
    if (ratio < 7)
      failures.push(`${name}：${fg} 配 ${bg} 只有 ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(
    failures,
    [],
    `側欄未達 AAA 的 7:1：\n- ${failures.join("\n- ")}`,
  );
});

test("⚠️ 前置：AAA 那一條真的會抓（舊的 .65 混合色必須被判不合格）", () => {
  /*
   * #aeb8c1 是 2026-09-30 之前側欄副標混合後的實際顏色，6.31:1。
   * 它必須被判成不合格——判不出來的話，上面那一條是恆綠的。
   */
  assert.ok(
    contrast("#aeb8c1", SIDEBAR_GROUND) < 7,
    "舊的 .65 混合色竟然算得出 ≥7:1，AAA 這條規則等於沒做",
  );
  assert.ok(
    contrast("#bec6cd", SIDEBAR_GROUND) >= 7,
    "改好的 .72 混合色卻算不過",
  );
});
