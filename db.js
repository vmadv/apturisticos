const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'apartments.db');
let _db;

function getDb() {
  if (!_db) _db = new Database(dbPath);
  return _db;
}

const db = {
  init() {
    const d = getDb();
    d.exec(`
      CREATE TABLE IF NOT EXISTS apartments (
        registration_code TEXT PRIMARY KEY,
        id TEXT,
        name TEXT,
        holder TEXT,
        establishment_address TEXT,
        categories TEXT,
        group_type TEXT,
        modalities TEXT,
        email TEXT,
        phone TEXT,
        mobile TEXT,
        postal_code TEXT,
        lat REAL,
        lon REAL,
        activity_start_date TEXT,
        activity_start_date_display TEXT,
        registration_date TEXT,
        registration_date_display TEXT,
        tot_gen_places INTEGER DEFAULT 0,
        tot_gen_ua INTEGER DEFAULT 0,
        specialties TEXT,
        url TEXT,
        first_seen_date TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        new_records INTEGER DEFAULT 0,
        error TEXT
      );
    `);
    this._importSeedIfEmpty(d);
  },

  _importSeedIfEmpty(d) {
    const count = d.prepare('SELECT COUNT(*) AS n FROM apartments').get().n;
    if (count > 0) return;
    const seedPath = path.join(__dirname, 'data', 'seed.json');
    if (!fs.existsSync(seedPath)) return;
    const apartments = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const insert = d.prepare(`
      INSERT OR IGNORE INTO apartments (
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
    d.transaction((apts) => { for (const apt of apts) insert.run(apt); })(apartments);
    console.log(`[seed] ${apartments.length} registros importados desde seed.json`);
  },

  getAll() {
    return getDb().prepare('SELECT * FROM apartments ORDER BY registration_code').all();
  },

  getByCode(registrationCode) {
    return getDb().prepare('SELECT * FROM apartments WHERE registration_code = ?').get(registrationCode) || null;
  },

  upsertMany(apartments) {
    const d = getDb();
    const today = new Date().toISOString().split('T')[0];

    const upsert = d.prepare(`
      INSERT INTO apartments (
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
      ON CONFLICT(registration_code) DO UPDATE SET
        id=excluded.id, name=excluded.name, holder=excluded.holder,
        establishment_address=excluded.establishment_address, categories=excluded.categories,
        group_type=excluded.group_type, modalities=excluded.modalities,
        email=excluded.email, phone=excluded.phone, mobile=excluded.mobile,
        postal_code=excluded.postal_code, lat=excluded.lat, lon=excluded.lon,
        activity_start_date=excluded.activity_start_date,
        activity_start_date_display=excluded.activity_start_date_display,
        registration_date=excluded.registration_date,
        registration_date_display=excluded.registration_date_display,
        tot_gen_places=excluded.tot_gen_places, tot_gen_ua=excluded.tot_gen_ua,
        specialties=excluded.specialties, url=excluded.url
    `);

    const existing = new Set(
      d.prepare('SELECT registration_code FROM apartments').all().map(r => r.registration_code)
    );

    const runMany = d.transaction((apts) => {
      let newCount = 0;
      for (const apt of apts) {
        if (!existing.has(apt.registration_code)) newCount++;
        upsert.run({ ...apt, first_seen_date: existing.has(apt.registration_code) ? undefined : today });
      }
      return newCount;
    });

    return runMany(apartments);
  },

  getNewSince(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return getDb().prepare(
      'SELECT * FROM apartments WHERE first_seen_date >= ? ORDER BY first_seen_date DESC'
    ).all(cutoffStr);
  },

  getRecentRegistrations(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().split('T')[0].replace(/-/g, '');
    return getDb().prepare(
      'SELECT * FROM apartments WHERE activity_start_date >= ? ORDER BY activity_start_date DESC'
    ).all(cutoffDate);
  },

  getEvolutionByYear() {
    return getDb().prepare(`
      SELECT substr(activity_start_date, 1, 4) AS year,
             COUNT(*) AS count,
             SUM(tot_gen_places) AS places
      FROM apartments
      WHERE activity_start_date IS NOT NULL AND length(activity_start_date) >= 4
      GROUP BY year
      ORDER BY year
    `).all();
  },

  getStats() {
    const d = getDb();
    const { total, totalPlaces, totalUnits } = d.prepare(
      'SELECT COUNT(*) AS total, SUM(tot_gen_places) AS totalPlaces, SUM(tot_gen_ua) AS totalUnits FROM apartments'
    ).get();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffStr = cutoffDate.toISOString().split('T')[0].replace(/-/g, '');
    const { newLast30Days } = d.prepare(
      'SELECT COUNT(*) AS newLast30Days FROM apartments WHERE activity_start_date >= ?'
    ).get(cutoffStr);

    return { total, totalPlaces, totalUnits, newLast30Days };
  },

  logSync(entry) {
    getDb().prepare(
      'INSERT INTO sync_log (date, status, total, new_records, error) VALUES (?, ?, ?, ?, ?)'
    ).run(new Date().toISOString(), entry.status, entry.total || 0, entry.new_records || 0, entry.error || null);
  },

  getLastSync() {
    const row = getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get();
    if (!row) return null;
    return { date: row.date, status: row.status, total: row.total, new_records: row.new_records, error: row.error };
  },

  getSyncLog() {
    return getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 20').all()
      .map(r => ({ date: r.date, status: r.status, total: r.total, new_records: r.new_records, error: r.error }));
  },
};

module.exports = db;
