const https = require('https');
const proj4 = require('proj4');
const db = require('./db');

// EPSG:25830 → WGS84
const UTM30N = '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

const API_BASE = 'https://datos.juntadeandalucia.es/api/v0/openrta/search';
const PARAMS = new URLSearchParams({
  id: '-',
  object_type: 'Apartamento turístico',
  category: '-',
  group: '-',
  modality: '-',
  province: 'SEVILLA',
  municipality: 'SEVILLA',
  order_by: 'id',
  mode: 'ASC',
  size: '2000',
});

function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function convertCoords(x, y) {
  if (!x || !y) return { lat: null, lon: null };
  try {
    const [lon, lat] = proj4(UTM30N, WGS84, [parseFloat(x), parseFloat(y)]);
    if (isNaN(lat) || isNaN(lon)) return { lat: null, lon: null };
    return { lat: parseFloat(lat.toFixed(7)), lon: parseFloat(lon.toFixed(7)) };
  } catch {
    return { lat: null, lon: null };
  }
}

function parseDate(dateStr) {
  if (!dateStr || dateStr.length < 8) return null;
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
}

function mapRecord(r) {
  const { lat, lon } = convertCoords(r.coord_x, r.coord_y);
  return {
    id: r.id,
    registration_code: r.registration_code,
    name: r.name || null,
    holder: r.holder || null,
    establishment_address: r.establishment_address || null,
    categories: r.categories || null,
    group_type: r.group || null,
    modalities: r.modalities || null,
    email: r.email && r.email !== '-' ? r.email : null,
    phone: r.phone && r.phone !== '-' ? r.phone : null,
    mobile: r.mobile && r.mobile !== '-' ? r.mobile : null,
    postal_code: r.postal_code || null,
    lat,
    lon,
    activity_start_date: r.activity_start_date || null,
    activity_start_date_display: parseDate(r.activity_start_date),
    registration_date: r.registration_date || null,
    registration_date_display: parseDate(r.registration_date),
    tot_gen_places: r.tot_gen_places || 0,
    tot_gen_ua: r.tot_gen_ua || 0,
    specialties: r.specialties || null,
    url: r.url || null,
  };
}

async function sync() {
  console.log(`[${new Date().toLocaleString('es-ES')}] Iniciando sincronización con OpenRTA...`);
  try {
    const url = `${API_BASE}?${PARAMS.toString()}`;
    const json = await fetchAPI(url);

    if (!json.results || !Array.isArray(json.results)) {
      throw new Error('Respuesta inesperada de la API');
    }

    const apartments = json.results.map(mapRecord);
    const newCount = db.upsertMany(apartments);

    const logEntry = {
      status: 'ok',
      total: apartments.length,
      new_records: newCount,
    };
    db.logSync(logEntry);

    console.log(`✓ Sincronización completada: ${apartments.length} registros, ${newCount} nuevos.`);
    return logEntry;
  } catch (err) {
    const logEntry = { status: 'error', error: err.message, total: 0, new_records: 0 };
    db.logSync(logEntry);
    console.error('✗ Error en sincronización:', err.message);
    return logEntry;
  }
}

module.exports = { sync };
