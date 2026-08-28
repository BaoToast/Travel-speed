const DB = "TrafficLOSWebV2",
  STORE = "app",
  KEY = "state";
document.head.insertAdjacentHTML(
  "beforeend",
  "<style>.project-switch{margin-left:auto;margin-right:10px;max-width:310px;border:1px solid #dce5ea;border-radius:7px;background:#fff;padding:8px 10px;font:inherit;color:#17354d}@media(max-width:650px){.project-switch{max-width:145px}.blank-badge{display:none}}</style>",
);
const DEFAULT_LOS_RULE = { A: 0.8, B: 0.6, C: 0.5, D: 0.4, E: 0.2 };
const emptyState = () => ({
  version: 10,
  projects: [],
  activeCode: "",
  details: [],
  summaries: [],
  limits: {},
  limitConfirmed: {},
  aliases: {},
  roadMeta: {},
  speedVersions: {},
  anomalyRules: {},
  reportDrafts: {},
  operations: [],
  losRules: {},
  imports: [],
  last: { year: "", quarter: "2", time: "" },
  manager: [],
});
let state = emptyState(),
  pending = [],
  /**
   * 匯入預覽裡被勾選要「批次確認」的 pending 索引。
   * 宣告在這裡而不是靠近 UI，是因為 clearPendingPreview() 位置更前面；
   * let 在 TDZ 內連 typeof 都會丟例外，用 typeof 當防護是沒有用的。
   */
  roadPicks = new Set(),
  /** 預覽當下的民國年／季度／計畫，確認寫入時一律以這一份為準 */
  pendingContext = null,
  healthIssues = [];
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const num = (v) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },
  fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d).replace(/\.00$/, ""));
const activeProject = () => state.projects.find((p) => p.code === state.activeCode) || null;
function openDB() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
function isLegacyLosRule(x) {
  return x && x.A === 0.9 && x.B === 0.7 && x.C === 0.5 && x.D === 0.4 && x.E === 0.3;
}
function migrateLosRules() {
  state.losRules = state.losRules || {};
  state.roadMeta = state.roadMeta || {};
  state.limitConfirmed = state.limitConfirmed || {};
  state.speedVersions = state.speedVersions || {};
  state.anomalyRules = state.anomalyRules || {};
  state.reportDrafts = state.reportDrafts || {};
  state.operations = state.operations || [];
  // 只在「從舊版本升上來」時清掉那組舊預設值。舊版是看數值判斷，
  // 使用者若真的想用 A.9/B.7/C.5/D.4/E.3（這是實務上存在的門檻表），
  // 每次載入都會被當成舊資料清掉，整個計畫的服務水準悄悄變樣。
  if ((Number(state.version) || 0) < 10)
    for (const [code, rule] of Object.entries(state.losRules))
      if (isLegacyLosRule(rule)) delete state.losRules[code];
  state.version = 10;
}
async function load() {
  try {
    const db = await openDB();
    state = await new Promise((ok, no) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => ok(r.result || emptyState());
      r.onerror = () => no(r.error);
    });
    if (state.project && !state.projects) {
      state.projects = state.project.code ? [state.project] : [];
      state.activeCode = state.project.code;
      delete state.project;
    }
    state = { ...emptyState(), ...state };
    migrateLosRules();
    rebuild();
  } catch {
    state = emptyState();
  }
  renderAll();
}
// 存檔失敗（無痕模式、容量已滿、磁碟已滿）若無聲無息，
// 畫面看起來一切正常，實際上什麼都沒寫進去。這裡統一攔下來提醒使用者。
addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || String(event.reason || "");
  toast(`儲存失敗，這次的變更沒有寫入：${message || "請確認瀏覽器儲存空間"}`);
});
async function save() {
  const db = await openDB();
  await new Promise((ok, no) => {
    const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(state, KEY);
    r.onsuccess = () => ok();
    r.onerror = () => no(r.error);
  });
  renderAll();
}
function toast(t) {
  $("toast").textContent = t;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}
const titles = {
  home: "操作首頁",
  setup: "計畫設定",
  import: "尖峰批次匯入",
  detail: "尖峰明細",
  summary: "尖峰彙總",
  roadadmin: "路段管理",
  speed: "路段速限",
  charts: "LOS 圖表",
  conclusion: "結論草稿產生器",
  manager: "Manager 比較",
  importlog: "匯入紀錄",
  maintenance: "資料維護",
  backup: "備份與淨空",
  guide: "新手說明",
};
function go(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  $("headTitle").textContent = titles[id] || id;
  document.querySelector("aside").classList.remove("open");
  scrollTo(0, 0);
  if (id === "charts") renderCharts();
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => go(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
$("menu").onclick = () => document.querySelector("aside").classList.toggle("open");
document.querySelector(".brand small").textContent = "正式版 v2.20.13";
document.querySelector(".blank-badge").textContent = "瀏覽器本機資料庫";
const printGuide = document.createElement("button");
printGuide.className = "outline";
printGuide.textContent = "列印／另存 PDF";
document.querySelector("#guide .title").append(printGuide);
printGuide.onclick = () => window.print();
// 完整版新手使用手冊（PDF 與可編輯 Word），與網站一起發佈。
const manualLinks = document.createElement("div");
manualLinks.className = "manual-download";
manualLinks.innerHTML =
  '<a class="primary" href="./manuals/交通服務水準分析系統_新手使用手冊_v2.20.13.pdf" download>下載完整新手手冊 PDF</a>' +
  '<a class="outline" href="./manuals/交通服務水準分析系統_新手使用手冊_v2.20.13.docx" download title="可自行編輯的 Word 版本">Word 版</a>';
document.querySelector("#guide .title").append(manualLinks);
const manual = document.createElement("div");
manual.className = "manual";
manual.innerHTML = `<article class="panel manual-intro"><span class="eyebrow">完整工作流程</span><h2>Project 建置 → 資料檢查 → Manager 比較</h2><p>Project 是每位同事各自管理的計畫資料；Manager 只接收確認完成的 Project 專案包。兩者分開可避免尚未確認的資料被拿去跨計畫比較。</p></article><div class="manual-grid"><article class="panel"><h3>一、第一次建立 Project</h3><ol><li>進入「計畫設定」，輸入公司計畫編號與完整名稱。</li><li>按「儲存計畫設定」，並確認頁面上方中央顯示正確計畫。</li><li>同一位使用者可建立任意數量計畫，之後從上方選單切換。</li></ol></article><article class="panel"><h3>二、每一季度匯入</h3><ol><li>進入「尖峰批次匯入」，輸入民國年與季度。</li><li>一次選取同一季度的平日、假日 Excel。</li><li>按「讀取並預覽」；每份正常檔案應有4筆。</li><li>確認沒有錯誤或未確認新路段，再按「確認寫入尖峰明細」。</li></ol></article><article class="panel"><h3>三、速限與 LOS</h3><ol><li>進入「路段速限」，核對方向1、方向2的公告速限。</li><li>預設為50 km/h；快慢車道速限不同時，依實際調查車流所使用的道路／車道設定。</li><li>按「套用並重算 LOS」。</li><li>代表值先比較4筆LOS與速限比，再將同一筆紀錄的旅行速率、行駛速率及總延滯一起帶入。</li></ol></article><article class="panel"><h3>四、檢查與圖表判讀</h3><ul><li><b>尖峰明細：</b>查看每路段、日別、上午／下午及兩方向的原始4筆結果。</li><li><b>尖峰彙總：</b>查看每路段日別的最差代表紀錄。</li><li><b>LOS圖表：</b>每路段一張圖，比較歷季平日與假日變化。</li><li><b>資料維護：</b>檢查名稱、4筆資料組、平假日及數值完整性。</li></ul></article><article class="panel"><h3>五、資料錯誤時</h3><ul><li>剛完成的錯誤匯入：到「匯入紀錄」按復原。</li><li>整季需重做：到「資料維護」選擇季度，備份後刪除，再重新匯入。</li><li>路段名稱不一致：到「路段速限」使用「路段名稱修改／合併」。</li><li>疑似新路段：預覽時先判斷是新路段或名稱差異，不確定時不要寫入。</li></ul></article><article class="panel"><h3>六、同步到 Manager</h3><ol><li>確認Project健康檢查通過。</li><li>進入「備份與淨空」，下載目前Project專案包。</li><li>進入「Manager比較」，匯入該JSON專案包。</li><li>相同計畫編號會更新，不會重複新增。</li><li>選擇計畫、季度、日別或LOS，查看表格與全路段趨勢圖。</li></ol></article><article class="panel"><h3>七、多人協作方式</h3><p>每位同事在自己的瀏覽器管理任意數量Project，定期交付Project專案包。管理者把各同事的專案包匯入Manager，即可統一比較；彼此的Project原始資料不會互相覆蓋。</p></article><article class="panel"><h3>八、備份與安全</h3><ul><li>每完成一季，下載一次Project專案包。</li><li>換電腦、清除瀏覽器資料或瀏覽器重設前，一定要先備份。</li><li>資料儲存在目前瀏覽器；同一網址在另一台電腦開啟，不會自動看到本機資料。</li><li>專案包支援還原，也可交給Manager使用。</li></ul></article><article class="panel"><h3>九、舊版 Excel 相容</h3><p>支援 .xls、.xlsx、.xlsm，以及「上午尖峰／下午尖峰」、「上午／下午」、AM／PM與名稱前後空白。若顯示欄位缺值，先用Excel開啟原始檔、重新計算並儲存，再回網頁預覽。</p></article><article class="panel"><h3>十、每季完成檢核</h3><ol><li>每份檔案4筆且失敗0。</li><li>路段速限已核對並重算。</li><li>健康檢查三項為0。</li><li>彙總代表值三項數值來自同一筆。</li><li>圖表路段數正確。</li><li>已下載Project專案包並更新Manager。</li></ol></article></div>`;
document.querySelector("#guide .warning").before(manual);

// Manager is a separate local workspace. Project packages are imported explicitly.
const managerButton = document.createElement("button");
managerButton.dataset.view = "manager";
managerButton.textContent = "Manager 比較";
document.querySelector('nav button[data-view="charts"]').after(managerButton);
managerButton.onclick = () => go("manager");
const managerSection = document.createElement("section");
managerSection.id = "manager";
managerSection.className = "view";
managerSection.innerHTML = `<div class="title"><div><span class="eyebrow">MANAGER EDITION</span><h2>跨計畫比較</h2><p>由各同事匯出 Project 專案包，再由管理者匯入；相同計畫編號會更新，不會重複累加。</p></div><label class="primary upload">匯入 Project 專案包<input id="managerFiles" type="file" multiple accept=".json"></label></div><div class="metrics"><article><span>已載入計畫</span><b id="managerProjects">0</b><small>專案包</small></article><article><span>篩選後資料</span><b id="managerRecords">0</b><small>路段日別彙總</small></article><article><span>篩選後路段</span><b id="managerRoads">0</b><small>計畫內去除重複</small></article><article><span>資料期間</span><b id="managerPeriod">—</b><small>篩選結果</small></article></div><div class="panel"><div class="panel-head"><div><h3>已匯入 Project 專案包</h3><small>可個別移除，不影響同事原始 Project</small></div><button class="outline" id="clearManager">全部清除</button></div><div class="table-wrap"><table><thead><tr><th>計畫編號</th><th>計畫名稱</th><th>彙總筆數</th><th>匯入／更新時間</th><th>操作</th></tr></thead><tbody id="managerPackageRows"></tbody></table></div></div><div id="managerStaleHint" class="panel manager-stale hidden"></div><div class="panel manager-data"><div class="manager-filters"><select id="managerProjectFilter"><option value="">全部計畫</option></select><select id="managerPeriodFilter"><option value="">全部季度</option></select><select id="managerDayFilter"><option value="">全部日別</option><option>平日</option><option>假日</option></select><select id="managerLosFilter"><option value="">全部 LOS</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option><option>F</option></select><input id="managerSearch" placeholder="搜尋路段或計畫"><button class="outline" id="resetManagerFilters">清除篩選</button><button class="primary" id="exportManager">匯出篩選結果</button></div><div class="table-wrap"><table><thead><tr><th>計畫</th><th>期間</th><th>路段</th><th>日別</th><th>代表尖峰</th><th>方向</th><th>旅行速率</th><th>總延滯</th><th>LOS</th></tr></thead><tbody id="managerRows"></tbody></table></div></div><div class="title manager-chart-title"><div><span class="eyebrow">MANAGER CHARTS</span><h2>計畫全路段 LOS 趨勢</h2><p>先於上方選擇一個計畫，再依目前季度、日別及 LOS 篩選產生每路段一張圖。</p></div></div><div id="managerChartHint" class="panel empty-block">請先選擇一個計畫，避免一次載入過多圖表。</div><div id="managerChartGrid" class="chart-grid"></div>`;
document.querySelector("#backup").before(managerSection);
const projectSpeedTitle = document.createElement("div");
projectSpeedTitle.className = "title speed-chart-title";
projectSpeedTitle.innerHTML =
  '<div><span class="eyebrow">TRAVEL SPEED</span><h2>各路段歷季旅行速率</h2><p>每路段一張圖，平日與假日分色，數值單位為 km/h。</p></div><button class="primary" id="exportProjectCharts">匯出可編輯Excel圖表</button>';
const projectSpeedGrid = document.createElement("div");
projectSpeedGrid.id = "speedTrendGrid";
projectSpeedGrid.className = "chart-grid";
$("chartGrid").after(projectSpeedTitle, projectSpeedGrid);
const managerSpeedTitle = document.createElement("div");
managerSpeedTitle.className = "title speed-chart-title";
managerSpeedTitle.innerHTML =
  '<div><span class="eyebrow">TRAVEL SPEED</span><h2>計畫全路段旅行速率趨勢</h2><p>依上方Manager篩選條件，顯示各路段歷季旅行速率（km/h）。</p></div><button class="primary" id="exportManagerCharts">匯出篩選後Excel圖表</button>';
const managerSpeedGrid = document.createElement("div");
managerSpeedGrid.id = "managerSpeedTrendGrid";
managerSpeedGrid.className = "chart-grid";
$("managerChartGrid").after(managerSpeedTitle, managerSpeedGrid);
document
  .querySelector("#charts>.title")
  .insertAdjacentHTML(
    "beforeend",
    '<button class="primary" id="exportProjectLos">匯出可編輯LOS Excel圖表</button>',
  );
document
  .querySelector(".manager-chart-title")
  .insertAdjacentHTML(
    "beforeend",
    '<button class="primary" id="exportManagerLos">匯出篩選後LOS Excel圖表</button>',
  );
function setHeaders(selector, labels) {
  document.querySelectorAll(`${selector} thead th`).forEach((th, i) => {
    if (labels[i]) th.textContent = labels[i];
  });
}
setHeaders("#detail", [
  "期間",
  "路段",
  "日別",
  "尖峰",
  "方向",
  "旅行速率（km/h）",
  "行駛速率（km/h）",
  "總延滯（秒）",
  "速限（km/h）",
  "LOS",
]);
setHeaders("#summary", [
  "期間",
  "路段",
  "日別",
  "代表尖峰",
  "代表方向",
  "旅行速率（km/h）",
  "行駛速率（km/h）",
  "總延滯（秒）",
  "速限比",
  "LOS",
]);
setHeaders("#manager .manager-data", [
  "計畫",
  "期間",
  "路段",
  "日別",
  "代表尖峰",
  "方向",
  "旅行速率（km/h）",
  "總延滯（秒）",
  "LOS",
]);
$("exportProjectCharts").onclick = async () => {
  const p = activeProject(),
    rows = state.summaries.filter((x) => x.projectCode === state.activeCode);
  if (!p || !rows.length) return toast("目前計畫沒有可匯出的旅行速率資料");
  try {
    await exportTravelWorkbook(rows, `${p.code}_${p.name}_旅行速率趨勢圖.xlsx`);
    toast("可編輯Excel圖表已下載");
  } catch (e) {
    toast(e.message || "Excel匯出失敗");
  }
};
$("exportManagerCharts").onclick = async () => {
  const project = $("managerProjectFilter").value,
    rows = managerFilteredRows();
  if (!project) return toast("請先選擇一個計畫");
  if (!rows.length) return toast("目前篩選條件沒有可匯出資料");
  try {
    await exportTravelWorkbook(rows, `Manager_${project}_旅行速率趨勢圖.xlsx`);
    toast("Manager Excel圖表已下載");
  } catch (e) {
    toast(e.message || "Excel匯出失敗");
  }
};
$("exportProjectLos").onclick = async () => {
  const p = activeProject(),
    rows = state.summaries.filter((x) => x.projectCode === state.activeCode);
  if (!p || !rows.length) return toast("目前計畫沒有可匯出的LOS資料");
  try {
    await exportLosWorkbook(rows, `${p.code}_${p.name}_LOS趨勢圖.xlsx`);
    toast("可編輯LOS Excel圖表已下載");
  } catch (e) {
    toast(e.message || "LOS Excel匯出失敗");
  }
};
$("exportManagerLos").onclick = async () => {
  const project = $("managerProjectFilter").value,
    rows = managerFilteredRows();
  if (!project) return toast("請先選擇一個計畫");
  if (!rows.length) return toast("目前篩選條件沒有可匯出資料");
  try {
    await exportLosWorkbook(rows, `Manager_${project}_LOS趨勢圖.xlsx`);
    toast("Manager LOS Excel圖表已下載");
  } catch (e) {
    toast(e.message || "LOS Excel匯出失敗");
  }
};
const logButton = document.createElement("button");
logButton.dataset.view = "importlog";
logButton.textContent = "匯入紀錄";
document.querySelector('nav button[data-view="manager"]').after(logButton);
logButton.onclick = () => go("importlog");
const logSection = document.createElement("section");
logSection.id = "importlog";
logSection.className = "view";
logSection.innerHTML = `<div class="title"><div><span class="eyebrow">AUDIT & ROLLBACK</span><h2>匯入批次紀錄</h2><p>每次正式寫入都保留新增、更新、略過與復原資訊。</p></div></div><div class="panel"><div class="filters"><span id="importLogCount">0 個批次</span></div><div class="table-wrap"><table><thead><tr><th>匯入時間</th><th>計畫</th><th>期間</th><th>檔案</th><th>新增</th><th>更新</th><th>略過</th><th>狀態</th><th>操作</th></tr></thead><tbody id="importLogRows"></tbody></table></div></div>`;
document.querySelector("#backup").before(logSection);
const maintenanceButton = document.createElement("button");
maintenanceButton.dataset.view = "maintenance";
maintenanceButton.textContent = "資料維護";
document.querySelector('nav button[data-view="backup"]').before(maintenanceButton);
maintenanceButton.onclick = () => go("maintenance");
const maintenanceSection = document.createElement("section");
maintenanceSection.id = "maintenance";
maintenanceSection.className = "view";
maintenanceSection.innerHTML = `<div class="title"><div><span class="eyebrow">MAINTENANCE</span><h2>資料維護與健康檢查</h2><p>匯錯季度可整季刪除重匯；健康檢查只列出需要注意的資料。</p></div><button class="primary" id="runHealth">執行健康檢查</button></div><div class="two"><article class="panel form"><h3>刪除單一季度</h3><p class="muted">執行前會先下載目前 Project 專案包，刪除後可從匯入紀錄還原。</p><label>選擇季度<select id="deletePeriod"></select></label><div class="note" id="deleteImpact">目前沒有可刪除的季度</div><button class="danger-button full" id="deleteQuarter" disabled>備份後刪除此季度</button></article><article class="panel"><h3>健康檢查摘要</h3><div class="metrics compact"><article><span>異常名稱</span><b id="healthNames">0</b></article><article><span>資料組不完整</span><b id="healthGroups">0</b></article><article><span>數值異常</span><b id="healthValues">0</b></article></div><button class="outline full" id="cleanSuffix" disabled>備份後修正明顯日期尾碼</button></article></div><div class="panel health-panel"><div class="filters"><b>檢查結果</b><span id="healthCount">尚未檢查</span></div><div class="table-wrap"><table><thead><tr><th>類型</th><th>期間</th><th>路段／項目</th><th>說明</th></tr></thead><tbody id="healthRows"><tr><td colspan="4" class="empty">按「執行健康檢查」開始</td></tr></tbody></table></div></div>`;
document.querySelector("#backup").before(maintenanceSection);
const policyBox = document.createElement("label");
policyBox.style.display = "block";
policyBox.style.margin = "14px 0";
policyBox.innerHTML =
  '重複資料處理<select id="duplicatePolicy" style="width:100%;margin-top:6px;padding:10px;border:1px solid #cbd7dd;border-radius:6px"><option value="update">更新既有資料（建議）</option><option value="skip">略過既有資料</option></select>';
document.querySelector("#commit").before(policyBox);
const projectSwitch = document.createElement("select");
projectSwitch.id = "projectSwitch";
projectSwitch.className = "project-switch";
document.querySelector("header .blank-badge").before(projectSwitch);
function clearPendingPreview() {
  // 預覽結果只對「預覽當下的那個計畫」有效。切換計畫、刪除計畫或全部清除之後
  // 若還留著，按下確認寫入會把資料寫到別的計畫，甚至寫進已經不存在的計畫。
  pending = [];
  pendingContext = null;
  healthIssues = [];
  /*
   * healthChecked 也要跟著清掉。
   *
   * 舊版只清 healthIssues，healthChecked 仍是 true，於是切到一個從來沒檢查過
   * 的計畫時，健康檢查與品質總覽會顯示「檢查通過，未發現異常」「目前四項品質
   * 檢查均通過」——把「沒有檢查」講成「檢查過而且沒問題」，是這兩張表最不該
   * 出現的錯誤。
   */
  healthChecked = false;
  healthStale = false;
  roadPicks = new Set();
  if (typeof roadAlert !== "undefined") roadAlert.style.display = "none";
  if (typeof roadBatchBar !== "undefined") roadBatchBar.style.display = "none";
  if ($("commit")) $("commit").disabled = true;
}
projectSwitch.onchange = async () => {
  state.activeCode = projectSwitch.value;
  clearPendingPreview();
  await save();
  toast("已切換計畫");
};
const projectPicker = document.createElement("label");
projectPicker.innerHTML = '目前計畫<select id="projectPicker"></select>';
document.querySelector("#setup .form").prepend(projectPicker);
$("projectPicker").onchange = () => {
  const p = state.projects.find((x) => x.code === $("projectPicker").value);
  $("projectCode").value = p?.code || "";
  $("projectName").value = p?.name || "";
  renderProjectSetupActions();
};
// 刪除計畫的入口放在「計畫設定」，使用者要刪計畫時第一個就會找這裡。
const deleteProjectBtn = document.createElement("button");
deleteProjectBtn.id = "deleteProject";
deleteProjectBtn.className = "danger-button full";
deleteProjectBtn.style.marginTop = "10px";
deleteProjectBtn.textContent = "刪除這個計畫";
$("saveProject").after(deleteProjectBtn);
const deleteProjectHint = document.createElement("p");
deleteProjectHint.className = "muted";
deleteProjectHint.style.margin = "8px 0 0";
deleteProjectHint.textContent =
  "刪除會一併移除此計畫的所有季度資料、彙總、速限與別名；刪除前會自動下載一份專案包備份。";
deleteProjectBtn.after(deleteProjectHint);
function renderProjectSetupActions() {
  const code = ($("projectCode").value || "").trim();
  const exists = state.projects.some((x) => x.code === code);
  deleteProjectBtn.disabled = !exists;
  deleteProjectBtn.textContent = exists ? `刪除計畫「${code}」` : "刪除這個計畫";
  deleteProjectHint.style.display = exists ? "" : "none";
}
deleteProjectBtn.onclick = () => {
  const code = ($("projectCode").value || "").trim();
  if (!state.projects.some((x) => x.code === code)) return toast("這個計畫尚未建立，沒有東西可刪除");
  return deleteProjectFlow(code, { fromSetup: true });
};
$("projectCode").addEventListener("input", renderProjectSetupActions);
const previewHead = document
  .querySelector("#previewRows")
  .closest("table")
  .querySelector("thead tr");
previewHead.insertAdjacentHTML("beforeend", "<th>路段判定</th>");
const roadAlert = document.createElement("div");
roadAlert.id = "roadAlert";
roadAlert.className = "warning";
roadAlert.style.display = "none";
document.querySelector("#previewRows").closest(".table-wrap").before(roadAlert);
/**
 * 疑似新路段的「批次確認」列。
 *
 * 一次匯入十幾二十份檔案時，系統對每個沒見過的路段名稱都會要求確認，
 * 使用者卻通常一眼就知道這批全部都是新路段——逐列點開下拉選單選一次，
 * 純粹是重複勞動。這一列讓使用者勾選（或全選）之後一次處理完，
 * 剩下真的要合併的那幾筆再自己逐一指定。
 */
const roadBatchBar = document.createElement("div");
roadBatchBar.id = "roadBatchBar";
roadBatchBar.className = "road-batch-bar";
roadBatchBar.style.display = "none";
roadBatchBar.innerHTML =
  '<label class="pick-all"><input type="checkbox" id="pickAll"><span>全選待確認</span></label>' +
  '<span id="pickCount" class="pick-count">已勾選 0 筆</span>' +
  '<span class="pick-actions">' +
  '<button class="primary" id="pickAsNew" disabled>勾選的確認為新路段</button>' +
  '<select id="pickMergeTarget"></select>' +
  '<button class="outline" id="pickAsMerge" disabled>勾選的合併至此路段</button>' +
  "</span>";
document.querySelector("#previewRows").closest(".table-wrap").before(roadBatchBar);

const renameBtn = document.createElement("button");
renameBtn.className = "outline";
renameBtn.textContent = "路段名稱修改／合併";
document.querySelector("#speed .title").append(renameBtn);

const roadAdminButton = document.createElement("button");
roadAdminButton.dataset.view = "roadadmin";
roadAdminButton.textContent = "路段管理";
document.querySelector('nav button[data-view="speed"]').before(roadAdminButton);
roadAdminButton.onclick = () => go("roadadmin");
const roadAdminSection = document.createElement("section");
roadAdminSection.id = "roadadmin";
roadAdminSection.className = "view";
roadAdminSection.innerHTML = `<div class="title"><div><span class="eyebrow">ROAD DIRECTORY</span><h2>路段管理</h2><p>集中管理正式名稱、方向名稱、檔名別名與重複路段。合併前會先顯示影響範圍。</p></div><button class="outline" id="roadAdminBackup">下載合併前備份</button></div><div class="metrics compact road-metrics"><article><span>正式路段</span><b id="roadCount">0</b></article><article><span>檔名別名</span><b id="aliasCount">0</b></article><article><span>涵蓋季度</span><b id="roadPeriodCount">0</b></article></div><div class="road-admin-grid"><article class="panel form"><h3>修改正式名稱</h3><label>目前路段<select id="renameRoad"></select></label><label>新的正式名稱<input id="formalRoadName" placeholder="例如：中正一路（民族路～民權路）"></label><button class="primary full" id="previewRename">預覽修改影響</button></article><article class="panel form"><h3>方向顯示名稱</h3><label>路段<select id="directionRoad"></select></label><div class="row"><label>方向1名稱<input id="directionA" placeholder="例如：東→西"></label><label>方向2名稱<input id="directionB" placeholder="例如：西→東"></label></div><button class="primary full" id="saveDirections">儲存方向名稱</button></article><article class="panel form"><h3>設定檔名別名</h3><label>檔名中可能出現的名稱<input id="aliasName" placeholder="例如：中正路"></label><label>自動對應正式路段<select id="aliasTarget"></select></label><button class="primary full" id="addAlias">新增或更新別名</button></article><article class="panel form"><h3>合併重複路段</h3><label>來源路段<select id="mergeSource"></select></label><label>合併至<select id="mergeTarget"></select></label><button class="outline full" id="previewMerge">顯示合併影響</button></article></div><div id="roadImpact" class="panel impact-panel"><b>尚未預覽修改</b><p>請先選擇路段並按「預覽」，系統不會立即改動資料。</p><button class="danger-button" id="confirmRoadChange" disabled>備份後確認執行</button></div><div class="panel"><div class="panel-head"><div><h3>正式路段清冊</h3><small>方向名稱只改變顯示，不改變原始方向鍵值；命名後全站（明細、彙總、速限、Manager 比較、報告與結論草稿、CSV）都會改用新名稱。</small></div></div><div class="table-wrap"><table><thead><tr><th>正式路段</th><th>方向1</th><th>方向2</th><th>季度</th><th>明細筆數</th><th>別名數</th></tr></thead><tbody id="roadAdminRows"></tbody></table></div></div><div class="panel"><div class="panel-head"><div><h3>檔名別名清冊</h3><small>匯入時若檔名符合別名，會自動併入指定正式路段。</small></div></div><div class="table-wrap"><table><thead><tr><th>檔名別名</th><th>對應正式路段</th><th>操作</th></tr></thead><tbody id="aliasRows"></tbody></table></div></div>`;
document.querySelector("#speed").before(roadAdminSection);
const roadPeriodPanel = document.createElement("article");
roadPeriodPanel.className = "panel form road-period-panel";
roadPeriodPanel.innerHTML = `<h3>路段有效期間</h3><p class="muted">開始季度空白時採第一次出現的季度；停止季度空白代表持續調查至目前最新季度。</p><div class="three"><label>路段<select id="periodRoad"></select></label><label>開始季度<input id="roadStartPeriod" placeholder="例如：114Q1"></label><label>停止季度<input id="roadEndPeriod" placeholder="例如：115Q4；持續調查可留白"></label></div><button class="primary" id="saveRoadPeriod">儲存有效期間</button>`;
document.querySelector("#roadadmin .road-admin-grid").after(roadPeriodPanel);
const qualityPanel = document.createElement("div");
qualityPanel.className = "panel quality-panel";
qualityPanel.innerHTML = `<div class="panel-head"><div><h3>計畫資料品質總覽</h3><small>依路段有效期間檢查平假日、四筆尖峰方向、速限確認及相鄰季度異常變化。</small></div><span id="qualityShown" class="quality-shown">尚未檢查</span></div><div class="metrics compact quality-metrics"><article><span>缺少平假日</span><b id="qualityDay">0</b></article><article><span>缺少方向／尖峰</span><b id="qualityGroup">0</b></article><article><span>速限未確認</span><b id="qualitySpeed">0</b></article><article><span>異常變化</span><b id="qualityChange">0</b></article></div><div class="anomaly-filters"><div class="anomaly-filter-row"><label>起始季度<select id="qualityFrom"><option value="">不限</option></select></label><label>結束季度<select id="qualityTo"><option value="">不限</option></select></label><label>路段<select id="qualityRoad"><option value="">全部路段</option></select></label><label>日別<select id="qualityDayFilter"><option value="">全部日別</option><option value="平日">平日</option><option value="假日">假日</option></select></label></div><div class="anomaly-chips" id="qualityTypeChips"></div><p class="anomaly-hint">季度區間的語意是「比較區間有重疊就列出」：異常變化是相鄰兩季相比，選 114Q1～114Q4 時，113Q4→114Q1 也會出現——114Q1 被標成異常的原因就在那一次比較。所有篩選都遵循同一個原則：<b>與該維度無關的項目，任何選擇都會列出</b>（期間標「全部」的名稱與速限不受季度區間影響；沒有日別的項目不受日別影響）。<b>匯出與交付檔案一律輸出全部項目，不受這裡的篩選影響。</b></p></div><div class="table-wrap"><table><thead><tr><th>類型</th><th>期間</th><th>路段／項目</th><th>說明</th></tr></thead><tbody id="qualityRows"><tr><td colspan="4" class="empty">按「執行健康檢查」產生品質總覽</td></tr></tbody></table></div>`;
document.querySelector("#maintenance .health-panel").before(qualityPanel);
renameBtn.onclick = () => go("roadadmin");

function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[﹙（]/g, "(")
    .replace(/[﹚）]/g, ")")
    .replace(/[~〜∼]/g, "～")
    .replace(/[‐‑‒–—―－]/g, "-")
    .replace(/[，､]/g, ",")
    .replace(/[。．]/g, ".")
    .replace(/[：]/g, ":")
    .replace(/[；]/g, ";")
    .replace(/[／]/g, "/");
}
function stripRoadSuffix(s) {
  return normalize(s).replace(
    /[-－]?\(?\s*(平日|假日)\s*\)?(?:[-－]?(?:\d{2,3}(?:[.\-]\d{1,4}){1,2}|\d{4,8}))?$/,
    "",
  );
}
function roadFromFile(name) {
  let s = name.replace(/\.(xlsx?|xlsm)$/i, "");
  s = s.replace(/^\d+TS\d+-?\d+[-－]?/i, "");
  return stripRoadSuffix(s);
}
function dayFromFile(name) {
  return name.includes("假日") ? "假日" : "平日";
}
function editDistance(a, b) {
  a = normalize(a);
  b = normalize(b);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}
function closestRoad(road, roads) {
  let best = null;
  for (const x of roads) {
    const score =
      1 - editDistance(road, x) / Math.max(normalize(road).length, normalize(x).length, 1);
    if (!best || score > best.score) best = { road: x, score };
  }
  return best;
}
function existingRoads() {
  return [
    ...new Set(state.details.filter((d) => d.projectCode === state.activeCode).map((d) => d.road)),
  ];
}
function analyzeRoads() {
  const known = existingRoads(),
    seen = [...new Set(pending.filter((x) => x.ok).map((x) => x.road))],
    signatureMap = {};
  for (const road of known) (signatureMap[roadSignature(road)] ??= []).push(road);
  for (const item of pending) {
    item.roadChoice = "";
    item.originalRoad = item.road;
    item.matchType = "新路段";
    if (!item.ok) continue;
    if (known.includes(item.road)) {
      item.matchType = "完全相符";
      continue;
    }
    if (!known.length) continue;
    const alias = state.aliases[`${state.activeCode}|${normalize(item.road)}`];
    if (alias && known.includes(alias)) {
      item.roadChoice = alias;
      item.matchType = "別名相符";
      continue;
    }
    const sameSignature = signatureMap[roadSignature(item.road)] || [];
    if (sameSignature.length === 1) {
      item.roadChoice = sameSignature[0];
      item.matchType = "完全相符";
      continue;
    }
    const near = closestRoad(item.road, known);
    item.matchType = "疑似相符";
    item.roadAlert = { near: near?.road || "", score: near?.score || 0 };
  }
  const hasNew = pending.some((x) => x.ok && x.roadAlert);
  const missing = known.filter(
    (x) => !seen.includes(x) && !pending.some((p) => p.roadChoice === x),
  );
  roadAlert.style.display = hasNew && missing.length ? "block" : "none";
  roadAlert.innerHTML =
    hasNew && missing.length
      ? `<b>本次有疑似新路段；另有 ${missing.length} 個既有路段未出現</b><p>${missing.map(esc).join("、")}</p><small>請先確認疑似新路段是否為名稱差異；若確為新增路段，仍可繼續。</small>`
      : "";
}
function rulesFor(code = state.activeCode) {
  return { ...DEFAULT_LOS_RULE, ...(state.losRules?.[code] || {}) };
}
function losOf(r, code = state.activeCode) {
  /*
   * 讀不到速限比時要回「?」，不是 F。
   * 舊寫法直接比大小，而 null >= 0.8 會因為 Number(null) === 0 而為 false，
   * 一路落到最後的 "F"——**缺值被判成最差等級**。呼叫端有的有防護
   * （d.ratio == null ? "?" : …），有的沒有；沒防護的那幾處（例如匯入預覽
   * 的 remapPending）就會在畫面上把「讀不到旅行速率」的那一筆標成 F。
   * 守衛放在這裡，六個呼叫端一次都對。
   */
  if (r == null || r === "" || !Number.isFinite(Number(r))) return "?";
  const value = Number(r);
  const x = rulesFor(code);
  return value >= x.A
    ? "A"
    : value >= x.B
      ? "B"
      : value >= x.C
        ? "C"
        : value >= x.D
          ? "D"
          : value >= x.E
            ? "E"
            : "F";
}
const losRank = { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
function matrix(wb, names) {
  const targets = (Array.isArray(names) ? names : [names]).map(normalize);
  let found = null;
  for (const target of targets) {
    found =
      wb.SheetNames.find((n) => normalize(n) === target) ||
      wb.SheetNames.find((n) => normalize(n).includes(target));
    if (found) break;
  }
  return found
    ? XLSX.utils.sheet_to_json(wb.Sheets[found], { header: 1, raw: true, defval: null })
    : null;
}
function metricAt(m, r, c) {
  // 只有「冒號後面就是數字」才算標籤自帶數值。
  // 舊版取整格文字的第一串數字，遇到「方向1平均總旅行速率：」「平均總旅行速率（07:30~08:30）」
  // 這類寫法會把標籤裡的 1 或 7 當成速率讀進來，整份資料的 LOS 全部變成 F。
  const label = String(m[r]?.[c] ?? "");
  // 冒號前面不能是數字，否則「（07:30~08:30）」這種時段字樣會被當成
  // 「冒號後面就是數字」，把 30 讀成速率——這一格明明只是標題，沒有數值。
  const inline = label.match(/(?:^|[^\d])[：:]\s*(-?\d+(?:\.\d+)?)\s*[^\d]*$/);
  if (inline) return +inline[1];
  // 往右找數值時，一碰到「另一個文字格」就停。真實版面同一列是
  //「平均總旅行速率｜21.08｜平均總行駛速率｜35.78」，原始檔若因為公式沒有
  // 快取值而讓 21.08 是空的，舊寫法會一路掃過「平均總行駛速率」這個標題，
  // 把 35.78 當成旅行速率讀進來——旅行速率與行駛速率變成同一個數字，
  // 服務水準直接差兩級，畫面上卻沒有任何異常。
  for (let dc = 1; dc <= 5; dc++) {
    const cell = m[r]?.[c + dc];
    const n = num(cell);
    if (n != null) return n;
    if (cell != null && String(cell).trim() !== "") break;
  }
  for (let dr = 1; dr <= 3; dr++)
    for (let dc = 0; dc <= 3; dc++) {
      const n = num(m[r + dr]?.[c + dc]);
      if (n != null) return n;
    }
  return null;
}
function findLabels(m, text) {
  const a = [];
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < (m[r]?.length || 0); c++)
      if (normalize(m[r][c]).includes(text)) a.push({ r, c });
  return a;
}
function nearestMetric(m, row, text) {
  let best = null;
  for (const p of findLabels(m, text)) {
    const dist = Math.abs(p.r - row);
    // 距離相同時要挑「在下方」的那個標籤。findLabels 由上往下掃，
    // 舊版嚴格小於的比較會讓上一個方向的行駛速率被誤讀成這個方向的。
    const better = !best || dist < best.dist || (dist === best.dist && p.r >= row);
    if (dist <= 3 && better) best = { ...p, dist };
  }
  return best ? metricAt(m, best.r, best.c) : null;
}
/**
 * 讀取某一個方向的延滯數值。
 *
 * 只在「這個方向自己的區塊」裡找標籤（區塊界線＝相鄰兩個平均總旅行速率標籤），
 * 否則第二個方向會抓到第一個方向的延滯表，兩個方向拿到一模一樣的數字卻毫無警告。
 * 區塊內找不到就回傳 null，讓這份檔案在預覽時明確報錯，而不是匯入錯的數值。
 */
function delayPart(m, row, text, bounds) {
  const from = bounds?.from ?? 0;
  const to = bounds?.to ?? m.length;
  let best = null;
  for (const p of findLabels(m, text)) {
    if (p.r < from || p.r >= to) continue;
    // 優先取「在速率標籤上方、且最靠近」的那一個；區塊內沒有才往下找。
    if (p.r <= row) {
      if (!best || best.r > row || p.r > best.r) best = p;
    } else if (!best) best = p;
  }
  if (!best) return null;
  const limit = Math.min(to - 1, best.r + 20);
  for (let r = best.r + 1; r <= limit; r++) {
    const n = num(m[r]?.[best.c]);
    if (n != null) return n;
  }
  return null;
}
/**
 * 把一張尖峰工作表切成「一趟旅次一個區塊」。
 *
 * 這是讀取這類報告最關鍵的一步。實際收到的調查表，一張「上午尖峰」工作表裡
 * 會有 6 趟旅次（每個方向 3 趟）上下疊在一起，每一趟的高度還不一樣（實測有
 * 37、40、61 列三種）；平均速率寫在該趟的最後一列，延滯表則寫在該趟的上方。
 * 只用「上一個平均速率標籤」當界線，或用「離哪個標籤最近」來猜，都會在某些
 * 版型把方向2 的延滯判給方向1（或反過來），而且錯了不會有任何提示。
 *
 * 改以「記錄分隔線」切塊就跟版面高度無關：先找每趟都會出現一次的「旅次編號」，
 * 沒有的話退而求其次用「重複出現的標題列」。兩者都找不到才回到舊的界線邏輯。
 */
function recordBlocks(m) {
  const starts = [];
  const push = (r) => {
    if (!starts.includes(r)) starts.push(r);
  };
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < (m[r]?.length || 0); c++)
      if (normalize(m[r][c]).includes("旅次編號")) {
        push(r);
        break;
      }
  if (starts.length < 2) {
    starts.length = 0;
    const firstRow = m.findIndex((row) => (row || []).some((v) => normalize(v)));
    const title =
      firstRow < 0 ? "" : normalize((m[firstRow] || []).find((v) => normalize(v)));
    // 標題太短（例如只有「1」）當分隔線太危險，會把整張表切碎。
    if (title.length >= 6)
      for (let r = 0; r < m.length; r++)
        if ((m[r] || []).some((v) => normalize(v) === title)) push(r);
  }
  if (starts.length < 2) return [];
  starts.sort((a, b) => a - b);
  return starts.map((from, i) => ({
    from,
    to: i + 1 < starts.length ? starts[i + 1] : m.length,
  }));
}
function labelsInBlock(m, block, text) {
  return findLabels(m, text).filter((p) => p.r >= block.from && p.r < block.to);
}
/** 讀標籤正下方最近的一個數字，只在同一個區塊內找。 */
function valueBelowLabel(m, p, block) {
  const limit = Math.min(block.to - 1, p.r + 20);
  for (let r = p.r + 1; r <= limit; r++) {
    const n = num(m[r]?.[p.c]);
    if (n != null) return n;
  }
  return null;
}
/** 取「方向　往：A--->B」的內容，用來判斷兩趟旅次是不是同一個方向。 */
function directionTextOf(m, block) {
  for (let r = block.from; r < block.to; r++)
    for (const v of m[r] || []) {
      const text = normalize(v);
      if (!text.startsWith("方向往")) continue;
      const parts = String(v).split(/[:：]/);
      if (parts.length > 1) return normalize(parts.slice(1).join(":"));
    }
  return "";
}
function rowFromBlockData(item, peak, index) {
  return {
    peak,
    direction: `方向${index + 1}`,
    // 報告上寫的方向文字（例如「大同路口--->中正路口」），只用於顯示，
    // 不參與任何計算，也不會變成資料的鍵值。
    directionText: item.directionText || "",
    travel: item.travel,
    running: item.running,
    roadDelay: item.roadDelay,
    junctionDelay: item.junctionDelay,
    // 路段延滯與交叉口延滯都是總延滯的必要組成，缺一不可。
    // 舊版把讀不到的那一項當成 0，會讓總延滯嚴重低估卻照樣通過檢核。
    totalDelay:
      item.roadDelay == null || item.junctionDelay == null
        ? null
        : item.roadDelay + item.junctionDelay,
  };
}
/** 以記錄區塊讀取。讀不出剛好兩個方向時，一律附上具體原因。 */
function parseByRecordBlocks(m, peak, blocks) {
  const found = [];
  // 同一個區塊裡出現兩個同名標籤（例如另外印了一份「平均總旅行速率(雙向)」），
  // 取第一個就結束會靜默拿到錯的值，而且跟跨區塊重複的守門標準不一致。
  let ambiguous = "";
  const single = (block, text) => {
    const hits = labelsInBlock(m, block, text);
    if (hits.length > 1 && !ambiguous)
      ambiguous = `「${peak}」工作表同一趟旅次裡有 ${hits.length} 個「${text}」，系統不會自行挑選，請確認報告只保留一個`;
    return hits[0] || null;
  };
  for (const block of blocks) {
    const travelLabel = single(block, "平均總旅行速率");
    if (!travelLabel) continue;
    const travel = metricAt(m, travelLabel.r, travelLabel.c);
    if (travel == null) continue;
    const runningLabel = single(block, "平均總行駛速率");
    const roadLabel = single(block, "路段延滯");
    const junctionLabel = single(block, "交叉口延滯");
    found.push({
      directionText: directionTextOf(m, block),
      travel,
      running: runningLabel ? metricAt(m, runningLabel.r, runningLabel.c) : null,
      roadDelay: roadLabel ? valueBelowLabel(m, roadLabel, block) : null,
      junctionDelay: junctionLabel
        ? valueBelowLabel(m, junctionLabel, block)
        : null,
    });
  }
  if (ambiguous) return { rows: [], issue: ambiguous };
  if (found.length < 2)
    return {
      rows: [],
      issue: `「${peak}」工作表切出 ${blocks.length} 趟旅次，但只有 ${found.length} 趟讀得到「平均總旅行速率」（應為 2 趟：兩個調查方向各一）`,
    };
  const groups = [];
  found.forEach((item, index) => {
    // 沒寫方向文字時，每一筆自成一個方向（等同以出現順序區分）。
    const key = item.directionText || `#${index}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(item);
    else groups.push({ key, items: [item] });
  });
  if (groups.length !== 2)
    return {
      rows: [],
      issue: `「${peak}」工作表讀到 ${groups.length} 個調查方向（應為 2 個）：${groups
        .map((g) => (g.key.startsWith("#") ? "未標示方向" : g.key))
        .join("、")}`,
    };
  const duplicated = groups.find((g) => g.items.length > 1);
  if (duplicated)
    return {
      rows: [],
      issue: `「${peak}」工作表中方向「${duplicated.key}」有 ${duplicated.items.length} 個「平均總旅行速率」，系統不會自行挑選或平均，請確認報告只保留一個代表值`,
    };
  return {
    rows: groups.map((g, i) => rowFromBlockData(g.items[0], peak, i)),
    issue: "",
  };
}
/** 舊解法：整張表只有兩個「平均總旅行速率」、沒有記錄分隔線時使用。 */
function parseByTravelAnchors(m, peak) {
  const travels = findLabels(m, "平均總旅行速率");
  // 一張尖峰工作表應該剛好有兩個方向。多出來（例如另有一個雙向平均區塊）
  // 或少於兩個時，寧可讓這份檔案在預覽時報錯，也不要用位置去猜哪兩個是方向1、2——
  // 猜錯會把「雙向平均」當成方向1，真正最差的那個方向反而整個不見。
  if (travels.length !== 2)
    return {
      rows: [],
      issue: `「${peak}」工作表找到 ${travels.length} 個「平均總旅行速率」區塊（應為 2 個：方向1、方向2），系統不會猜測哪兩個才是調查方向`,
    };
  const rows = travels.map((p, i) => {
    // 這個方向的區塊：從上一個速率標籤的下一列開始，到下一個速率標籤為止。
    const previous = travels[i - 1];
    const next = travels[i + 1];
    const bounds = {
      from: previous ? previous.r + 1 : 0,
      to: next ? next.r : m.length,
    };
    return rowFromBlockData(
      {
        directionText: "",
        travel: metricAt(m, p.r, p.c),
        running: nearestMetric(m, p.r, "平均總行駛速率"),
        roadDelay: delayPart(m, p.r, "路段延滯", bounds),
        junctionDelay: delayPart(m, p.r, "交叉口延滯", bounds),
      },
      peak,
      i,
    );
  });
  return { rows, issue: "" };
}
/**
 * 讀取一張尖峰工作表，回傳 { rows, issue }。
 *
 * 這裡不再用函式屬性傳遞診斷訊息：呼叫端會連續讀上午與下午兩張表，
 * 第二次呼叫一開始就會把第一次的訊息清掉，於是「問題出在上午尖峰」時
 * 使用者永遠看不到具體原因，只剩最泛用的那一句。
 *
 * 另外：只有在「切不出記錄分隔線」時才退回舊解法。區塊解法若已經明確
 * 判定版面有問題（例如兩趟旅次其實是同一個方向），那是陽性診斷，不能
 * 被舊解法覆蓋成靜默成功——舊解法只數整張表有幾個平均速率，看不出
 * 那兩個屬於同一個方向。
 */
function parsePeakSheet(m, peak) {
  if (!m) return { rows: [], issue: "" };
  const blocks = recordBlocks(m);
  if (blocks.length >= 2) return parseByRecordBlocks(m, peak, blocks);
  return parseByTravelAnchors(m, peak);
}
/**
 * 讀出來的四個數字合不合物理常識。
 *
 * 旅行速率是「含延滯」的速率，行駛速率是「不含延滯」的速率，所以
 * 旅行速率一定不會大於行駛速率；有延滯時一定嚴格小於。這條不變式幾乎
 * 不花成本，卻能擋掉「讀到隔壁欄位」這一整類錯誤——那類錯誤最可怕的
 * 地方在於數字看起來很正常，只是屬於別的欄位，事後完全查不出來。
 */
function implausibleReason(r) {
  const label = `${r.peak}／${r.directionText || r.direction}`;
  if (!(r.travel > 0)) return `${label} 的旅行速率不是正數（讀到 ${r.travel}）`;
  if (!(r.running > 0)) return `${label} 的行駛速率不是正數（讀到 ${r.running}）`;
  // 浮點數比較留一點餘裕，避免四捨五入造成誤判。
  const tolerance = 0.01;
  if (r.travel > r.running + tolerance)
    return `${label} 的旅行速率 ${r.travel.toFixed(2)} 大於行駛速率 ${r.running.toFixed(2)}，數值可能讀到相鄰欄位`;
  if (r.totalDelay > 0 && Math.abs(r.travel - r.running) < tolerance)
    return `${label} 有 ${r.totalDelay.toFixed(1)} 秒延滯，旅行速率卻等於行駛速率，數值可能讀到相鄰欄位`;
  return "";
}
/*
 * ────────────────────────────────────────────────────────────────
 *  Excel 解析的邊界防護
 * ────────────────────────────────────────────────────────────────
 * 這一套的 SheetJS 已經是官方 0.20.3（原型污染警示的修正版），所以下面
 * 這一層是「多一道」而不是「唯一一道」：
 *   1. 解析時關掉用不到的路徑（公式、內嵌 HTML、VBA 巨集）。這支程式只讀
 *      儲存格的值，那些一個都不需要，關掉就少一片攻擊面。
 *   2. 解析前後比對 Object.prototype 的自有屬性；多出來就代表這個檔案真的
 *      動到了原型：刪掉、中止這次匯入、並指出是哪一個檔案。安靜地清掉更
 *      危險——使用者會以為那個檔案沒問題。
 * 這樣即使日後 SheetJS 又退回舊版、或出現新的解析漏洞，也不會無聲通過。
 */
const SAFE_XLSX_READ_OPTIONS = {
  type: "array",
  cellFormula: false,
  cellHTML: false,
  bookVBA: false,
};
function prototypeFingerprint() {
  return Object.getOwnPropertyNames(Object.prototype);
}
function detectPrototypePollution(before) {
  const known = new Set(before);
  const added = Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => !known.has(name),
  );
  for (const name of added) {
    try {
      delete Object.prototype[name];
    } catch {
      /* 刪不掉也要照樣往下報告 */
    }
  }
  return added;
}
function assertNoPrototypePollution(before, fileLabel) {
  const added = detectPrototypePollution(before);
  if (!added.length) return;
  throw new Error(
    `「${fileLabel}」在解析過程中試圖修改瀏覽器的內建物件（${added.join("、")}），` +
      "本次匯入已中止，系統資料沒有變動。請確認這個檔案的來源。",
  );
}

async function parseFile(file, year, q, defSpeed) {
  const p = activeProject();
  const fingerprint = prototypeFingerprint();
  const wb = XLSX.read(await file.arrayBuffer(), SAFE_XLSX_READ_OPTIONS);
  assertNoPrototypePollution(fingerprint, file.name);
  const road = roadFromFile(file.name),
    day = dayFromFile(file.name),
    morning = matrix(wb, ["上午尖峰", "上午", "AM尖峰", "AM"]),
    afternoon = matrix(wb, ["下午尖峰", "下午", "PM尖峰", "PM"]);
  const am = parsePeakSheet(morning, "上午尖峰");
  const pm = parsePeakSheet(afternoon, "下午尖峰");
  const rows = [...am.rows, ...pm.rows];
  // 兩張表的診斷都要留著。舊寫法把訊息放在函式屬性上，下午那次呼叫會把
  // 上午的訊息洗掉，而上午永遠先解析，等於上午的問題永遠看不到原因。
  const blockIssue = [am.issue, pm.issue].filter(Boolean).join("；");
  for (const r of rows) {
    const k = `${p.code}|${road}|${r.direction}`;
    // 匯入預覽也要走「速限版本」那一套。舊版只看 state.limits，於是設過
    // 速限版本的路段，預覽 LOS 是用預設速限算的，按下確認寫入之後 rebuild()
    // 才換成版本速限，同一批資料在預覽與匯入結果顯示成兩種服務水準。
    const context = {
      projectCode: p.code,
      road,
      direction: r.direction,
      period: `${year}Q${q}`,
    };
    const version = globalThis.speedVersionFor?.(context) || null;
    const base = Number(state.limits[k]);
    const limit = version
      ? Number(version.speed)
      : Number.isFinite(base) && base > 0
        ? base
        : Number(defSpeed) > 0
          ? Number(defSpeed)
          : 50;
    Object.assign(r, {
      id: `${p.code}|${year}|Q${q}|${road}|${day}|${r.peak}|${r.direction}`,
      projectCode: p.code,
      projectName: p.name,
      year: +year,
      quarter: +q,
      period: `${year}Q${q}`,
      road,
      day,
      limit,
      // 報告上寫的方向文字，只作顯示用；方向的鍵值仍是方向1／方向2。
      directionText: r.directionText || "",
      limitSource: version ? version.source || "" : "",
      limitVersionStart: version ? version.start : "",
      ratio: r.travel == null ? null : r.travel / limit,
      los: r.travel == null ? "?" : losOf(r.travel / limit),
      source: file.name,
    });
  }
  const complete =
    rows.length === 4 &&
    rows.every((r) => r.travel != null && r.running != null && r.totalDelay != null);
  const implausible = complete ? rows.map(implausibleReason).filter(Boolean) : [];
  const ok = complete && !implausible.length;
  const sheetError =
    !morning || !afternoon
      ? "找不到上午／下午工作表（支援名稱：上午尖峰、下午尖峰、上午、下午、AM、PM）"
      : "";
  return {
    file: file.name,
    road,
    day,
    rows,
    ok,
    error: ok
      ? ""
      : sheetError ||
        blockIssue ||
        implausible[0] ||
        (rows.length !== 4 ? "無法辨識完整4筆尖峰方向資料" : "速率或延滯欄位缺少數值"),
  };
}
function rebuild() {
  /*
   * 資料一動，畫面上的健康檢查結果就是舊的。以前不標示，使用者匯入一整季
   * 新資料之後，品質總覽仍然顯示上一次的筆數與路段清單，而且四個統計數字
   * 看起來就像是「現在的」結果——新路段的問題完全看不到。
   */
  if (healthChecked) healthStale = true;
  const groups = {};
  for (const d of state.details) {
    d.los = d.ratio == null ? "?" : losOf(d.ratio, d.projectCode);
    const k = [d.projectCode, d.year, d.quarter, d.road, d.day].join("|");
    (groups[k] ??= []).push(d);
  }
  state.summaries = Object.values(groups).map((rows) => {
    const sorted = [...rows].sort(
      (a, b) =>
        (losRank[a.los] || 9) - (losRank[b.los] || 9) ||
        (a.ratio ?? 9) - (b.ratio ?? 9) ||
        (a.travel ?? 999) - (b.travel ?? 999),
    );
    const w = sorted[0];
    return { ...w, detailCount: rows.length };
  });
}
function upsert(rows) {
  const map = new Map(state.details.map((x) => [x.id, x]));
  rows.forEach((x) => map.set(x.id, x));
  state.details = [...map.values()];
  for (const d of rows) {
    const k = `${d.projectCode}|${d.road}|${d.direction}`;
    if (!state.limits[k]) state.limits[k] = d.limit;
  }
  adoptDirectionNames(rows);
  rebuild();
}
/**
 * 報告上寫著「方  向  往：大同路口--->中正路口」，把它拿來當方向的顯示名稱。
 *
 * 只在使用者還沒自己命名時才填（預設值是「方向1」「方向2」，看不出哪個方向
 * 是哪一邊）。方向的鍵值仍然是方向1／方向2，不會因此改變，既有資料不受影響；
 * 使用者之後在「路段管理」改成別的名稱也不會被這裡蓋掉。
 */
function adoptDirectionNames(rows) {
  for (const d of rows) {
    if (!d.directionText) continue;
    const key = roadMetaKey(d.road, d.projectCode);
    const meta = state.roadMeta[key] || {
      directionA: "方向1",
      directionB: "方向2",
      startPeriod: "",
      endPeriod: "",
    };
    const field = d.direction === "方向1" ? "directionA" : "directionB";
    const fallback = d.direction === "方向1" ? "方向1" : "方向2";
    if (meta[field] && meta[field] !== fallback) continue;
    state.roadMeta[key] = { ...meta, [field]: d.directionText };
  }
}

$("saveProject").onclick = async () => {
  const code = $("projectCode").value.trim(),
    name = $("projectName").value.trim();
  if (!code || !name) return toast("請完整輸入計畫編號與名稱");
  // 所有設定都以「計畫編號|…」當鍵值，編號含有「|」會讓刪除計畫時
  // 連同另一個計畫的設定一起被清掉。
  if (code.includes("|")) return toast("計畫編號不可包含「|」符號");
  const i = state.projects.findIndex((p) => p.code === code);
  if (i >= 0) state.projects[i] = { code, name };
  else state.projects.push({ code, name });
  // 換了作用中的計畫就要清掉上一個計畫的預覽與健康檢查結果，
  // 否則新計畫會看到別人的路段清單與異常項目（切換下拉選單有清，這裡漏了）。
  const switched = state.activeCode !== code;
  state.activeCode = code;
  if (switched) clearPendingPreview();
  await save();
  toast(i >= 0 ? "計畫設定已更新" : "新計畫已建立");
  go("import");
};
$("files").onchange = () => {
  $("fileInfo").textContent = $("files").files.length
    ? `已選取 ${$("files").files.length} 份檔案`
    : "尚未選取檔案";
};
$("preview").onclick = async () => {
  if (!activeProject()) return toast("請先完成計畫設定");
  const files = [...$("files").files],
    year = $("rocYear").value,
    q = $("quarter").value;
  if (!files.length || !year) return toast("請輸入民國年並選取檔案");
  // 民國年只接受 90～200 的整數。舊版完全不檢查，打錯成 1145 或 114.5
  // 會產生一個「1145Q1」的幽靈季度，之後所有期間比較、速限版本與成果範圍
  // 都比對不到它，只能用刪除季度才清得掉。
  const yearNumber = Number(year);
  if (!Number.isInteger(yearNumber) || yearNumber < 90 || yearNumber > 200)
    return toast("民國年必須是 90～200 之間的整數");
  if (!window.XLSX) return toast("Excel 讀取元件尚未載入，請確認網路後重新整理");
  $("preview").disabled = true;
  $("previewStatus").textContent = "讀取中…";
  pending = [];
  roadPicks = new Set();
  for (const f of files) {
    try {
      pending.push(await parseFile(f, year, q, $("defaultSpeed").value));
    } catch (e) {
      // 使用者在預覽後把檔案拿去 Excel 修正、再按一次「讀取並預覽」時，
      // 瀏覽器手上那個檔案參照已經失效（內容與選取當下不一致），
      // 讀取會直接失敗。這時講「格式不支援」會把人引到完全錯誤的方向。
      const changed = /NotReadable|not be read|changed/i.test(String(e?.name || e?.message || ""));
      pending.push({
        file: f.name,
        rows: [],
        ok: false,
        error: changed
          ? "這個檔案在選取之後被修改過，請重新選取一次檔案再預覽"
          : "檔案無法開啟或格式不支援",
      });
    }
  }
  // 記住這次預覽的條件。寫入時要用這一份，而不是當下輸入框的值：
  // 使用者若在預覽後才改民國年或季度，舊版會把資料寫進「預覽時的季度」，
  // 卻把「改過的季度」記進匯入紀錄，兩邊不一致而且完全看不出來。
  pendingContext = { year, quarter: q, projectCode: state.activeCode };
  analyzeRoads();
  $("preview").disabled = false;
  renderPreview();
};
/**
 * 取消本次預覽。
 *
 * 預覽的用意就是「先看看有沒有問題，有問題先去修檔案」。舊版只有
 *「讀取並預覽」與「確認寫入」兩個按鈕，看到判讀失敗之後沒有任何方式
 * 把這批結果清掉——畫面就一直掛著一份錯誤的預覽，使用者也不確定自己
 * 是不是已經被寫進去了。這個按鈕把預覽狀態整個清乾淨，資料完全不動。
 */
$("cancelPreview").onclick = () => {
  if (!pending.length) return;
  clearPendingPreview();
  // 檔案輸入也要清掉：使用者修好檔案後通常會重新選同一個檔名，
  // 不清掉的話瀏覽器可能不觸發 change，看起來像「選了卻沒反應」。
  $("files").value = "";
  $("fileInfo").textContent = "尚未選取檔案";
  renderPreview();
  // renderPreview() 會把狀態列改寫成「成功 0，失敗 0…」，看起來像剛匯完
  // 一批 0 筆的資料。所以「尚未開始」要放在它後面才留得住。
  $("previewStatus").textContent = "尚未開始";
  toast("已取消本次預覽，資料完全沒有變動；修正檔案後請重新選取並預覽");
};

// 改了民國年或季度就讓預覽失效，避免用舊條件寫入。
for (const id of ["rocYear", "quarter"])
  $(id).addEventListener("change", () => {
    // 使用者一旦自己動過，renderAll 就不可以再把它改回上次匯入的季度。
    importPeriodTouched = true;
    if (!pending.length) return;
    pending = [];
    pendingContext = null;
    roadAlert.style.display = "none";
    renderPreview();
    toast("季度或年度已變更，請重新按「讀取並預覽」");
  });
for (const id of ["rocYear", "quarter"])
  $(id).addEventListener("input", () => {
    importPeriodTouched = true;
  });
function matchBadge(type) {
  const cls =
    { 完全相符: "exact", 別名相符: "alias", 疑似相符: "possible", 新路段: "new" }[type] || "new";
  return `<span class="match-badge match-${cls}">${esc(type || "新路段")}</span>`;
}
function roadDecision(x, i) {
  if (!x.ok) return "—";
  const badge = matchBadge(x.matchType);
  if (!x.roadAlert)
    return `${badge}<br>${x.roadChoice ? `自動對應：${esc(x.roadChoice)}` : "使用目前正式名稱"}`;
  const known = existingRoads(),
    hint = x.roadAlert.score >= 0.55 ? `（疑似：${esc(x.roadAlert.near)}）` : "";
  // 勾選框只出現在「需要人工確認」的列；已經確認過的仍保留勾選框，
  // 使用者改變主意時可以再批次改一次。
  return `<label class="road-pick"><input type="checkbox" data-pick="${i}" ${roadPicks.has(i) ? "checked" : ""}>${badge}</label><br><select class="road-choice" data-pending="${i}"><option value="" ${!x.roadChoice ? "selected" : ""}>請確認${hint}</option><option value="__NEW__" ${x.roadChoice === "__NEW__" ? "selected" : ""}>確認為新路段</option>${known.map((r) => `<option value="${esc(r)}" ${x.roadChoice === r ? "selected" : ""}>合併至：${esc(r)}</option>`).join("")}</select>`;
}
/** 需要人工確認的 pending 索引。 */
function pendingNeedingChoice() {
  return pending.map((x, i) => (x.ok && x.roadAlert ? i : -1)).filter((i) => i >= 0);
}
function applyRoadPick(value) {
  const picked = [...roadPicks].filter((i) => pending[i]?.roadAlert);
  if (!picked.length) return;
  for (const i of picked) {
    pending[i].roadChoice = value;
    pending[i].matchType = value === "__NEW__" ? "新路段" : "疑似相符";
  }
  roadPicks = new Set();
  renderPreview();
  toast(
    value === "__NEW__"
      ? `已將 ${picked.length} 筆確認為新路段`
      : `已將 ${picked.length} 筆設定為合併至「${value}」`,
  );
}
function renderRoadBatchBar() {
  const targets = pendingNeedingChoice();
  roadBatchBar.style.display = targets.length ? "flex" : "none";
  if (!targets.length) {
    roadPicks = new Set();
    return;
  }
  // 勾選集合只保留仍然存在、且仍需確認的索引。
  roadPicks = new Set([...roadPicks].filter((i) => targets.includes(i)));
  const undecided = targets.filter((i) => !pending[i].roadChoice);
  $("pickCount").textContent =
    `共 ${targets.length} 筆需確認（尚未決定 ${undecided.length} 筆）｜已勾選 ${roadPicks.size} 筆`;
  $("pickAll").checked = roadPicks.size > 0 && roadPicks.size === targets.length;
  $("pickAll").indeterminate = roadPicks.size > 0 && roadPicks.size < targets.length;
  $("pickAsNew").disabled = !roadPicks.size;
  const known = existingRoads();
  $("pickAsMerge").disabled = !roadPicks.size || !known.length;
  const previous = $("pickMergeTarget").value;
  $("pickMergeTarget").innerHTML = known.length
    ? known.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")
    : '<option value="">目前沒有既有路段</option>';
  if (known.includes(previous)) $("pickMergeTarget").value = previous;
}
function projectedId(item, r) {
  const target = item.roadChoice && item.roadChoice !== "__NEW__" ? item.roadChoice : r.road;
  return [r.projectCode, r.year, `Q${r.quarter}`, target, r.day, r.peak, r.direction].join("|");
}
function duplicateStats() {
  const ids = new Set(state.details.map((x) => x.id));
  let added = 0,
    updated = 0;
  for (const item of pending.filter((x) => x.ok))
    for (const r of item.rows) ids.has(projectedId(item, r)) ? updated++ : added++;
  return { added, updated };
}
function renderPreview() {
  const errors = pending.filter((x) => !x.ok).length,
    unchecked = pending.filter((x) => x.ok && x.roadAlert && !x.roadChoice).length,
    dup = duplicateStats();
  $("errorBadge").textContent = unchecked ? `${unchecked} 路段待確認` : `${errors} 錯誤`;
  $("errorBadge").style.color = errors || unchecked ? "#bd463d" : "#168466";
  $("previewStatus").textContent =
    `成功 ${pending.length - errors}，失敗 ${errors}｜新增 ${dup.added}，重複 ${dup.updated}`;
  $("previewRows").innerHTML =
    pending
      .map(
        (x, i) =>
          `<tr><td>${esc(x.file)}</td><td>${esc(x.day || "—")}</td><td>${x.ok ? "辨識成功" : `<span style="color:#bd463d">${esc(x.error)}</span>`}</td><td>${x.rows.length}</td><td>${roadDecision(x, i)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="5" class="empty">沒有可預覽資料</td></tr>';
  document.querySelectorAll("[data-pending]").forEach(
    (s) =>
      (s.onchange = () => {
        const item = pending[+s.dataset.pending];
        item.roadChoice = s.value;
        item.matchType = s.value === "__NEW__" ? "新路段" : "疑似相符";
        renderPreview();
      }),
  );
  document.querySelectorAll("[data-pick]").forEach(
    (box) =>
      (box.onchange = () => {
        const index = +box.dataset.pick;
        if (box.checked) roadPicks.add(index);
        else roadPicks.delete(index);
        renderRoadBatchBar();
      }),
  );
  renderRoadBatchBar();
  $("commit").disabled = !pending.some((x) => x.ok) || unchecked > 0;
  // 只要有預覽結果就可以取消，不論成功或失敗。
  if ($("cancelPreview")) $("cancelPreview").disabled = !pending.length;
}
$("pickAll").onchange = () => {
  const targets = pendingNeedingChoice();
  roadPicks = $("pickAll").checked ? new Set(targets) : new Set();
  renderPreview();
};
$("pickAsNew").onclick = () => applyRoadPick("__NEW__");
$("pickAsMerge").onclick = () => {
  const target = $("pickMergeTarget").value;
  if (!target) return toast("目前沒有可合併的既有路段");
  applyRoadPick(target);
};

function remapPending(item, target) {
  if (!target || target === "__NEW__") return;
  state.aliases[`${state.activeCode}|${item.originalRoad}`] = target;
  for (const r of item.rows) {
    r.road = target;
    r.id = [r.projectCode, r.year, `Q${r.quarter}`, target, r.day, r.peak, r.direction].join("|");
    const k = `${r.projectCode}|${target}|${r.direction}`;
    r.limit = state.limits[k] || r.limit;
    r.ratio = r.travel == null ? null : r.travel / r.limit;
    r.los = losOf(r.ratio);
  }
  item.road = target;
}
$("commit").onclick = async () => {
  if (!pendingContext) return toast("請先按「讀取並預覽」");
  if (pendingContext.projectCode !== state.activeCode)
    return toast("預覽之後計畫被切換過了，請重新預覽再寫入");
  const unchecked = pending.filter((x) => x.ok && x.roadAlert && !x.roadChoice);
  if (unchecked.length) return toast("請先確認所有疑似新路段");
  const good = pending.filter((x) => x.ok);
  good.forEach((x) => remapPending(x, x.roadChoice));
  // 同一批次內若有兩份檔案指向同一個路段＋日別，後寫入的會蓋掉前一份，
  // 而畫面上仍顯示「新增 8 筆」。這種情況一律擋下並指出是哪些檔案。
  const owners = new Map();
  for (const item of good)
    for (const row of item.rows) {
      const list = owners.get(row.id) ?? [];
      if (!list.includes(item.file)) list.push(item.file);
      owners.set(row.id, list);
    }
  const collided = [...new Set([...owners.values()].filter((list) => list.length > 1).flat())];
  if (collided.length)
    return toast(
      `這幾份檔案被判定為同一個路段與日別，會互相覆蓋，請確認後分批匯入：${collided.join("、")}`,
    );
  const all = good.flatMap((x) => x.rows),
    before = new Map(state.details.map((x) => [x.id, x])),
    policy = $("duplicatePolicy").value,
    batchId = `B${Date.now()}`,
    previous = [],
    addedIds = [],
    write = [];
  let skipped = 0;
  for (const row of all) {
    const old = before.get(row.id);
    if (old && policy === "skip") {
      skipped++;
      continue;
    }
    if (old) previous.push(structuredClone(old));
    else addedIds.push(row.id);
    write.push({ ...row, importBatch: batchId });
  }
  upsert(write);
  const now = new Date(),
    batch = {
      id: batchId,
      projectCode: state.activeCode,
      projectName: activeProject()?.name || "",
      period: `${pendingContext.year}Q${pendingContext.quarter}`,
      time: now.toLocaleString("zh-TW"),
      timestamp: now.toISOString(),
      files: good.map((x) => x.file),
      addedIds,
      previous,
      writtenIds: write.map((x) => x.id),
      added: addedIds.length,
      updated: previous.length,
      skipped,
      status: "有效",
    };
  state.imports.unshift(batch);
  state.last = {
    year: pendingContext.year,
    quarter: pendingContext.quarter,
    time: batch.time,
  };
  // 寫入完成之後這一輪就結束了，下一次可以再帶入「上次的季度」當預設值。
  importPeriodTouched = false;
  await save();
  toast(`寫入完成：新增 ${batch.added}、更新 ${batch.updated}、略過 ${batch.skipped}`);
  pending = [];
  roadAlert.style.display = "none";
  renderPreview();
  go("importlog");
};

let pendingRoadChange = null;
const roadMetaKey = (road, code = state.activeCode) => `${code}|${road}`;
function roadMeta(road, code = state.activeCode) {
  return (
    state.roadMeta[roadMetaKey(road, code)] || {
      directionA: "方向1",
      directionB: "方向2",
      startPeriod: "",
      endPeriod: "",
    }
  );
}
function validPeriod(v) {
  return !v || /^\d{2,3}Q[1-4]$/.test(v);
}
function periodIndex(v) {
  const m = String(v || "").match(/^(\d{2,3})Q([1-4])$/);
  return m ? Number(m[1]) * 4 + Number(m[2]) : -1;
}
function sortPeriods(values) {
  return [...new Set(values)].sort((a, b) => periodIndex(a) - periodIndex(b));
}
function roadObservedPeriods(road, code = state.activeCode) {
  return sortPeriods(
    state.details.filter((x) => x.projectCode === code && x.road === road).map((x) => x.period),
  );
}
function roadIsActive(road, period, code = state.activeCode) {
  const m = roadMeta(road, code),
    observed = roadObservedPeriods(road, code),
    projectPeriods = sortPeriods(
      state.details.filter((x) => x.projectCode === code).map((x) => x.period),
    ),
    projectLast = projectPeriods.at(-1) || "",
    start = m.startPeriod || observed[0] || "",
    end = m.endPeriod || projectLast,
    p = periodIndex(period);
  // 格式不合的期間（例如手改備份留下的 114Q9）視為「沒有設定」，
  // 否則 periodIndex 會回 -1，任何季度都大於它，路段會被當成永遠有效。
  const startIndex = periodIndex(start),
    endIndex = periodIndex(end);
  return (
    (startIndex < 0 || p >= startIndex) && (endIndex < 0 || p <= endIndex)
  );
}
/*
 * 方向的顯示名稱只有這一支可以決定，全站每一個要把方向寫給人看的地方
 * ——畫面表格、下拉與勾選框、CSV、結論草稿、報告草稿、健康檢查說明——
 * 都必須走這裡。
 *
 * 之前有一半的地方直接印 row.direction，結果使用者替路段命名之後，
 * 明細與速限表顯示新名稱、Manager 比較與結論草稿卻還是「方向1／方向2」，
 * 同一份資料在同一個系統裡有兩種寫法，看的人無從判斷哪一個才對。
 *
 * 鍵值永遠是「方向1」「方向2」（原始報告就是這樣寫的），不會因為改名而變動；
 * 這裡只換顯示字。沒有自訂名稱時就回鍵值本身。
 */
function directionNameFrom(meta, direction) {
  if (direction === "方向1") return (meta && meta.directionA) || "方向1";
  if (direction === "方向2") return (meta && meta.directionB) || "方向2";
  return direction;
}
function directionName(road, direction, code = state.activeCode) {
  return directionNameFrom(roadMeta(road, code), direction);
}
/*
 * Manager 比較的資料來自別人的專案包，命名是跟著那個包走的，
 * 不在本機的 state.roadMeta 裡。先讀包內的 roadMeta，讀不到才退回本機
 * （同一台電腦同時是 Project 又是 Manager 時會用到）。
 */
/*
 * 一筆明細要顯示的方向。
 *
 * 使用者在「路段管理」設的名稱**永遠優先**。原本尖峰明細寫的是
 * `x.directionText || directionName(...)`，也就是報告上的起訖文字排在前面，
 * 於是使用者改名之後，彙總與速限表換了、明細沒換——同一個方向在相鄰兩張表
 * 上有兩個名字。
 *
 * 沒有設定名稱時（例如很舊的備份還原進來，roadMeta 是空的）才退回報告上的
 * 起訖文字，那比「方向1」有用；兩者都沒有就是鍵值本身。
 */
/**
 * 一筆紀錄要顯示的方向名稱——**全系統只有這一支**。
 *
 * 順序：專案包裡取過的名字 → 本機取過的名字 → 報告上的「方向往」文字 → 鍵值。
 *
 * 第三段（directionText）是獨立的一致性修正：同一筆資料在
 * 尖峰明細與 Manager 不應出現不同方向名稱。使用者當時看到舊名稱的真正原因
 * 是 Manager 仍保留舊專案包，並非這個備援邏輯。
 * 前兩次分別修好了「讓所有畫面都用同一支解析名字」與「佔位值擋住本機取好的名字」，
 * 但 Manager 比較與尖峰彙總等處**少了報告文字這一層備援**，而尖峰明細有。
 * 結果同一個計畫、同一張表裡，報告有寫「方向往」的路段顯示成「南-北(北上)」，
 * 沒寫的顯示成「方向1」——看起來就像「有些改到、有些沒改到」。
 * 事實上兩者都沒有被使用者命名過，差別只在報告上有沒有那行字。
 *
 * packageMeta 只有 Manager 比較會傳（資料來自別人的專案包，命名跟著包走）。
 */
function displayDirectionName(row, packageMeta) {
  const key = roadMetaKey(row.road, row.projectCode);
  const fromPackage = packageMeta ? packageMeta[key] : null;
  const fromLocal = state.roadMeta[key];
  if (hasRealDirectionName(fromPackage, row.direction))
    return directionNameFrom(fromPackage, row.direction);
  if (hasRealDirectionName(fromLocal, row.direction))
    return directionNameFrom(fromLocal, row.direction);
  // 兩邊都沒取過名字：報告上的「方向往：大同路口--->中正路口」比裸的「方向1」有用得多。
  if (row.directionText) return row.directionText;
  return directionNameFrom(fromPackage || fromLocal, row.direction);
}
function rowDirectionName(row) {
  return displayDirectionName(row, null);
}
/**
 * 只知道「路段＋方向」、手上沒有整筆紀錄時用這一支（路段速限表、速限未確認、
 * 速限版本清單）。它自己去 details 找一筆同路段同方向的紀錄，好讓報告上的
 * 「方向往」文字也能當備援——否則使用者在「路段速限」看到的永遠是裸的
 * 「方向1／方向2」，而那正是他要去改名字的畫面，最需要看得懂哪個方向是哪一邊。
 */
function directionNameFor(road, direction, code = state.activeCode) {
  const sample = state.details.find(
    (d) => d.projectCode === code && d.road === road && d.direction === direction,
  );
  return displayDirectionName(
    sample || { road, direction, projectCode: code, directionText: "" },
    null,
  );
}
/**
 * 這一份 roadMeta 到底有沒有「真的取過名字」。
 *
 * ⚠️ 「有沒有這個項目」不等於「有沒有取過名字」。roadMeta 的項目可能只是設定
 * 路段有效期間時順手建立的，內容是
 * `{ directionA: "方向1", directionB: "方向2", startPeriod, endPeriod }`
 * ——那兩個是**佔位值**，不是使用者取的名稱。
 */
function hasRealDirectionName(meta, direction) {
  if (!meta) return false;
  const name = directionNameFrom(meta, direction);
  return !!name && name !== direction;
}
/*
 * Manager 比較的資料來自專案包，命名跟著那個包走，不在本機的 state.roadMeta 裡。
 *
 * ⚠️ 判斷順序不能寫成「包裡有項目就用包裡的」。使用者實際遇到的畫面是：同一個
 * 計畫裡有些路段顯示「南-北(北上)」、有些還是「方向1」。成因就是這個——匯出專案包
 * 的當下，某些路段的 roadMeta 只是設定有效期間時建立的佔位項目，名字還是「方向1」；
 * 那個項目是「有值」的，於是擋掉了本機同一個計畫真正取好的名稱。
 *
 * 正確的規則是**挑真的有名字的那一份**：
 *   1. 專案包裡有取過名字 → 用它（那是資料提供者自己的命名，最準）
 *   2. 否則看本機同一個計畫有沒有取過（同一台電腦既是 Project 又是 Manager 很常見）
 *   3. 都沒有 → 顯示鍵值
 */
function managerDirectionName(row) {
  return displayDirectionName(row, row.packageRoadMeta || null);
}
function projectAliases() {
  const prefix = `${state.activeCode}|`;
  return Object.entries(state.aliases)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, target]) => ({ alias: k.slice(prefix.length), target }));
}
function roadImpact(source, target) {
  const rows = state.details.filter((x) => x.projectCode === state.activeCode && x.road === source),
    periods = sortPeriods(rows.map((x) => x.period)),
    targetIds = new Set(
      state.details
        .filter((x) => x.projectCode === state.activeCode && x.road === target)
        .map((x) => x.id),
    ),
    collisions = rows.filter((x) =>
      targetIds.has(
        [x.projectCode, x.year, `Q${x.quarter}`, target, x.day, x.peak, x.direction].join("|"),
      ),
    ).length;
  return {
    projectCode: state.activeCode,
    source,
    target,
    rows: rows.length,
    periods,
    summary: state.summaries.filter((x) => x.projectCode === state.activeCode && x.road === source)
      .length,
    collisions,
  };
}
function showRoadImpact(source, target, mode) {
  if (!source || !target || source === target) {
    pendingRoadChange = null;
    $("confirmRoadChange").disabled = true;
    $("roadImpact").innerHTML =
      '<b>無法預覽</b><p>來源與目標必須是不同名稱。</p><button class="danger-button" id="confirmRoadChange" disabled>備份後確認執行</button>';
    return;
  }
  const impact = roadImpact(source, target),
    exists = existingRoads().includes(target);
  pendingRoadChange = { ...impact, mode };
  $("roadImpact").innerHTML =
    `<div><b>${mode === "rename" && !exists ? "正式名稱修改" : "重複路段合併"}預覽</b><p>「${esc(source)}」→「${esc(target)}」</p><ul><li>影響季度：${impact.periods.length ? impact.periods.join("、") : "無"}</li><li>尖峰明細：${impact.rows} 筆</li><li>尖峰彙總：${impact.summary} 筆</li><li>合併後重複鍵值：${impact.collisions} 筆（保留目標路段既有資料）</li></ul><small>執行前會自動下載 Project 專案包；路段速限、別名及圖表會一起更新。</small></div><button class="danger-button" id="confirmRoadChange">備份後確認執行</button>`;
  $("confirmRoadChange").onclick = confirmRoadChange;
}
async function applyRoadChange(source, target) {
  const code = state.activeCode,
    sourceKey = roadMetaKey(source),
    targetKey = roadMetaKey(target),
    sourceMeta = state.roadMeta[sourceKey],
    targetMeta = state.roadMeta[targetKey];
  state.aliases[`${code}|${normalize(source)}`] = target;
  for (const [k, v] of Object.entries(state.aliases))
    if (k.startsWith(`${code}|`) && v === source) state.aliases[k] = target;
  const kept = state.details.filter((x) => !(x.projectCode === code && x.road === source)),
    map = new Map(kept.map((x) => [x.id, x]));
  for (const d of state.details.filter((x) => x.projectCode === code && x.road === source)) {
    const oldLimit = `${code}|${source}|${d.direction}`,
      newLimit = `${code}|${target}|${d.direction}`;
    if (!state.limits[newLimit]) state.limits[newLimit] = state.limits[oldLimit] || d.limit || 50;
    if (state.limitConfirmed[oldLimit]) state.limitConfirmed[newLimit] = true;
    delete state.limits[oldLimit];
    delete state.limitConfirmed[oldLimit];
    // 速限版本（有效期間、查證來源與人員）也是以「計畫|路段|方向」為鍵，
    // 改名時一併搬過去，否則整組查證紀錄會變成孤兒、速限悄悄退回預設值。
    if (state.speedVersions?.[oldLimit]) {
      state.speedVersions[newLimit] = (state.speedVersions[newLimit] || []).concat(
        state.speedVersions[oldLimit],
      );
      delete state.speedVersions[oldLimit];
    }
    const moved = { ...d, road: target, limit: state.limits[newLimit] };
    moved.ratio = moved.travel == null ? null : moved.travel / moved.limit;
    moved.los = losOf(moved.ratio, code);
    moved.id = [
      moved.projectCode,
      moved.year,
      `Q${moved.quarter}`,
      target,
      moved.day,
      moved.peak,
      moved.direction,
    ].join("|");
    if (!map.has(moved.id)) map.set(moved.id, moved);
  }
  state.details = [...map.values()];
  if (sourceMeta || targetMeta)
    state.roadMeta[targetKey] = {
      directionA: targetMeta?.directionA || sourceMeta?.directionA || "方向1",
      directionB: targetMeta?.directionB || sourceMeta?.directionB || "方向2",
      startPeriod: targetMeta?.startPeriod || sourceMeta?.startPeriod || "",
      endPeriod: targetMeta?.endPeriod || sourceMeta?.endPeriod || "",
    };
  delete state.roadMeta[sourceKey];
  rebuild();
  await save();
}
async function confirmRoadChange() {
  const x = pendingRoadChange;
  if (!x) return;
  if (x.projectCode !== state.activeCode) {
    pendingRoadChange = null;
    renderRoadAdmin();
    return toast("計畫已切換，請重新預覽合併影響");
  }
  if (
    !confirm(
      `確定執行？\n\n${x.source}\n→ ${x.target}\n\n影響 ${x.periods.length} 個季度、${x.rows} 筆明細；${x.collisions} 筆重複資料將保留目標路段版本。`,
    )
  )
    return;
  downloadProjectPackage(false);
  await applyRoadChange(x.source, x.target);
  pendingRoadChange = null;
  toast("路段正式名稱、明細、速限、別名與圖表已更新");
  go("roadadmin");
}
function roadOptions(selected = "") {
  return (
    existingRoads()
      .sort()
      .map(
        (r) => `<option value="${esc(r)}" ${r === selected ? "selected" : ""}>${esc(r)}</option>`,
      )
      .join("") || '<option value="">目前尚無路段</option>'
  );
}
function renderRoadAdmin() {
  if (!$("roadAdminRows")) return;
  const roads = existingRoads().sort(),
    aliases = projectAliases(),
    periods = new Set(
      state.details.filter((x) => x.projectCode === state.activeCode).map((x) => x.period),
    );
  $("roadCount").textContent = roads.length;
  $("aliasCount").textContent = aliases.length;
  $("roadPeriodCount").textContent = periods.size;
  for (const id of [
    "renameRoad",
    "directionRoad",
    "periodRoad",
    "aliasTarget",
    "mergeSource",
    "mergeTarget",
  ]) {
    const old = $(id).value;
    $(id).innerHTML = roadOptions(old);
    if (roads.includes(old)) $(id).value = old;
  }
  const selected = $("directionRoad").value;
  if (selected) {
    const m = roadMeta(selected);
    $("directionA").value = m.directionA || "方向1";
    $("directionB").value = m.directionB || "方向2";
  }
  const periodSelected = $("periodRoad").value;
  if (periodSelected) {
    const m = roadMeta(periodSelected);
    $("roadStartPeriod").value = m.startPeriod || "";
    $("roadEndPeriod").value = m.endPeriod || "";
  }
  $("roadAdminRows").innerHTML = roads.length
    ? roads
        .map((road) => {
          const rows = state.details.filter(
              (x) => x.projectCode === state.activeCode && x.road === road,
            ),
            m = roadMeta(road),
            ps = sortPeriods(rows.map((x) => x.period)),
            range =
              m.startPeriod || m.endPeriod
                ? `${m.startPeriod || "不限"}～${m.endPeriod || "持續"}`
                : ps.join("、");
          return `<tr><td><b>${esc(road)}</b></td><td>${esc(m.directionA || "方向1")}</td><td>${esc(m.directionB || "方向2")}</td><td>${esc(range)}</td><td>${rows.length}</td><td>${aliases.filter((x) => x.target === road).length}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">匯入資料後會建立正式路段清冊</td></tr>';
  $("aliasRows").innerHTML = aliases.length
    ? aliases
        .map(
          (x) =>
            `<tr><td>${esc(x.alias)}</td><td>${esc(x.target)}</td><td><button class="outline" data-delete-alias="${esc(x.alias)}">刪除</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="empty">尚未設定檔名別名</td></tr>';
  document.querySelectorAll("[data-delete-alias]").forEach(
    (b) =>
      (b.onclick = async () => {
        delete state.aliases[`${state.activeCode}|${b.dataset.deleteAlias}`];
        await save();
        toast("別名已刪除");
      }),
  );
}
$("roadAdminBackup").onclick = () => downloadProjectPackage();
$("directionRoad").onchange = () => {
  const m = roadMeta($("directionRoad").value);
  $("directionA").value = m.directionA || "方向1";
  $("directionB").value = m.directionB || "方向2";
};
$("saveDirections").onclick = async () => {
  const road = $("directionRoad").value;
  if (!road) return toast("請先選擇路段");
  const old = roadMeta(road);
  state.roadMeta[roadMetaKey(road)] = {
    ...old,
    directionA: $("directionA").value.trim() || "方向1",
    directionB: $("directionB").value.trim() || "方向2",
  };
  await save();
  toast("方向顯示名稱已更新");
};
$("periodRoad").onchange = () => {
  const m = roadMeta($("periodRoad").value);
  $("roadStartPeriod").value = m.startPeriod || "";
  $("roadEndPeriod").value = m.endPeriod || "";
};
$("saveRoadPeriod").onclick = async () => {
  const road = $("periodRoad").value,
    start = $("roadStartPeriod").value.trim().toUpperCase(),
    end = $("roadEndPeriod").value.trim().toUpperCase();
  if (!road) return toast("請先選擇路段");
  if (!validPeriod(start) || !validPeriod(end))
    return toast("季度格式應為民國年加 Q1～Q4，例如 114Q1");
  if (start && end && periodIndex(start) > periodIndex(end))
    return toast("停止季度不可早於開始季度");
  state.roadMeta[roadMetaKey(road)] = { ...roadMeta(road), startPeriod: start, endPeriod: end };
  await save();
  toast("路段有效期間已更新");
};
$("addAlias").onclick = async () => {
  const alias = normalize($("aliasName").value),
    target = $("aliasTarget").value;
  if (!alias || !target) return toast("請完整輸入別名並選擇正式路段");
  if (alias === target) return toast("別名不可與正式路段完全相同");
  state.aliases[`${state.activeCode}|${alias}`] = target;
  $("aliasName").value = "";
  await save();
  toast(`別名「${alias}」將自動對應至「${target}」`);
};
$("previewRename").onclick = () => {
  const source = $("renameRoad").value,
    target = normalize($("formalRoadName").value);
  if (!target) return toast("請輸入新的正式名稱");
  showRoadImpact(source, target, "rename");
};
$("previewMerge").onclick = () =>
  showRoadImpact($("mergeSource").value, $("mergeTarget").value, "merge");

function losChip(l) {
  return `<span class="los los-${String(l).toLowerCase()}">${esc(l)}</span>`;
}
/**
 * 建立人員可搜尋的文字，只納入純量欄位，避免內部物件被轉成
 * "[object Object]"；方向則另外加入畫面實際顯示的名稱。
 */
function rowSearchText(row, directionLabel) {
  const scalar = (v) => ["string", "number", "boolean"].includes(typeof v);
  const values = [];
  Object.values(row).forEach((value) => {
    if (scalar(value)) {
      values.push(value);
    } else if (Array.isArray(value) && value.every(scalar)) {
      /*
       * ⚠️ 陣列不可以跟著物件一起丟掉。
       *
       * 會被轉成 "[object Object]" 的是**物件**；純量陣列的 toString 是有意義的
       * 文字，而且本來就搜得到——sourceRefs（每個數字來自原始 Excel 哪幾格，
       * 例如「平均總旅行速率:A7,路段延滯:A3」）就是陣列。把它一起濾掉的話，
       * 稽核時想用儲存格位置或欄位標題回頭找是哪幾列，會查不到任何東西，
       * 而且畫面上不會有任何跡象說明為什麼搜不到。
       */
      values.push(value.join(" "));
    }
  });
  if (directionLabel) values.push(directionLabel);
  return values.join(" ");
}
function renderDetails() {
  const q = normalize($("detailSearch")?.value || ""),
    code = state.activeCode;
  const rows = state.details.filter(
    (x) => x.projectCode === code && (!q || normalize(rowSearchText(x, rowDirectionName(x))).includes(q)),
  );
  $("detailCount").textContent = `${rows.length} 筆`;
  $("detailRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.period)}</td><td>${esc(x.road)}</td><td>${esc(x.day)}</td><td>${esc(x.peak)}</td><td>${esc(rowDirectionName(x))}</td><td>${fmt(x.travel, 3)}</td><td>${fmt(x.running, 3)}</td><td>${fmt(x.totalDelay, 3)}</td><td>${fmt(x.limit, Number.isInteger(Number(x.limit)) ? 0 : 1)}</td><td>${losChip(x.los)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="10" class="empty">目前計畫尚無尖峰明細</td></tr>';
}
function renderSummaries() {
  const q = normalize($("summarySearch")?.value || ""),
    code = state.activeCode;
  const rows = state.summaries.filter(
    (x) => x.projectCode === code && (!q || normalize(rowSearchText(x, rowDirectionName(x))).includes(q)),
  );
  $("summaryCount").textContent = `${rows.length} 筆`;
  $("summaryRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.period)}</td><td>${esc(x.road)}</td><td>${esc(x.day)}</td><td>${esc(x.peak)}</td><td>${esc(rowDirectionName(x))}</td><td>${fmt(x.travel, 3)}</td><td>${fmt(x.running, 3)}</td><td><b>${fmt(x.totalDelay, 3)}</b></td><td>${fmt(x.ratio, 3)}</td><td>${losChip(x.los)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="10" class="empty">目前計畫尚無尖峰彙總</td></tr>';
}
function renderLosRules() {
  const x = rulesFor();
  for (const grade of ["A", "B", "C", "D", "E"]) $(`los${grade}`).value = x[grade];
  $("losRuleExplanation").innerHTML =
    `<span><b>A：</b>速限比 ≥ ${fmt(x.A, 2)}</span><span><b>B：</b>${fmt(x.B, 2)} ≤ 速限比 ＜ ${fmt(x.A, 2)}</span><span><b>C：</b>${fmt(x.C, 2)} ≤ 速限比 ＜ ${fmt(x.B, 2)}</span><span><b>D：</b>${fmt(x.D, 2)} ≤ 速限比 ＜ ${fmt(x.C, 2)}</span><span><b>E：</b>${fmt(x.E, 2)} ≤ 速限比 ＜ ${fmt(x.D, 2)}</span><span><b>F：</b>速限比 ＜ ${fmt(x.E, 2)}</span>`;
}
function readLosRules() {
  const x = Object.fromEntries(
    ["A", "B", "C", "D", "E"].map((g) => [g, Number($(`los${g}`).value)]),
  );
  return Object.values(x).every(Number.isFinite) &&
    x.A > x.B &&
    x.B > x.C &&
    x.C > x.D &&
    x.D > x.E &&
    x.E >= 0 &&
    x.A <= 2
    ? x
    : null;
}
$("applyLosRules").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  const x = readLosRules();
  if (!x) return toast("門檻必須是 A＞B＞C＞D＞E，且介於 0～2");
  state.losRules[p.code] = x;
  rebuild();
  await save();
  toast("服務水準門檻已保存，明細、彙總與圖表已重新計算");
};
$("resetLosRules").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("請先建立或選擇計畫");
  if (!confirm("確定將目前計畫的服務水準門檻恢復為系統預設值？")) return;
  delete state.losRules[p.code];
  rebuild();
  await save();
  toast("已恢復預設門檻並重新計算");
};
$("detailSearch").oninput = renderDetails;
$("summarySearch").oninput = renderSummaries;
$("rebuild").onclick = async () => {
  rebuild();
  await save();
  toast("尖峰彙總已重新建立");
};
function renderLimits() {
  const keys = [
    ...new Set(
      state.details
        .filter((d) => d.projectCode === state.activeCode)
        .map((d) => `${d.projectCode}|${d.road}|${d.direction}`),
    ),
  ].sort();
  $("speedRows").innerHTML = keys.length
    ? keys
        .map((k) => {
          const parts = k.split("|"),
            direction = parts.pop(),
            road = parts.pop();
          /*
           * 有「速限版本」覆蓋時，這一格顯示的基準速限並不是實際換算 LOS
           * 用的值。舊版什麼都不標，使用者在這裡把 90 改成 60、按下套用，
           * 畫面顯示 60、資料仍用 90，而 toast 還說「LOS 已重新計算」。
           * 這裡把「有版本覆蓋」明白標出來，並列出實際生效的速限。
           */
          const versions = (state.speedVersions?.[k] || []).filter(Boolean);
          const versionNote = versions.length
            ? `<div class="limit-version-note">此路段方向設有 ${versions.length} 個速限版本，實際換算 LOS 時以版本速限為準（${versions
                .map((v) => `${esc(String(v.from || "起始"))}起 ${esc(String(v.limit))} km/h`)
                .join("、")}）；下方欄位是未被版本涵蓋的季度所使用的基準速限。</div>`
            : "";
          return `<tr><td>${esc(road)}</td><td>${esc(directionNameFor(road, direction))}</td><td><input class="speed-input" data-limit="${esc(k)}" type="number" min="1" value="${state.limits[k] || 50}">${versionNote}</td><td>${state.limitConfirmed[k] ? '<span class="status-ok">已人工確認</span>' : '<span class="status-warn">預設值，未確認</span>'}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="4" class="empty">目前計畫匯入資料後會自動建立路段方向</td></tr>';
}
$("applySpeed").onclick = async () => {
  // 速限一定是正數。`Number(i.value) || 50` 只擋得掉 0、空白與非數字：
  // 打成 -50 會照樣存進去，之後 travel / limit 變成負的比值，整條路段的
  // 服務水準無聲變成 F，而且畫面上也看不出哪裡不對。
  //
  // 而且驗證一定要「全部檢查完再寫入」。邊驗證邊寫入的話，合法的欄位已經
  // 進了 state 並標成「已人工確認」，卻因為提早 return 而沒有 rebuild()、
  // 沒有 save()；使用者以為整批取消了，下一次任何不相干的存檔卻會把這半套
  // 設定固化，重新整理後 LOS 就悄悄變了。
  const inputs = [...document.querySelectorAll("[data-limit]")];
  const rejected = inputs.filter((i) => {
    const parsed = Number(i.value);
    return !Number.isFinite(parsed) || parsed <= 0;
  });
  if (rejected.length) {
    rejected.forEach((i) => {
      i.value = state.limits[i.dataset.limit] || 50;
    });
    return toast(
      `速限必須大於 0，這次完全沒有變更：${rejected
        .map((i) => i.dataset.limit.split("|").slice(1).join(" "))
        .join("、")}`,
    );
  }
  inputs.forEach((i) => {
    state.limits[i.dataset.limit] = Number(i.value);
    state.limitConfirmed[i.dataset.limit] = true;
  });
  state.details
    .filter((d) => d.projectCode === state.activeCode)
    .forEach((d) => {
      d.limit = state.limits[`${d.projectCode}|${d.road}|${d.direction}`] || 50;
      d.ratio = d.travel == null ? null : d.travel / d.limit;
      d.los = losOf(d.ratio, d.projectCode);
    });
  rebuild();
  await save();
  toast("目前計畫的速限已人工確認，LOS 已重新計算");
};
function renderTravelCharts(rows, gridId) {
  const grid = $(gridId);
  grid.innerHTML = "";
  const roads = [...new Set(rows.map((x) => x.road))];
  for (const road of roads) {
    const own = rows
        .filter((x) => x.road === road)
        .sort((a, b) => periodIndex(a.period) - periodIndex(b.period)),
      periods = [...new Set(own.map((x) => x.period))],
      values = own.map((x) => Number(x.travel) || 0),
      rawMax = Math.max(...values, 1),
      max = Math.ceil(rawMax / 10) * 10 || 10,
      ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0],
      card = document.createElement("article");
    card.className = "chart-card";
    card.innerHTML = `<h3>${esc(road)}｜旅行速率</h3><div class="bars speed-bars"><div class="speed-y-title">平均總旅行速率（km/h）</div><div class="y-axis">${ticks.map((t, i) => `<span style="top:${i * 25}%">${fmt(t, 1)}</span>`).join("")}</div>${periods
      .map((p) => {
        /*
         * 「有這筆紀錄，但速率讀不到」和「速率是 0」必須分開。
         * 舊寫法是 Number(w?.travel) || 0，null 會折成 0，而柱子的
         * data-value 判斷的是 w（紀錄存在）不是 w.travel（數值存在），
         * 於是缺值走進了「有值」那條路：柱高 0、柱上標「0.0」、
         * 提示寫「平日 0.000 km/h」。旅行速率 0 km/h 的意思是完全動不了，
         * 會被直接誤讀成最嚴重的壅塞。缺值要留白，不是畫成 0。
         */
        const w = own.find((x) => x.period === p && x.day === "平日"),
          h = own.find((x) => x.period === p && x.day === "假日"),
          hasW = w != null && w.travel != null && Number.isFinite(Number(w.travel)),
          hasH = h != null && h.travel != null && Number.isFinite(Number(h.travel)),
          wv = hasW ? Number(w.travel) : null,
          hv = hasH ? Number(h.travel) : null;
        return `<div class="bar-group"><i class="bar weekday speed-bar" data-value="${hasW ? fmt(wv, 1) : ""}" title="平日 ${hasW ? fmt(wv, 3) + " km/h" : "讀不到數值"}" style="height:${hasW ? (wv / max) * 100 : 0}%"></i><i class="bar holiday speed-bar" data-value="${hasH ? fmt(hv, 1) : ""}" title="假日 ${hasH ? fmt(hv, 3) + " km/h" : "讀不到數值"}" style="height:${hasH ? (hv / max) * 100 : 0}%"></i><small>${p}</small></div>`;
      })
      .join(
        "",
      )}</div><div class="chart-legend"><i style="background:#247db4"></i>平日<i style="background:#e88943"></i>假日　單位：km/h</div>`;
    grid.append(card);
  }
}
function renderCharts() {
  const grid = $("chartGrid"),
    code = state.activeCode,
    own = state.summaries.filter((x) => x.projectCode === code);
  grid.innerHTML = "";
  $("chartEmpty").style.display = own.length ? "none" : "block";
  const roads = [...new Set(own.map((x) => x.road))];
  for (const road of roads) {
    const rows = own
      .filter((x) => x.road === road)
      .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
    const periods = [...new Set(rows.map((x) => x.period))];
    const card = document.createElement("article");
    card.className = "chart-card";
    card.innerHTML = `<h3>${esc(road)}</h3><div class="bars">${periods
      .map((p) => {
        const w = rows.find((x) => x.period === p && x.day === "平日"),
          h = rows.find((x) => x.period === p && x.day === "假日");
        return `<div class="bar-group"><i class="bar weekday" data-los="${w?.los || ""}" title="平日 ${w?.los || "—"}" style="height:${((losRank[w?.los] || 0) / 6) * 100}%"></i><i class="bar holiday" data-los="${h?.los || ""}" title="假日 ${h?.los || "—"}" style="height:${((losRank[h?.los] || 0) / 6) * 100}%"></i><small>${p}</small></div>`;
      })
      .join(
        "",
      )}</div><div class="chart-legend"><i style="background:#247db4"></i>平日<i style="background:#e88943"></i>假日　資料柱上方為LOS等級</div>`;
    grid.append(card);
  }
  renderTravelCharts(own, "speedTrendGrid");
}
function csv(rows, name) {
  if (!rows.length) return toast("目前沒有資料");
  // 取所有列的欄位聯集：舊版只看第一列，若第一列剛好是舊版沒有來源欄位的資料，
  // 整份 CSV 就會少掉來源檔名、工作表與驗證碼等欄位。
  const heads = [...new Set(rows.flatMap((row) => Object.keys(row)))],
    body = [heads, ...rows.map((r) => heads.map((h) => r[h]))]
      .map((a) => a.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  download(
    "\ufeff" + body,
    name || `${activeProject()?.code || "Project"}_尖峰明細.csv`,
    "text/csv",
  );
}
$("exportDetail").onclick = () =>
  csv(
    /*
     * CSV 是照欄位原樣倒出去的，direction 一定是鍵值（方向1／方向2）。
     * 交出去的檔案只有鍵值，收的人看不出哪個方向是哪一邊，所以另外補一欄
     * 顯示名稱。鍵值那一欄保留不動，既有的比對流程不受影響。
     */
    state.details
      .filter((x) => x.projectCode === state.activeCode)
      .map((x) => ({
        ...x,
        directionLabel: rowDirectionName(x),
      })),
  );
/**
 * 觸發瀏覽器下載。
 * 連結一定要先掛進文件再點擊：部分瀏覽器對「沒有掛進 DOM」的 <a> 會忽略
 * download 屬性，檔案就會被存成沒有副檔名的「download」，使用者根本認不出來。
 */
function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name || "download";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 1500);
}
globalThis.triggerDownload = triggerDownload;
function download(data, name, type = "application/json") {
  triggerDownload(URL.createObjectURL(new Blob([data], { type })), name);
}
function projectPackage() {
  const p = activeProject();
  if (!p) return null;
  const details = state.details.filter((x) => x.projectCode === p.code),
    summaries = state.summaries.filter((x) => x.projectCode === p.code),
    imports = state.imports.filter((x) => x.projectCode === p.code),
    limits = Object.fromEntries(
      Object.entries(state.limits).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    limitConfirmed = Object.fromEntries(
      Object.entries(state.limitConfirmed).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    aliases = Object.fromEntries(
      Object.entries(state.aliases).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    roadMeta = Object.fromEntries(
      Object.entries(state.roadMeta).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    speedVersions = Object.fromEntries(
      Object.entries(state.speedVersions).filter(([k]) => k.startsWith(`${p.code}|`)),
    ),
    reportDrafts = Object.fromEntries(
      Object.entries(state.reportDrafts).filter(([k]) => k.startsWith(`${p.code}|`)),
    );
  return {
    kind: "TLM_PROJECT_PACKAGE",
    exportedAt: new Date().toISOString(),
    project: p,
    details,
    summaries,
    imports,
    limits,
    limitConfirmed,
    aliases,
    roadMeta,
    speedVersions,
    anomalyRule: state.anomalyRules[p.code] || null,
    reportDrafts,
    losRule: rulesFor(p.code),
    /*
     * 結論草稿的「條件範本」也要跟著專案包走。
     *
     * 它存在 state.conclusionTemplates[計畫代碼]，本機是有存的，
     * 但**匯出的專案包原本沒有收**——使用者在 A 電腦存好幾組常用條件，
     * 帶到 B 電腦匯入之後範本一個都不在，而畫面只會說匯入成功。
     * 那些條件是使用者自己一項一項勾出來的，重建很花時間。
     */
    conclusionTemplates: (state.conclusionTemplates || {})[p.code] || [],
  };
}
function downloadProjectPackage(note = true) {
  const pack = projectPackage();
  if (!pack) {
    toast("尚未建立計畫");
    return false;
  }
  download(
    JSON.stringify(pack, null, 2),
    `${pack.project.code}_${pack.project.name}_Project專案包.json`,
  );
  if (note) toast("目前 Project 專案包已下載");
  return true;
}
$("downloadBackup").textContent = "下載目前 Project 專案包";
$("downloadBackup").onclick = () => downloadProjectPackage();
const portfolioBtn = document.createElement("button");
portfolioBtn.className = "outline";
portfolioBtn.style.marginLeft = "8px";
portfolioBtn.textContent = "下載個人全部計畫包";
$("downloadBackup").after(portfolioBtn);
portfolioBtn.onclick = () => {
  if (!state.projects.length) return toast("尚未建立計畫");
  download(
    JSON.stringify(
      {
        kind: "TLM_PORTFOLIO_PACKAGE",
        exportedAt: new Date().toISOString(),
        projects: state.projects,
        details: state.details,
        summaries: state.summaries,
        imports: state.imports,
        limits: state.limits,
        limitConfirmed: state.limitConfirmed,
        aliases: state.aliases,
        roadMeta: state.roadMeta,
        speedVersions: state.speedVersions,
        anomalyRules: state.anomalyRules,
        reportDrafts: state.reportDrafts,
        operations: state.operations,
        losRules: state.losRules,
        /* 條件範本（依計畫代碼分組），理由同 projectPackage。 */
        conclusionTemplates: state.conclusionTemplates || {},
      },
      null,
      2,
    ),
    "交通服務水準_個人全部計畫包.json",
  );
  toast("個人全部計畫包已下載");
};
/**
 * 判斷一份沒有 kind 標記的 JSON 是不是「舊版備份」。
 *
 * 只檢查「有沒有 projects 與 details 兩個陣列」是不夠的：一個
 * `{"projects":[],"details":[]}` 就能通過，載入後把使用者全部的資料清空，
 * 畫面卻顯示「備份已載入」。舊版備份是把整個 state 存成 JSON，一定同時
 * 帶著版本號與其他設定物件，而且至少有一個計畫、每個計畫都有編號。
 */
function looksLikeLegacyBackup(x) {
  if (!Array.isArray(x.projects) || !Array.isArray(x.details)) return false;
  if (!x.projects.length) return false;
  if (!x.projects.every((p) => p && typeof p.code === "string" && p.code)) return false;
  const bags = ["limits", "aliases", "roadMeta", "losRules"];
  return bags.some((k) => x[k] && typeof x[k] === "object");
}
$("restoreFile").onchange = async (e) => {
  // 還原前先把目前狀態留一份。舊版是「邊解析邊改 state」，
  // 遇到壞掉的備份檔會在改壞之後才丟出例外，畫面只顯示「這不是有效的備份檔」，
  // 但原本的資料其實已經被覆蓋，而且下一次存檔就寫進資料庫，救不回來。
  const snapshot = structuredClone(state);
  try {
    const x = JSON.parse(await e.target.files[0].text()),
      manager = state.manager;
    if (!x || typeof x !== "object") throw new Error("格式不符");
    if (x.kind === "TLM_PROJECT_PACKAGE") {
      state.projects = state.projects.filter((p) => p.code !== x.project.code);
      state.projects.push(x.project);
      state.activeCode = x.project.code;
      state.details = state.details
        .filter((d) => d.projectCode !== x.project.code)
        .concat(x.details || []);
      state.imports = state.imports
        .filter((d) => d.projectCode !== x.project.code)
        .concat(x.imports || []);
      Object.assign(state.limits, x.limits || {});
      Object.assign(state.limitConfirmed, x.limitConfirmed || {});
      Object.assign(state.aliases, x.aliases || {});
      Object.assign(state.roadMeta, x.roadMeta || {});
      Object.assign(state.speedVersions, x.speedVersions || {});
      if (x.anomalyRule) state.anomalyRules[x.project.code] = x.anomalyRule;
      Object.assign(state.reportDrafts, x.reportDrafts || {});
      /*
       * 備份裡有什麼就還原什麼，不要再用 isLegacyLosRule 過濾。
       *
       * A.9/B.7/C.5/D.4/E.3 是實務上真的有人在用的門檻表（migrateLosRules
       * 的註解自己就寫了這件事，所以只在版本升級時清一次）。這裡卻無條件
       * 過濾，於是「匯出專案包再還原同一個檔案」就會把使用者的自訂門檻
       * 清成預設值——同一筆速限比 0.65 的紀錄，還原前是 C、還原後變成 B，
       * 整個計畫的服務水準悄悄改變，畫面只說「備份已載入」。
       */
      if (x.losRule) state.losRules[x.project.code] = x.losRule;
      else delete state.losRules[x.project.code];
      /*
       * 條件範本：專案包裡有就帶進來。沒有（舊版的專案包）就維持這台電腦
       * 原本的，不要清空——把使用者已經存好的範本刪掉比不還原更糟。
       */
      state.conclusionTemplates = state.conclusionTemplates || {};
      if (Array.isArray(x.conclusionTemplates))
        state.conclusionTemplates[x.project.code] = x.conclusionTemplates;
    } else if (x.kind === "TLM_PORTFOLIO_PACKAGE") {
      state = { ...emptyState(), ...x, activeCode: x.projects?.[0]?.code || "", manager };
    } else if (looksLikeLegacyBackup(x)) {
      // 舊版備份沒有 kind 標記，只能靠形狀認。但「形狀」必須嚴格檢查：
      // 舊版是把整個 state 直接存成 JSON，一定同時帶著 projects 與 details
      // 兩個陣列。之前這裡是無條件 else，於是隨便一個 JSON（例如從別的系統
      // 匯出的設定檔）都會被當成備份，展開後 projects 變成 emptyState() 的空
      // 陣列，完整性檢查因此通過，接著 save() 就把使用者全部的計畫洗掉。
      state = { ...emptyState(), ...x, manager };
    } else throw new Error("缺少備份檔標記");
    if (!Array.isArray(state.projects) || !Array.isArray(state.details))
      throw new Error("內容不完整");
    state.summaries = Array.isArray(state.summaries) ? state.summaries : [];
    state.imports = Array.isArray(state.imports) ? state.imports : [];
    migrateLosRules();
    rebuild();
    await save();
    // 把載入了什麼講清楚，使用者才看得出自己剛剛換掉了什麼。
    toast(
      `備份已載入：${state.projects.length} 個計畫、${state.details.length} 筆尖峰明細`,
    );
  } catch {
    state = snapshot;
    renderAll();
    toast("這不是有效的備份檔，原有資料未變動");
  } finally {
    e.target.value = "";
  }
};
/**
 * 刪除一個計畫，以及它底下所有的資料。
 * 各種以「計畫編號|…」為鍵值的設定（速限、別名、路段資料、速限版本、
 * 報告草稿…）都必須一併清掉，否則之後建立同編號的計畫會沿用到舊設定。
 */
function purgeProject(code) {
  state.projects = state.projects.filter((x) => x.code !== code);
  state.details = state.details.filter((x) => x.projectCode !== code);
  state.summaries = state.summaries.filter((x) => x.projectCode !== code);
  state.imports = state.imports.filter((x) => x.projectCode !== code);
  for (const bag of ["limits", "limitConfirmed", "aliases", "roadMeta", "speedVersions"])
    for (const k of Object.keys(state[bag] || {}))
      if (k.startsWith(`${code}|`)) delete state[bag][k];
  for (const k of Object.keys(state.reportDrafts || {}))
    if (k.startsWith(`${code}|`)) delete state.reportDrafts[k];
  state.operations = (state.operations || []).filter((x) => x.projectCode !== code);
  delete state.losRules[code];
  delete state.anomalyRules[code];
  if (state.activeCode === code) state.activeCode = state.projects[0]?.code || "";
  clearPendingPreview();
}
/** 刪除計畫前一律先產生一份專案包，誤刪時還救得回來。 */
async function deleteProjectFlow(code, { fromSetup = false } = {}) {
  const target = state.projects.find((x) => x.code === code);
  if (!target) return toast("找不到要刪除的計畫");
  const rows = state.details.filter((x) => x.projectCode === code).length;
  const periods = [
    ...new Set(state.details.filter((x) => x.projectCode === code).map((x) => x.period)),
  ].length;
  if (
    !confirm(
      `確定要刪除計畫「${target.code} ${target.name}」嗎？\n\n` +
        `這個計畫底下的 ${periods} 個季度、${rows} 筆尖峰明細、彙總、路段速限、別名與報告草稿都會一起刪除，且無法復原。\n\n` +
        `按「確定」前，系統會先自動下載一份這個計畫的專案包備份。`,
    )
  )
    return;
  const previousActive = state.activeCode;
  state.activeCode = code;
  downloadProjectPackage(false);
  state.activeCode = previousActive;
  purgeProject(code);
  await save();
  toast(`計畫「${target.code} ${target.name}」已刪除，其他計畫不受影響`);
  if (fromSetup) go(state.projects.length ? "home" : "setup");
}
// 「備份與淨空」原本的按鈕寫著「清除目前瀏覽器內所有計畫及資料」，
// 實際上卻只刪掉目前這一個計畫，文案與行為不符。這裡改成兩個分開的動作。
$("clearAll").textContent = "刪除目前這一個計畫";
$("clearAll").onclick = async () => {
  const p = activeProject();
  if (!p) return toast("目前沒有計畫");
  await deleteProjectFlow(p.code);
};
const clearAllCard = $("clearAll").closest(".action-card");
if (clearAllCard) {
  clearAllCard.querySelector("b").textContent = "刪除計畫";
  clearAllCard.querySelector("p").textContent =
    "刪除目前選取的那一個計畫及其全部資料；刪除前會自動下載一份專案包備份。其他計畫不受影響。";
  const wipeAll = document.createElement("button");
  wipeAll.id = "wipeEverything";
  wipeAll.style.marginTop = "8px";
  wipeAll.textContent = "清除這台電腦上的全部計畫";
  clearAllCard.append(wipeAll);
  wipeAll.onclick = async () => {
    if (!state.projects.length && !state.manager.length) return toast("目前沒有任何資料");
    if (
      !confirm(
        `確定要清除這個瀏覽器內的「全部 ${state.projects.length} 個計畫」及 Manager 已匯入的專案包嗎？\n\n` +
          `此動作無法復原。建議先按上方「下載個人全部計畫包」保存備份。`,
      )
    )
      return;
    if (!confirm("再次確認：全部計畫資料都會被清除，且無法復原。確定繼續？")) return;
    state = emptyState();
    clearPendingPreview();
    await save();
    toast("已清除全部資料，回到全新空白模板");
    go("setup");
  };
}

$("managerFiles").onchange = async (e) => {
  let added = 0;
  for (const f of [...e.target.files])
    try {
      const p = JSON.parse(await f.text()),
        packs =
          p.kind === "TLM_PORTFOLIO_PACKAGE"
            ? (p.projects || []).map((project) => ({
                kind: "TLM_PROJECT_PACKAGE",
                project,
                details: (p.details || []).filter((x) => x.projectCode === project.code),
                summaries: (p.summaries || []).filter((x) => x.projectCode === project.code),
                /*
                 * 組合包原本只拆 details 與 summaries，roadMeta 整份被丟掉——
                 * 一次匯入多個計畫時，方向名稱一個都不會出現，而畫面只會說匯入成功。
                 */
                roadMeta: Object.fromEntries(
                  Object.entries(p.roadMeta || {}).filter(([k]) =>
                    k.startsWith(`${project.code}|`),
                  ),
                ),
              }))
            : [p];
      for (const pack of packs) {
        if (pack.kind !== "TLM_PROJECT_PACKAGE" || !pack.project?.code) continue;
        pack.importedAt = new Date().toLocaleString("zh-TW");
        state.manager = state.manager.filter((x) => x.project.code !== pack.project.code);
        state.manager.push(pack);
        added++;
      }
    } catch {}
  e.target.value = "";
  await save();
  toast(`已匯入或更新 ${added} 個 Project`);
};
for (const id of [
  "managerSearch",
  "managerProjectFilter",
  "managerPeriodFilter",
  "managerDayFilter",
  "managerLosFilter",
])
  $(id).addEventListener(id === "managerSearch" ? "input" : "change", renderManager);
$("resetManagerFilters").onclick = () => {
  for (const id of [
    "managerProjectFilter",
    "managerPeriodFilter",
    "managerDayFilter",
    "managerLosFilter",
    "managerSearch",
  ])
    $(id).value = "";
  renderManager();
};
$("clearManager").onclick = async () => {
  if (confirm("確定清除 Manager 內全部專案包？各 Project 本身不受影響。")) {
    state.manager = [];
    await save();
  }
};
$("exportManager").onclick = () =>
  csv(
    /*
     * Manager 畫面已經使用專案包的方向顯示名稱，匯出檔也必須一致。
     * direction 原始鍵值仍保留，另加 directionLabel 供人閱讀；
     * packageRoadMeta 只是畫面解析用的內部物件，不應出現在 CSV。
     */
    managerFilteredRows().map(({ packageProject, packageRoadMeta, ...row }) => ({
      ...row,
      directionLabel: managerDirectionName({ ...row, packageRoadMeta }),
    })),
    `Manager_篩選結果_${new Date().toISOString().slice(0, 10)}.csv`,
  );
function syncOptions(id, items, allLabel) {
  const el = $(id),
    old = el.value;
  el.innerHTML =
    `<option value="">${allLabel}</option>` +
    items.map((x) => `<option value="${esc(x.value ?? x)}">${esc(x.label ?? x)}</option>`).join("");
  el.value = [...el.options].some((x) => x.value === old) ? old : "";
}
function managerAllRows() {
  return state.manager.flatMap((p) =>
    (p.summaries || []).map((x) => ({
      ...x,
      packageProject: p.project,
      // 方向名稱是跟著專案包走的，這裡不接起來，Manager 就永遠只看得到鍵值。
      packageRoadMeta: p.roadMeta || null,
    })),
  );
}
/**
 * 一列在 Manager 搜尋框裡可以被搜到的文字。
 *
 * 舊版是 `Object.values(x).join(" ")`，有兩個問題：
 *
 * 1. **畫面上顯示的方向名稱搜不到。** 那個名稱是 managerDirectionName()
 *    從專案包的 roadMeta 解出來的，而 roadMeta 掛在 packageRoadMeta 這個
 *    **物件**上；Object.values(...).join(" ") 會把物件變成 "[object Object]"，
 *    名稱根本不在可搜尋的字串裡。使用者畫面上看到「南-北(北上)」，
 *    搜它卻得到「目前篩選條件沒有資料」。
 * 2. 反過來，packageProject 與 packageRoadMeta 兩個內部物件讓「object」
 *    這個字可以搜到全部資料。
 *
 * 這和方向名稱那一系列是同一族缺陷：**畫面顯示 X、功能操作 Y**。
 * 尖峰明細、尖峰彙總、Manager 比較的顯示，以及尖峰明細與 Manager 的匯出 CSV
 * 都已經在前幾版陸續修過；前一版把三個搜尋入口統一，本版再修好它順手
 * 把純量陣列（sourceRefs）也一起濾掉的問題。
 *
 * 這裡是「原有的可搜尋欄位**再加上**顯示名稱」，不是改成「只搜畫面上的欄位」
 * ——有些欄位（例如站號、資料別）沒有印在表格上但一直搜得到，
 * 縮小範圍會拿掉使用者既有的用法。
 */
function managerSearchText(row) {
  const { packageProject, packageRoadMeta, ...rest } = row;
  return rowSearchText(rest, managerDirectionName(row));
}
function managerFilteredRows() {
  const all = managerAllRows(),
    project = $("managerProjectFilter").value,
    period = $("managerPeriodFilter").value,
    day = $("managerDayFilter").value,
    los = $("managerLosFilter").value,
    q = normalize($("managerSearch").value);
  return all.filter(
    (x) =>
      (!project || x.projectCode === project) &&
      (!period || x.period === period) &&
      (!day || x.day === day) &&
      (!los || x.los === los) &&
      (!q || normalize(managerSearchText(x)).includes(q)),
  );
}
function renderManagerCharts(rows) {
  const grid = $("managerChartGrid"),
    project = $("managerProjectFilter").value;
  grid.innerHTML = "";
  $("managerSpeedTrendGrid").innerHTML = "";
  $("managerChartHint").style.display = project && rows.length ? "none" : "block";
  $("managerChartHint").textContent = project
    ? "目前篩選條件沒有可繪製資料。"
    : "請先選擇一個計畫，避免一次載入過多圖表。";
  managerSpeedTitle.style.display = project && rows.length ? "flex" : "none";
  if (!project) return;
  const roads = [...new Set(rows.map((x) => x.road))];
  for (const road of roads) {
    const own = rows
        .filter((x) => x.road === road)
        .sort((a, b) => periodIndex(a.period) - periodIndex(b.period)),
      periods = [...new Set(own.map((x) => x.period))],
      card = document.createElement("article");
    card.className = "chart-card";
    card.innerHTML = `<h3>${esc(road)}</h3><div class="bars">${periods
      .map((p) => {
        const w = own.find((x) => x.period === p && x.day === "平日"),
          h = own.find((x) => x.period === p && x.day === "假日");
        return `<div class="bar-group"><i class="bar weekday" data-los="${w?.los || ""}" title="平日 ${w?.los || "—"}" style="height:${((losRank[w?.los] || 0) / 6) * 100}%"></i><i class="bar holiday" data-los="${h?.los || ""}" title="假日 ${h?.los || "—"}" style="height:${((losRank[h?.los] || 0) / 6) * 100}%"></i><small>${p}</small></div>`;
      })
      .join(
        "",
      )}</div><div class="chart-legend"><i style="background:#247db4"></i>平日<i style="background:#e88943"></i>假日　資料柱上方為LOS等級</div>`;
    grid.append(card);
  }
  renderTravelCharts(rows, "managerSpeedTrendGrid");
}
/*
 * ── Manager 比較不會自動同步目前的 Project ──────────────────────────────────
 *
 * 這是設計上的分工：Manager 收的是**別人交來的專案包**，一份包就是一次交付，
 * 不會因為對方後來又改了什麼就跟著變。
 *
 * 但同一台電腦同時當 Project 又當 Manager 時（最常見的用法），這個分工會變成陷阱：
 * 使用者在 Project 改好方向名稱，切到 Manager 卻還看到舊的，畫面上沒有任何線索
 * 說明「你看的是 8/27 匯入的那一份」。實際發生過——使用者與我為此各查了三輪，
 * 最後才發現要重新匯出再匯入，程式其實一直是對的。
 *
 * 所以：本機同一個計畫代碼的內容如果和 Manager 裡那份包不一樣，就明講出來。
 * 只提醒，不自動同步——自動同步會讓「這份包是誰、什麼時候交的」這件事失去意義。
 */
function managerFingerprint(summaries, roadMeta) {
  const s = (summaries || [])
    /*
     * 指紋不只比畫面上的幾個數字。Manager 匯出的是整筆代表紀錄，
     * 只要會影響分析或顯示的內容改了，就應提醒重新匯出專案包。
     * 特別是 directionText：它已納入方向名稱備援，若不比對，
     * Project 的報告方向文字已更新時，Manager 仍不會顯示過期提醒。
     */
    .map((x) =>
      [
        x.period,
        x.road,
        x.day,
        x.peak,
        x.direction,
        x.directionText,
        x.travel,
        x.running,
        x.roadDelay,
        x.intersectionDelay,
        x.totalDelay,
        x.limit,
        x.ratio,
        x.los,
        x.detailCount,
      ].join("|"),
    )
    .sort()
    .join("\n");
  const meta = roadMeta || {};
  const m = Object.keys(meta)
    .sort()
    .map((k) => `${k}=${meta[k]?.directionA || ""}/${meta[k]?.directionB || ""}`)
    .join("\n");
  return `${s}\n--\n${m}`;
}

/** 本機也有、而且內容和 Manager 裡那份包不一樣的計畫。 */
function managerStaleProjects() {
  return state.manager
    .filter((p) => p.project?.code && state.projects.some((x) => x.code === p.project.code))
    .filter((p) => {
      const code = p.project.code;
      const localSummaries = state.summaries.filter((x) => x.projectCode === code);
      const localMeta = Object.fromEntries(
        Object.entries(state.roadMeta).filter(([k]) => k.startsWith(`${code}|`)),
      );
      return (
        managerFingerprint(localSummaries, localMeta) !==
        managerFingerprint(p.summaries, p.roadMeta)
      );
    })
    .map((p) => p.project);
}

function renderManagerStaleHint() {
  const box = $("managerStaleHint");
  if (!box) return;
  const stale = managerStaleProjects();
  if (!stale.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  /*
   * 一行講完。Manager 不自動同步的來龍去脈寫在手冊第 16 章，畫面上不重述——
   * 使用者要的是「怎麼回事、怎麼辦」，不是一段說明文。
   *
   * ⚠️ 名稱來自各自匯入的專案包，長度與數量都不受控：
   * 實測 8 個計畫一起過期會變成 166 字，一個委託案全名就可能有 40 字。
   * 所以最多列兩個、單一名稱過長就截斷，其餘用「等 N 個計畫」帶過——
   * 完整清單就在上方「已匯入 Project 專案包」那張表裡，不需要在提示裡重印。
   */
  // 超過兩個時只列一個就好——完整清單就在上方「已匯入 Project 專案包」那張表裡，
  // 提示的用途是「讓你知道有這回事」，不是取代那張表。
  const SHOW = stale.length > 2 ? 1 : 2;
  const short = (t) => (t.length > 22 ? `${t.slice(0, 22)}…` : t);
  const names = stale
    .slice(0, SHOW)
    .map((p) => esc(short(`${p.code} ${p.name}`)))
    .join("、");
  const more = stale.length > SHOW ? ` 等 ${stale.length} 個計畫` : "";
  box.innerHTML =
    `<b>⚠️ ${names}${more}：本機內容較新</b>` +
    `<p>Manager 顯示的是匯入當時的專案包。重新匯出並匯入即可更新（詳見手冊第 16 章）。</p>`;
}

function renderManager() {
  const all = managerAllRows(),
    projectBefore = $("managerProjectFilter").value;
  syncOptions(
    "managerProjectFilter",
    state.manager.map((x) => ({
      value: x.project.code,
      label: `${x.project.code} ${x.project.name}`,
    })),
    "全部計畫",
  );
  if (projectBefore) $("managerProjectFilter").value = projectBefore;
  const periodSource = all.filter(
    (x) => !$("managerProjectFilter").value || x.projectCode === $("managerProjectFilter").value,
  );
  syncOptions(
    "managerPeriodFilter",
    sortPeriods(periodSource.map((x) => x.period)),
    "全部季度",
  );
  const rows = managerFilteredRows();
  $("managerProjects").textContent = state.manager.length;
  $("managerRecords").textContent = rows.length;
  $("managerRoads").textContent = new Set(rows.map((x) => `${x.projectCode}|${x.road}`)).size;
  const ps = sortPeriods(rows.map((x) => x.period));
  $("managerPeriod").textContent = ps.length ? `${ps[0]}～${ps.at(-1)}` : "—";
  $("managerPackageRows").innerHTML = state.manager.length
    ? state.manager
        .map(
          (x) =>
            `<tr><td>${esc(x.project.code)}</td><td>${esc(x.project.name)}</td><td>${(x.summaries || []).length}</td><td>${esc(x.importedAt || x.exportedAt || "舊版匯入")}</td><td><button class="outline" data-remove-manager="${esc(x.project.code)}">移除</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="empty">尚未匯入 Project 專案包</td></tr>';
  renderManagerStaleHint();
  $("managerRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.projectCode)} ${esc(x.projectName)}</td><td>${esc(x.period)}</td><td>${esc(x.road)}</td><td>${esc(x.day)}</td><td>${esc(x.peak)}</td><td>${esc(managerDirectionName(x))}</td><td>${fmt(x.travel, 3)}</td><td>${fmt(x.totalDelay, 3)}</td><td>${losChip(x.los)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="9" class="empty">目前篩選條件沒有資料</td></tr>';
  document.querySelectorAll("[data-remove-manager]").forEach(
    (b) =>
      (b.onclick = async () => {
        const code = b.dataset.removeManager,
          p = state.manager.find((x) => x.project.code === code)?.project;
        if (confirm(`確定從 Manager 移除「${code} ${p?.name || ""}」？原始 Project 不受影響。`)) {
          state.manager = state.manager.filter((x) => x.project.code !== code);
          await save();
        }
      }),
  );
  renderManagerCharts(rows);
}
function renderImportLog() {
  const rows = (state.imports || []).filter((x) => x.projectCode === state.activeCode);
  $("importLogCount").textContent = `${rows.length} 個批次`;
  $("importLogRows").innerHTML = rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.time)}</td><td>${esc(x.projectCode)} ${esc(x.projectName)}</td><td>${esc(x.period)}</td><td>${x.files.length}</td><td>${x.added}</td><td>${x.updated}</td><td>${x.skipped}</td><td>${esc(x.status)}</td><td>${x.status === "有效" ? `<button class="outline" data-rollback="${esc(x.id)}">復原此批</button>` : "—"}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="9" class="empty">目前計畫尚無匯入紀錄</td></tr>';
  document
    .querySelectorAll("[data-rollback]")
    .forEach((b) => (b.onclick = () => rollbackBatch(b.dataset.rollback)));
}
/** 清掉「已經沒有任何明細」的路段自動命名，避免留下孤兒方向名稱。 */
function forgetOrphanDirectionNames() {
  const alive = new Set(
    state.details.map((d) => roadMetaKey(d.road, d.projectCode)),
  );
  for (const key of Object.keys(state.roadMeta || {})) {
    if (alive.has(key)) continue;
    const meta = state.roadMeta[key];
    if (!meta) continue;
    const cleared = { ...meta, directionA: "方向1", directionB: "方向2" };
    // 只有起訖點與期間設定值得保留；全空的話整筆刪掉。
    if (!cleared.startPeriod && !cleared.endPeriod) delete state.roadMeta[key];
    else state.roadMeta[key] = cleared;
  }
}
async function rollbackBatch(id) {
  const batch = state.imports.find((x) => x.id === id);
  if (!batch || batch.status !== "有效") return;
  const current = new Map(state.details.map((x) => [x.id, x])),
    written = Array.isArray(batch.writtenIds) ? batch.writtenIds : [],
    changed = written.filter(
      (key) => current.has(key) && current.get(key).importBatch !== id,
    );
  if (changed.length) return toast("此批資料已被後續批次更新，請先復原較新的相關批次");
  // 舊版的守門只看「被改掉的」，看不出「已經不存在的」。
  // 路段改名或合併會把每一筆的 id 全部改寫，這時 writtenIds 全部查無資料，
  // 守門形同虛設，一按復原就會把改名前的舊路段整批復活、與新名稱重複計算。
  if (written.length && written.some((key) => !current.has(key)))
    return toast("這批資料的路段名稱或期間已被後續操作變更，無法安全復原；請改用備份還原");
  // 「刪除季度」批次若之後又重新匯入同一季，直接還原會把新資料蓋回舊值。
  const restoring = (batch.previous || []).filter((row) => current.has(row.id));
  if (
    batch.type === "delete-quarter" &&
    restoring.some((row) => current.get(row.id).importBatch !== id)
  )
    return toast("這個季度在刪除後已重新匯入，還原會覆蓋新資料；請先復原較新的匯入批次");
  const message =
    batch.type === "delete-quarter"
      ? `確定還原已刪除的 ${batch.period}？\n將回復 ${batch.previous.length} 筆尖峰明細。`
      : `確定復原 ${batch.time} 的匯入？\n新增 ${batch.added} 筆將移除，更新 ${batch.updated} 筆將還原。`;
  if (!confirm(message)) return;
  const added = new Set(batch.addedIds);
  state.details = state.details.filter((x) => !added.has(x.id));
  const map = new Map(state.details.map((x) => [x.id, x]));
  batch.previous.forEach((x) => map.set(x.id, x));
  state.details = [...map.values()];
  batch.status = "已復原";
  batch.revertedAt = new Date().toLocaleString("zh-TW");
  // 匯入時會把報告上的方向文字寫進路段的方向名稱。復原之後，若這個路段
  // 已經沒有任何明細，那組名稱就是孤兒——匯錯檔（例如被別名對應到錯的
  // 路段）復原後，錯的方向名稱會留在路段管理裡，而且因為「已經不是預設值」
  // 之後匯入正確檔案時也不會再被更新。
  forgetOrphanDirectionNames();
  rebuild();
  await save();
  toast(batch.type === "delete-quarter" ? "該季度已還原" : "該匯入批次已復原");
}
function projectPeriods() {
  // 用期間本身的先後排序，不能用字串比較：
  // "100Q1".localeCompare("99Q4") 會是負的，99→100 年的資料會整個排反。
  return sortPeriods(
    state.details.filter((x) => x.projectCode === state.activeCode).map((x) => x.period),
  );
}
function refreshMaintenance() {
  const periods = projectPeriods(),
    selected = $("deletePeriod").value;
  $("deletePeriod").innerHTML =
    periods
      .map((p) => `<option value="${esc(p)}" ${p === selected ? "selected" : ""}>${p}</option>`)
      .join("") || '<option value="">目前沒有資料</option>';
  const period = $("deletePeriod").value,
    rows = state.details.filter((x) => x.projectCode === state.activeCode && x.period === period),
    roads = new Set(rows.map((x) => x.road)).size;
  $("deleteImpact").textContent = period
    ? `${period}：${rows.length} 筆尖峰明細、${roads} 個路段。刪除後可重新批次匯入。`
    : "目前沒有可刪除的季度";
  $("deleteQuarter").disabled = !rows.length;
}
$("deletePeriod").onchange = refreshMaintenance;
$("deleteQuarter").onclick = async () => {
  const p = activeProject(),
    period = $("deletePeriod").value,
    rows = state.details.filter((x) => x.projectCode === state.activeCode && x.period === period);
  if (!p || !rows.length) return;
  if (
    !confirm(
      `確定刪除「${p.code} ${p.name}」的 ${period}？\n共 ${rows.length} 筆尖峰明細。系統會先下載備份，刪除後可重新匯入。`,
    )
  )
    return;
  downloadProjectPackage(false);
  const now = new Date(),
    batch = {
      id: `D${Date.now()}`,
      type: "delete-quarter",
      projectCode: p.code,
      projectName: p.name,
      period,
      time: now.toLocaleString("zh-TW"),
      timestamp: now.toISOString(),
      files: [],
      addedIds: [],
      previous: structuredClone(rows),
      writtenIds: [],
      added: 0,
      updated: rows.length,
      skipped: 0,
      status: "有效",
    };
  state.details = state.details.filter((x) => !(x.projectCode === p.code && x.period === period));
  state.imports.unshift(batch);
  rebuild();
  await save();
  inspectHealth();
  toast(`${period} 已刪除，可重新批次匯入`);
};
function roadSignature(s) {
  return stripRoadSuffix(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　/\\_~～〜‐‑‒–—―－.,，、。:：;；()（）\[\]【】]/g, "");
}
function inspectHealth() {
  const rows = state.details.filter((x) => x.projectCode === state.activeCode),
    issues = [];
  const roads = [...new Set(rows.map((x) => x.road))];
  for (const road of roads) {
    const clean = stripRoadSuffix(road);
    if (clean !== road)
      issues.push({
        type: "異常名稱",
        period: "全部",
        road,
        item: road,
        detail: `疑似包含日別或日期尾碼，建議修正為「${clean}」`,
        fixable: true,
      });
  }
  const signatures = {};
  for (const road of roads) (signatures[roadSignature(road)] ??= []).push(road);
  for (const variants of Object.values(signatures)) {
    const names = [...new Set(variants)];
    if (names.length > 1)
      issues.push({
        type: "名稱疑似重複",
        period: "全部",
        item: names.join("／"),
        detail: "標點或分隔符不同，請確認是否為同一路段；可使用「路段名稱修改／合併」。",
      });
  }
  // 方向1／方向2 是照報告裡旅次出現的先後決定的。同一個路段若在不同季度、
  // 不同日別的報告裡把兩個方向的順序對調（調查員換方向起跑很常見），
  // 同一個「方向1」就會對應到兩個相反的實際方向，而數字看起來都很正常。
  // 每一列都記著報告上寫的方向文字，這裡拿來互相比對。
  const directionTexts = {};
  for (const d of rows) {
    if (!d.directionText) continue;
    const k = [d.road, d.direction].join("|");
    (directionTexts[k] ??= new Set()).add(d.directionText);
  }
  for (const [key, set] of Object.entries(directionTexts))
    if (set.size > 1) {
      const [road, direction] = key.split("|");
      issues.push({
        type: "方向對應不一致",
        period: "全部",
        item: `${road}／${direction}`,
        detail: `不同報告把這個方向寫成：${[...set].join("、")}。請確認各季報告的旅次順序是否一致，否則跨季比較會拿相反方向互比。`,
      });
    }
  // 分組的 key 用 | 串接，但還原欄位時不能再 split 回來——路段名稱本身可能
  // 含有 |，切出來的片段會變成錯誤的路段／日別，而那些值現在會進到篩選的
  // 下拉選單裡。改成把欄位直接掛在分組上。
  const groups = {};
  for (const d of rows) {
    const k = [d.period, d.road, d.day].join("|");
    (groups[k] ??= Object.assign([], { period: d.period, road: d.road, day: d.day })).push(d);
    if (!(
      Number(d.travel) > 0 &&
      Number(d.running) > 0 &&
      Number(d.totalDelay) >= 0 &&
      Number(d.limit) > 0
    ))
      issues.push({
        type: "數值異常",
        period: d.period,
        road: d.road,
        day: d.day,
        peak: d.peak,
        item: `${d.road}／${d.day}／${d.peak}／${rowDirectionName(d)}`,
        detail: "旅行速率、行駛速率、總延滯或速限包含空白、零值或無效數值。",
      });
    /*
     * 物理常識：旅行速率一定 ≤ 行駛速率（旅行速率含停等時間，行駛速率不含）。
     * 這個檢查本來只在匯入預覽時做，但備份／專案包還原是直接把資料塞進
     * state，完全不經過那條路徑——還原進來的不合理資料因此永遠不會被發現，
     * 還會被選為彙總的代表紀錄。
     */
    if (
      Number(d.travel) > 0 &&
      Number(d.running) > 0 &&
      Number(d.travel) > Number(d.running)
    )
      issues.push({
        type: "數值異常",
        period: d.period,
        road: d.road,
        day: d.day,
        peak: d.peak,
        item: `${d.road}／${d.day}／${d.peak}／${rowDirectionName(d)}`,
        detail: `旅行速率 ${fmt(d.travel, 1)} km/h 大於行駛速率 ${fmt(d.running, 1)} km/h，物理上不可能（旅行速率含停等時間）。常見原因是讀到隔壁欄位，請核對原始報告。`,
      });
  }
  for (const g of Object.values(groups))
    if (g.length !== 4)
      issues.push({
        type: "資料組不完整",
        period: g.period,
        road: g.road,
        day: g.day,
        item: `${g.road}／${g.day}`,
        detail: `應有4筆尖峰方向資料，目前為 ${g.length} 筆。`,
      });
  const periods = projectPeriods(),
    dayGroups = {};
  for (const d of rows)
    (dayGroups[`${d.period}|${stripRoadSuffix(d.road)}`] ??= new Set()).add(d.day);
  for (const period of periods)
    for (const road of roads) {
      if (!roadIsActive(road, period)) continue;
      const days = dayGroups[`${period}|${stripRoadSuffix(road)}`] || new Set();
      if (!days.has("平日") || !days.has("假日"))
        issues.push({
          type: "日別不完整",
          period,
          road,
          item: road,
          detail: days.size
            ? `目前只有 ${[...days].join("、")}，請確認本季是否漏匯檔案。`
            : "有效期間內沒有平日及假日資料，請確認是否漏匯。",
        });
    }
  // 這裡同樣不能 split 回來取欄位，改為連同原始欄位一起記著。
  const limitKeys = new Map();
  for (const d of rows)
    limitKeys.set(`${d.projectCode}|${d.road}|${d.direction}`, {
      road: d.road,
      direction: d.direction,
    });
  for (const [key, meta] of limitKeys)
    if (!state.limitConfirmed[key])
      issues.push({
        type: "速限未確認",
        period: "全部",
        road: meta.road,
        item: `${meta.road}／${directionNameFor(meta.road, meta.direction)}`,
        detail: `目前使用預設 ${state.limits[key] || 50} km/h，請至「路段速限」人工核對後按套用。`,
      });
  for (const road of roads)
    for (const day of ["平日", "假日"]) {
      const seq = state.summaries
        .filter((x) => x.projectCode === state.activeCode && x.road === road && x.day === day)
        .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1],
          now = seq[i],
          drop = (losRank[prev.los] || 0) - (losRank[now.los] || 0),
          speedChange = prev.travel ? Math.abs(now.travel - prev.travel) / prev.travel : 0;
        if (drop >= 2 || speedChange >= 0.25)
          issues.push({
            type: "異常變化",
            // 異常變化是「相鄰兩季之間」的比較，兩端都要記著，
            // 季度區間篩選才能用「比較區間有重疊就列出」的語意。
            fromPeriod: prev.period,
            period: now.period,
            road,
            day,
            item: `${road}／${day}`,
            detail: `相較 ${prev.period}：LOS ${prev.los}→${now.los}，旅行速率 ${fmt(prev.travel, 1)}→${fmt(now.travel, 1)} km/h，請確認資料或現地變化。`,
          });
      }
    }
  healthIssues = issues;
  healthChecked = true;
  healthStale = false;
  renderHealth();
  return issues;
}
function renderHealth() {
  const counts = (t) => healthIssues.filter((x) => x.type === t).length;
  $("healthNames").textContent = counts("異常名稱") + counts("名稱疑似重複");
  $("healthGroups").textContent = counts("資料組不完整") + counts("日別不完整");
  $("healthValues").textContent = counts("數值異常");
  /*
   * 沒檢查過就不能說「檢查通過」。品質總覽已經有這道守衛，這一格漏了：
   * 一開啟頁面（完全沒有資料時）就顯示「檢查通過，未發現異常」。
   * 檢查完之後資料又變動過的話，也要標示結果是舊的。
   */
  $("healthCount").textContent = !healthChecked
    ? "尚未檢查"
    : (healthIssues.length
        ? `發現 ${healthIssues.length} 項需確認`
        : "檢查通過，未發現異常") +
      (healthStale ? "（資料已變動，請重新檢查）" : "");
  $("healthCount").classList.toggle("stale", healthChecked && healthStale);
  $("healthRows").innerHTML = !healthChecked
    ? '<tr><td colspan="4" class="empty">按「執行健康檢查」開始</td></tr>'
    : healthIssues.length
      ? healthIssues
          .map(
            (x) =>
              `<tr><td>${esc(x.type)}</td><td>${esc(x.period)}</td><td>${esc(x.item)}</td><td>${esc(x.detail)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4" class="empty">目前計畫未發現資料異常</td></tr>';
  $("cleanSuffix").disabled = !healthIssues.some((x) => x.fixable);
  renderQuality();
}
/*
 * 品質總覽的篩選條件。
 *
 * 季度一累積，這張表就會長到幾十上百列，整片文字看不出重點。使用者要問的
 * 通常是「114Q1 到 114Q4 之間出過哪些異常」或「只看異常變化」，所以提供
 * 季度區間、類型（可複選）、路段、日別、尖峰五種篩選。
 *
 * 兩個刻意的設計：
 * 1. 篩選只影響「畫面」。匯出與交付的專案包一律含全部項目——篩選是給人看
 *    的工具，交付檔案不該因為畫面上剛好篩了什麼而少東西。
 * 2. 季度區間用「比較區間有重疊就列出」：異常變化是相鄰兩季相比，若只比對
 *    後面那一季，選 114Q1～114Q4 就會漏掉 113Q4→114Q1 這一筆，而那正是
 *    114Q1 出問題的原因。
 */
const QUALITY_TYPES = ["日別不完整", "資料組不完整", "速限未確認", "異常變化"];
const qualityFilter = { from: "", to: "", road: "", day: "", types: [] };
/**
 * 使用者是否自己動過匯入的年度／季度欄位。
 * 動過之後，renderAll 就不再把它改回「上次匯入的季度」。
 */
let importPeriodTouched = false;
/** 已經跑過健康檢查了嗎。沒跑過時不能宣稱「四項品質檢查均通過」。 */
let healthChecked = false;
/** 檢查完之後資料又變動過了嗎。是的話畫面上的結果是舊的，要講出來。 */
let healthStale = false;
/**
 * 這一筆異常涵蓋的季度區間；與季度無關的項目回 null（任何區間都列出）。
 * periodIndex 對無法解析的字串會回 -1，那個 -1 若被當成真正的季度，
 * 會讓區間變成「幾乎涵蓋全部」，使用者以為篩掉了舊季度其實沒有。
 */
function issueSpan(issue) {
  if (!issue.period || issue.period === "全部") return null;
  const end = periodIndex(issue.period);
  if (end < 0) return null;
  const start = issue.fromPeriod ? periodIndex(issue.fromPeriod) : end;
  const safeStart = start < 0 ? end : start;
  return { start: Math.min(safeStart, end), end: Math.max(safeStart, end) };
}
function filterQualityIssues(issues, filter) {
  // 無法解析的季度字串（手改過的備份可能出現 114Q9）不能當成邊界：
  // periodIndex 會回 -1，等於把下界拿掉。
  const fromIndex = filter.from ? periodIndex(filter.from) : -Infinity;
  const toIndex = filter.to ? periodIndex(filter.to) : Infinity;
  const from = fromIndex < 0 ? -Infinity : fromIndex;
  const to = toIndex < 0 ? Infinity : toIndex;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return issues.filter((issue) => {
    if (filter.types.length && !filter.types.includes(issue.type)) return false;
    /*
     * 路段與日別採用與季度相同的規則：「與這個維度無關的項目，任何選擇都列出」。
     *
     * 舊寫法是 issue.day !== filter.day，於是沒有日別欄位的項目（速限未確認、
     * 日別不完整）一選日別就整批消失——而「日別不完整」講的正是日別缺漏，
     * 被日別篩選藏起來完全說不通。路段同理，且日後若把「名稱疑似重複」
     * 這類沒有單一路段的項目納進來，也不會默默消失。
     */
    if (filter.road && issue.road && issue.road !== filter.road) return false;
    if (filter.day && issue.day && issue.day !== filter.day) return false;
    const span = issueSpan(issue);
    // 與季度無關的項目（名稱、速限）在任何區間都要看得到。
    if (!span) return true;
    return span.end >= lo && span.start <= hi;
  });
}
function renderQuality() {
  if (!$("qualityRows")) return;
  const all = healthIssues.filter((x) => QUALITY_TYPES.includes(x.type));
  // 上方四個數字報的是「全部」，不隨篩選變動——那是這一季的體檢結果，
  // 不是目前畫面看了幾筆。筆數變化在下面的「顯示 N / 共 M」講。
  $("qualityDay").textContent = all.filter((x) => x.type === "日別不完整").length;
  $("qualityGroup").textContent = all.filter((x) => x.type === "資料組不完整").length;
  $("qualitySpeed").textContent = all.filter((x) => x.type === "速限未確認").length;
  $("qualityChange").textContent = all.filter((x) => x.type === "異常變化").length;
  /*
   * 季度下拉要列「這個計畫有哪些季度」，不是「哪些季度已經出過異常」。
   * 用後者的話，4 季資料只有一筆異常時下拉就只剩那一季，使用者根本沒辦法
   * 表達「114Q1 到 114Q4」這個問題——而那正是這個功能要回答的問題。
   */
  const periods = projectPeriods().filter(validPeriod);
  const roads = [...new Set(all.map((x) => x.road).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );
  const fillSelect = (id, values, placeholder, current) => {
    const el = $(id);
    if (!el) return "";
    const keep = values.includes(current) ? current : "";
    el.innerHTML =
      `<option value="">${placeholder}</option>` +
      values
        .map((v) => `<option value="${esc(v)}"${v === keep ? " selected" : ""}>${esc(v)}</option>`)
        .join("");
    return keep;
  };
  qualityFilter.from = fillSelect("qualityFrom", periods, "不限", qualityFilter.from);
  qualityFilter.to = fillSelect("qualityTo", periods, "不限", qualityFilter.to);
  qualityFilter.road = fillSelect("qualityRoad", roads, "全部路段", qualityFilter.road);
  if ($("qualityDayFilter")) $("qualityDayFilter").value = qualityFilter.day;
  /*
   * 重畫按鈕會把焦點打掉：使用者用鍵盤按下一個類型鈕之後，該按鈕在事件處理
   * 過程中就被 innerHTML 換掉了，activeElement 掉回 body，第二下 Enter 沒有
   * 任何反應，得從頁首重新 Tab 一次。所以記住焦點在哪一顆，重畫後放回去。
   */
  const focusedType = document.activeElement?.closest?.(".anomaly-chip")?.dataset?.type;
  const focusedClear = document.activeElement?.id === "qualityClear";
  const chips = $("qualityTypeChips");
  if (chips) {
    chips.innerHTML =
      QUALITY_TYPES.map((type) => {
        const count = all.filter((x) => x.type === type).length;
        const on = qualityFilter.types.includes(type);
        return `<button type="button" class="anomaly-chip${on ? " on" : ""}" aria-pressed="${on}" data-type="${esc(type)}">${esc(type)}（${count}）</button>`;
      }).join("") +
      `<button type="button" class="anomaly-chip clear" id="qualityClear">清除篩選</button>`;
    if (focusedType)
      chips.querySelector(`.anomaly-chip[data-type="${CSS.escape(focusedType)}"]`)?.focus();
    else if (focusedClear) $("qualityClear")?.focus();
  }
  const rows = filterQualityIssues(all, qualityFilter);
  const countEl = $("qualityShown");
  if (countEl) {
    const base = !healthChecked
      ? "尚未檢查"
      : rows.length === all.length
        ? `共 ${all.length} 項`
        : `顯示 ${rows.length} / 共 ${all.length} 項`;
    countEl.textContent =
      healthChecked && healthStale ? `${base}（資料已變動，請重新檢查）` : base;
    countEl.classList.toggle("stale", healthChecked && healthStale);
  }
  // 還沒按過「執行健康檢查」時不能寫「四項品質檢查均通過」——那是把
  //「沒檢查」講成「檢查過而且沒問題」，是這張表最不該出的錯。
  $("qualityRows").innerHTML = !healthChecked
    ? '<tr><td colspan="4" class="empty">按「執行健康檢查」產生品質總覽</td></tr>'
    : rows.length
      ? rows
          .map(
            (x) =>
              `<tr><td>${esc(x.type)}</td><td>${esc(x.fromPeriod ? `${x.fromPeriod}→${x.period}` : x.period)}</td><td>${esc(x.item)}</td><td>${esc(x.detail)}</td></tr>`,
          )
          .join("")
      : all.length
        ? '<tr><td colspan="4" class="empty">目前篩選條件下沒有符合的項目，請放寬季度區間或類型。</td></tr>'
        : '<tr><td colspan="4" class="empty">目前四項品質檢查均通過</td></tr>';
}
/* 篩選事件用委派綁在整個面板上：下拉選單與類型鈕都是每次 render 重畫的。 */
qualityPanel.addEventListener("change", (e) => {
  const map = {
    qualityFrom: "from",
    qualityTo: "to",
    qualityRoad: "road",
    qualityDayFilter: "day",
  };
  const key = map[e.target.id];
  if (!key) return;
  qualityFilter[key] = e.target.value;
  renderQuality();
});
qualityPanel.addEventListener("click", (e) => {
  const chip = e.target.closest(".anomaly-chip");
  if (!chip) return;
  if (chip.id === "qualityClear") {
    qualityFilter.from = qualityFilter.to = qualityFilter.road = "";
    qualityFilter.day = "";
    qualityFilter.types = [];
  } else {
    const type = chip.dataset.type;
    qualityFilter.types = qualityFilter.types.includes(type)
      ? qualityFilter.types.filter((x) => x !== type)
      : [...qualityFilter.types, type];
  }
  renderQuality();
});
$("runHealth").onclick = () => {
  inspectHealth();
  toast(healthIssues.length ? `健康檢查完成：${healthIssues.length} 項需確認` : "健康檢查通過");
};
$("cleanSuffix").onclick = async () => {
  const p = activeProject(),
    targets = new Map(
      healthIssues.filter((x) => x.fixable).map((x) => [x.item, stripRoadSuffix(x.item)]),
    );
  if (!p || !targets.size) return;
  if (
    !confirm(
      `確定修正 ${targets.size} 個含日期尾碼的路段名稱？\n系統會先下載 Project 備份，再合併明細、彙總與速限。`,
    )
  )
    return;
  downloadProjectPackage(false);
  const cleanFirst = state.details.filter((x) => x.projectCode !== p.code || !targets.has(x.road)),
    dirty = state.details.filter((x) => x.projectCode === p.code && targets.has(x.road)),
    map = new Map(cleanFirst.map((x) => [x.id, x]));
  let dropped = 0;
  for (const d of dirty) {
    const old = d.road,
      target = targets.get(old);
    state.aliases[`${p.code}|${old}`] = target;
    const oldLimit = `${p.code}|${old}|${d.direction}`,
      newLimit = `${p.code}|${target}|${d.direction}`;
    if (!state.limits[newLimit]) state.limits[newLimit] = state.limits[oldLimit] || d.limit;
    if (state.limitConfirmed[oldLimit]) state.limitConfirmed[newLimit] = true;
    delete state.limits[oldLimit];
    delete state.limitConfirmed[oldLimit];
    // 速限版本一併搬過去（同 applyRoadChange）
    if (state.speedVersions?.[oldLimit]) {
      state.speedVersions[newLimit] = (state.speedVersions[newLimit] || []).concat(
        state.speedVersions[oldLimit],
      );
      delete state.speedVersions[oldLimit];
    }
    d.road = target;
    d.limit = state.limits[newLimit];
    d.ratio = d.travel == null ? null : d.travel / d.limit;
    d.los = losOf(d.ratio);
    d.id = [d.projectCode, d.year, `Q${d.quarter}`, target, d.day, d.peak, d.direction].join("|");
    // 併到同一個路段之後，鍵值可能撞到既有紀錄。保留既有的那一筆，
    // 但要記下丟掉幾筆——實測 32 筆合併成 16 筆而畫面只說「已修正並合併」，
    // 使用者不會知道有一半的資料被丟掉了（路段管理的合併就有揭露這件事）。
    if (!map.has(d.id)) map.set(d.id, d);
    else dropped += 1;
  }
  state.details = [...map.values()];
  rebuild();
  await save();
  inspectHealth();
  toast(
    dropped
      ? `明顯日期尾碼已修正並合併；其中 ${dropped} 筆與既有資料鍵值重複，已保留原有資料（合併前的備份已下載）。`
      : "明顯日期尾碼已修正並合併",
  );
};
function renderAll() {
  const p = activeProject(),
    ownDetails = state.details.filter((x) => x.projectCode === state.activeCode),
    ownSummary = state.summaries.filter((x) => x.projectCode === state.activeCode),
    options = state.projects
      .map(
        (x) =>
          `<option value="${esc(x.code)}" ${x.code === state.activeCode ? "selected" : ""}>${esc(x.code)} ${esc(x.name)}</option>`,
      )
      .join("");
  projectSwitch.innerHTML = options || '<option value="">尚未建立計畫</option>';
  $("projectPicker").innerHTML = '<option value="">＋ 建立新計畫</option>' + options;
  $("projectCode").value = p?.code || "";
  $("projectName").value = p?.name || "";
  $("headProject").textContent = p ? `${p.code} ${p.name}` : "尚未建立計畫";
  renderProjectSetupActions();
  $("mProject").textContent = state.projects.length;
  $("mDetail").textContent = ownDetails.length;
  $("mSummary").textContent = ownSummary.length;
  $("mPeriod").textContent = state.last.year ? `${state.last.year}Q${state.last.quarter}` : "—";
  $("mTime").textContent = state.last.time || "尚無資料";
  /*
   * 匯入表單只在「使用者還沒自己填過」時才帶入上次的季度。
   *
   * 舊版是每次 renderAll 都無條件覆寫，而每一個 save() 結尾都會呼叫
   * renderAll——於是使用者輸入 116 年第 3 季之後，去別的頁面存個路段名稱
   * 再回來，表單已經悄悄變回 115Q1，接著「確認寫入」就把資料寫進錯誤的
   * 季度。因為是程式指派，change 事件不會觸發，預覽失效的保護也不會啟動。
   */
  if (state.last.year && !importPeriodTouched) {
    $("rocYear").value = state.last.year;
    $("quarter").value = state.last.quarter;
  }
  renderDetails();
  renderSummaries();
  renderLosRules();
  renderLimits();
  renderCharts();
  renderManager();
  renderImportLog();
  refreshMaintenance();
  renderHealth();
  if (p && !ownDetails.length) {
    $("nextTitle").textContent = "匯入目前計畫的第一季尖峰資料";
    $("nextText").textContent = "選擇同一季度的平日、假日 Excel，先預覽再寫入。";
    $("nextBtn").onclick = () => go("import");
  } else if (ownDetails.length) {
    $("nextTitle").textContent = "檢查目前計畫的尖峰彙總";
    $("nextText").textContent = "確認旅行速率、行駛速率與總延滯來自同一筆紀錄。";
    $("nextBtn").onclick = () => go("summary");
  } else {
    $("nextTitle").textContent = "建立第一個計畫";
    $("nextText").textContent = "計畫數量不設上限，可持續新增並切換管理。";
    $("nextBtn").onclick = () => go("setup");
  }
}
const renderAllBase = renderAll;
renderAll = () => {
  renderAllBase();
  renderRoadAdmin();
};
load();
