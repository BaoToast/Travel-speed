/*
 * 表頭欄位篩選——像 Excel 的「資料篩選」那樣，在每個欄位標題上掛一個下拉。
 *
 * 使用者要的東西：
 *   「尖峰明細、尖峰彙總的篩選功能是輸入文字做篩選，能否變成如同 Excel 資料篩選
 *     那樣，針對表標題列提供篩選，例如期間篩選 115Q2，然後路段篩選 A 路段，
 *     表單就呈現出 115Q2 A 路段的資訊。」
 *
 * 所以規則是：
 *   ・每個可篩選的欄位標題旁邊有一個漏斗按鈕，點開是**該欄目前真的有的值**的勾選清單
 *   ・同一欄勾多個 → 那幾個值都要（OR）
 *   ・不同欄各自勾 → 條件疊加（AND）。期間勾 115Q2、路段勾 A 路段，就只剩兩者都符合的列
 *   ・一欄都沒勾 = 這一欄不設限，不是「全部排除」
 *   ・原本的全文搜尋框保留，兩者同時生效（使用者指定保留）
 *
 * ── 兩個容易做錯、但錯了很難發現的地方 ──
 *
 * 一、**篩選比對的是「儲存值」，畫面上顯示的是「顯示值」。**
 *     期間存的一律是民國年（115Q1），但畫面可能顯示成西元、也可能顯示成月份。
 *     所以每一欄要分開提供 `value(row)`（拿來比對、當識別鍵）與 `label(row)`
 *     （拿來給人看）。用顯示值當鍵的話，切換民國／西元顯示就會把已勾的條件弄丟，
 *     而且同一季在兩種顯示下會變成兩個不同的選項。
 *
 * 二、**選項清單要排除「自己這一欄」的條件。**
 *     期間已經勾了 115Q2 之後，再打開「路段」，看到的應該是
 *     「115Q2 這一季有哪些路段」；但再打開「期間」時，看到的必須仍然是完整的季度清單，
 *     否則勾完就再也改不掉了（清單裡只剩自己勾的那一個）。
 *     這也是 Excel 的行為。
 *
 * 另外，勾過的值若因為刪除季度、改名而不存在了，會在重畫時自動剔除——
 * 否則畫面會變成一片空白，而且看不出原因。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  L-1（使用者 2026-09-15 裁示）：選項母體是**全部資料**，不是主工具列篩剩的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「主工具列做了篩選的話，表格也跟著做篩選……但這種篩選是表單自己全部資料下
 *     跟著主工具列做的篩選，**使用者點開路段篩選鈕時，仍舊看得到全部路段的資料**，
 *     如果勾了一個與主工具列目前篩選條件不同的路段，**這個表單就脫離，
 *     只影響這個表單**，並出現回歸主工具列的按鈕，主工具列也跳出全部回歸按鈕。」
 *
 * ⚠️ 這**推翻了**升級初期的作法。舊版把選項母體限制在主工具列篩剩的資料上，
 *   於是主工具列選了 115Q1～115Q2 之後，漏斗裡再也找不到 114 年的季度——
 *   使用者 2026-09-15 回報：「**會誤以為自己表格裡 114Q1～114Q4 資料遺失了**」。
 *   當時的補救是加一句說明（C-4／J-3），但那只是把「做不到」講出來而已；
 *   使用者要的是**做得到**。
 *
 * 所以現在分成三份資料，三份都要傳進 mount()，少傳一份就會退回舊行為：
 *   ・fullRows    ＝ 這個計畫的**全部**資料（完全不看主工具列）→ 決定漏斗裡**列出哪些值**
 *   ・optionRows  ＝ 已套用主工具列（與搜尋框）的資料 → 決定哪些值算「在目前條件內」
 *   ・universeRows＝ 判斷已勾的值是不是真的被刪掉了（不能拿搜尋結果來判斷）
 *
 * 勾到「不在目前條件內」的值時，這裡**不自己處理**——呼叫 config.onOutOfScope()，
 * 由呼叫端決定怎麼脫離（脫離狀態屬於主工具列的三態模型，不屬於這一支）。
 * 回傳 truthy 代表呼叫端已經自己重畫過了，這裡就不再呼叫 onChange，避免畫兩次。
 */
(function () {
  "use strict";

  /** 目前開著的下拉，全域只會有一個。 */
  let openPanel = null;
  function closePanel() {
    if (openPanel && openPanel.parentNode) openPanel.parentNode.removeChild(openPanel);
    openPanel = null;
  }
  document.addEventListener("click", (event) => {
    if (!openPanel) return;
    if (openPanel.contains(event.target)) return;
    if (event.target.closest && event.target.closest(".col-filter-btn")) return;
    closePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  /**
   * 建立一組表頭篩選。
   *
   * @param {object} config
   * @param {string} config.thead      表頭那一列的 CSS 選擇器（例如 "#detailTable thead tr"）
   * @param {string} config.summary    顯示「已篩選 N 欄」與清除鈕的容器選擇器
   * @param {Array} config.columns     [{ index, name, value(row), label(row) }]
   *                                   index 是這一欄在 <tr> 裡的位置（0 起算）
   * @param {Function} config.onChange 條件變動時呼叫（通常就是重畫表格的函式）
   */
  function create(config) {
    /** field name -> Set(儲存值)。空集合代表這一欄不設限。 */
    const picked = new Map();
    config.columns.forEach((column) => picked.set(column.name, new Set()));

    /*
     * mount() 收到的三份資料留在這裡，開面板時才用得到。
     * ⚠️ 不要在 openFor() 的參數上傳——按鈕的 onclick 是在 mount 當下綁的，
     *   閉包會抓住**那一次**的陣列；下一次重畫之後按鈕雖然重綁，
     *   但中間任何一次非重畫的更新（例如只換 refreshButtons）就會拿到舊資料。
     */
    let mountedOptionRows = [];
    let mountedFullRows = [];

    /** 只套用「除了 skip 以外」的欄位條件。 */
    function applyExcept(rows, skip) {
      return rows.filter((row) =>
        config.columns.every((column) => {
          if (column.name === skip) return true;
          const chosen = picked.get(column.name);
          if (!chosen || chosen.size === 0) return true;
          return chosen.has(column.value(row));
        }),
      );
    }

    /** 全部欄位條件都套用。呼叫端要先自己套用搜尋框。 */
    function filter(rows) {
      return applyExcept(rows, null);
    }

    /**
     * 某一欄現在可以選的值（依 Excel 的規則，排除自己這一欄的條件）。
     *
     * ⚠️ 列出來的是 **fullRows**（全部資料）的值，不是主工具列篩剩的——
     *   這就是 L-1。哪些值「不在主工具列目前的條件內」則由 optionRows 決定，
     *   標在 inScope 上，畫面會把它們標出來、勾了會讓整張表脫離。
     */
    function optionsFor(column) {
      const inScope = new Set(
        applyExcept(mountedOptionRows, column.name).map((row) => column.value(row)),
      );
      const seen = new Map();
      for (const row of applyExcept(mountedFullRows, column.name)) {
        const value = column.value(row);
        if (!seen.has(value)) seen.set(value, column.label(row));
      }
      return [...seen.entries()]
        .map(([value, label]) => ({ value, label, inScope: inScope.has(value) }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label), "zh-Hant"));
    }

    /** 勾過的值若已經不存在於資料裡就剔除，避免表格莫名變空白。 */
    function prune(allRows) {
      for (const column of config.columns) {
        const chosen = picked.get(column.name);
        if (!chosen.size) continue;
        const exists = new Set(allRows.map((row) => column.value(row)));
        for (const value of [...chosen]) if (!exists.has(value)) chosen.delete(value);
      }
    }

    /**
     * 勾到了「不在主工具列目前條件內」的值 → 交給呼叫端脫離。
     * @returns true 代表呼叫端已經自己重畫過，這裡就不要再 onChange。
     */
    function handedOffOutOfScope(columnName, value) {
      if (typeof config.onOutOfScope !== "function") return false;
      return Boolean(config.onOutOfScope(columnName, value));
    }

    function openFor(column, button) {
      closePanel();
      /*
       * ⚠️ options 必須是 let，而且脫離之後要重算。
       *   脫離的那一刻「不在主工具列條件內」的值全部變成在範圍內了，
       *   面板卻還開著；不重算的話灰字與那一句說明會留在畫面上，
       *   使用者會以為自己還在受限，而實際上已經不是了。
       */
      let options = optionsFor(column);
      const chosen = picked.get(column.name);
      const panel = document.createElement("div");
      panel.className = "col-filter-panel";
      panel.innerHTML =
        `<div class="col-filter-head"><b>${column.name}</b>` +
        `<div><button type="button" data-act="all">全選</button>` +
        `<button type="button" data-act="none">清除</button></div></div>` +
        (options.length > 12
          ? '<input class="col-filter-search" type="search" placeholder="在這一欄裡找…">'
          : "") +
        '<div class="col-filter-list"></div>' +
        '<div class="col-filter-foot" data-testid="col-filter-foot"></div>';

      const list = panel.querySelector(".col-filter-list");
      const foot = panel.querySelector(".col-filter-foot");
      /*
       * ⚠️ 有範圍外的值時一定要在這裡講清楚會發生什麼事。
       *   使用者按下去之前看不到後果的話，「整張表脫離」會像是程式壞了。
       */
      function paintFoot() {
        const outside = options.filter((o) => !o.inScope).length;
        foot.innerHTML =
          `共 ${options.length} 個值` +
          (outside
            ? `，其中 <b>${outside} 個不在主工具列目前的條件內</b>（標成灰字）。勾了它，<b>這一張表就會脫離主工具列</b>、改用完整資料，只影響這一張表，旁邊會出現「回到主工具列條件」。`
            : "");
      }
      function paint(keyword) {
        const key = (keyword || "").trim().toLowerCase();
        const shown = key
          ? options.filter((o) => String(o.label).toLowerCase().includes(key))
          : options;
        list.innerHTML = shown.length
          ? shown
              .map(
                (o, i) =>
                  `<label${o.inScope ? "" : ' class="col-filter-outside" data-outside="1"'}>` +
                  `<input type="checkbox" data-i="${i}"${chosen.has(o.value) ? " checked" : ""}>` +
                  `<span>${String(o.label).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</span>` +
                  (o.inScope ? "" : '<small class="col-filter-outside-tag">不在主工具列條件內</small>') +
                  "</label>",
              )
              .join("")
          : '<p class="col-filter-empty">沒有符合的值</p>';
        list.querySelectorAll("input[type=checkbox]").forEach((box) => {
          box.onchange = () => {
            const option = shown[Number(box.dataset.i)];
            if (box.checked) chosen.add(option.value);
            else chosen.delete(option.value);
            /*
             * ⚠️ 勾了範圍外的值就整張表脫離。順序不可以反過來：
             *   要先把值放進 chosen，呼叫端重畫時才看得到這個條件；
             *   先脫離再放值的話，重畫那一次還是舊條件，畫面會慢一拍。
             */
            const handed =
              box.checked && !option.inScope && handedOffOutOfScope(column.name, option.value);
            if (!handed) config.onChange();
            else options = optionsFor(column);
            /* 重畫表格會換掉表頭按鈕，這裡只更新面板自身的狀態列 */
            repaint();
            refreshButtons();
          };
        });
        paintFoot();
      }
      let search = null;
      const repaint = () => paint(search ? search.value : "");
      paint("");
      search = panel.querySelector(".col-filter-search");
      if (search) search.oninput = () => paint(search.value);
      panel.querySelector('[data-act="all"]').onclick = () => {
        /*
         * ⚠️ 「全選」也會勾到範圍外的值——那同樣要脫離。
         *   漏掉這一條的話，一顆按鈕就能讓表格顯示範圍外的資料而不標示，
         *   那正是這一整段要防的事。
         */
        const outside = options.find((o) => !o.inScope);
        options.forEach((o) => chosen.add(o.value));
        const handed = outside && handedOffOutOfScope(column.name, outside.value);
        if (!handed) config.onChange();
        else options = optionsFor(column);
        repaint();
        refreshButtons();
      };
      panel.querySelector('[data-act="none"]').onclick = () => {
        chosen.clear();
        config.onChange();
        repaint();
        refreshButtons();
      };

      document.body.appendChild(panel);
      openPanel = panel;
      /* 定位在按鈕正下方，靠右不要超出視窗 */
      const rect = button.getBoundingClientRect();
      const width = panel.offsetWidth || 240;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      panel.style.left = `${Math.round(left + window.scrollX)}px`;
      panel.style.top = `${Math.round(rect.bottom + window.scrollY + 4)}px`;
      if (search) search.focus();
    }

    /** 依目前條件更新每個欄位按鈕的樣子，以及「已篩選」提示。 */
    function refreshButtons() {
      const head = document.querySelector(config.thead);
      if (!head) return;
      let activeColumns = 0;
      for (const column of config.columns) {
        const chosen = picked.get(column.name);
        const th = head.children[column.index];
        if (!th) continue;
        const button = th.querySelector(".col-filter-btn");
        if (!button) continue;
        const on = chosen.size > 0;
        if (on) activeColumns += 1;
        button.classList.toggle("on", on);
        button.textContent = on ? `▼ ${chosen.size}` : "▼";
        button.title = on
          ? `${column.name}：已選 ${chosen.size} 個值（點開可修改）`
          : `依「${column.name}」篩選`;
      }
      const summary = config.summary && document.querySelector(config.summary);
      if (summary) {
        summary.innerHTML = activeColumns
          ? `<span class="col-filter-on">已篩選 ${activeColumns} 個欄位</span>` +
            '<button type="button" class="col-filter-clear">清除全部篩選</button>'
          : "";
        const clear = summary.querySelector(".col-filter-clear");
        if (clear)
          clear.onclick = () => {
            picked.forEach((set) => set.clear());
            closePanel();
            config.onChange();
          };
      }
    }

    /**
     * 把按鈕掛回表頭。表格重畫之後要呼叫一次。
     *
     * @param {Array} optionRows   已套用主工具列與搜尋框的列 → 決定哪些值「在目前條件內」
     * @param {Array} universeRows 已套用主工具列、但**沒有**搜尋框的列
     * @param {Array} fullRows     完全不看主工具列的全部資料 → 決定漏斗裡**列出哪些值**
     *
     * ⚠️ 三者不能混用：
     *   ・全文搜尋可能暫時把已勾值排除，但那不代表資料已不存在——
     *     拿 optionRows 做 prune 的話，先篩 A 路段再搜尋 B 路段時，
     *     A 路段條件會被靜默清掉。
     *   ・prune 要拿 **fullRows**：主工具列篩掉的值**還在資料裡**，
     *     用 universeRows 做 prune 會把使用者勾的範圍外條件當成「已刪除」而清掉，
     *     於是 L-1 的脫離一按下去就被自己抹掉（勾了→脫離→重畫→prune 清掉→回到原狀）。
     *   ・fullRows 沒傳時退回 universeRows，行為與 L-1 之前相同（例如路段速限那一張，
     *     它本來就完全不吃主工具列，全部資料就是它的母體）。
     */
    function mount(optionRows, universeRows = optionRows, fullRows = universeRows) {
      mountedOptionRows = optionRows;
      mountedFullRows = fullRows;
      prune(fullRows);
      const head = document.querySelector(config.thead);
      if (!head) return;
      for (const column of config.columns) {
        const th = head.children[column.index];
        if (!th) continue;
        if (!th.querySelector(".col-filter-btn")) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "col-filter-btn";
          th.classList.add("has-col-filter");
          th.appendChild(button);
        }
        const button = th.querySelector(".col-filter-btn");
        button.onclick = (event) => {
          event.stopPropagation();
          if (openPanel && openPanel.dataset.name === column.name) return void closePanel();
          openFor(column, button);
          if (openPanel) openPanel.dataset.name = column.name;
        };
      }
      refreshButtons();
    }

    return {
      filter,
      mount,
      anyActive: () => config.columns.some((c) => picked.get(c.name).size > 0),
      /**
       * 圖表下鑽等程式化操作用：直接指定某欄要保留的儲存值。
       * 不在這裡觸發 onChange，讓呼叫端可一次設定多欄後只重畫一次。
       */
      set(name, values) {
        const chosen = picked.get(name);
        if (!chosen) return false;
        chosen.clear();
        for (const value of values || []) chosen.add(value);
        return true;
      },
      clearAll() {
        picked.forEach((set) => set.clear());
        closePanel();
      },
    };
  }

  globalThis.ColumnFilter = { create, close: closePanel };
})();
