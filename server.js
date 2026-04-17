const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('./db');
const { sync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET || null;

db.init();

app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoints API ---

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

app.get('/api/apartments', (req, res) => {
  const all = db.getAll().filter(a => a.lat && a.lon);
  res.json(all);
});

app.get('/api/new', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const byFirstSeen = db.getNewSince(days);
  const byActivity = db.getRecentRegistrations(days);

  // Merge y deduplicar por registration_code
  const seen = new Set();
  const merged = [];
  for (const apt of [...byActivity, ...byFirstSeen]) {
    if (!seen.has(apt.registration_code)) {
      seen.add(apt.registration_code);
      merged.push(apt);
    }
  }
  merged.sort((a, b) => (b.activity_start_date || '').localeCompare(a.activity_start_date || ''));
  res.json(merged);
});

app.get('/api/evolution', (req, res) => {
  const byYear = db.getEvolutionByYear();
  // Calcular acumulados
  let cumulative = 0;
  let cumulativePlaces = 0;
  const withCumulative = byYear.map(d => {
    cumulative += d.count;
    cumulativePlaces += d.places;
    return { ...d, cumulative, cumulativePlaces };
  });
  res.json(withCumulative);
});

app.get('/api/sync', async (req, res) => {
  const result = await sync();
  res.json(result);
});

app.get('/api/sync-cron', async (req, res) => {
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await sync();
  res.json(result);
});

app.get('/api/sync-status', (req, res) => {
  res.json({
    lastSync: db.getLastSync(),
    log: db.getSyncLog(),
  });
});

app.get('/api/export', async (req, res) => {
  const all = db.getAll();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Monitor Apartamentos Turísticos Sevilla';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Apartamentos Turísticos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'Código Registro', key: 'registration_code', width: 18 },
    { header: 'Nombre', key: 'name', width: 30 },
    { header: 'Titular', key: 'holder', width: 35 },
    { header: 'Dirección', key: 'establishment_address', width: 40 },
    { header: 'Código Postal', key: 'postal_code', width: 14 },
    { header: 'Categoría', key: 'categories', width: 14 },
    { header: 'Grupo', key: 'group_type', width: 22 },
    { header: 'Modalidad', key: 'modalities', width: 14 },
    { header: 'Plazas Totales', key: 'tot_gen_places', width: 15 },
    { header: 'Unidades', key: 'tot_gen_ua', width: 12 },
    { header: 'Fecha Alta', key: 'activity_start_date_display', width: 14 },
    { header: 'Fecha Registro', key: 'registration_date_display', width: 16 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Teléfono', key: 'phone', width: 16 },
    { header: 'Móvil', key: 'mobile', width: 16 },
    { header: 'Latitud', key: 'lat', width: 14 },
    { header: 'Longitud', key: 'lon', width: 14 },
    { header: 'Primera Detección', key: 'first_seen_date', width: 18 },
  ];

  // Header style
  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
  ws.getRow(1).height = 22;

  // Data rows
  all.forEach((apt, i) => {
    const row = ws.addRow(apt);
    if (i % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FC' } };
      });
    }
  });

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: 'R1' };

  // Summary sheet
  const summary = workbook.addWorksheet('Resumen');
  const stats = db.getStats();
  summary.getColumn('A').width = 30;
  summary.getColumn('B').width = 20;
  [
    ['Generado el', new Date().toLocaleString('es-ES')],
    ['Total Apartamentos', stats.total],
    ['Total Plazas', stats.totalPlaces],
    ['Total Unidades', stats.totalUnits],
    ['Nuevos (últimos 30 días)', stats.newLast30Days],
  ].forEach(([label, value]) => {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="apartamentos_sevilla_${new Date().toISOString().split('T')[0]}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.listen(PORT, async () => {
  console.log(`\n🏠 Monitor Apartamentos Turísticos Sevilla`);
  console.log(`   http://localhost:${PORT}\n`);
  const lastSync = db.getLastSync();
  if (!lastSync) {
    console.log('Primera ejecución: descargando datos iniciales...');
    await sync();
  } else {
    console.log(`Última sincronización: ${lastSync.date}`);
  }
});
