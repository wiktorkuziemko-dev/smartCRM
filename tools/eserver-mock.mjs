// Symulator API E-SERVER (wg dokumentacji v2.0.0) do testów integracji SmartCRM bez prawdziwego konta.
// Uruchomienie: node tools/eserver-mock.mjs  →  w SmartCRM: URL http://localhost:4545/api, login demo, hasło tajne.
import http from 'node:http';
import crypto from 'node:crypto';
const LOGIN = 'demo', PASSWORD = 'tajne';
const expected = 'Basic ' + Buffer.from(`${LOGIN}:${crypto.createHash('md5').update(PASSWORD).digest('hex')}`).toString('base64');
const devices = [
  { deviceId: 'a1'.repeat(16), deviceName: 'Skoda Octavia 36001039 EL 1234A', serial: '36001039', plateNo: 'EL 1234A', lat: 51.759, lon: 19.456, ign: 'ON', speed: 120 },
  { deviceId: 'b2'.repeat(16), deviceName: 'Toyota Corolla 36011882 WA 55555', serial: '36011882', plateNo: 'WA 55555', lat: 52.2297, lon: 21.0122, ign: 'OFF', speed: 0 },
  { deviceId: 'c3'.repeat(16), deviceName: 'Ford Focus 36002050 KR 9876C', serial: '36002050', plateNo: 'KR 9876C', lat: 50.0647, lon: 19.945, ign: 'OFF', speed: 0 },
];
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
// Deterministyczne trasy: codziennie 2–4 odcinki jazdy rano/po południu, w weekend brak jazdy.
function history(serial, from, to) {
  const seed = Number(serial.slice(-3));
  const details = [];
  let distance = 0, driving = 0;
  let cursor = new Date(from);
  for (let day = new Date(from); day < to; day = new Date(day.getTime() + 864e5)) {
    const dow = new Date(day.getTime() + 2 * 3600e3).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const n = 2 + ((seed + day.getUTCDate()) % 3);
    for (let k = 0; k < n; k++) {
      const begin = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 6 + k * 3, (seed * 7 + k * 13) % 60));
      if (begin < from || begin > to) continue;
      const minutes = 20 + ((seed + k * 17 + day.getUTCDate() * 5) % 90);
      const end = new Date(Math.min(begin.getTime() + minutes * 60e3, to.getTime()));
      const km = Math.round(((end - begin) / 3600e3) * (45 + (seed % 30)) * 10) / 10;
      if (begin > cursor) details.push({ motion: false, begin: fmt(cursor), end: fmt(begin) });
      details.push({ motion: true, begin: fmt(begin), end: fmt(end), distance: km });
      distance += km; driving += (end - begin) / 1000; cursor = end;
    }
  }
  if (cursor < to) details.push({ motion: false, begin: fmt(cursor), end: fmt(to) });
  const total = (to - from) / 1000;
  return { distance: Math.round(distance * 10) / 10, driving_time: Math.round(driving), parking_time: Math.round(total - driving), details };
}
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== expected) return send(403, { error: 'Forbidden' });
  const form = chunks.length ? await new Request('http://x', { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }).formData() : new FormData();
  const fn = req.url.split('?')[0].replace(/^\/api\//, '');
  const now = new Date();
  if (fn === 'devices') return send(200, { deviceList: devices.map(({ deviceId, deviceName, serial, plateNo }) => ({ deviceId, deviceName, serial, plateNo })) });
  if (fn === 'positions') return send(200, { positionList: devices.map((d, i) => {
    // Pojazd 1 jedzie, ale ostatni raport pozycji ma 15 min (jak w zgłoszeniu) – stan rozstrzyga /status.
    const t = new Date(now.getTime() - (i === 2 ? 26 * 3600e3 : i === 0 ? 15 * 60e3 : 90e3 * (i + 1)));
    return { deviceId: d.deviceId, serial: d.serial, coordinate: { latitude: d.lat, longitude: d.lon }, heading: 90 * i, speed: d.speed, ignitionState: d.ign,
      dateTime: { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), seconds: t.getUTCSeconds(), timezone: 'UTC' }, vehicleMileage: 120000 + i * 5000 };
  }) });
  if (fn === 'status') {
    // Stan pojazdu w chwili 'date': jazda (motion=true) albo postój, z początkiem i końcem odcinka.
    const i = devices.findIndex((d) => d.serial === String(form.get('serial')));
    if (i < 0) return send(200, { result: 'ERROR' });
    const at = new Date(String(form.get('date')).replace(' ', 'T') + 'Z');
    const begin = new Date(at.getTime() - (i === 0 ? 40 * 60e3 : i === 1 ? 3 * 3600e3 : 30 * 3600e3));
    return send(200, { result: 'OK', data: { motion: i === 0, begin: fmt(begin), end: fmt(at) } });
  }
  if (fn === 'history') {
    const serial = String(form.get('serial'));
    if (!devices.some((d) => d.serial === serial)) return send(200, { result: 'ERROR' });
    const from = new Date(String(form.get('date_from')).replace(' ', 'T') + 'Z'), to = new Date(String(form.get('date_to')).replace(' ', 'T') + 'Z');
    const h = history(serial, from, to);
    if (form.get('details') !== '1') delete h.details;
    return send(200, { result: 'OK', data: h });
  }
  send(404, { error: 'unknown' });
}).listen(4545, () => console.log('mock E-SERVER na :4545'));
