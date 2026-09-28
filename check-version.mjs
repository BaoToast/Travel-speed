/**
 * 版本一致性檢查。
 *
 * v2.7 出過一次事：app.js 把版本字樣寫成 v2.7，但 quality-extension.js 裡
 * 還留著一行 `.brand small = "正式版 v2.6"`，而它在 index.html 裡排在 app.js
 * 後面，於是把剛寫上的版本又蓋回舊的。結果是「檔案全部都更新了、網站也部署
 * 成功了，畫面卻永遠顯示上一版」，而且怎麼清瀏覽器快取都沒用——因為根本
 * 不是快取問題。
 *
 * 這支檢查確保：
 *   1. 全站只有「一個地方」會寫入版本字樣；
 *   2. 那個字樣、index.html 的 ?v= 參數、手冊檔名三者版本一致；
 *   3. 沒有任何檔案殘留舊版號。
 *
 * 用法：node check-version.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const scripts = [
  "app.js",
  "quality-extension.js",
  "excel-export.js",
  "conclusion.js",
  /* 新加的模組也要納入，否則「只有一個檔案寫版本字樣」這條會漏掉它們。 */
  "trend.js",
  "trend-excel.js",
  "column-filter.js",
  "period-date.js",
  /* 2026-09-20 新增：方向名稱成對判定（三支共用）。 */
  "direction-pair.js",
  "chart-levels.js",
  /*
   * ⚠️ 2026-09-15 補上的三支。它們在主工具列改版時新增，當時忘了加進這份清單，
   *   於是「沒有殘留其他版號」那一條**從來沒掃過它們**——
   *   實測：main-toolbar.js 裡寫著「已於 v2.20.62 移除」而 app.js 版本是 v2.20.61，
   *   app.js 的同一句被抓到、main-toolbar.js 的沒有。
   *   新增模組時請一併加進來，這份清單就是這幾條規則的涵蓋範圍。
   */
  "main-filters.js",
  "main-toolbar.js",
  "los-rule-scope.js",
];
const html = read("index.html");

// 1) 只能有一個地方寫入 .brand small
const writers = scripts.filter((name) => /\.brand small"?\)?\.textContent\s*=/.test(read(name)));
ok(
  "全站只有一個檔案會寫入版本字樣",
  writers.length === 1,
  writers.length ? `寫入者：${writers.join("、")}` : "沒有任何檔案寫入版本字樣",
);

// 2) 取出那個版本字樣
const source = writers[0] ? read(writers[0]) : "";
const shown = source.match(/正式版\s*v(\d+\.\d+(?:\.\d+)?)/)?.[1];
ok("找得到版本字樣", Boolean(shown), shown ? `v${shown}` : "");

// package metadata 也是正式版本基準；曾出現畫面 v2.20.75、兩份 manifest 仍是 2.20.74。
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
ok(
  "package.json 版本與程式版本相同",
  packageJson.version === shown,
  `package ${packageJson.version} vs 顯示 ${shown}`,
);
ok(
  "package-lock.json 根版本與程式版本相同",
  packageLock.version === shown && packageLock.packages?.[""]?.version === shown,
  `lock ${packageLock.version}／${packageLock.packages?.[""]?.version} vs 顯示 ${shown}`,
);

// 3) index.html 的 ?v= 參數全部一致，且等於版本字樣
const cacheBusters = [...html.matchAll(/\?v=(\d+\.\d+(?:\.\d+)?)/g)].map((m) => m[1]);
const uniqueBusters = [...new Set(cacheBusters)];
ok(
  "index.html 的 ?v= 參數全部一致",
  uniqueBusters.length === 1,
  uniqueBusters.join("、"),
);
ok(
  "?v= 參數與版本字樣相同",
  uniqueBusters.length === 1 && uniqueBusters[0] === shown,
  `?v=${uniqueBusters.join("/")} vs 顯示 v${shown}`,
);

// 4) index.html 裡靜態寫死的版本字樣也要一致
const staticShown = html.match(/正式版\s*v(\d+\.\d+(?:\.\d+)?)/)?.[1];
ok(
  "index.html 靜態版本字樣與程式寫入的相同",
  staticShown === shown,
  `HTML v${staticShown} vs JS v${shown}`,
);

// 5) 手冊檔名版本一致，且檔案真的存在
const manualRefs = [...source.matchAll(/交通服務水準程式手冊_v(\d+\.\d+(?:\.\d+)?)\.(pdf|docx)/g)];
const manualVersions = [...new Set(manualRefs.map((m) => m[1]))];
ok(
  "程式裡引用的手冊版本一致且等於版本字樣",
  manualVersions.length === 1 && manualVersions[0] === shown,
  manualVersions.join("、"),
);
const manualDir = join(here, "manuals");
const manuals = existsSync(manualDir) ? readdirSync(manualDir) : [];
for (const [, version, ext] of manualRefs) {
  const name = `交通服務水準程式手冊_v${version}.${ext}`;
  ok(`手冊檔案存在：${name}`, manuals.includes(name));
}
// 6) manuals 目錄不能留著別的版本（舊手冊會讓使用者下載到過期內容）
const strays = manuals.filter((n) => !n.includes(`_v${shown}.`));
ok("manuals 目錄沒有殘留舊版手冊", strays.length === 0, strays.join("、"));

// 6b) 手冊的版號與日期：只能有一個來源，而且要和 app.js 對得上
/*
 * v2.20.3 出過事：手冊封面戳記寫「更新日期：2026-08-25」，每一頁頁尾卻印
 * 「2026-08-24」。因為兩支產生程式各自把版號與日期寫死，升版時用字串取代去改，
 * 比對不到就靜靜失敗——而**日期完全沒有人在看**，版號檢查照樣全綠。
 *
 * 現在頁尾與檔名都由 manual.html 的封面戳記推導（見 manual-src/release.mjs），
 * 結構上不可能不一致。這裡把剩下的那一段接起來：戳記要等於 app.js 的版號，
 * 並確認那兩支產生程式裡真的沒有寫死的版號或日期可以漏改。
 */
/*
 * ⚠️ 2026-09-12 起只出 PDF（使用者：「新手手冊只需要做 PDF 檔就好……
 *   三個程式都同步」）。build-docx.mjs 與 .docx 都已刪除，
 *   這裡跟著只剩一支；反面守門在 manual-copies-identical.test.mjs。
 */
/*
 * ⚠️ 2026-09-25 第五輪獨立複查：這裡原本**只掃 build-pdf.mjs**，
 *   而頁尾那串 `v… ｜ 日期 ｜ …` 根本不在 build-pdf.mjs 裡，
 *   它在 manual-src/release.mjs 的 footerPrefix()——上面那段註解自己就指著
 *   release.mjs，結果那一支不在掃描清單裡。也就是「唯一可能被寫死的地方」
 *   從來沒被守到。兩支一起掃。
 * ⚠️ 掃之前要先剝註解：release.mjs 的註解裡記著 2026-08-24／25／26
 *   （v2.20.3 那次事故的日期），不剝會直接誤報。
 */
const manualSrc = ["manual-src/build-pdf.mjs", "manual-src/release.mjs"];
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const stampSource = read("manual-src/manual.html");
const stamp = stampSource.match(
  /系統版本：\s*v([\d.]+)\s*[\s　]*更新日期：\s*(\d{4}-\d{2}-\d{2})/,
);
ok("manual.html 找得到版本戳記", Boolean(stamp), stamp ? `v${stamp[1]}／${stamp[2]}` : "");
ok(
  "手冊封面戳記的版號與程式寫入的相同",
  Boolean(stamp) && stamp[1] === shown,
  `手冊 v${stamp?.[1]} vs 顯示 v${shown}`,
);
for (const name of manualSrc) {
  const body = stripComments(read(name));
  const hardcoded = [
    ...body.matchAll(/v\d+\.\d+(?:\.\d+)?\s*｜/g),
    ...body.matchAll(/\d{4}-\d{2}-\d{2}/g),
    ...body.matchAll(/交通服務水準程式手冊_v\d+\.\d+(?:\.\d+)?/g),
  ].map((m) => m[0]);
  ok(
    `${name} 沒有寫死版號或日期（必須取自封面戳記）`,
    hardcoded.length === 0,
    hardcoded.join("、"),
  );
}

// 7) 任何原始檔都不該再出現舊版號
const olderPattern = new RegExp(`v(?!${shown.replaceAll(".", "\\.")})\\d+\\.\\d+(?:\\.\\d+)?`, "g");
for (const name of [...scripts, "index.html"]) {
  const hits = [...read(name).matchAll(olderPattern)].map((m) => m[0]);
  const suspicious = [...new Set(hits)].filter((h) => /^v\d+\.\d+(?:\.\d+)?$/.test(h));
  ok(`${name} 沒有殘留其他版號`, suspicious.length === 0, suspicious.join("、"));
}

// 8) 部署說明裡的版號要跟著版本走
/*
 * 這一條是實際踩到的：更新說明最後的「如何更新」從 v2.20.20 起就沒再改過，
 * v2.20.21、v2.20.22 兩次發布都照原樣交出去。依那份說明操作的人會
 * **刪掉本版的驗證報告**（它說只保留 VALIDATION_v2.20.20.md），
 * 而且會照著錯的版號去確認部署有沒有成功。
 */
{
  const notes = read("【更新說明】請先讀我.txt");
  /*
   * 「給Claude的交接說明_v2.20.1.md」是**要求刪除的舊檔名**，
   * 那個版號本來就該是舊的，掃描前先拿掉。
   */
  const deploySection = notes
    .slice(notes.indexOf("如何更新"))
    .replaceAll(/給Claude的交接說明_v[\d.]+\.md/g, "〔要求刪除的舊檔〕");
  const stale = [
    ...new Set(
      [...deploySection.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)]
        .map((m) => m[1])
        .filter((v) => v !== shown.replace(/^v/, "")),
    ),
  ];
  ok(
    "更新說明的「如何更新」段落沒有殘留舊版號",
    stale.length === 0,
    stale.map((v) => "v" + v).join("、"),
  );
  ok(
    "更新說明的標題就是本版版號",
    notes.split("\n")[0].includes(shown),
    notes.split("\n")[0],
  );
}

// 9) README 與驗證報告也必須跟正式版本一致。
{
  const readme = read("README.md");
  const firstReadmeVersion = readme.match(/^##\s+v([\d.]+)/m)?.[1];
  ok(
    "README 第一個版本章節與程式相同",
    firstReadmeVersion === shown,
    `README v${firstReadmeVersion} vs 顯示 v${shown}`,
  );

  const validationFiles = readdirSync(here).filter((name) => /^VALIDATION_v[\d.]+\.md$/.test(name));
  const expectedValidation = `VALIDATION_v${shown}.md`;
  ok(
    "根目錄只保留本版驗證報告",
    validationFiles.length === 1 && validationFiles[0] === expectedValidation,
    validationFiles.join("、"),
  );
  if (validationFiles.includes(expectedValidation)) {
    const headingVersion = read(expectedValidation).match(/^#\s+交通服務水準\s+v([\d.]+)\s+驗證報告/m)?.[1];
    ok(
      "驗證報告標題與程式相同",
      headingVersion === shown,
      `報告 v${headingVersion} vs 顯示 v${shown}`,
    );
  }
}

// 10) 同一個版號不可以出現兩段（不同內容共用一個版號 = 無法對照是哪一包）
/*
 * ⚠️ 2026-09-24 F6 獨立複查抓到：`【更新說明】請先讀我.txt` 與
 *   `VALIDATION_*.md` 各有**兩則都叫 v2.20.71**（09-23 與 09-24，
 *   內容完全不同）。使用者手上拿到一包時，無法判斷是哪一份。
 *
 * ⚠️ 2026-09-25 補正：**第一版這一條幾乎是恆真的**，是 F6 第三輪抓到的。
 *   第一版比的是「兩段的標題字串不同」，而標題字串只抓到版號＋日期括號，
 *   後面的敘述不在裡面——於是 `■ v2.20.61` 那種**沒有日期**的四則，
 *   四個 `match[0]` 完全一樣，被當成同一則，一個都不會報。
 *   實測：它對這份文件裡「3 個版號、共 9 段」回報通過。
 *   現在改成**計次**，不比字串。
 *
 * ⚠️ 範圍刻意只收**標題帶日期**的段落（v2.20.68 之後的寫法）。更早的歷史
 *   一個版號分好幾則（`■ v2.20.61：…` ×4）是當時的慣例，那是同一批的多則、
 *   不是兩份不同內容；把它們收進來只會迫使我**改寫歷史紀錄**，
 *   而那正是這條守門要防的事的反面。
 * ⚠️ 標題含「續」的排除：那是同一批的延續。
 */
{
  const sources = [
    ["【更新說明】請先讀我.txt", /^■\s*v([\d.]+)（(\d{4}-\d{2}-\d{2})）[^\n]*/gm],
    [`VALIDATION_v${shown}.md`, /^##\s+v([\d.]+)[^（\n]*（(\d{4}-\d{2}-\d{2})）[^\n]*/gm],
  ];
  for (const [name, pattern] of sources) {
    if (!existsSync(join(here, name))) continue;
    const text = read(name);
    const count = new Map();
    for (const match of text.matchAll(pattern)) {
      if (/續/.test(match[0])) continue;
      count.set(match[1], (count.get(match[1]) || 0) + 1);
    }
    const dup = [...count]
      .filter(([, n]) => n > 1)
      .map(([version, n]) => `v${version}（${n} 段）`);
    ok(`${name} 沒有兩段共用同一個版號`, dup.length === 0, dup.join("；"));
    /* 前置檢查：真的抓到帶日期的段落標題，否則寫法一改就安靜變恆真。 */
    ok(
      `${name} 抓得到帶日期的版本段落標題`,
      count.size >= 3,
      `抓到 ${count.size} 個`,
    );
    /* 前置檢查：本版一定要在裡面。 */
    ok(`${name} 抓得到本版（v${shown}）的段落標題`, count.has(shown), "");
  }
}

// 11) 更新說明寫出來的 SHA-256 必須真的是那個檔案的
/*
 * ⚠️ 2026-09-24 補。三支同一條規則：雜湊是使用者與複查者唯一能確認
 *   「我手上這一份就是你說的那一份」的依據。全日交通量就出過
 *   「宣告 faf9d25c… 實際 44bec3c6…」這一件，而它那支只比對檔名的守門
 *   完全沒看見。這一支實際重算比對。
 */
{
  const notes = read("【更新說明】請先讀我.txt");
  const pairs = [
    ...notes.matchAll(
      /^[ \t]*([^\s\n]+\.(?:pdf|js|css))[ \t]*\n[ \t]*SHA-256[ \t]*=[ \t]*([0-9a-f]{64})[ \t]*$/gm,
    ),
  ].map((m) => ({ name: m[1], sha: m[2] }));
  /* 前置檢查：格式一改就要有人知道，不可以安靜地變成恆真。 */
  ok("更新說明寫得出手冊的 SHA-256", pairs.length >= 1, `抓到 ${pairs.length} 組`);
  for (const { name, sha } of pairs) {
    const candidates = [join(here, "manuals", name), join(here, name)];
    const found = candidates.find((path) => existsSync(path));
    if (!found) {
      ok(`更新說明寫的 ${name} 在包裡找得到`, false, "找不到這個檔案");
      continue;
    }
    const real = createHash("sha256").update(readFileSync(found)).digest("hex");
    ok(
      `更新說明寫的 ${name} SHA-256 與實際檔案相符`,
      real === sha,
      /* ⚠️ 印全長，不要截成前 8 位——差在尾巴時截過的兩串看起來一樣。 */
      real === sha ? "" : `寫 ${sha}，實際 ${real}`,
    );
  }
}

// 12) 「未發布候選版」的區間與數量必須自己算得出來
/*
 * ⚠️ 2026-09-25 第六輪抓到：README 寫「v2.20.69～.73 五個候選未發布」，
 *   而 VALIDATION 寫「v2.20.69～v2.20.72 四個」、PROJECT_HANDOFF 也寫「四個」。
 *   三份文件對同一件事給三個答案，而讀的人只會看到其中一份。
 *
 * 這個數字**算得出來**：最後一個正式發布版是 v2.20.68，本版是 v${shown}，
 * 所以未發布候選是 .69 ～（本版 patch − 1），數量 = 該區間的長度。
 * 因為算得出來，就不可以讓它用手打。
 *
 * ⚠️ 只檢查**明確寫出區間**的句子。沒寫區間的段落（例如歷史紀錄裡
 *   「當時有三個候選」）是對的，不可以被連坐——歷史敘述講的是當時的狀態。
 */
{
  /*
   * ⚠️ 2026-09-27：**基準線動了**。GPT 已經把 v2.20.76 正式發布上線，
   *   所以「最後一個正式發布版是 v2.20.68」這個前提不再成立。
   *
   *   這裡要分成兩個常數，不可以只改一個：
   *     RANGE_BASE    ——「v2.20.69～.N 共 M 個」這種**歷史句子**的算術基準。
   *                      那句話講的是「.69 到 .N 有幾個版本」，與現在發布到哪一版無關，
   *                      所以它永遠是 68。把它一起改掉，會讓所有正確的歷史句子變紅。
   *     LAST_RELEASED ——**現在**最後一個真的發布出去的版本。現況敘述靠它。
   *
   *   當「本版的前一版」就是正式發布版時，根本沒有未發布候選區間，
   *   這時要求的就不是區間句，而是**寫明前一正式版是哪一版**。
   */
  const RANGE_BASE = 68;
  const LAST_RELEASED = 76;
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const patch = Number(String(shown).split(".")[2]);
  const wantTo = patch - 1;
  const wantCount = wantTo - RANGE_BASE;
  let seen = 0;
  const current = new Set();
  for (const name of [
    "README.md",
    `VALIDATION_v${shown}.md`,
    "PROJECT_HANDOFF.md",
    "【更新說明】請先讀我.txt",
  ]) {
    if (!existsSync(join(here, name))) continue;
    const text = read(name);
    for (const m of text.matchAll(
      /v2\.20\.69\s*[～~]\s*(?:v2\.20)?\.?(\d+)[^。\n]{0,8}?([0-9一二三四五六七八九十]+)\s*個候選/g,
    )) {
      const to = Number(m[1]);
      const count = CJK[m[2]] ?? Number(m[2]);
      /* 歷史段落：區間結束在更早的版本，數量要與那個區間相符就好。 */
      const expect = to - RANGE_BASE;
      seen += 1;
      ok(
        `${name} 的「v2.20.69～.${to} ${m[2]}個候選」數量與區間相符`,
        count === expect,
        `寫 ${m[2]} 個，.69～.${to} 實際是 ${expect} 個`,
      );
      if (to === wantTo) current.add(name);
    }
  }
  /* 前置檢查：真的掃到句子了，不是格式改掉之後安靜恆真。 */
  ok("找得到「v2.20.69～… N 個候選」這種句子", seen >= 2, `只抓到 ${seen} 句`);
  /*
   * ⚠️ 上面那條「區間與數量自己相符」**不足以**抓到第六輪那個缺陷：
   *   VALIDATION 寫「.69～.72 四個」，區間與數量互相是對的，
   *   錯的是**區間本身停在上一版**——它是一份停在舊狀態的現況敘述。
   *   （第一次寫這條守門時就是這樣漏掉的：反證沒有變紅。）
   *
   * 所以這三份「講現在是什麼狀態」的文件，各自都必須至少有一句把區間
   * 寫到本版前一版（.${wantTo}）。README 與更新說明裡停在更早版本的句子
   * 是歷史紀錄，照樣允許——只要同一份文件裡另外有一句是最新的。
   */
  if (LAST_RELEASED >= wantTo) {
    /*
     * 前一版就是正式發布版 → 沒有未發布候選區間。
     * ⚠️ 一定要印出來，安靜跳過就等於把這一條悄悄關掉。
     */
    console.log(
      `  ℹ️ v2.20.${LAST_RELEASED} 已正式發布，本版直接建在它之上，` +
        "沒有「未發布候選區間」可寫——改成要求三份現況文件寫明前一正式版是哪一版。",
    );
    for (const name of ["README.md", `VALIDATION_v${shown}.md`, "PROJECT_HANDOFF.md"]) {
      if (!existsSync(join(here, name))) continue;
      ok(
        `${name} 要寫明前一正式版是 v2.20.${LAST_RELEASED}`,
        new RegExp(`前一正式版[：:]\\s*\`?v2\\.20\\.${LAST_RELEASED}\`?`).test(read(name)),
        "現況文件要講清楚這一包是建在哪一個已發布版本之上",
      );
    }
  } else
  for (const name of ["README.md", `VALIDATION_v${shown}.md`, "PROJECT_HANDOFF.md"]) {
    if (!existsSync(join(here, name))) continue;
    ok(
      `${name} 有一句把未發布候選區間寫到本版前一版（v2.20.69～.${wantTo}，共 ${wantCount} 個）`,
      current.has(name),
      "這一份講的是「目前狀態」，區間停在更早的版本就等於在說舊話",
    );
  }
}

// 13) 文件寫「某支測試 N 條」時，N 必須等於那支檔案裡 test() 的數量
/*
 * ⚠️ 2026-09-25 第六輪抓到：兩份文件都寫「issue-ack-stability.test.mjs（8 條）」，
 *   實際 10 條。這種數字沒有人會回去數，但它是讀者判斷「守門夠不夠」的依據。
 *   既然數得出來，就不可以用手打。
 */
{
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  let seen = 0;
  for (const name of [
    "README.md",
    `VALIDATION_v${shown}.md`,
    "PROJECT_HANDOFF.md",
    "【更新說明】請先讀我.txt",
  ]) {
    if (!existsSync(join(here, name))) continue;
    const text = read(name);
    /*
     * 兩種寫法都要抓：
     *   ・`xxx.test.mjs`（N 條）        → N 必須是**現在**的條數
     *   ・`xxx.test.mjs`（當時 N 條，現為 M 條） → **M** 必須是現在的條數
     *
     * ⚠️ 第二種是刻意保留的：歷史段落寫的是「那一版新增時有幾條」，
     *   把它改成今天的數字等於**偽造當時的紀錄**（這一組系統自己定的規則：
     *   歷史段落要加向前指標，不是改掉）。2026-09-25 第六輪第一版只抓第一種，
     *   於是我把兩處歷史數字改成了今天的值——那是竄改紀錄，已還原並改成這個寫法。
     */
    for (const m of text.matchAll(
      /([A-Za-z0-9-]+\.test\.mjs)`?）?（(?:當時\s*[0-9一二三四五六七八九十]+\s*條[，,]\s*現為\s*)?([0-9一二三四五六七八九十]+)\s*條/g,
    )) {
      const [, file, raw] = m;
      if (!existsSync(join(here, file))) {
        ok(`${name} 提到的 ${file} 在包裡找得到`, false, "找不到這個檔案");
        continue;
      }
      /* 只數真的會跑的 test(...)：註解裡寫到 test( 的不算。 */
      const body = readFileSync(join(here, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
      const real = (body.match(/^\s*test\(/gm) || []).length;
      seen += 1;
      ok(
        `${name} 寫的「${file}（${raw} 條）」與實際條數相符`,
        (CJK[raw] ?? Number(raw)) === real,
        `寫 ${raw} 條，實際 ${real} 條`,
      );
    }
  }
  /* 前置檢查：格式改掉之後不可以安靜地變成恆真。 */
  ok("找得到「某支 .test.mjs（N 條）」這種句子", seen >= 1, `只抓到 ${seen} 句`);
}

// 14) 「「XXX」這 N 個字」的 N 必須等於引號裡的字數
/*
 * ⚠️ 2026-09-25 第六輪抓到：驗證報告寫「重點路段總覽」…「這五個字」，
 *   而它指的「優先處理清單」是六個字。一句話裡同時出現引號與字數時，
 *   字數是可以當場數的——數得出來就不可以寫錯。
 */
{
  let seen = 0;
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  for (const name of [
    "README.md",
    `VALIDATION_v${shown}.md`,
    "PROJECT_HANDOFF.md",
    "【更新說明】請先讀我.txt",
  ]) {
    if (!existsSync(join(here, name))) continue;
    for (const m of read(name).matchAll(
      /「([^」\n]{1,20})」[^。\n]{0,6}?這([0-9一二三四五六七八九十]+)個字/g,
    )) {
      const [, quoted, raw] = m;
      const want = [...quoted.replace(/\*\*/g, "")].length;
      seen += 1;
      ok(
        `${name}：「${quoted}」這${raw}個字`,
        (CJK[raw] ?? Number(raw)) === want,
        `寫 ${raw} 個字，「${quoted}」實際 ${want} 個字`,
      );
    }
  }
  ok("找得到「「XXX」這 N 個字」這種句子", seen >= 1, `只抓到 ${seen} 句`);
}

// 15) 驗證報告寫的手冊頁數／字元數，在有 pdftotext 的環境裡當場重算
/*
 * ⚠️ 2026-09-25 第六輪抓到：報告寫「27 頁 / 20,878 字元（NFKC 後）」，
 *   而那個字數用任何一種算法都重現不出來（raw 21,428、NFKC 21,442、
 *   NFKC 去空白 19,110）。**沒有人能重算的數字，寫了等於沒寫**，
 *   而讀的人會拿它當「我手上這一本是不是同一本」的依據。
 *
 * ⚠️ 這一條**不可以在沒有 pdftotext 的環境裡變紅**：複查者的機器不一定有
 *   poppler-utils，在正確的包上紅比沒有守門更糟（這一組系統已經踩過三次）。
 *   所以缺工具時跳過並**印出為什麼跳過**——不是安靜過去。
 */
{
  const validation = existsSync(join(here, `VALIDATION_v${shown}.md`))
    ? read(`VALIDATION_v${shown}.md`)
    : "";
  /*
   * ⚠️ 只看**本版那一節**（2026-09-27 加）。
   *   VALIDATION 是逐版累積的；本版那一節一旦沒寫「N 頁 / M 字元」，
   *   原本的整檔 match 會往下抓到**歷史版本**那一列，拿舊數字去比對新 PDF。
   *   姊妹系統全日交通量當天就是這樣紅的（抓到上一版的 33 頁去比 34 頁的 PDF），
   *   紅得對，但訊息把人帶往「PDF 錯了」。
   */
  const sectionStart = validation.search(
    new RegExp(`^##\\s*v${shown.replace(/\./g, "\\.")}(?![\\d.])`, "m"),
  );
  const sectionText =
    sectionStart >= 0
      ? (() => {
          const rest = validation.slice(sectionStart + 3);
          const next = rest.search(/^##\s+v[\d.]/m);
          return next >= 0 ? rest.slice(0, next) : rest;
        })()
      : "";
  const claim = sectionText.match(
    /\*\*(\d+) 頁 \/ ([\d,]+) 字元\*\*/,
  );
  ok(
    `驗證報告的「## v${shown}」那一節寫得出手冊的頁數與字元數`,
    Boolean(claim),
    claim ? claim[0] : "本版那一節裡找不到「**N 頁 / M 字元**」",
  );
  const pdfDir = join(here, "manuals");
  const pdf = existsSync(pdfDir)
    ? readdirSync(pdfDir).find((n) => n.endsWith(".pdf"))
    : null;
  if (claim && pdf) {
    const path = join(pdfDir, pdf);
    let tools = true;
    let pages = null;
    let chars = null;
    try {
      pages = Number(
        execFileSync("pdfinfo", [path], { encoding: "utf8" }).match(/^Pages:\s+(\d+)/m)?.[1],
      );
      const text = execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      /*
       * ⚠️ 先把換行統一成 LF 再數（2026-09-27 加）。
       *   Windows 的 poppler 輸出 CRLF，同一份 PDF 會多出「行數」那麼多個字元
       *  （實測本版手冊：不正規化 26,330 vs 28,186，差值剛好等於行數）。
       *   不統一換行，這個數字換一台機器就對不上，而每一次對不上都會有人
       *   把數字改成自己那一台的值——這一條守門就是為了擋那件事。
       */
      chars = [...text.replace(/\r\n?/g, "\n").normalize("NFKC")].length;
    } catch {
      tools = false;
    }
    if (!tools) {
      console.log(
        "  ℹ️ 這台機器沒有 pdfinfo／pdftotext（poppler-utils），" +
          "跳過手冊頁數與字元數的重算比對——這不是失敗，是這個環境算不了。",
      );
    } else {
      ok(`驗證報告寫的手冊頁數（${claim[1]} 頁）與 PDF 相符`, pages === Number(claim[1]), `實際 ${pages} 頁`);
      ok(
        `驗證報告寫的手冊字元數（${claim[2]}）與 PDF 相符`,
        chars === Number(claim[2].replace(/,/g, "")),
        `實際 ${chars}（換行統一為 LF、NFKC 後、含空白）`,
      );
    }
  }
}

console.log(
  problems.length ? `\n❌ 有問題：\n- ${problems.join("\n- ")}` : "\n全部通過",
);
process.exit(problems.length ? 1 : 0);
