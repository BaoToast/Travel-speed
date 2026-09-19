/*
 * 同一版手冊在包裡的每一份副本，內容必須逐位元相同。
 *
 * ── 為什麼需要這一支 ──
 *
 * 手冊在包裡不只一份。以本包為例，同一個檔名同時存在於：
 *   ・建置來源（public/ 或 public/manuals/）——`build-pdf.mjs` 只寫這裡
 *   ・GitHub Pages 實際發布的位置（倉庫根目錄）——要另外複製過去
 *   ・建置產物（dist 與 github-pages 目錄）——建置時從來源複製
 *
 * 2026-09-03 清理手冊那一輪，實際發生的事情是：
 * 重新產生手冊只更新了 public/ 那一份，**根目錄那一份沒有跟著更新**，
 * 於是包裡同時存在新舊兩本手冊——而網站服務的是舊的那一本。
 * 當時根目錄的 PDF 還留著已經刪掉的「v2.1.0 已修正」等維護敘事，
 * 頁數也還停在清理前的數字。
 *
 * **原有的測試全部沒有抓到**：它們只確認 `public/` 底下檔案存在、
 * 檔名帶著本版版號、舊版號的檔案已刪除——每一項根目錄那份都通過，
 * 因為它的檔名一樣是本版版號，只是內容是舊的。
 * 「檔名對」不等於「內容對」，這一支補的就是這個缺口。
 *
 * ── 檢查方式 ──
 *
 * 掃出包裡所有符合本版檔名的手冊，逐一比對 SHA-256。
 * 只要有兩份不一樣就紅字，並印出各自的雜湊與位置。
 *
 * ── 2026-09-12：只出 PDF 之後，這一支的意義**重新定義**（不是刪掉） ──
 *
 * 使用者：「新手手冊只需要做 PDF 檔就好……三個程式都同步。」
 * 舊版這一支守的是「.docx 與 .pdf 各自的副本一致」。.docx 整個拿掉之後，
 * 如果只是把 docx 那幾行刪掉，覆蓋率會**默默變少一半**而沒有人發現。
 *
 * 所以改成守兩件事：
 *   ① PDF 的每一份副本仍然來自同一次產生（原本的用意，照舊）
 *   ② 包裡**不可以再出現任何 .docx 手冊**，畫面上也不可以再有 .docx 連結
 *      ——只刪檔案不守門的話，下次照舊樣板補回一顆「Word 版」按鈕，
 *      使用者按下去會下載到 404，而且沒有任何訊息。
 *
 * 注意：PDF 內嵌產生時間，所以「同樣的 HTML 產生兩次」也會得到不同位元組。
 * 這正是要求各副本必須來自**同一次產生**（用複製，不是各自重跑）的原因；
 * 各自重跑會踩紅這一支，那是刻意的——否則就分不出「重跑」與「忘了同步」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { manualBaseName, manualRelease } from "./manual-src/release.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".next", ".turbo", ".wrangler"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("包裡每一份手冊副本都必須來自同一次產生", () => {
  const base = manualBaseName(manualRelease());
  const files = walk(ROOT).filter((f) => basename(f) === base + ".pdf");
  assert.ok(
    files.length > 0,
    "包裡找不到任何本版手冊——升版時可能忘了重新產生，或檔名對不上。",
  );

  const byHash = new Map();
  for (const f of files) {
    const hash = createHash("sha256").update(readFileSync(f)).digest("hex");
    const key = "pdf:" + hash;
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push(relative(ROOT, f));
  }

  /* 只能有一個雜湊。 */
  for (const kind of ["pdf"]) {
    const groups = [...byHash.entries()].filter(([k]) => k.startsWith(kind + ":"));
    assert.ok(groups.length > 0, `包裡缺少本版 ${kind} 手冊。`);
    if (groups.length <= 1) continue;
    const detail = groups
      .map(([k, list]) => `  ${k.slice(kind.length + 1, kind.length + 13)}…  ${list.join("、")}`)
      .join("\n");
    assert.fail(
      `包裡有 ${groups.length} 種不同內容的 ${kind} 手冊——代表某一份沒有跟著更新，\n` +
        `而網站服務的可能正是舊的那一份（檔名一樣，所以其他測試看不出來）。\n` +
        `重新產生手冊之後，請把 public/ 產出的那一份複製到其他每一個位置。\n` +
        detail,
    );
  }
});

/*
 * ── 反面守門：只出 PDF 這件事要守得住 ──────────────────────────
 *
 * ⚠️ 沒有這一條，上面那一條在 .docx 被補回來時**照樣全綠**
 *   （它現在只看 .pdf），而我們會以為「只出 PDF」還成立。
 */
test("包裡不可以再出現 Word 手冊，畫面上也不可以再有 .docx 連結", () => {
  const docx = walk(ROOT)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(
    docx,
    [],
    `包裡還有 Word 檔：${docx.join("、")}——使用者指定三支程式都只出 PDF`,
  );

  const app = readFileSync(join(ROOT, "app.js"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  for (const [name, source] of [
    ["app.js", app],
    ["index.html", index],
  ]) {
    /* 註解裡寫「原本有一顆 .docx 按鈕」是允許的，實際的連結不行。 */
    const links = [...source.matchAll(/href="[^"]*\.docx[^"]*"/g)].map(
      (m) => m[0],
    );
    assert.deepEqual(
      links,
      [],
      `${name} 仍有 .docx 連結：${links.join("、")}——檔案已刪，按下去是 404`,
    );
  }

  /* 產生器也要真的不在了，否則下次 npm run manual 又會生出一份。 */
  assert.ok(
    !existsSync(join(ROOT, "manual-src", "build-docx.mjs")),
    "manual-src/build-docx.mjs 還在——它會再生出一本沒人維護的 Word 手冊",
  );
});
