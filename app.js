const STORAGE_KEY = "shared-ledger-expenses-v1";
const SETTINGS_KEY = "shared-ledger-settings-v1";

const categories = [
  { name: "居住", color: "#8c7cf0" },
  { name: "吃饭", color: "#f0a65a" },
  { name: "交通", color: "#5b8def" },
  { name: "日用品", color: "#65b68c" },
  { name: "宠物", color: "#d982a6" },
  { name: "医疗", color: "#e06f61" },
  { name: "娱乐", color: "#57bfc4" },
  { name: "其它", color: "#8b9099" },
];

const payers = [
  { name: "小王", color: "#7b8cff" },
  { name: "小陈", color: "#ffb169" },
];

const state = {
  expenses: [],
  settings: {
    memberName: "",
    monthlyBudget: 0,
    groupId: "default-ledger",
    supabaseUrl: "",
    supabaseKey: "",
  },
  activeView: "add",
  search: "",
  month: currentMonth(),
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => `¥${Number(value || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function previousMonth(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 2, 1);
  return date.toISOString().slice(0, 7);
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCategory(name) {
  if (name === "餐饮") return categories.find((category) => category.name === "吃饭");
  if (name === "日用") return categories.find((category) => category.name === "日用品");
  if (name === "其他") return categories.find((category) => category.name === "其它");
  return categories.find((category) => category.name === name) || categories[categories.length - 1];
}

function normalizeCategory(name) {
  return getCategory(name).name;
}

function getPayer(name) {
  return payers.find((payer) => payer.name === name) || payers[0];
}

function loadLocal() {
  state.expenses = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  state.settings = { ...state.settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function cloudReady() {
  return Boolean(state.settings.supabaseUrl && state.settings.supabaseKey && state.settings.groupId);
}

function supabaseEndpoint() {
  return `${state.settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/expenses`;
}

async function cloudRequest(url, options = {}) {
  const headers = {
    apikey: state.settings.supabaseKey,
    Authorization: `Bearer ${state.settings.supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...(options.headers || {}),
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return [];
  return response.json();
}

async function syncFromCloud() {
  if (!cloudReady()) {
    updateStatus("本地模式：在设置中填写 Supabase 后可同步");
    return;
  }

  updateStatus("正在同步...");
  const group = encodeURIComponent(state.settings.groupId);
  const rows = await cloudRequest(`${supabaseEndpoint()}?group_id=eq.${group}&select=*&order=date.desc,created_at.desc`);
  state.expenses = rows.map(fromCloudRow);
  saveLocal();
  updateStatus(`已同步 ${state.expenses.length} 条记录`);
}

async function upsertCloud(expense) {
  if (!cloudReady()) return;
  await cloudRequest(supabaseEndpoint(), {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(toCloudRow(expense)),
  });
}

async function deleteCloud(id) {
  if (!cloudReady()) return;
  await cloudRequest(`${supabaseEndpoint()}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

function toCloudRow(expense) {
  return {
    id: expense.id,
    group_id: state.settings.groupId,
    amount: expense.amount,
    category: expense.category,
    payer: expense.payer,
    note: expense.note,
    date: expense.date,
    member_name: expense.memberName,
    created_at: expense.createdAt,
  };
}

function fromCloudRow(row) {
  return {
    id: row.id,
    amount: Number(row.amount),
    category: normalizeCategory(row.category),
    payer: row.payer || row.member_name || "小王",
    note: row.note || "",
    date: row.date,
    memberName: row.member_name || "",
    createdAt: row.created_at,
  };
}

function updateStatus(text) {
  $("#syncStatus").textContent = text;
}

function renderCategoryOptions() {
  $("#category").innerHTML = categories.map((category) => `<option value="${category.name}">${category.name}</option>`).join("");
}

function renderSettings() {
  $("#memberName").value = state.settings.memberName || "";
  $("#monthlyBudget").value = state.settings.monthlyBudget || "";
  $("#groupId").value = state.settings.groupId || "";
  $("#supabaseUrl").value = state.settings.supabaseUrl || "";
  $("#supabaseKey").value = state.settings.supabaseKey || "";
}

function renderMonthFilter() {
  const months = [...new Set([currentMonth(), ...state.expenses.map((item) => item.date.slice(0, 7))])].sort().reverse();
  $("#monthFilter").innerHTML = months.map((month) => `<option value="${month}">${month}</option>`).join("");
  $("#monthFilter").value = months.includes(state.month) ? state.month : currentMonth();
  state.month = $("#monthFilter").value;
}

function filteredExpenses() {
  const keyword = state.search.trim().toLowerCase();
  return state.expenses
    .filter((item) => item.date.startsWith(state.month))
    .filter((item) => {
      if (!keyword) return true;
      return [item.category, item.note, item.payer, item.memberName, item.date].some((value) => String(value || "").toLowerCase().includes(keyword));
    })
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
}

function renderSummary() {
  const monthItems = state.expenses.filter((item) => item.date.startsWith(currentMonth()));
  const monthTotal = sum(monthItems);
  const budget = Number(state.settings.monthlyBudget || 0);
  const left = budget - monthTotal;
  $("#monthTotal").textContent = money(monthTotal);
  $("#monthBudget").textContent = money(budget);
  $("#budgetLeft").textContent = money(left);
  $("#budgetLeft").classList.toggle("is-negative", left < 0);
}

function renderList() {
  const list = $("#billList");
  const items = filteredExpenses();
  if (!items.length) {
    list.innerHTML = $("#emptyTemplate").innerHTML;
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const category = getCategory(item.category);
      const note = item.note ? `<div class="bill-note">${escapeHtml(item.note)}</div>` : "";
      const payer = item.payer || item.memberName || "小王";
      return `
        <article class="bill-item">
          <div class="bill-main">
            <div class="bill-title"><span class="dot" style="background:${category.color}"></span>${escapeHtml(item.category)}</div>
            ${note}
            <div class="bill-meta">${item.date} · ${escapeHtml(payer)}</div>
            <button class="delete-button" type="button" data-delete="${item.id}">删除</button>
          </div>
          <div class="bill-amount">${money(item.amount)}</div>
        </article>
      `;
    })
    .join("");
}

function renderStats() {
  const items = state.expenses.filter((item) => item.date.startsWith(state.month));
  const previous = previousMonth(state.month);
  const previousItems = state.expenses.filter((item) => item.date.startsWith(previous));
  const total = sum(items);
  $("#payerStatsMonthLabel").textContent = state.month;
  $("#categoryStatsMonthLabel").textContent = `${state.month} / ${previous}`;
  $("#payerStatsTotal").textContent = money(total);

  const payerGrouped = payers
    .map((payer) => ({
      ...payer,
      total: sum(items.filter((item) => (item.payer || item.memberName || "小王") === payer.name)),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  const categoryGrouped = categories.map((category) => ({
    ...category,
    current: sum(items.filter((item) => normalizeCategory(item.category) === category.name)),
    previous: sum(previousItems.filter((item) => normalizeCategory(item.category) === category.name)),
  }));

  drawPieChart($("#payerChart"), payerGrouped, total);
  drawBarChart($("#categoryBarChart"), categoryGrouped);
  renderRanks(payerGrouped, total);
}

function drawPieChart(canvas, grouped, total) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!grouped.length) {
    ctx.fillStyle = "#71716b";
    ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("本月暂无数据", width / 2, height / 2);
    return;
  }

  let start = -Math.PI / 2;
  const radius = 78;
  const centerX = width / 2;
  const centerY = 106;

  grouped.forEach((item) => {
    const angle = (item.total / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    start += angle;
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, 48, 0, Math.PI * 2);
  ctx.fillStyle = "#fffaf0";
  ctx.fill();
  ctx.fillStyle = "#202124";
  ctx.font = "700 20px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(money(total), centerX, centerY + 7);
}

function drawBarChart(canvas, grouped) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 24, right: 18, bottom: 72, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...grouped.flatMap((item) => [item.current, item.previous]));
  const slot = chartWidth / grouped.length;
  const barWidth = Math.min(14, slot / 3.4);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(116, 105, 91, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(width - padding.right, padding.top + chartHeight);
  ctx.stroke();

  grouped.forEach((item, index) => {
    const centerX = padding.left + slot * index + slot / 2;
    const baseY = padding.top + chartHeight;
    const previousHeight = (item.previous / maxValue) * chartHeight;
    const currentHeight = (item.current / maxValue) * chartHeight;

    roundedBar(ctx, centerX - barWidth - 2, baseY - previousHeight, barWidth, previousHeight, 6, "rgba(139, 144, 153, 0.48)");
    roundedBar(ctx, centerX + 2, baseY - currentHeight, barWidth, currentHeight, 6, item.color);

    ctx.save();
    ctx.translate(centerX, height - 16);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = "#716a62";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(item.name, 0, 0);
    ctx.restore();
  });

  ctx.fillStyle = "#716a62";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("灰色上月", padding.left, 14);
  ctx.fillStyle = "#8c7cf0";
  ctx.fillText("彩色本月", padding.left + 70, 14);
}

function roundedBar(ctx, x, y, width, height, radius, color) {
  if (height <= 0) return;
  const r = Math.min(radius, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
  ctx.fill();
}

function renderRanks(grouped, total) {
  const list = $("#rankList");
  if (!grouped.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = grouped
    .map((item) => {
      const percent = total ? Math.round((item.total / total) * 100) : 0;
      return `
        <article class="rank-item">
          <div class="rank-main">
            <div class="rank-title"><span class="dot" style="background:${item.color}"></span>${item.name}</div>
            <div class="progress"><span style="width:${percent}%; background:${item.color}"></span></div>
          </div>
          <div class="rank-amount">${money(item.total)}</div>
        </article>
      `;
    })
    .join("");
}

function sum(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function render() {
  renderMonthFilter();
  renderSummary();
  renderList();
  renderStats();
}

function bindEvents() {
  $(".tabbar").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    state.activeView = button.dataset.target;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === state.activeView));
    render();
  });

  $("#expenseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const expense = {
      id: uid(),
      amount: Number($("#amount").value),
      category: normalizeCategory($("#category").value),
      payer: $("#payer").value,
      date: $("#date").value,
      note: $("#note").value.trim(),
      memberName: state.settings.memberName.trim(),
      createdAt: new Date().toISOString(),
    };
    state.expenses.unshift(expense);
    saveLocal();
    render();
    event.target.reset();
    $("#date").value = today();
    $("#payer").value = "小王";
    $("#amount").focus();
    try {
      await upsertCloud(expense);
      updateStatus(cloudReady() ? "已保存并同步" : "已保存到本地");
    } catch (error) {
      updateStatus("已保存到本地，云端同步失败");
    }
  });

  $("#billList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    const id = button.dataset.delete;
    state.expenses = state.expenses.filter((item) => item.id !== id);
    saveLocal();
    render();
    try {
      await deleteCloud(id);
      updateStatus(cloudReady() ? "已删除并同步" : "已删除本地记录");
    } catch (error) {
      updateStatus("本地已删除，云端删除失败");
    }
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderList();
  });

  $("#monthFilter").addEventListener("change", (event) => {
    state.month = event.target.value;
    renderList();
    renderStats();
  });

  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.settings = {
      memberName: $("#memberName").value.trim(),
      monthlyBudget: Number($("#monthlyBudget").value || 0),
      groupId: $("#groupId").value.trim() || "default-ledger",
      supabaseUrl: $("#supabaseUrl").value.trim(),
      supabaseKey: $("#supabaseKey").value.trim(),
    };
    saveSettings();
    updateStatus("设置已保存");
    try {
      await syncFromCloud();
      render();
    } catch (error) {
      updateStatus("设置已保存，云端连接失败");
    }
  });

  $("#syncNow").addEventListener("click", async () => {
    try {
      await syncFromCloud();
      render();
    } catch (error) {
      updateStatus("同步失败，请检查设置");
    }
  });
}

function init() {
  loadLocal();
  state.expenses = state.expenses.map((expense) => ({
    ...expense,
    category: normalizeCategory(expense.category),
    payer: expense.payer || expense.memberName || "小王",
  }));
  renderCategoryOptions();
  renderSettings();
  $("#date").value = today();
  bindEvents();
  render();
  updateStatus(cloudReady() ? "可同步" : "本地模式：在设置中填写 Supabase 后可同步");
  if (cloudReady()) {
    syncFromCloud().then(render).catch(() => updateStatus("自动同步失败，请检查设置"));
  }
}

init();
