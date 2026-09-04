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

    /** 某一欄現在可以選的值（依 Excel 的規則，排除自己這一欄的條件）。 */
    function optionsFor(column, allRows) {
      const seen = new Map();
      for (const row of applyExcept(allRows, column.name)) {
        const value = column.value(row);
        if (!seen.has(value)) seen.set(value, column.label(row));
      }
      return [...seen.entries()]
        .map(([value, label]) => ({ value, label }))
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

    function openFor(column, button, allRows) {
      closePanel();
      const options = optionsFor(column, allRows);
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
        `<div class="col-filter-foot">共 ${options.length} 個值</div>`;

      const list = panel.querySelector(".col-filter-list");
      function paint(keyword) {
        const key = (keyword || "").trim().toLowerCase();
        const shown = key
          ? options.filter((o) => String(o.label).toLowerCase().includes(key))
          : options;
        list.innerHTML = shown.length
          ? shown
              .map(
                (o, i) =>
                  `<label><input type="checkbox" data-i="${i}"${chosen.has(o.value) ? " checked" : ""}>` +
                  `<span>${String(o.label).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</span></label>`,
              )
              .join("")
          : '<p class="col-filter-empty">沒有符合的值</p>';
        list.querySelectorAll("input[type=checkbox]").forEach((box) => {
          box.onchange = () => {
            const option = shown[Number(box.dataset.i)];
            if (box.checked) chosen.add(option.value);
            else chosen.delete(option.value);
            config.onChange();
            /* 重畫表格會換掉表頭按鈕，這裡只更新面板自身的狀態列 */
            refreshButtons();
          };
        });
      }
      paint("");
      const search = panel.querySelector(".col-filter-search");
      if (search) search.oninput = () => paint(search.value);
      panel.querySelector('[data-act="all"]').onclick = () => {
        options.forEach((o) => chosen.add(o.value));
        config.onChange();
        paint(search ? search.value : "");
        refreshButtons();
      };
      panel.querySelector('[data-act="none"]').onclick = () => {
        chosen.clear();
        config.onChange();
        paint(search ? search.value : "");
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
     * @param {Array} optionRows 尚未套用欄位條件、但已套用搜尋框的列；供下拉列選項
     * @param {Array} universeRows 完整資料母體；只用來判斷已勾值是否真的被刪除或改名
     *
     * 兩者不能混用：全文搜尋可能暫時把已勾值排除，但那不代表資料已不存在。
     * 若拿 optionRows 做 prune，先篩 A 路段再搜尋 B 路段時，A 路段條件會被靜默清掉。
     */
    function mount(optionRows, universeRows = optionRows) {
      prune(universeRows);
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
          openFor(column, button, optionRows);
          if (openPanel) openPanel.dataset.name = column.name;
        };
      }
      refreshButtons();
    }

    return {
      filter,
      mount,
      anyActive: () => config.columns.some((c) => picked.get(c.name).size > 0),
      clearAll() {
        picked.forEach((set) => set.clear());
        closePanel();
      },
    };
  }

  globalThis.ColumnFilter = { create, close: closePanel };
})();
