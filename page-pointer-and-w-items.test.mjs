/*
 * ══════════════════════════════════════════════════════════════════════
 *  W 區守門（交通服務水準）：#48 指路／#47 hover／#64 刪除文案／#51／#66／#3
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 的裁示與確認結果（動手前先查的，見待修正清單 W 區）：
 *   #48 幾乎沒做 → 做
 *   #47 數值那一半已經做好了 → 只補守門
 *   #64 已經做好了 → 只補守門
 *   #51 只有 1 處 → 做
 *   #66 還在 → 做
 *   #3 掃描已加，但抓到三處真實低對比 → 修並釘住
 *
 * ⚠️「已經做好了」的那兩件也要有守門：沒有守門的話，下一個人把它改回去
 *   不會有任何症狀，而使用者只會再回報一次同一件事。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "app.js"), "utf8");
const cssSource = readFileSync(join(here, "styles.css"), "utf8");
const htmlSource = readFileSync(join(here, "index.html"), "utf8");
const readmeSource = readFileSync(join(here, "README.md"), "utf8");

/** 把壓縮成一行的 CSS 拆成一條一條規則（選擇器 ＋ 宣告）。 */
function cssRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((hit) => ({
    selector: hit[1].trim(),
    body: hit[2].trim(),
  }));
}

/* ══════════════════════════════════════════════════════════════════════
 *  #48 畫面之間要互相指路
 * ══════════════════════════════════════════════════════════════════════ */

/** app.js 裡的 titles 對照（分頁 id → 分頁名稱）。 */
function pageTitles() {
  const start = appSource.indexOf("const titles = {");
  assert.ok(start > 0, "前置：找不到 titles 對照");
  let depth = 0;
  let end = start;
  for (let i = appSource.indexOf("{", start); i < appSource.length; i += 1) {
    if (appSource[i] === "{") depth += 1;
    if (appSource[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const block = appSource.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...block.matchAll(/^\s*([a-zA-Z]+):\s*"/gm)].map((hit) => hit[1]);
}

/** PAGE_POINTERS 的鍵與每一個指向的目標。 */
function pointerMap() {
  const start = appSource.indexOf("const PAGE_POINTERS = {");
  assert.ok(start > 0, "前置：找不到 PAGE_POINTERS");
  const end = appSource.indexOf("\n};", start);
  const block = appSource.slice(start, end);
  const map = new Map();
  const sections = [...block.matchAll(/^\s{2}([a-zA-Z]+):\s*\[([\s\S]*?)\n\s{2}\],/gm)];
  for (const section of sections)
    map.set(
      section[1],
      [...section[2].matchAll(/\["([a-zA-Z]+)",\s*"([^"]+)"\]/g)].map((hit) => ({
        target: hit[1],
        why: hit[2],
      })),
    );
  return map;
}

test("#48-1 每一個分頁都有指路（一頁都不可以漏）", () => {
  /*
   * ⚠️ 這一條就是 #48 的驗收線，而且它守的是「下一次新增分頁時不會漏」。
   *   逐頁手寫 HTML 的話，漏掉一頁不會有任何症狀——所以做成一份資料，
   *   再用這一條逐一對照 titles。
   */
  const titles = pageTitles();
  const pointers = pointerMap();
  assert.ok(titles.length >= 15, `前置：titles 只讀到 ${titles.length} 個分頁，讀法壞了`);
  const missing = titles.filter((id) => !pointers.has(id));
  assert.deepEqual(missing, [], `這幾個分頁沒有指路：${missing.join("、")}`);
});

test("#48-2 指到的一定要是真的分頁，而且不可以指自己", () => {
  const titles = new Set(pageTitles());
  const pointers = pointerMap();
  const bad = [];
  for (const [from, targets] of pointers)
    for (const { target } of targets) {
      if (!titles.has(target)) bad.push(`${from} → ${target}（不存在的分頁）`);
      if (target === from) bad.push(`${from} → 自己`);
    }
  assert.deepEqual(bad, [], bad.join("；"));
});

test("#48-3 每一頁至少指兩個地方，而且每一個都要說「為什麼去那裡」", () => {
  /*
   * ⚠️ 只列分頁名稱不算指路——使用者要的是「說『更細的在哪一頁』」，
   *   光是一排按鈕跟側欄沒有差別。
   */
  const pointers = pointerMap();
  const bad = [];
  for (const [from, targets] of pointers) {
    if (targets.length < 2) bad.push(`${from} 只指了 ${targets.length} 個地方`);
    for (const { target, why } of targets)
      if (!why || why.length < 4) bad.push(`${from} → ${target} 沒有說明為什麼`);
  }
  assert.deepEqual(bad, [], bad.join("；"));
});

test("#48-4 指路用 go() 切分頁，不可以用 <a href>", () => {
  /*
   * 這是單頁程式，href 會讓整頁重新載入，還沒寫入的預覽就沒了。
   */
  const start = appSource.indexOf("function renderPagePointers()");
  assert.ok(start > 0, "前置：找不到 renderPagePointers()");
  const block = appSource.slice(start, appSource.indexOf("\n}\n", start));
  assert.match(block, /go\(targetId\)/);
  assert.doesNotMatch(block, /createElement\("a"\)/, "指路用了 <a>，會整頁重新載入");
});

/* ══════════════════════════════════════════════════════════════════════
 *  #47 圖上的數值滑鼠移上去才顯示（已完成，這裡只鎖住）
 * ══════════════════════════════════════════════════════════════════════ */

test("#47-1 旅行速率圖的數值預設藏起來、hover／鍵盤焦點才顯示", () => {
  const rules = cssRules(cssSource);
  const hidden = rules.find(
    (rule) => rule.selector === ".speed-bar::before" && /opacity:\s*0/.test(rule.body),
  );
  assert.ok(hidden, "`.speed-bar::before` 沒有 opacity:0——數值會永遠顯示在圖上");
  const shown = rules.find(
    (rule) =>
      /\.speed-bar:hover::before/.test(rule.selector) &&
      /opacity:\s*1/.test(rule.body),
  );
  assert.ok(shown, "找不到 hover 時顯示數值的規則");
  assert.match(
    shown.selector,
    /focus-visible/,
    "只有 hover 沒有 focus-visible——用鍵盤的人永遠看不到數值",
  );
});

test("#47-2 LOS 圖上的 A～F 等級字母**不可以**跟著藏起來", () => {
  /*
   * ⚠️ 這是反面。#47 要藏的是「數值」，而 LOS 圖上的是等級字母——
   *   那張圖的內容本身就是它，藏起來圖就空了。
   *   把 `.bar::before` 也加上 opacity:0 的話這一條要紅。
   */
  const rules = cssRules(cssSource);
  const losLabel = rules.find(
    (rule) =>
      rule.selector === ".bar::before" && /content:\s*attr\(data-los\)/.test(rule.body),
  );
  assert.ok(losLabel, "前置：找不到 LOS 圖的等級字母規則");
  assert.doesNotMatch(
    losLabel.body,
    /opacity:\s*0/,
    "LOS 圖的等級字母被藏起來了——那張圖畫的就是等級，藏掉圖就空了",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #64 刪除的 confirm 要寫出代價與備份提醒（已完成，這裡只鎖住）
 * ══════════════════════════════════════════════════════════════════════ */

test("#64-1 刪除單一計畫：confirm 要寫出刪掉什麼、無法復原、會先下載備份", () => {
  const start = appSource.indexOf("async function deleteProjectFlow(");
  assert.ok(start > 0, "前置：找不到 deleteProjectFlow()");
  const block = appSource.slice(start, start + 1400);
  assert.match(block, /個季度/, "沒有寫出會刪掉幾個季度");
  assert.match(block, /筆尖峰明細/, "沒有寫出會刪掉幾筆明細");
  assert.match(block, /無法復原/, "沒有寫出「無法復原」");
  assert.match(block, /備份/, "沒有備份提醒");
  /*
   * ⚠️ 而且要**真的先下載**，不是只在文字上寫。
   *   順序也要對：下載必須在 purgeProject() 之前。
   */
  const downloadAt = block.indexOf("downloadProjectPackage(false)");
  const purgeAt = block.indexOf("purgeProject(code)");
  assert.ok(downloadAt > 0, "confirm 寫了會先下載備份，程式卻沒有真的下載");
  assert.ok(
    downloadAt < purgeAt,
    "備份下載排在刪除之後了——那時候資料已經沒了，下載到的是空的",
  );
});

test("#64-2 清除全部計畫：要寫出代價、備份提醒，而且要問兩次", () => {
  const start = appSource.indexOf('wipeAll.textContent = "清除這台電腦上的全部計畫"');
  assert.ok(start > 0, "前置：找不到「清除這台電腦上的全部計畫」");
  const block = appSource.slice(start, start + 1600);
  assert.match(block, /全部 \$\{state\.projects\.length\} 個計畫/, "沒有寫出會清掉幾個計畫");
  assert.match(block, /無法復原/);
  assert.match(block, /下載個人全部計畫包/, "沒有指出備份要按哪一顆");
  assert.equal(
    (block.match(/confirm\(/g) || []).length,
    2,
    "清除全部計畫只問了一次——這個動作不可逆，要問兩次",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #51 匯出範圍的說明要在兩個地方都講
 * ══════════════════════════════════════════════════════════════════════ */

test("#51-1 品質總覽說「一律輸出全部」，明細說「只輸出畫面上這些」", () => {
  /*
   * 這兩個匯出的行為**刻意不一樣**，所以兩邊都要各自講清楚。
   * 只講一邊的話，使用者會拿其中一邊的印象去推另一邊。
   */
  assert.match(
    appSource,
    /匯出與交付檔案一律輸出全部項目，不受這裡的篩選影響/,
    "品質總覽少了「一律輸出全部」的說明",
  );
  assert.match(
    htmlSource,
    /data-testid="detail-export-scope"/,
    "尖峰明細的匯出旁邊沒有說明範圍",
  );
  const noteAt = htmlSource.indexOf('data-testid="detail-export-scope"');
  const block = htmlSource.slice(noteAt, noteAt + 500);
  assert.match(block, /畫面上目前這些/, "沒有說出明細匯出的是篩選後的結果");
  assert.match(block, /一律輸出全部項目/, "沒有點出另一邊的行為不一樣");
});

/* ══════════════════════════════════════════════════════════════════════
 *  #66 版本速限註記在窄畫面不可以擠成一條
 * ══════════════════════════════════════════════════════════════════════ */

test("#66-1 .limit-version-note 不再用底色＋固定 max-width", () => {
  const rules = cssRules(cssSource);
  const rule = rules.find((item) => item.selector === ".limit-version-note");
  assert.ok(rule, "前置：找不到 .limit-version-note");
  assert.doesNotMatch(
    rule.body,
    /max-width/,
    "還寫著 max-width——欄寬本來就比它窄的時候完全不起作用",
  );
  assert.doesNotMatch(
    rule.body,
    /background\s*:/,
    "還有滿底色——會把「擠成一條」放大成一塊很顯眼的色帶",
  );
  assert.match(rule.body, /overflow-wrap\s*:\s*anywhere/, "沒有允許換行");
});

/* ══════════════════════════════════════════════════════════════════════
 *  #3 全頁對比掃描抓到的三處真實低對比
 * ══════════════════════════════════════════════════════════════════════ */

/** WCAG 相對亮度。 */
function luminance(hex) {
  const value = hex.replace("#", "");
  const parts = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("#3-1 表頭漏斗在 th 底色上要過 AA（不是在白底上算）", () => {
  /*
   * ⚠️ 這一條記的是一個**真的犯過的錯**：前一版把 #5b7285 算成 5.01:1，
   *   那是拿**白底**算的；這顆按鈕長在 th 裡面，th 的底色是 #eef3f5，
   *   實際只有 4.48:1。「算對了比值、底色拿錯」是這一類修正最容易犯的錯。
   */
  const rules = cssRules(cssSource);
  const button = rules.find((rule) => rule.selector === ".col-filter-btn");
  assert.ok(button, "前置：找不到 .col-filter-btn");
  const color = button.body.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(color, "前置：讀不到 .col-filter-btn 的文字色");
  const th = rules.find((rule) => rule.selector === "th");
  const background = th?.body.match(/background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(background, "前置：讀不到 th 的底色");
  const ratio = contrast(color, background);
  assert.ok(
    ratio >= 4.5,
    `表頭漏斗 ${color} 在 th 底色 ${background} 上只有 ${ratio.toFixed(2)}:1`,
  );
});

test("#3-2 判定標準的欄位小字要過 AA", () => {
  const rules = cssRules(cssSource);
  const label = rules.find((rule) => rule.selector === ".los-rule-grid label");
  const span = rules.find((rule) => rule.selector === ".los-rule-grid label span");
  assert.ok(label && span, "前置：找不到 .los-rule-grid 的規則");
  const background = label.body.match(/background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  const color = span.body.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(background && color, "前置：讀不到底色或文字色");
  const ratio = contrast(color, background);
  assert.ok(ratio >= 4.5, `${color} 在 ${background} 上只有 ${ratio.toFixed(2)}:1`);
});

test("#3-3 「0 錯誤」徽章不可以再用 inline style 蓋掉樣式表的顏色", () => {
  /*
   * ⚠️ 這一條記的是另一個真的犯過的錯，而且它比「顏色不夠深」更壞：
   *   styles.css 早就把 #errorBadge 改成 #12735a 了，畫面上卻永遠是
   *   #168466——app.js 用 inline style 寫死了綠色，inline 贏過樣式表。
   *   **那次修正完全沒有生效，而且看樣式表看不出來。**
   *
   *   規則：沒有錯的時候一律寫空字串讓 CSS 接手，只有「有錯」才寫 inline。
   */
  const lines = appSource
    .split("\n")
    .filter((line) => line.includes('$("errorBadge").style.color'));
  assert.ok(lines.length > 0, "前置：找不到 errorBadge 的顏色指派");
  for (const line of lines)
    assert.doesNotMatch(
      line,
      /#1[0-9a-fA-F]{2}8|#12735a|#168466/,
      `又把綠色寫成 inline 了，樣式表的顏色會被蓋掉：${line.trim()}`,
    );
  const rules = cssRules(cssSource);
  const badge = rules.find((rule) => rule.selector === "#errorBadge");
  assert.ok(badge, "前置：找不到 #errorBadge 的樣式");
  const color = badge.body.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1];
  const background = badge.body.match(/background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(color && background, "前置：讀不到 #errorBadge 的顏色");
  const ratio = contrast(color, background);
  assert.ok(ratio >= 4.5, `${color} 在 ${background} 上只有 ${ratio.toFixed(2)}:1`);
});

/* ══════════════════════════════════════════════════════════════════════
 *  #54 側欄分頁名稱不可以被裁掉
 * ══════════════════════════════════════════════════════════════════════ */

test("#54-1 側欄按鈕要同時有 line-break:anywhere 與 overflow-wrap:anywhere", () => {
  /*
   * ⚠️ 只有 overflow-wrap:anywhere **不夠**：CSS 禁止在全形右括號「）」之前
   *   斷行，而 overflow-wrap:anywhere 只在「整行完全沒有斷行機會」時才強制斷。
   *   「三段分法（順暢／尚可／壅塞）」在「／」處有斷行機會，於是不強制斷，
   *   最後那一段「壅塞）」黏成不可斷的尾巴直接溢出 4px。
   *
   * ⚠️ 分頁名稱是使用者逐字指定的（X-62），不可以為了排版改短，
   *   所以只能從斷行這一邊解。
   */
  const rules = cssRules(cssSource);
  const rule = rules.find(
    (item) => item.selector === "nav button" && /overflow-wrap/.test(item.body),
  );
  assert.ok(rule, "前置：找不到 nav button 的換行規則");
  assert.match(
    rule.body,
    /white-space:\s*normal/,
    "少了 white-space:normal —— <button> 的瀏覽器預設是 nowrap，" +
      "在它之下 overflow-wrap 與 line-break 完全不起作用（實測過）",
  );
  assert.match(rule.body, /overflow-wrap:\s*anywhere/);
  assert.match(
    rule.body,
    /line-break:\s*anywhere/,
    "少了 line-break:anywhere——全形括號前不會斷，長名稱還是會溢出",
  );
});

test("#54-2 側欄一定要能上下捲動（換行之後整條會變高）", () => {
  /*
   * ⚠️ 這一條守的是「修了 A 壓到 B」。
   *   把分頁名稱改成可以換行之後，長名稱變兩行、側欄變高，
   *   900px 寬那一級的視窗上最下面幾顆按鈕被推出畫面——
   *   而 aside 是 position:fixed 又沒有捲動，那幾顆就完全按不到
   *   （e2e-narrow-nav-clickable 實測「判定標準」點不到）。
   *
   *   把 overflow-y 拿掉，這一條紅；端對端那一支也會紅。
   */
  const rules = cssRules(cssSource);
  const aside = rules.find((rule) => rule.selector === "aside");
  assert.ok(aside, "前置：找不到 aside 的樣式");
  assert.match(
    aside.body,
    /overflow-y:\s*auto/,
    "側欄不能捲動——換行之後最下面幾顆按鈕會按不到",
  );
  assert.match(
    aside.body,
    /overscroll-behavior:\s*contain/,
    "少了 overscroll-behavior:contain，側欄捲到底會把捲動傳給主畫面",
  );
});

test("#3-4 說明小字在面板底色上要過 AA", () => {
  /*
   * e2e 的全頁掃描 2026-09-29 抓到「要看的指標（可複選）」#65798a 在
   * #f8fbfc 上只有 4.34:1。它在**白底**上是 4.51:1 —— 剛好過，
   * 所以「拿白底量」的舊守門看不出來。這一條改成量它實際的底色。
   */
  const rules = cssRules(cssSource);
  const label = rules.find((rule) => rule.selector === ".los-rule-grid label");
  const background = label?.body.match(/background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(background, "前置：讀不到面板底色");
  const notes = rules.filter(
    (rule) =>
      /panel-head p$|^\.rule-note$|band-rule-head p$/.test(rule.selector) &&
      /color:\s*#/.test(rule.body),
  );
  assert.ok(notes.length >= 3, `前置：只找到 ${notes.length} 條說明小字規則，抓法壞了`);
  for (const note of notes) {
    const color = note.body.match(/color:\s*(#[0-9a-fA-F]{6})/)[1];
    const ratio = contrast(color, background);
    assert.ok(
      ratio >= 4.5,
      `${note.selector} 的 ${color} 在面板底色 ${background} 上只有 ${ratio.toFixed(2)}:1`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════
 *  #60 使用者裁示「定稿鎖不做」——但後半段「在說明上講明」要做
 * ══════════════════════════════════════════════════════════════════════ */

test("#60 畫面上要明講「本系統沒有定稿鎖」", () => {
  /*
   * 使用者 2026-09-29 裁示：「交通服務水準程式沒有定稿鎖就不做了，
   * 避免引發一連串問題」。⚠️ 那是「功能不做」，不是「當作沒這回事」——
   * 另外兩支都有這個功能，使用者從那邊切過來會在這一頁一直找。
   * 2026-09-29 查證：全檔 0 處「定稿」，也就是後半段完全沒做。
   */
  assert.match(
    appSource,
    /data-testid="no-final-lock"/,
    "資料維護頁沒有「本系統沒有定稿鎖」的說明",
  );
  const at = appSource.indexOf('data-testid="no-final-lock"');
  const block = appSource.slice(at, at + 600);
  assert.match(block, /沒有「定稿鎖」/, "沒有直接講出「沒有定稿鎖」這件事");
  assert.match(block, /刻意沒有做/, "沒有說明那是刻意的決定，會被當成漏掉");
  assert.match(block, /備份與還原/, "沒有給替代做法（下載專案包）");
});

test("#60-2 那段說明的顏色在它自己的底色上要過 AA", () => {
  const rules = cssRules(cssSource);
  const rule = rules.find((item) => item.selector === ".no-final-lock");
  assert.ok(rule, "前置：找不到 .no-final-lock 的樣式");
  const color = rule.body.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1];
  const background = rule.body.match(/background:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(color && background, "前置：讀不到它的前景或底色");
  const ratio = contrast(color, background);
  assert.ok(ratio >= 4.5, `${color} 在 ${background} 上只有 ${ratio.toFixed(2)}:1`);
});

/* ══════════════════════════════════════════════════════════════════════
 *  W-0l：畫面上用到的 class 一定要有樣式（#37 的第一個實例）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-30：`.road-choice` 在 app.js 用了兩處，styles.css **0 條規則**——
 * 那顆下拉用瀏覽器預設樣式呈現，和同一頁其他下拉長得不一樣。
 *
 * ⚠️ 為什麼一直沒被抓到：這一支還沒有 class 覆蓋掃描（清單 #37）。
 *   這一條是**針對已知的那幾個 class** 的最小版本，不是完整的 #37——
 *   完整版要掃全部 class，列在待修正清單的守門覆蓋率區。
 *   ⚠️ 寫成最小版本是刻意的：假裝它等於 #37 才是危險的事。
 */
test("W-0l 畫面上用到的下拉 class 一定要有樣式", () => {
  const rules = cssRules(cssSource);
  /* 只挑「在 app.js 真的被輸出到畫面上」的那幾個 */
  const used = ["road-choice", "road-pick", "link-button", "page-pointer"].filter(
    (name) => new RegExp(`class="[^"]*\\b${name}\\b`).test(appSource),
  );
  assert.ok(used.length >= 3, `前置：只找到 ${used.length} 個 class，抓法壞了`);
  const missing = used.filter(
    (name) => !rules.some((rule) => rule.selector.includes("." + name)),
  );
  assert.deepEqual(
    missing,
    [],
    `這幾個 class 在畫面上用了、styles.css 卻一條規則都沒有：${missing.join("、")}`,
  );
});

test("W-0l-2 .road-choice 的樣式要和同一頁其他下拉一致", () => {
  /*
   * 光是「有規則」不夠——給一條 `color:red` 也會通過上一條。
   * 這裡釘住它真的對齊了 `.form select` 的那幾個關鍵屬性。
   */
  const rules = cssRules(cssSource);
  const rule = rules.find((item) => item.selector === ".road-choice");
  assert.ok(rule, "前置：找不到 .road-choice");
  for (const prop of ["border", "border-radius", "padding", "font"])
    assert.match(
      rule.body,
      new RegExp(prop),
      `.road-choice 少了 ${prop}，和同一頁其他下拉長得不一樣`,
    );
});

test("W-0l-3 README 的「可編輯 Word」那一句要有向前指標", () => {
  /*
   * README 第 347 行寫「v2.20.55 已移除 Word 版下載鈕」，
   * 而 v2.6 那一節（第 923 行）還寫「可下載 PDF 與可編輯 Word」——
   * **同一份文件自己跟自己矛盾**。
   *
   * ⚠️ 依規矩**歷史段落不改寫**，所以原句保留，只加向前指標。
   *   這一條守的是那個指標還在。
   */
  const at = readmeSource.indexOf("網站「新手說明」頁可下載 PDF 與可編輯 Word。");
  assert.ok(at > 0, "前置：找不到那一句（改寫了歷史段落？）");
  const after = readmeSource.slice(at, at + 400);
  assert.match(after, /向前指標/, "那一句後面沒有向前指標");
  assert.match(after, /v2\.20\.55/, "向前指標沒有寫出是哪一版移除的");
  assert.match(after, /現在只出 PDF/, "向前指標沒有寫出現況");
});
