/*
 * 產生「一個檔案就能用」的試用版 HTML。
 *
 * 使用者的測試流程是：收到一個 .html → 點兩下用瀏覽器開 → 直接操作。
 * 不架伺服器、不解壓縮，所以 JS 與 CSS 一定要整段塞進 HTML 裡。
 *
 * ⚠️ 這支只做「內嵌」，不做任何功能上的取捨——試用版與正式版是同一份程式，
 *   否則使用者試過沒問題的東西，發布之後可能不一樣。
 *
 * ⚠️ 內嵌完一定要檢查**沒有任何剩下的外部參照**。
 *   漏一個 <script src> 在 file:// 下不會報錯給使用者看，
 *   畫面照樣長出來，只是某個功能默默沒反應——最難查的那種。
 *   所以下面有硬性檢查，發現殘留就直接失敗，不產檔。
 *
 * ⚠️ **載入順序不可以動**。這一支不是模組化的：app.js 依賴 period-date.js
 *   先掛上 window，conclusion.js 又要在 app.js 之後才綁得到按鈕。
 *   內嵌時照 index.html 裡出現的順序逐一取代，就不會改變順序——
 *   千萬不要改成「先收集再一次塞到最後」。
 *
 * （另外兩支是 Vite 專案，走各自的 scripts/build-tryout.mjs；
 *   這一支是純靜態檔，所以自己來。三支產出的檔名格式一致。）
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "index.html");
let html = readFileSync(indexPath, "utf8");

/** 版本號以畫面上顯示的那一個為準（check-version.mjs 釘著它與各檔一致）。 */
const version =
  /v(\d+\.\d+\.\d+)/.exec(readFileSync(join(here, "app.js"), "utf8"))?.[1] ||
  /v(\d+\.\d+\.\d+)/.exec(html)?.[1];
if (!version) throw new Error("讀不出版本號，不產檔（檔名會對不上）");

const readLocal = (file) => {
  /* index.html 的參照都帶著 ?v=… 快取字串，要先切掉才找得到檔案。 */
  const clean = file.split("?")[0].replace(/^\.\//, "");
  const full = join(here, clean);
  if (!existsSync(full)) throw new Error(`找不到要內嵌的 ${clean}`);
  return readFileSync(full, "utf8");
};

html = html.replace(
  /<script[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g,
  (whole, file) => {
    const code = readLocal(file);
    /*
     * ⚠️ 程式碼裡若出現 </script> 會提前結束標籤。
     *   用 <\/script 取代是 JS 字面值裡合法的寫法，行為完全相同。
     */
    return `<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`;
  },
);

html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (whole, file) => `<style>${readLocal(file)}</style>`,
);

/*
 * ── 手冊 PDF：放成**同資料夾的獨立檔**，不再嵌進 HTML ──────────────
 *
 * ⚠️ 「下載完整新手手冊 PDF」那顆按鈕的 href 是 ./manuals/…pdf。
 *   單檔試用版沒有那個資料夾，按下去在 file:// 下**不會有任何錯誤訊息**，
 *   畫面毫無反應——使用者只會覺得按鈕壞了。所以一定要處理，不可以放著。
 *
 * ── 為什麼從「嵌成 data URI」改成「同資料夾的獨立檔」（2026-09-16）──
 *
 * 使用者回報「試用檔不像以前那樣立刻開起，要等 1～2 秒、滑鼠還會轉圈」。
 * 實測（headless Chromium，各量 7 次取平均）：
 *
 *   程式        內嵌手冊      拿掉手冊     DOMInteractive
 *   交通服務水準  4.76 MB  →  1.39 MB      371ms → 212ms（−43%）
 *   路口轉向     4.69 MB  →  1.91 MB      266ms → 151ms（−43%）
 *   全日交通量   5.64 MB  →  2.19 MB      318ms → 161ms（−49%）
 *
 * 手冊 PDF 佔了整個試用版的 **59～71%**。使用者的機器比這裡慢，同樣的比例
 * 就是他看到的那 1～2 秒。使用者 2026-09-16 裁示：手冊改成同資料夾的獨立檔。
 *
 * ⚠️ 也試過「把 base64 搬到非 JS 的 <script> 區塊」——實測**沒有用**
 *   （三支互有增減，在雜訊範圍內）。成本來自**檔案大小**本身，
 *   不是 base64 放在哪裡。記下來免得有人再試一次。
 *
 * ⚠️ 代價要講清楚：試用版不再是「只有一個檔」。HTML 被單獨搬走時手冊
 *   就開不了，所以按鈕上的字要先講明白（見下面那一段）。
 *
 * 這個連結是在 app.js 裡動態組出來的，所以要對**內嵌之後的整份 HTML**
 * 取代，不是只看 index.html。
 */
const manualLink = /\.\/manuals\/([^"']+\.pdf)/g;
/** 這一次要跟著 HTML 一起交出去的手冊檔名（給下面的搬檔與檢查用）。 */
const manualFiles = new Set();
html = html.replace(manualLink, (whole, file) => {
  const name = decodeURIComponent(file);
  const full = join(here, "manuals", name);
  if (!existsSync(full)) throw new Error(`找不到要交付的手冊 ${name}`);
  manualFiles.add(name);
  /* 同一個資料夾，所以是 ./檔名，沒有 manuals/ 這一層。 */
  return "./" + file;
});
/*
 * ⚠️ 一次都沒命中就代表「手冊按鈕不見了」或 href 改了寫法——兩種都要停下來，
 *   否則這一段會安靜地變成恆真的裝飾，而試用版又會出現一顆按了沒反應的按鈕。
 */
if (!manualFiles.size)
  throw new Error(
    "找不到任何手冊連結。手冊按鈕被拿掉了，或 href 的寫法變了；不可以就這樣出檔。",
  );
/*
 * ⚠️ 按鈕上的字要**先講**手冊是獨立檔。
 *   使用者只把 HTML 複製到別處時，按下去會開不了——那時候才發現就太晚了。
 */
/*
 * ⚠️ 使用者 2026-09-16：「這個按鈕的名稱太長了，括號內的文字不需要」。
 *   提醒改掛在按鈕的 title（滑鼠移上去才顯示），版面不再被那一長串佔掉。
 *   這裡只**確認按鈕還在**，不再改寫文字。
 */
const manualLabel = ">下載新手手冊<";
if (!html.includes(manualLabel))
  throw new Error(
    "找不到手冊按鈕（>下載新手手冊<）；按鈕文字改過了就要一起更新這裡。",
  );

/*
 * ── 往外連線：試用版一個都不可以有 ───────────────────────────────
 *
 * ⚠️ 2026-09-12 在路口轉向實測抓到：內嵌完的 CSS 第一行仍然是
 *     @import 後面直接接 fonts.googleapis.com 的網址
 *   下面那一段「殘留外部參照」的檢查看不到它——它只找 `./` 與 `assets/`
 *   開頭的相對路徑，而那是一個絕對網址，而且在 CSS 裡、不是 src/href。
 *   後果：使用者拿到「單檔、點兩下就能用」的試用版，開啟時卻靜靜地連一次
 *   網路；沒有網路（或公司擋掉）時字型退回備援，畫面和我驗過的不一樣，
 *   而且沒有任何訊息。
 *
 *   這一支目前沒有這種參照，但**三支要用同一道關卡**（使用者：
 *   「我們踩過的雷，請確保三份程式都不會再踩到」），所以一併補上。
 *
 * ⚠️ 只找瀏覽器真的會去抓的那幾種寫法（標籤的 src/href、CSS 的 url()）。
 *   不可以放寬成「出現 http 就算」——xlsx 那個函式庫裡滿滿都是
 *   XML 命名空間網址字串，那些不會發出任何請求，寬鬆比對會全部誤判，
 *   然後人就會把這條整個關掉，等於沒守。
 */
const external = [
  ...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/g),
  ...html.matchAll(/@import\s+(?:url\(\s*)?["'](https?:\/\/[^"']+)["']/g),
].map((m) => m[1]);
if (external.length)
  throw new Error(
    "試用版還會往外連線，離線或公司網路擋掉時會靜靜地不一樣：\n  " +
      [...new Set(external)].join("\n  "),
  );

/* ── 硬性檢查：不可以有任何剩下的外部參照 ───────────────────── */
const leftovers = [
  ...html.matchAll(/(?:src|href)="(\.\/[^"]+|(?!https?:|data:|#)[^":]+\.(?:js|css))"/g),
  /*
   * ⚠️ 上面那一條只看 HTML 屬性；打包後寫在 JS 字面值裡的相對路徑一律漏掉。
   *   2026-09-14 在另外兩支實測抓到：手冊那顆「下載 PDF」的 href 是在 JS
   *   裡組出來的相對路徑，這條檢查看不到，於是試用版出貨時帶著一顆
   *   按了沒反應的按鈕（file:// 下連錯誤訊息都沒有）。
   *   本支早就把手冊嵌成 data URI 所以沒踩到，但**三支要用同一道關卡**
   *  （使用者：「我們踩過的雷，請確保三份程式都不會再踩到」）。
   *   副檔名限定在使用者會按下去下載的那幾種，不放寬成「出現 ./ 就算」
   *   ——函式庫裡的模組路徑會全部誤判，然後人就會把這條整個關掉。
   */
  ...html.matchAll(
    /["'`](\.{0,2}\/[^"'`<>]*\.(?:pdf|docx|xlsx|csv|zip))["'`]/gi,
  ),
]
  .map((m) => m[1])
  /*
   * ⚠️ 手冊是**刻意**留成同資料夾的相對路徑（2026-09-16 使用者裁示），
   *   所以放行——但只放行「這一次真的會跟著交出去的那幾個檔名」，
   *   不是放行所有 .pdf。寫成 `./*.pdf` 都放行的話，
   *   日後任何一個忘了處理的 PDF 連結都會靜靜地溜過去。
   */
  .filter((ref) => !manualFiles.has(decodeURIComponent(ref.replace(/^\.\//, ""))));
if (leftovers.length)
  throw new Error(
    "試用版還有沒內嵌的外部檔案，單檔開啟時會默默失效：\n  " +
      [...new Set(leftovers)].join("\n  "),
  );

const outDir = join(here, "..", "out");
mkdirSync(outDir, { recursive: true });
/*
 * ── 大小上限：3 MB ──────────────────────────────────────────────
 *
 * ⚠️ 這不是潔癖，是使用者實際回報的問題（2026-09-16）：
 *   「試用檔不像以前那樣立刻開起，要等 1～2 秒、滑鼠指標還會出現轉圈」。
 *   原因是程式手冊 PDF 被整份嵌進 HTML，三支各佔 59～71% 的體積。
 *   實測拿掉之後 DOMInteractive 少 43～49%。
 *
 * ⚠️ 這一條擋的是**同一類錯再發生**：日後有人再把一個幾 MB 的東西
 *  （手冊、字型、範例檔、圖庫）整份塞進來時，出檔就會停下來，
 *   而不是等使用者發現「開檔變慢了」才回頭查。
 *
 * ⚠️ 真的需要放寬時，請連同**為什麼**一起改這個數字與這段註解。
 *   目前三支是 1.8～2.3 MB，3 MB 留了足夠的成長空間。
 */
const SIZE_LIMIT_MB = 3;
const sizeMb = Buffer.byteLength(html) / 1024 / 1024;
if (sizeMb > SIZE_LIMIT_MB)
  throw new Error(
    `試用版 ${sizeMb.toFixed(2)} MB，超過 ${SIZE_LIMIT_MB} MB 的上限。\n` +
      "  開檔會明顯變慢（使用者 2026-09-16 回報過一次）。\n" +
      "  多半是有東西被整份內嵌了（手冊、字型、範例檔…）；\n" +
      "  請改成放同資料夾的獨立檔，或先確認放寬上限是有意識的決定。",
  );

const out = join(outDir, `交通服務水準_試用版_v${version}.html`);
writeFileSync(out, html, "utf8");
/*
 * 手冊 PDF 要跟 HTML **放在一起**交出去，否則按鈕一樣是壞的。
 * ⚠️ 搬完要再確認一次真的在那裡：少了這一步，出檔會成功、按鈕會壞，
 *   而且要等使用者按下去才知道。
 */
for (const name of manualFiles) {
  const target = join(outDir, name);
  copyFileSync(join(here, "manuals", name), target);
  if (!existsSync(target)) throw new Error(`手冊沒有搬到交付資料夾：${name}`);
}
console.log(
  `試用版已產生：${out}\n  大小 ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB` +
    `・除了同資料夾的手冊（${[...manualFiles].join("、")}）之外沒有任何外部參照` +
    `\n  ⚠️ 手冊 PDF 要與 HTML 放在同一個資料夾一起交出去`,
);
