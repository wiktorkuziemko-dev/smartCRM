// Symulator API platformy SMART (logowanie + rawdata) do testów zakładki Testy bez prawdziwego konta.
// Uruchomienie: node tools/smart-mock.mjs  →  w SmartCRM (Integracja ze SMART):
//   adres logowania http://localhost:4747/api/login, adres API http://localhost:4747/api/functions/rawdata,
//   login demo, hasło tajne, domena logowania rks.smartmetering24.pl, client_id 1.
// Wodociągi: olsztyn (wszystko dociera), kowiesy (część raportów brak / za wcześnie), pusty (bez nakładek).
import http from 'node:http';

const STATE = '012345678901234567890123456789012345678901234567890123456789';
const TOKEN = 'token-testowy-123';
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return day(d); };
const today = day(new Date());

const METERS = {
  'olsztyn.smartmetering24.pl': [
    { number: 'C22SB018016', communicator: '53000951', communicator_installed: '2024-03-25 00:00:00', address: 'Zakopiańska 6', city: 'Olsztyn' },
    { number: 'C22SB018017', communicator: '53000952', communicator_installed: '2024-03-25 00:00:00', address: 'Zakopiańska 8', city: 'Olsztyn' },
    { number: 'C22SB018099', communicator: null, communicator_installed: null, address: 'Bez nakładki 1', city: 'Olsztyn' },
  ],
  'kowiesy.smartmetering24.pl': [
    { number: 'K1', communicator: '61000001', communicator_installed: '2024-05-01 00:00:00', address: 'Polna 1', city: 'Kowiesy' },
    // nakładka zamontowana 3 dni temu – wcześniejsze dni puste
    { number: 'K2', communicator: '61000002', communicator_installed: `${addDays(today, -3)} 00:00:00`, address: 'Polna 2', city: 'Kowiesy' },
    // nakładka zamontowana dziś – poza okresem (do wczoraj), odfiltrowana
    { number: 'K3', communicator: '61000003', communicator_installed: `${today} 10:00:00`, address: 'Polna 3', city: 'Kowiesy' },
  ],
  'pusty.smartmetering24.pl': [
    { number: 'P1', communicator: null, communicator_installed: null, address: 'Leśna 1', city: 'Pusty' },
  ],
};

function reports(domain, from, to) {
  const out = [];
  for (const m of METERS[domain] ?? []) {
    if (!m.communicator) continue;
    for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
      if (domain.startsWith('kowiesy') && m.number === 'K1' && i % 3 === 1) continue;            // brak raportu
      const sameDay = domain.startsWith('kowiesy') && m.number === 'K1' && i % 3 === 2;           // dotarł tego samego dnia → „brak”
      out.push({ communicator: m.communicator, date: d, received_at: `${sameDay ? d : addDays(d, 1)} 03:15:00` });
    }
  }
  return out;
}

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const form = new URLSearchParams(Buffer.concat(chunks).toString());
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.state !== STATE) return send(400, { message: 'brak nagłówka State' });
  if (req.url === '/api/login') {
    if (form.get('login') !== 'demo' || form.get('password') !== 'tajne' || !form.get('domain') || !form.get('client_id')) return send(401, { message: 'Invalid credentials' });
    return send(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 });
  }
  if (req.url === '/api/functions/rawdata') {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Unauthenticated' });
    const domain = form.get('domain');
    if (!METERS[domain]) return send(404, { message: `Unknown domain ${domain}` });
    if (form.get('type') === 'meters') return send(200, { data: { data: METERS[domain] } });
    if (form.get('type') === 'reports') return send(200, { data: { data: reports(domain, form.get('date_from'), form.get('date_to')) } });
    return send(400, { message: 'unknown type' });
  }
  send(404, { message: 'not found' });
}).listen(4747, () => console.log('mock SMART na :4747'));
