const fs = require('fs');
const path = require('path');
const db = require('./db');

const APARTMENTS_FILE = path.join(__dirname, 'data', 'apartments.json');
const SYNC_LOG_FILE = path.join(__dirname, 'data', 'sync_log.json');

if (!fs.existsSync(APARTMENTS_FILE)) {
  console.log('No hay datos JSON que migrar.');
  process.exit(0);
}

db.init();

const apartments = Object.values(JSON.parse(fs.readFileSync(APARTMENTS_FILE, 'utf8')));
console.log(`Migrando ${apartments.length} apartamentos...`);

const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'apartments.db');
const raw = new Database(dbPath);

const insert = raw.prepare(`
  INSERT OR REPLACE INTO apartments (
    registration_code, id, name, holder, establishment_address, categories,
    group_type, modalities, email, phone, mobile, postal_code,
    lat, lon, activity_start_date, activity_start_date_display,
    registration_date, registration_date_display,
    tot_gen_places, tot_gen_ua, specialties, url, first_seen_date
  ) VALUES (
    @registration_code, @id, @name, @holder, @establishment_address, @categories,
    @group_type, @modalities, @email, @phone, @mobile, @postal_code,
    @lat, @lon, @activity_start_date, @activity_start_date_display,
    @registration_date, @registration_date_display,
    @tot_gen_places, @tot_gen_ua, @specialties, @url, @first_seen_date
  )
`);

raw.transaction((apts) => {
  for (const apt of apts) insert.run(apt);
})(apartments);

console.log(`✓ ${apartments.length} apartamentos migrados.`);

if (fs.existsSync(SYNC_LOG_FILE)) {
  const logs = JSON.parse(fs.readFileSync(SYNC_LOG_FILE, 'utf8'));
  const insertLog = raw.prepare(
    'INSERT INTO sync_log (date, status, total, new_records, error) VALUES (?, ?, ?, ?, ?)'
  );
  raw.transaction((entries) => {
    for (const e of entries.slice().reverse()) {
      insertLog.run(e.date || new Date().toISOString(), e.status || 'ok', e.total || 0, e.new_records || 0, e.error || null);
    }
  })(logs);
  console.log(`✓ ${logs.length} entradas de log migradas.`);
}

raw.close();
console.log('Migración completada.');
