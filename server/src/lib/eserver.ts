import crypto, { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import tls from 'node:tls';
import { Agent, FormData, fetch, type Dispatcher, type Response } from 'undici';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Integracja z platformą GPS E-SERVER (Pronal), wg „E-SERVER PLATFORM API SPECIFICATION” v2.0.0:
 *  - autoryzacja: HTTP Basic, Base64(login + ':' + MD5(hasło)) – przechowujemy tylko skrót MD5, nie hasło,
 *  - POST {baseUrl}/devices    – lista pojazdów (deviceId, deviceName, serial, plateNo),
 *  - POST {baseUrl}/positions  – bieżące pozycje (współrzędne, prędkość, stacyjka, czas raportu w UTC),
 *  - POST {baseUrl}/history    – podsumowanie okresu (dystans, czas jazdy i postojów) + odcinki (details=1).
 * Odpowiedzi są chwilowo zapamiętywane, bo pojedyncze zapytanie trwa 1,5–3,5 s.
 */

const SETTINGS_KEY = 'eserver';
export const DEFAULT_BASE_URL = 'https://e-server.com.pl/api';

export interface EServerConfig { baseUrl: string; login: string; passwordMd5: string }
export interface Device { deviceId: string; deviceName: string; serial: string; plateNo: string }
export interface Position {
  deviceId: string; serial: string | null; lat: number; lon: number; speed: number; heading: number;
  ignition: 'ON' | 'OFF' | 'UNKNOWN'; at: string | null; mileage: number | null;
}
export interface Segment { motion: boolean; begin: string; end: string; distance?: number }
export interface HistoryData { distance: number; drivingTime: number; parkingTime: number; details: Segment[] }

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  value.catch(() => cache.delete(key)); // błędów nie zapamiętujemy
  return value;
}
export function clearEServerCache() { cache.clear(); }

export async function getEServerConfig(): Promise<EServerConfig | null> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  return (row?.value as EServerConfig | undefined) ?? null;
}

export async function saveEServerConfig(cfg: EServerConfig) {
  await db.insert(schema.appSettings).values({ key: SETTINGS_KEY, value: cfg })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: cfg } });
  clearEServerCache();
}

export async function removeEServerConfig() {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  clearEServerCache();
}

export const md5 = (text: string) => crypto.createHash('md5').update(text, 'utf8').digest('hex');

// --- Niepełny łańcuch certyfikatów SSL po stronie serwera ---
// Część serwerów wysyła sam certyfikat strony bez certyfikatu pośredniego. Przeglądarki dociągają go same
// (adres „CA Issuers” w certyfikacie – AIA), Node.js nie. Robimy to samo: pobieramy brakujący certyfikat
// pośredni i łączymy się z pełną weryfikacją względem zaufanych urzędów certyfikacji (nie wyłączamy jej).
const CHAIN_ERRORS = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const agents = new Map<string, Dispatcher>();

/** Zaufane urzędy: wbudowane w Node.js + opcjonalnie plik NODE_EXTRA_CA_CERTS (np. certyfikat zapory firmowej). */
function trustedRoots() {
  const roots = [...tls.rootCertificates];
  const extra = process.env.NODE_EXTRA_CA_CERTS;
  if (extra && fs.existsSync(extra)) roots.push(fs.readFileSync(extra, 'utf8'));
  return roots;
}

/** Pobiera certyfikaty pośrednie wskazane w certyfikacie serwera (AIA „CA Issuers”). */
async function fetchIntermediates(host: string, port: number): Promise<string[]> {
  // Połączenie wyłącznie po to, by odczytać certyfikat serwera – żadne dane nie są wysyłane.
  const peer = await new Promise<tls.DetailedPeerCertificate>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate(true);
      socket.end();
      resolve(cert);
    });
    socket.setTimeout(15_000, () => socket.destroy(new Error('Przekroczono czas połączenia')));
    socket.on('error', reject);
  });
  const found: string[] = [];
  let infoAccess = peer.infoAccess;
  for (let depth = 0; depth < 3; depth++) {
    const uri = infoAccess?.['CA Issuers - URI']?.find((u) => /^https?:\/\//i.test(u));
    if (!uri) break;
    const res = await fetch(uri, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) break;
    const raw = Buffer.from(await res.arrayBuffer());
    const cert = new X509Certificate(raw.includes('-----BEGIN') ? raw.toString('utf8') : raw);
    found.push(cert.toString());
    if (cert.issuer === cert.subject) break;
    infoAccess = cert.infoAccess ? parseInfoAccess(cert.infoAccess) : undefined;
  }
  return found;
}

/** Zamienia tekstowe infoAccess z X509Certificate na postać z getPeerCertificate(). */
function parseInfoAccess(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+?):(.+)$/);
    if (m) (out[m[1].trim()] ??= []).push(m[2].trim());
  }
  return out;
}

async function agentWithIntermediates(url: URL) {
  const key = url.host;
  const existing = agents.get(key);
  if (existing) return existing;
  const intermediates = await fetchIntermediates(url.hostname, Number(url.port) || 443);
  if (!intermediates.length) return null;
  const agent = new Agent({ connect: { ca: [...trustedRoots(), ...intermediates] } });
  agents.set(key, agent);
  console.log(`E-SERVER: serwer ${key} nie wysyła pełnego łańcucha certyfikatów – pobrano brakujący certyfikat pośredni.`);
  return agent;
}

/** Zapytanie POST do API (parametry jako form-data, jak w dokumentacji). */
async function call<T>(cfg: EServerConfig, fn: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${cfg.baseUrl.replace(/\/+$/, '')}/${fn}`);
  const auth = Buffer.from(`${cfg.login}:${cfg.passwordMd5}`).toString('base64');
  const send = (dispatcher?: Dispatcher) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(params)) body.append(k, v);
    return fetch(url, {
      method: 'POST', body, dispatcher, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
  };
  let res: Response;
  try {
    res = await send(agents.get(url.host));
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code ?? '';
    if (url.protocol !== 'https:' || !CHAIN_ERRORS.has(code)) throw new Error(connectionError(err, cfg.baseUrl));
    // Niepełny łańcuch certyfikatów – uzupełniamy go i ponawiamy zapytanie (z pełną weryfikacją).
    let agent: Dispatcher | null = null;
    try { agent = await agentWithIntermediates(url); } catch { /* niżej: komunikat o pierwotnym błędzie */ }
    if (!agent) throw new Error(connectionError(err, cfg.baseUrl));
    try { res = await send(agent); } catch (err2) { throw new Error(connectionError(err2, cfg.baseUrl)); }
  }
  if (res.status === 403 || res.status === 401) {
    throw new Error('E-SERVER odmówił dostępu (403): nieprawidłowy login lub hasło albo dostęp do API nie jest aktywny na koncie.');
  }
  if (!res.ok) throw new Error(`E-SERVER zwrócił błąd ${res.status} dla funkcji ${fn}`);
  try { return (await res.json()) as T; } catch { throw new Error(`E-SERVER zwrócił niepoprawne dane dla funkcji ${fn}`); }
}

/** Zamienia błąd sieci/TLS z fetch (przyczyna w err.cause) na zrozumiały komunikat z kodem błędu. */
export function connectionError(err: unknown, url: string) {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const code = e.cause?.code ?? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'TIMEOUT' : '');
  let host = url;
  try { host = new URL(url).host; } catch { /* zostaje pełny adres */ }
  const hints: Record<string, string> = {
    ENOTFOUND: `serwer aplikacji nie może odnaleźć adresu ${host} (DNS). Sprawdź adres URL oraz dostęp kontenera Docker do internetu i DNS.`,
    EAI_AGAIN: `chwilowy błąd DNS przy szukaniu ${host}. Spróbuj ponownie; jeśli się powtarza – sprawdź DNS i dostęp do internetu.`,
    ECONNREFUSED: `${host} odrzucił połączenie. Sprawdź adres URL (powinien zaczynać się od https://).`,
    ECONNRESET: `połączenie z ${host} zostało przerwane – często przez zaporę, proxy lub VPN.`,
    ETIMEDOUT: `${host} nie odpowiada – połączenie blokuje prawdopodobnie zapora, proxy lub VPN.`,
    UND_ERR_CONNECT_TIMEOUT: `${host} nie odpowiada – połączenie blokuje prawdopodobnie zapora, proxy lub VPN.`,
    TIMEOUT: `${host} nie odpowiedział w ciągu 30 s.`,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'nie można zweryfikować certyfikatu SSL serwera – serwer nie wysyła pełnego łańcucha certyfikatów, a nie udało się pobrać brakującego certyfikatu pośredniego (sprawdź dostęp serwera aplikacji do internetu po HTTP).',
    UNABLE_TO_GET_ISSUER_CERT: 'certyfikat SSL serwera nie pochodzi od zaufanego urzędu certyfikacji – połączenie zostało odrzucone ze względów bezpieczeństwa.',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'certyfikat SSL wystawił nieznany urząd certyfikacji – najczęściej antywirus lub zapora firmowa skanuje ruch HTTPS.',
    SELF_SIGNED_CERT_IN_CHAIN: 'w łańcuchu certyfikatów jest certyfikat własny – najczęściej antywirus lub zapora firmowa skanuje ruch HTTPS.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'serwer przedstawił certyfikat SSL z podpisem własnym.',
    CERT_HAS_EXPIRED: 'certyfikat SSL serwera wygasł (lub zegar komputera jest źle ustawiony).',
    ERR_TLS_CERT_ALTNAME_INVALID: `certyfikat SSL nie pasuje do adresu ${host}.`,
    ERR_SSL_WRONG_VERSION_NUMBER: 'niezgodność protokołu – sprawdź, czy adres zaczyna się od https:// i czy port jest właściwy.',
  };
  const hint = hints[code] ?? (code.startsWith('ERR_SSL') || code === 'EPROTO'
    ? 'nie udało się zestawić szyfrowanego połączenia (TLS).'
    : 'sprawdź adres URL i dostęp serwera aplikacji do internetu.');
  return `Brak połączenia z E-SERVER: ${hint}${code ? ` [kod: ${code}]` : ''}${e.cause?.message && !code ? ` (${e.cause.message})` : ''}`;
}

export async function fetchDevices(cfg: EServerConfig, fresh = false): Promise<Device[]> {
  const load = async () => {
    const r = await call<{ deviceList?: Device[] }>(cfg, 'devices');
    return (r.deviceList ?? []).map((d) => ({ deviceId: String(d.deviceId), deviceName: String(d.deviceName ?? ''), serial: String(d.serial ?? ''), plateNo: String(d.plateNo ?? '') }));
  };
  if (fresh) cache.delete('devices');
  return cached('devices', 10 * 60_000, load);
}

interface RawPosition {
  deviceId: string; serial?: string; coordinate?: { latitude: number; longitude: number }; speed?: number; heading?: number;
  ignitionState?: string; vehicleMileage?: number;
  dateTime?: { year: number; month: number; day: number; hour: number; minute: number; seconds: number; timezone?: string };
}

export async function fetchPositions(cfg: EServerConfig): Promise<Position[]> {
  return cached('positions', 30_000, async () => {
    const r = await call<{ positionList?: RawPosition[] }>(cfg, 'positions');
    return (r.positionList ?? []).filter((p) => p.coordinate).map((p) => {
      const d = p.dateTime;
      return {
        deviceId: String(p.deviceId), serial: p.serial ? String(p.serial) : null,
        lat: Number(p.coordinate!.latitude), lon: Number(p.coordinate!.longitude),
        speed: Number(p.speed ?? 0), heading: Number(p.heading ?? 0),
        ignition: (['ON', 'OFF'].includes(String(p.ignitionState)) ? p.ignitionState : 'UNKNOWN') as Position['ignition'],
        at: d ? new Date(Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.seconds)).toISOString() : null,
        mileage: p.vehicleMileage != null ? Number(p.vehicleMileage) : null,
      };
    });
  });
}

const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
/** Daty z odpowiedzi (date_format = 'utc') mają postać "YYYY-MM-DD HH:mm:ss" w UTC. */
export const parseUtc = (s: string) => new Date(`${s.replace(' ', 'T')}Z`);

export async function fetchHistory(cfg: EServerConfig, serial: string, from: Date, to: Date): Promise<HistoryData> {
  const key = `history:${serial}:${from.toISOString()}`;
  return cached(key, 5 * 60_000, async () => {
    const r = await call<{ result?: string; data?: { distance?: number | string; driving_time?: number | string; parking_time?: number | string; details?: Segment[] } }>(
      cfg, 'history', { serial, date_from: utc(from), date_to: utc(to), details: '1', date_format: 'utc' },
    );
    if (r.result && r.result !== 'OK') throw new Error(`E-SERVER: brak historii dla nadajnika ${serial}`);
    const d = r.data ?? {};
    return {
      distance: Number(d.distance ?? 0), drivingTime: Number(d.driving_time ?? 0), parkingTime: Number(d.parking_time ?? 0),
      details: (d.details ?? []).map((s) => ({ ...s, motion: Boolean(s.motion), distance: s.distance != null ? Number(s.distance) : undefined })),
    };
  });
}

/** Statystyki z historii: najdłuższy odcinek jazdy (bez postoju), liczba odcinków, dni z jazdą, średnia prędkość. */
export function summarize(h: HistoryData, timezone: string) {
  const trips = h.details.filter((s) => s.motion && (s.distance ?? 0) > 0);
  const longest = trips.reduce<Segment | null>((best, s) => ((s.distance ?? 0) > (best?.distance ?? -1) ? s : best), null);
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  const days = new Set(trips.map((s) => dayFmt.format(parseUtc(s.begin))));
  return {
    distanceKm: Math.round(h.distance * 10) / 10,
    drivingSec: h.drivingTime,
    parkingSec: h.parkingTime,
    trips: trips.length,
    activeDays: days.size,
    avgSpeed: h.drivingTime > 0 ? Math.round((h.distance / (h.drivingTime / 3600)) * 10) / 10 : 0,
    longestTripKm: longest ? Math.round((longest.distance ?? 0) * 10) / 10 : 0,
    longestTripAt: longest ? parseUtc(longest.begin).toISOString() : null,
    longestTripSec: longest ? Math.round((parseUtc(longest.end).getTime() - parseUtc(longest.begin).getTime()) / 1000) : 0,
  };
}

/** Wykonuje zadania z ograniczeniem liczby równoległych zapytań do API. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}
