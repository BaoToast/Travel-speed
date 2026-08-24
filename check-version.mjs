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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const scripts = ["app.js", "quality-extension.js", "excel-export.js", "conclusion.js"];
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
const manualRefs = [...source.matchAll(/新手使用手冊_v(\d+\.\d+(?:\.\d+)?)\.(pdf|docx)/g)];
const manualVersions = [...new Set(manualRefs.map((m) => m[1]))];
ok(
  "程式裡引用的手冊版本一致且等於版本字樣",
  manualVersions.length === 1 && manualVersions[0] === shown,
  manualVersions.join("、"),
);
const manualDir = join(here, "manuals");
const manuals = existsSync(manualDir) ? readdirSync(manualDir) : [];
for (const [, version, ext] of manualRefs) {
  const name = `交通服務水準分析系統_新手使用手冊_v${version}.${ext}`;
  ok(`手冊檔案存在：${name}`, manuals.includes(name));
}
// 6) manuals 目錄不能留著別的版本（舊手冊會讓使用者下載到過期內容）
const strays = manuals.filter((n) => !n.includes(`_v${shown}.`));
ok("manuals 目錄沒有殘留舊版手冊", strays.length === 0, strays.join("、"));

// 7) 任何原始檔都不該再出現舊版號
const olderPattern = new RegExp(`v(?!${shown.replaceAll(".", "\\.")})\\d+\\.\\d+(?:\\.\\d+)?`, "g");
for (const name of [...scripts, "index.html"]) {
  const hits = [...read(name).matchAll(olderPattern)].map((m) => m[0]);
  const suspicious = [...new Set(hits)].filter((h) => /^v\d+\.\d+(?:\.\d+)?$/.test(h));
  ok(`${name} 沒有殘留其他版號`, suspicious.length === 0, suspicious.join("、"));
}

console.log(
  problems.length ? `\n❌ 有問題：\n- ${problems.join("\n- ")}` : "\n全部通過",
);
process.exit(problems.length ? 1 : 0);
