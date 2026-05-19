const STORAGE_KEY = "karada-log-records";
const SETTINGS_KEY = "karada-log-settings";
const DEFAULT_HEIGHT_CM = 164;
const DEFAULT_STEP_GOAL = 8000;
const DEFAULT_CALORIE_GOAL = 1800;

const els = {
  form: document.querySelector("#entryForm"),
  date: document.querySelector("#dateInput"),
  weight: document.querySelector("#weightInput"),
  fat: document.querySelector("#fatInput"),
  note: document.querySelector("#noteInput"),
  today: document.querySelector("#todayButton"),
  latestWeight: document.querySelector("#latestWeight"),
  latestFat: document.querySelector("#latestFat"),
  weightDelta: document.querySelector("#weightDelta"),
  fatDelta: document.querySelector("#fatDelta"),
  avgSevenWeight: document.querySelector("#avgSevenWeight"),
  avgSevenFat: document.querySelector("#avgSevenFat"),
  avgSevenDiff: document.querySelector("#avgSevenDiff"),
  avgFourteenWeight: document.querySelector("#avgFourteenWeight"),
  avgFourteenFat: document.querySelector("#avgFourteenFat"),
  avgFourteenDiff: document.querySelector("#avgFourteenDiff"),
  bmi: document.querySelector("#bmiValue"),
  recordCount: document.querySelector("#recordCount"),
  latestSteps: document.querySelector("#latestSteps"),
  latestCalories: document.querySelector("#latestCalories"),
  avgSteps: document.querySelector("#avgSteps"),
  avgCalories: document.querySelector("#avgCalories"),
  activityAverageSteps: document.querySelector("#activityAverageSteps"),
  activityTotalSteps: document.querySelector("#activityTotalSteps"),
  stepGoalStatus: document.querySelector("#stepGoalStatus"),
  activityAverageCalories: document.querySelector("#activityAverageCalories"),
  activityTotalCalories: document.querySelector("#activityTotalCalories"),
  calorieGoalStatus: document.querySelector("#calorieGoalStatus"),
  chart: document.querySelector("#trendChart"),
  activityChart: document.querySelector("#activityChart"),
  calorieChart: document.querySelector("#calorieChart"),
  history: document.querySelector("#historyList"),
  empty: document.querySelector("#emptyState"),
  rangeButtons: document.querySelectorAll("[data-range]"),
  exportCsv: document.querySelector("#exportCsvButton"),
  exportJson: document.querySelector("#exportJsonButton"),
  backup: document.querySelector("#backupButton"),
  import: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  height: document.querySelector("#heightInput"),
  stepGoal: document.querySelector("#stepGoalInput"),
  calorieGoal: document.querySelector("#calorieGoalInput"),
  saveSettings: document.querySelector("#saveSettingsButton"),
  clear: document.querySelector("#clearButton"),
  tabButtons: document.querySelectorAll("[data-tab]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),
};

let records = readRecords();
let settings = readSettings();
let activeRange = "7";
let syncTimer = null;
let activeTab = "record";

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveRecords(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  if (options.sync !== false) scheduleServerSync();
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function currentHeight() {
  return Number(settings.height) || DEFAULT_HEIGHT_CM;
}

function currentStepGoal() {
  return Number(settings.stepGoal) || DEFAULT_STEP_GOAL;
}

function currentCalorieGoal() {
  return Number(settings.calorieGoal) || DEFAULT_CALORIE_GOAL;
}

function sortRecords(list) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeRecords(...lists) {
  const byDate = new Map();
  lists.flat().forEach((item) => {
    if (!item?.date || !Number.isFinite(Number(item.weight))) return;
    const existing = byDate.get(item.date);
    const itemFat = normalizeFat(item.fat);
    byDate.set(item.date, {
      date: item.date,
      weight: Number(item.weight),
      fat: itemFat ?? existing?.fat ?? null,
      steps: normalizePositiveInteger(item.steps) ?? existing?.steps ?? null,
      calories: normalizePositiveInteger(item.calories) ?? existing?.calories ?? null,
      note: String(item.note || ""),
    });
  });
  return sortRecords([...byDate.values()]);
}

function formatNumber(value, unit) {
  return Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "--";
}

function formatInteger(value, unit = "") {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ja-JP")}${unit}` : "--";
}

function normalizeFat(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function deltaText(current, previous, unit) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "前回比 --";
  const diff = current - previous;
  const sign = diff > 0 ? "+" : "";
  return `前回比 ${sign}${diff.toFixed(1)}${unit}`;
}

function averageWeight(list, days) {
  const sliced = list.slice(-days);
  if (!sliced.length) return null;
  return sliced.reduce((sum, item) => sum + item.weight, 0) / sliced.length;
}

function averageMetric(list, key, days) {
  const sliced = list.slice(-days).filter((item) => Number.isFinite(item[key]));
  if (!sliced.length) return null;
  return sliced.reduce((sum, item) => sum + item[key], 0) / sliced.length;
}

function windowAverage(list, key, start, days) {
  const sliced = list.slice(start, start + days).filter((item) => Number.isFinite(item[key]));
  if (!sliced.length) return null;
  return sliced.reduce((sum, item) => sum + item[key], 0) / sliced.length;
}

function averageComparison(list, key, days) {
  const currentStart = Math.max(0, list.length - days);
  const previousStart = Math.max(0, list.length - days * 2);
  const previousEnd = currentStart;
  const current = windowAverage(list, key, currentStart, days);
  const previous = windowAverage(list, key, previousStart, previousEnd - previousStart);

  return {
    current,
    previous,
    diff: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
  };
}

function diffText(diff, unit) {
  if (!Number.isFinite(diff)) return "--";
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}${unit}`;
}

function metricTotalAndAverage(list, key, days) {
  const recent = list.slice(-days).filter((item) => Number.isFinite(item[key]));
  const total = recent.reduce((sum, item) => sum + item[key], 0);
  return {
    total,
    average: recent.length ? total / recent.length : null,
    count: recent.length,
  };
}

function filteredRecords() {
  const sorted = sortRecords(records);
  if (activeRange === "all") return sorted;
  return sorted.slice(-Number(activeRange));
}

function renderSummary() {
  const sorted = sortRecords(records);
  const latest = sorted.at(-1);
  const previous = sorted.at(-2);
  const latestFatRecord = sorted.filter((record) => Number.isFinite(record.fat)).at(-1);
  const previousFatRecord = sorted.filter((record) => Number.isFinite(record.fat)).at(-2);

  els.latestWeight.textContent = latest ? formatNumber(latest.weight, "kg") : "--";
  els.latestFat.textContent = latestFatRecord ? formatNumber(latestFatRecord.fat, "%") : "--";
  els.weightDelta.textContent = latest ? deltaText(latest.weight, previous?.weight, "kg") : "記録待ち";
  els.fatDelta.textContent = latestFatRecord ? deltaText(latestFatRecord.fat, previousFatRecord?.fat, "%") : "記録待ち";

  const sevenWeight = averageComparison(sorted, "weight", 7);
  const sevenFat = averageComparison(sorted, "fat", 7);
  const fourteenWeight = averageComparison(sorted, "weight", 14);
  const fourteenFat = averageComparison(sorted, "fat", 14);
  els.avgSevenWeight.textContent = `体重 ${formatNumber(sevenWeight.current, "kg")}`;
  els.avgSevenFat.textContent = `体脂肪率 ${formatNumber(sevenFat.current, "%")}`;
  els.avgSevenDiff.textContent = `前7日比 体重 ${diffText(sevenWeight.diff, "kg")} / 体脂肪率 ${diffText(sevenFat.diff, "%")}`;
  els.avgFourteenWeight.textContent = `体重 ${formatNumber(fourteenWeight.current, "kg")}`;
  els.avgFourteenFat.textContent = `体脂肪率 ${formatNumber(fourteenFat.current, "%")}`;
  els.avgFourteenDiff.textContent = `前14日比 体重 ${diffText(fourteenWeight.diff, "kg")} / 体脂肪率 ${diffText(fourteenFat.diff, "%")}`;
  els.recordCount.textContent = `${records.length}日`;
  els.latestSteps.textContent = latest ? formatInteger(latest.steps, "歩") : "--";
  els.latestCalories.textContent = latest ? formatInteger(latest.calories, "kcal") : "--";
  els.avgSteps.textContent = `7日平均 ${formatInteger(averageMetric(sorted, "steps", 7), "歩")}`;
  els.avgCalories.textContent = `7日平均 ${formatInteger(averageMetric(sorted, "calories", 7), "kcal")}`;
  const stepStats = metricTotalAndAverage(sorted, "steps", 7);
  const stepGoal = currentStepGoal();
  els.activityAverageSteps.textContent = formatInteger(stepStats.average, "歩");
  els.activityTotalSteps.textContent = stepStats.count ? formatInteger(stepStats.total, "歩") : "--";
  els.stepGoalStatus.textContent = Number.isFinite(stepStats.average)
    ? `${formatInteger(stepGoal, "歩")} / ${stepStats.average >= stepGoal ? "達成中" : "あと少し"}`
    : formatInteger(stepGoal, "歩");
  const calorieStats = metricTotalAndAverage(sorted, "calories", 7);
  const calorieGoal = currentCalorieGoal();
  els.activityAverageCalories.textContent = formatInteger(calorieStats.average, "kcal");
  els.activityTotalCalories.textContent = calorieStats.count ? formatInteger(calorieStats.total, "kcal") : "--";
  els.calorieGoalStatus.textContent = Number.isFinite(calorieStats.average)
    ? `${formatInteger(calorieGoal, "kcal")} / ${calorieStats.average >= calorieGoal ? "達成中" : "あと少し"}`
    : formatInteger(calorieGoal, "kcal");

  if (latest) {
    const meters = currentHeight() / 100;
    els.bmi.textContent = (latest.weight / (meters * meters)).toFixed(1);
  } else {
    els.bmi.textContent = "--";
  }
}

function drawLine(ctx, points, color, options = {}) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width || 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  if (options.points === false) return;

  ctx.fillStyle = color;
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function movingAverage(values, days) {
  return values.map((item, index, list) => {
    const window = list.slice(Math.max(0, index - days + 1), index + 1);
    const average = window.reduce((sum, entry) => sum + entry.value, 0) / window.length;
    return {
      value: average,
      index: item.index,
    };
  });
}

function scalePoints(values, width, height, top, right, bottom, left, totalCount) {
  const numbers = values.map((item) => item.value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = max - min || 1;
  return values.map(({ value, index }) => {
    const x = left + (index / Math.max(totalCount - 1, 1)) * (width - left - right);
    const y = top + (1 - (value - min) / range) * (height - top - bottom);
    return { x, y };
  });
}

function drawChart() {
  const ctx = els.chart.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = els.chart.getBoundingClientRect();
  els.chart.width = Math.max(1, Math.round(rect.width * dpr));
  els.chart.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, width, height);

  const data = filteredRecords();
  const top = 24;
  const right = 18;
  const bottom = 42;
  const left = 28;

  ctx.strokeStyle = "#dfe7df";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = top + (i / 3) * (height - top - bottom);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }

  if (!data.length) {
    ctx.fillStyle = "#64716b";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("記録するとグラフが表示されます", width / 2, height / 2);
    return;
  }

  const weights = data.map((item, index) => ({ value: item.weight, index }));
  const fourteenDayAverage = movingAverage(weights, 14);
  const thirtyDayAverage = movingAverage(weights, 30);
  const fats = data
    .map((item, index) => ({ value: item.fat, index }))
    .filter((item) => Number.isFinite(item.value));
  drawLine(ctx, scalePoints(weights, width, height, top, right, bottom, left, data.length), "#1f7a6d");
  drawLine(
    ctx,
    scalePoints(fourteenDayAverage, width, height, top, right, bottom, left, data.length),
    "#d08b2f",
    { width: 3, points: false }
  );
  drawLine(
    ctx,
    scalePoints(thirtyDayAverage, width, height, top, right, bottom, left, data.length),
    "#4d6fb3",
    { width: 3, points: false }
  );
  drawLine(ctx, scalePoints(fats, width, height, top, right, bottom, left, data.length), "#b44e5f");

  ctx.fillStyle = "#64716b";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(formatDate(data[0].date), left, height - 10);
  ctx.textAlign = "right";
  ctx.fillText(formatDate(data.at(-1).date), width - right, height - 10);
}

function prepareCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    ctx,
    width: rect.width,
    height: rect.height,
  };
}

function drawBarGoalChart(canvas, options) {
  if (!canvas) return;

  const { ctx, width, height } = prepareCanvas(canvas);
  const data = sortRecords(records).slice(-7);
  const top = 20;
  const right = 16;
  const bottom = 40;
  const left = 42;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfb";
  ctx.fillRect(0, 0, width, height);

  const availableValues = data
    .map((item) => Number(item[options.key]))
    .filter((value) => Number.isFinite(value));

  if (!availableValues.length) {
    ctx.fillStyle = "#64716b";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(options.emptyText, width / 2, height / 2);
    return;
  }

  const goal = options.goal;
  const maxValue = Math.max(goal, ...availableValues);
  const scaleMax = Math.ceil(maxValue / options.scaleStep) * options.scaleStep || options.scaleStep;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const barGap = Math.max(8, chartWidth * 0.025);
  const slotWidth = chartWidth / Math.max(data.length, 1);
  const barWidth = Math.max(10, slotWidth - barGap);
  const yFor = (value) => top + (1 - value / scaleMax) * chartHeight;

  ctx.strokeStyle = "#dfe7df";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64716b";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i < 4; i += 1) {
    const value = (scaleMax / 3) * i;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    if (i > 0) {
      ctx.fillText(Math.round(value).toLocaleString("ja-JP"), left - 6, y + 4);
    }
  }

  const goalY = yFor(goal);
  ctx.strokeStyle = "#78b866";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(left, goalY);
  ctx.lineTo(width - right, goalY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#4f8f43";
  ctx.textAlign = "right";
  ctx.fillText(`目標 ${formatInteger(goal, options.unit)}`, width - right, Math.max(top + 12, goalY - 6));

  data.forEach((item, index) => {
    const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
    const value = Number.isFinite(item[options.key]) ? item[options.key] : 0;
    const y = yFor(value);
    const barHeight = Math.max(0, top + chartHeight - y);
    ctx.fillStyle = value >= goal ? options.color : options.underColor;
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  ctx.fillStyle = "#64716b";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  data.forEach((item, index) => {
    const x = left + index * slotWidth + slotWidth / 2;
    const label = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(new Date(`${item.date}T00:00:00`));
    ctx.fillText(label, x, height - 12);
  });
}

function drawActivityChart() {
  drawBarGoalChart(els.activityChart, {
    key: "steps",
    goal: currentStepGoal(),
    unit: "歩",
    scaleStep: 1000,
    color: "#12aaa5",
    underColor: "#7db9b6",
    emptyText: "歩数を取り込むと表示されます",
  });
}

function drawCalorieChart() {
  drawBarGoalChart(els.calorieChart, {
    key: "calories",
    goal: currentCalorieGoal(),
    unit: "kcal",
    scaleStep: 500,
    color: "#7a5bb0",
    underColor: "#b5a4d8",
    emptyText: "消費カロリーを取り込むと表示されます",
  });
}

function drawAllCharts() {
  drawChart();
  drawActivityChart();
  drawCalorieChart();
}

function renderHistory() {
  const sorted = sortRecords(records).reverse();
  els.empty.hidden = sorted.length > 0;
  els.history.innerHTML = "";

  sorted.forEach((record) => {
    const item = document.createElement("li");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-main">
        <span class="history-date">${formatDate(record.date)}</span>
        <span class="history-values">${formatNumber(record.weight, "kg")} / ${formatNumber(record.fat, "%")}</span>
        <span class="history-activity">${formatInteger(record.steps, "歩")} / ${formatInteger(record.calories, "kcal")}</span>
        ${record.note ? `<span class="history-note">${escapeHtml(record.note)}</span>` : ""}
      </div>
      <button class="delete-button" type="button" aria-label="${record.date}の記録を削除" data-delete="${record.date}">×</button>
    `;
    els.history.appendChild(item);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function render() {
  renderSummary();
  renderHistory();
  drawAllCharts();
}

function showTab(tabName) {
  activeTab = tabName;
  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tabName;
  });
  if (tabName === "chart") {
    requestAnimationFrame(drawAllCharts);
  }
}

async function syncToServer() {
  try {
    await fetch("api/records", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sortRecords(records)),
    });
  } catch {
    // Wi-Fi server is optional. Local browser storage still keeps the data.
  }
}

function scheduleServerSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(syncToServer, 500);
}

async function loadServerRecords() {
  try {
    const response = await fetch("api/records", { cache: "no-store" });
    if (!response.ok) return;
    const serverRecords = await response.json();
    const merged = mergeRecords(records, serverRecords);
    records = merged;
    saveRecords({ sync: false });
    render();
    scheduleServerSync();
  } catch {
    // File-open mode cannot use PC sync. The app still works locally.
  }
}

function upsertRecord(record) {
  records = records.filter((item) => item.date !== record.date);
  records.push(record);
  records = sortRecords(records);
  saveRecords();
  render();
}

function exportCsv() {
  const rows = [["date", "weight_kg", "body_fat_percent", "steps", "calories_kcal", "note"]];
  sortRecords(records).forEach((record) => {
    rows.push([record.date, record.weight, record.fat, record.steps ?? "", record.calories ?? "", record.note || ""]);
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `karada-log-${todayString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(sortRecords(records), null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `karada-log-${todayString()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeImportedRecords(imported) {
  if (!Array.isArray(imported)) throw new Error("Invalid file");
  return mergeRecords(imported);
}

function replaceRecords(imported) {
  records = normalizeImportedRecords(imported);
  saveRecords();
  render();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const weight = Number(els.weight.value);
  const fat = Number(els.fat.value);
  if (!Number.isFinite(weight) || !Number.isFinite(fat)) return;

  upsertRecord({
    date: els.date.value,
    weight,
    fat,
    note: els.note.value.trim(),
  });
  els.note.value = "";
});

els.today.addEventListener("click", () => {
  els.date.value = todayString();
});

els.rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeRange = button.dataset.range;
    els.rangeButtons.forEach((item) => item.classList.toggle("active", item === button));
    drawAllCharts();
  });
});

els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

els.history.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  records = records.filter((record) => record.date !== button.dataset.delete);
  saveRecords();
  render();
});

els.exportCsv.addEventListener("click", exportCsv);
els.exportJson.addEventListener("click", exportJson);
if (els.backup) {
  els.backup.addEventListener("click", async () => {
    try {
      const response = await fetch("api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: sortRecords(records) }),
      });
      if (!response.ok) throw new Error("Backup failed");
      const result = await response.json();
      alert(`PCにバックアップしました。\n${result.fileName}`);
    } catch {
      exportJson();
      alert("PCへのバックアップができなかったため、JSONファイルを書き出しました。");
    }
  });
}
els.import.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith(".db")) {
      throw new Error("DB_SELECTED");
    }
    const imported = JSON.parse(await file.text());
    replaceRecords(imported);
  } catch (error) {
    if (error.message === "DB_SELECTED") {
      alert("元の.dbファイルではなく、からだログのJSONバックアップを選んでください。");
    } else {
      alert("読み込めるJSONファイルではありません。からだログのJSONバックアップを選んでください。");
    }
  } finally {
    els.importFile.value = "";
  }
});

els.settingsButton.addEventListener("click", () => {
  els.height.value = settings.height || DEFAULT_HEIGHT_CM;
  els.stepGoal.value = settings.stepGoal || DEFAULT_STEP_GOAL;
  els.calorieGoal.value = settings.calorieGoal || DEFAULT_CALORIE_GOAL;
  els.settingsDialog.showModal();
});

els.saveSettings.addEventListener("click", () => {
  const height = Number(els.height.value);
  const stepGoal = Number(els.stepGoal.value);
  const calorieGoal = Number(els.calorieGoal.value);
  settings.height = Number.isFinite(height) && height > 0 ? height : null;
  settings.stepGoal = Number.isFinite(stepGoal) && stepGoal > 0 ? Math.round(stepGoal) : null;
  settings.calorieGoal = Number.isFinite(calorieGoal) && calorieGoal > 0 ? Math.round(calorieGoal) : null;
  saveSettings();
  render();
});

els.clear.addEventListener("click", () => {
  if (!confirm("すべての記録を削除しますか？")) return;
  records = [];
  saveRecords();
  render();
  els.settingsDialog.close();
});

window.addEventListener("resize", drawAllCharts);

els.date.value = todayString();
render();
showTab(activeTab);
loadServerRecords();
