// ─── State ───────────────────────────────────────────────────────────────────
let map, clusterLayer;
let evolutionData = [];
let evolutionChart = null;
let dashboardChart = null;
let chartMode = 'anual';
let chartMetric = 'licencias';
let dateField = 'registration';
const NEW_DAYS_THRESHOLD = 365;

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  initMap();
  document.getElementById('global-btn-registration').classList.add('active');
  await Promise.all([loadStats(), loadSyncStatus(), loadDashboardChart(), loadNewAlerts()]);
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${name}`));

  if (name === 'map') {
    map.invalidateSize();
    if (!clusterLayer) loadMap();
  }
  if (name === 'evolution' && evolutionData.length === 0) loadEvolutionChart();
  if (name === 'alerts') loadAlertsTab();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const s = await fetchJSON(`/api/stats?field=${dateField}`);
  document.getElementById('stat-total').textContent = s.total.toLocaleString('es-ES');
  document.getElementById('stat-places').textContent = s.totalPlaces.toLocaleString('es-ES');
  document.getElementById('stat-units').textContent = s.totalUnits.toLocaleString('es-ES');
  document.getElementById('stat-new').textContent = s.newLast30Days.toLocaleString('es-ES');
}

// ─── Sync status ──────────────────────────────────────────────────────────────
async function loadSyncStatus() {
  const { lastSync } = await fetchJSON('/api/sync-status');
  const el = document.getElementById('last-sync-text');
  if (lastSync) {
    const d = new Date(lastSync.date);
    el.textContent = `Última sync: ${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · ${lastSync.total} registros`;
  } else {
    el.textContent = 'Sin datos de sincronización';
  }
}

async function triggerSync() {
  const btn = document.getElementById('btn-sync');
  btn.classList.add('syncing');
  btn.disabled = true;
  document.getElementById('last-sync-text').textContent = 'Sincronizando...';
  try {
    const r = await fetchJSON('/api/sync');
    if (r.status === 'ok') {
      await Promise.all([loadStats(), loadSyncStatus(), loadNewAlerts()]);
      if (evolutionData.length > 0) loadEvolutionChart();
    } else {
      alert('Error en sincronización: ' + (r.error || 'desconocido'));
    }
  } finally {
    btn.classList.remove('syncing');
    btn.disabled = false;
  }
}

// ─── Dashboard mini-chart ─────────────────────────────────────────────────────
async function loadDashboardChart() {
  const data = await fetchJSON(`/api/evolution?field=${dateField}`);
  if (!data.length) return;

  const recentYears = data.slice(-15);
  const ctx = document.getElementById('dashboard-chart').getContext('2d');

  dashboardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: recentYears.map(d => d.year),
      datasets: [{
        label: 'Nuevas licencias',
        data: recentYears.map(d => d.count),
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ─── Global date field selector ───────────────────────────────────────────────
function setGlobalDateField(field) {
  dateField = field;
  document.getElementById('global-btn-activity').classList.toggle('active', field === 'activity');
  document.getElementById('global-btn-registration').classList.toggle('active', field === 'registration');
  Promise.all([loadStats(), loadDashboardChart(), loadNewAlerts()]);
  if (evolutionData.length > 0) loadEvolutionChart();
  if (document.getElementById('tab-alerts').classList.contains('active')) loadAlertsTab();
}

// ─── Alerts (panel + tab) ─────────────────────────────────────────────────────
async function loadNewAlerts() {
  const days = parseInt(document.getElementById('new-days-filter').value) || 30;
  const data = await fetchJSON(`/api/new?days=${days}&field=${dateField}`);
  const list = document.getElementById('alerts-list');
  const badge = document.getElementById('new-count-badge');
  badge.textContent = data.length;
  list.innerHTML = data.length === 0
    ? '<div class="empty">Sin nuevas altas en el período seleccionado.</div>'
    : data.map(renderAlertItem).join('');
}

async function loadAlertsTab() {
  const days = parseInt(document.getElementById('alert-days-filter').value) || 30;
  const data = await fetchJSON(`/api/new?days=${days}&field=${dateField}`);
  const list = document.getElementById('alerts-tab-list');
  list.innerHTML = data.length === 0
    ? '<div class="empty">Sin nuevas altas en el período seleccionado.</div>'
    : data.map(renderAlertItem).join('');
}

function renderAlertItem(apt) {
  const isNew = isRecentDate(apt.activity_start_date, 90);
  const places = apt.tot_gen_places || 0;
  const placesClass = places >= 20 ? 'places-high' : '';
  const dateDisplay = dateField === 'registration' ? apt.registration_date_display : apt.activity_start_date_display;
  const dateLabel = dateField === 'registration' ? 'Licencia' : 'Alta';
  const dateStr = dateDisplay ? formatDate(dateDisplay) : '—';

  return `
    <div class="alert-item">
      <div class="alert-dot ${isNew ? '' : 'dot-old'}"></div>
      <div class="alert-body">
        <div class="alert-name" title="${esc(apt.name || apt.registration_code)}">
          ${esc(apt.name || apt.registration_code)}
        </div>
        <div class="alert-meta">
          ${esc(apt.registration_code)} · ${esc(apt.establishment_address || '—')}
          ${apt.holder ? `· <em>${esc(apt.holder)}</em>` : ''}
          ${apt.categories ? `· ${esc(apt.categories)}` : ''}
        </div>
      </div>
      <div class="alert-date">${dateLabel}: ${dateStr}</div>
      <div class="alert-places ${placesClass}">${places} plazas</div>
    </div>`;
}

// ─── MAP ──────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([37.3886, -5.9823], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

async function loadMap() {
  const data = await fetchJSON('/api/apartments');
  const infoEl = document.getElementById('map-info');
  infoEl.textContent = `${data.length} apartamentos con coordenadas`;

  if (clusterLayer) map.removeLayer(clusterLayer);
  clusterLayer = L.markerClusterGroup({ maxClusterRadius: 40 });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - NEW_DAYS_THRESHOLD);
  const cutoffDate = cutoff.toISOString().split('T')[0].replace(/-/g, '');

  for (const apt of data) {
    const isNew = apt.activity_start_date && apt.activity_start_date >= cutoffDate;
    const marker = L.circleMarker([apt.lat, apt.lon], {
      radius: isNew ? 9 : 7,
      fillColor: isNew ? '#dc2626' : '#2563eb',
      color: isNew ? '#991b1b' : '#1d4ed8',
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.75,
    });
    marker.bindPopup(buildPopup(apt, isNew));
    clusterLayer.addLayer(marker);
  }
  clusterLayer.addTo(map);
}

function buildPopup(apt, isNew) {
  const dateStr = apt.activity_start_date_display ? formatDate(apt.activity_start_date_display) : '—';
  return `
    <div class="popup-name">${esc(apt.name || apt.registration_code)}</div>
    ${isNew ? '<span class="popup-badge new">🆕 Alta reciente</span>' : `<span class="popup-badge">${esc(apt.categories || 'Sin categoría')}</span>`}
    <div class="popup-row"><span class="popup-label">Código:</span> ${esc(apt.registration_code)}</div>
    <div class="popup-row"><span class="popup-label">Titular:</span> ${esc(apt.holder || '—')}</div>
    <div class="popup-row"><span class="popup-label">Dirección:</span> ${esc(apt.establishment_address || '—')}</div>
    <div class="popup-row"><span class="popup-label">Plazas:</span> <strong>${apt.tot_gen_places || 0}</strong></div>
    <div class="popup-row"><span class="popup-label">Unidades:</span> ${apt.tot_gen_ua || 0}</div>
    <div class="popup-row"><span class="popup-label">Grupo:</span> ${esc(apt.group_type || '—')}</div>
    <div class="popup-row"><span class="popup-label">Alta:</span> ${dateStr}</div>
    ${apt.email ? `<div class="popup-row"><span class="popup-label">Email:</span> <a href="mailto:${esc(apt.email)}">${esc(apt.email)}</a></div>` : ''}
    ${apt.phone ? `<div class="popup-row"><span class="popup-label">Tel:</span> ${esc(apt.phone)}</div>` : ''}
  `;
}

// ─── Evolution chart ──────────────────────────────────────────────────────────
async function loadEvolutionChart() {
  evolutionData = await fetchJSON(`/api/evolution?field=${dateField}`);
  renderEvolutionChart();
  renderEvolutionSummary();
}

function setChartMode(mode) {
  chartMode = mode;
  document.getElementById('btn-anual').classList.toggle('active', mode === 'anual');
  document.getElementById('btn-acumulado').classList.toggle('active', mode === 'acumulado');
  renderEvolutionChart();
}

function setMetric(metric) {
  chartMetric = metric;
  document.getElementById('btn-licencias').classList.toggle('active', metric === 'licencias');
  document.getElementById('btn-plazas').classList.toggle('active', metric === 'plazas');
  renderEvolutionChart();
}

function renderEvolutionChart() {
  if (!evolutionData.length) return;

  const labels = evolutionData.map(d => d.year);
  const isAcumulado = chartMode === 'acumulado';
  const isPlazas = chartMetric === 'plazas';

  let values;
  if (isAcumulado) {
    values = evolutionData.map(d => isPlazas ? d.cumulativePlaces : d.cumulative);
  } else {
    values = evolutionData.map(d => isPlazas ? d.places : d.count);
  }

  const label = isPlazas
    ? (isAcumulado ? 'Plazas acumuladas' : 'Plazas nuevas por año')
    : (isAcumulado ? 'Licencias acumuladas' : 'Nuevas licencias por año');

  document.getElementById('evolution-title').textContent = label;

  const ctx = document.getElementById('evolution-chart').getContext('2d');
  if (evolutionChart) evolutionChart.destroy();

  evolutionChart = new Chart(ctx, {
    type: isAcumulado ? 'line' : 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: isAcumulado ? 'rgba(124,58,237,.15)' : 'rgba(59,130,246,.7)',
        borderColor: isAcumulado ? '#7c3aed' : '#2563eb',
        borderWidth: isAcumulado ? 2.5 : 1,
        borderRadius: isAcumulado ? 0 : 4,
        fill: isAcumulado,
        tension: 0.3,
        pointRadius: isAcumulado ? 3 : 0,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toLocaleString('es-ES')} ${isPlazas ? 'plazas' : 'licencias'}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,.05)' },
          ticks: { callback: v => v.toLocaleString('es-ES') },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderEvolutionSummary() {
  if (!evolutionData.length) return;
  const last = evolutionData[evolutionData.length - 1];
  const decade = evolutionData.filter(d => parseInt(d.year) >= new Date().getFullYear() - 10);
  const decadeCount = decade.reduce((s, d) => s + d.count, 0);
  const decadeAvg = Math.round(decadeCount / Math.min(decade.length, 10));

  const el = document.getElementById('evolution-summary');
  el.innerHTML = [
    { label: `Alta en ${last.year}`, value: last.count.toLocaleString('es-ES'), sub: 'nuevas licencias' },
    { label: `Plazas en ${last.year}`, value: last.places.toLocaleString('es-ES'), sub: 'nuevas plazas' },
    { label: 'Total acumulado', value: last.cumulative.toLocaleString('es-ES'), sub: 'licencias históricas' },
    { label: 'Media última década', value: decadeAvg.toLocaleString('es-ES'), sub: 'licencias/año' },
  ].map(s => `
    <div class="stat-card evol-stat accent-blue">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-label" style="font-size:.72rem;margin-top:2px;opacity:.7">${s.sub}</div>
    </div>
  `).join('');
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportExcel() {
  window.location.href = '/api/export';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function isRecentDate(dateStr, days) {
  if (!dateStr || dateStr.length < 8) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0].replace(/-/g, '');
  return dateStr >= cutoffStr;
}