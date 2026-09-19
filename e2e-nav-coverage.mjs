/*
 * ══════════════════════════════════════════════════════════════════════
 *  盤點：每一個大分頁底下「該有」幾個小分頁，實際列了幾個
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「大分頁下面有小分頁（例如各種圖的名稱作為小分頁
 * 名稱）……利用大小分頁讓人知道各種圖、功能分別在哪。」
 *
 * ⚠️ e2e-nav-sections 驗的是「**列出來的**點得到、框得起來、字比較小」。
 *   它驗不到「該列的有沒有漏列」——一頁有七塊、一項都沒列，照樣全綠。
 *   2026-09-13 逐頁盤點就是這樣抓到：路段管理 7 塊、資料維護 5 塊、
 *   成果交付 2 塊、新手說明 12 塊，全部一項都沒有。
 *
 * 判定「一塊」：目前這一頁裡有自己標題（h2／h3／summary）、
 * 而且畫得出高度的最外層 .panel／.chart-grid。
 *
 * 有落差就紅。要嘛補上小分頁，要嘛列進 NO_BLOCKS（那一頁畫面上本來就
 * 沒有可列的區塊）——兩種都要留下決定，新加一頁時才不會默默漏掉。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
const server = createServer((req,res)=>{const p=join(here,decodeURIComponent(req.url.split("?")[0]).replace(/^\//,"")||"index.html");
 if(!existsSync(p)||!p.startsWith(here)){res.writeHead(404).end("nf");return;}
 res.writeHead(200,{"content-type":TYPES[extname(p)]||"application/octet-stream"});res.end(readFileSync(p));});
await new Promise((ok)=>server.listen(0,ok));
const base=`http://127.0.0.1:${server.address().port}/`;
/*
 * 這幾頁畫面上沒有「有標題的獨立區塊」可列（整頁就是一張大表或一段流程），
 * 所以小分頁是 0。⚠️ 之後若長出區塊，下面會紅——那時要補小分頁，不是加名單。
 */
/*
 * ⚠️ X-62（2026-09-17）：「LOS 圖表」這一頁已經拆成四個大分頁。
 *   那四頁各自只有一塊，而且那一塊就叫這個大分頁的名字，
 *   依 sectionsFor 的規則**刻意不列**小分頁（同一個字兩層是噪音），
 *   所以它們也屬於「小分頁是 0」這一類——但理由與其他幾頁不同，
 *   寫在這裡以免下一個人以為是漏做。
 */
const NO_BLOCKS = new Set([
  "操作首頁",
  "匯入紀錄",
  "尖峰明細",
  "結論草稿",
  "各路段 LOS 圖",
  "各路段歷季旅行速率",
  "歷季趨勢（可勾選指標）",
  "三段分法（順暢／尚可／壅塞）",
]);
const problems = [];
const browser=await chromium.launch(launchOptions());
const page=await (await browser.newContext({viewport:{width:1500,height:1000}})).newPage();
page.on("dialog",(d)=>d.accept());
await page.goto(base,{waitUntil:"networkidle"});
await page.waitForTimeout(800);
const views=await page.evaluate(()=>[...document.querySelectorAll("nav button[data-view]")].map((b)=>({v:b.dataset.view,t:(b.textContent||"").trim()})));
console.log("大分頁".padEnd(16),"小分頁","畫面區塊");
for(const {v,t} of views){
  await page.locator(`nav button[data-view="${v}"]`).click();
  await page.waitForTimeout(450);
  const info=await page.evaluate(()=>{
    const listed=[...document.querySelectorAll(".nav-section")].map((e)=>(e.textContent||"").trim());
    const blocks=[];
    const view=document.querySelector(".view.active");
    const scope=view||document;
    const mislabelled=[];
    for(const el of document.querySelectorAll("[data-nav-skip='explanation']")){
      const interactive=el.querySelectorAll("button, input, select, textarea, table, a[download]").length;
      if(interactive)mislabelled.push(`${(el.querySelector("h2, h3")?.textContent||el.id||"?").trim().slice(0,20)}（有 ${interactive} 個可操作元素）`);
    }
    for(const el of scope.querySelectorAll(".panel, .chart-grid, .road-admin-grid > .panel")){
      if(el.parentElement?.closest(".panel"))continue;
      /*
       * ⚠️ 純說明的區塊刻意不列（使用者 2026-09-13）。
       *   標記名不副實時上面那一段會抓出來——不讓它變成萬用貼紙。
       */
      if(el.closest("[data-nav-skip='explanation']"))continue;
      const h=el.querySelector(":scope > .panel-head h3, :scope > .panel-head h2, :scope > h3, :scope > h2, :scope > summary");
      if(!h)continue;
      if(el.getBoundingClientRect().height<20)continue;
      blocks.push((h.textContent||"").replace(/\s+/g," ").trim().slice(0,26));
    }
    const skipped=[...scope.querySelectorAll("[data-nav-skip='explanation'] .panel, [data-nav-skip='explanation']")].filter((el)=>el.querySelector(":scope > h2, :scope > h3, :scope > .panel-head h3")).length;
    /*
     * ⚠️ **沒有標題的區塊，這支守門原本完全看不到。**
     *
     * 使用者 2026-09-13 回報：「路段速限本身也是一個功能視窗，但沒有對應的小分頁……
     *   想回到最上面的路段速限設定，只能往上滑畫面」。
     * 成因是那一塊沒有標題，而 sectionsFor() 是靠標題認區塊的——
     * 於是它既不會被列成小分頁，也不會被算進 blocks，
     * 上面那條「有幾塊就要列幾個」永遠看不出少了它。
     *
     * 所以這裡另外盤點：有內容（高度夠）卻沒有標題的頂層面板，一律報出來。
     * 空的容器（高度 0，例如還沒匯入資料的圖表容器）不算。
     */
    const untitled=[];
    for(const el of scope.querySelectorAll(".panel")){
      if(el.parentElement?.closest(".panel"))continue;
      if(el.closest("[data-nav-skip='explanation']"))continue;
      if(el.getBoundingClientRect().height<60)continue;
      if(el.classList.contains("empty-block"))continue;
      if(el.querySelector(":scope > .panel-head h3, :scope > .panel-head h2, :scope > h3, :scope > h2, :scope > summary"))continue;
      /*
       * ⚠️ 已經有小分頁指著它的不算（NAV_SECTIONS 手寫的那幾條就是這種：
       *   區塊沒有標題，但清單上給了名字）。那種情況跳得回去，不是問題。
       */
      if(el.id && listed.length && [...document.querySelectorAll(".nav-section")].some((n)=>n.dataset.anchor===el.id))continue;
      untitled.push((el.textContent||"").replace(/\s+/g," ").trim().slice(0,24));
    }
    return {listed,blocks:[...new Set(blocks)],mislabelled,skipped,untitled};
  });
  /*
   * ⚠️ 只在**這一頁已經有小分頁**時才報。
   *   整頁只有一塊的頁面（尖峰明細、匯入紀錄…）沒有「跳走就回不來」的問題，
   *   點大分頁本來就到得了；報出來只會變成噪音，而噪音會讓人開始無視這支守門。
   *   使用者回報的正是「有小分頁、但最上面那一塊不在裡面」這一種。
   */
  if(info.listed.length)
    for(const item of info.untitled ?? [])
      problems.push(`${t}：有小分頁，但最上面那一塊沒有標題（「${item}…」）所以不在清單裡——跳走之後回不去。請給它一個標題`);
  for(const item of info.mislabelled ?? [])
    problems.push(`${t}：「${item}」被標成「純說明」，但它有可操作的元素——標記名不副實`);
  const missing=info.blocks.filter(b=>!info.listed.some(l=>l.includes(b)||b.includes(l)||b.startsWith(l.replace(/…$/,""))));
  console.log(t.padEnd(16), String(info.listed.length).padEnd(6), String(info.blocks.length).padEnd(4), missing.length?"⚠️ 少 "+missing.length+"："+missing.join("、").slice(0,70):"");
  if(missing.length) problems.push(`${t}：畫面上有「${missing.join("、")}」，側欄沒有列出來`);
  if(NO_BLOCKS.has(t) && info.blocks.length) problems.push(`${t}：已列在「沒有可列區塊」的名單裡，畫面上卻有 ${info.blocks.length} 塊——請補小分頁或把它移出名單`);
  /*
   * ⚠️ 新手說明整頁都是純說明文字，使用者 2026-09-13 指定**一個小分頁都不要列**：
   *   「新手使用說明全部小分頁都是說明用的文字，依照我們說好的，
   *     這類不用做成左側小分頁」。
   *
   * ⚠️ 但「0 個小分頁」有兩種可能：標記生效（對），或整頁沒長出來（錯）。
   *   所以同時要求它**真的有被標記跳過的區塊**——實測 12 塊。
   *   哪天手冊沒渲染出來，這一條會紅而不是安靜地通過。
   */
  if(t==="新手說明"){
    if(info.listed.length!==0) problems.push(`新手說明：純說明頁不可以列小分頁，現在列了 ${info.listed.length} 個`);
    if(!(info.skipped>=10)) problems.push(`新手說明：被標記跳過的說明區塊只有 ${info.skipped} 塊——手冊可能沒渲染出來，「0 個小分頁」不算數`);
  }
}
await browser.close();server.close();
if(problems.length){
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for(const p of problems) console.error("  ・"+p);
  process.exit(1);
}
console.log("\n✅ 每一個大分頁底下，畫面上有幾塊就列得出幾個小分頁");
