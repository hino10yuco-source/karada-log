const STORAGE_KEY = "karada-log-records";
const SETTINGS_KEY = "karada-log-settings";
const DEFAULT_HEIGHT_CM = 164;

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
  avgSeven: document.querySelector("#avgSeven"),
  avgFourteen: document.querySelector("#avgFourteen"),
  bmi: document.querySelector("#bmiValue"),
  recordCount: document.querySelector("#recordCount"),
  chart: document.querySelector("#trendChart"),
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
  saveSettings: document.querySelector("#saveSettingsButton"),
  clear: document.querySelector("#clearButton"),
};

let records = readRecords();
let settings = readSettings();
let activeRange = "7";
let syncTimer = null;

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
      note: String(item.note || ""),
    });
  });
  return sortRecords([...byDate.values()]);
}

function formatNumber(value, unit) {
  return Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "--";
}

function normalizeFat(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

  els.avgSeven.textContent = formatNumber(averageWeight(sorted, 7), "kg");
  els.avgFourteen.textContent = formatNumber(averageWeight(sorted, 14), "kg");
  els.recordCount.textContent = `${records.length}日`;

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
  drawChart();
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
  const rows = [["date", "weight_kg", "body_fat_percent", "note"]];
  sortRecords(records).forEach((record) => {
    rows.push([record.date, record.weight, record.fat, record.note || ""]);
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
    drawChart();
  });
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
  els.settingsDialog.showModal();
});

els.saveSettings.addEventListener("click", () => {
  const height = Number(els.height.value);
  settings.height = Number.isFinite(height) && height > 0 ? height : null;
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

window.addEventListener("resize", drawChart);

els.date.value = todayString();
render();
loadServerRecords();
