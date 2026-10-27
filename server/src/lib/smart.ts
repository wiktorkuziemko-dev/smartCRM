import { Agent, fetch, type Response } from 'undici';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Integracja z platformą SMART (smartmetering24.pl) – wyniki testów nakładek na wodomierzach.
 * Odpowiednik skryptu Apps Script: logowanie (token), pobranie wodomierzy i raportów dla domeny wodociągu,
 * status każdego dnia („OK” / „brak” / puste przed instalacją nakładki) i SLA wodomierza oraz wodociągu.
 */

const SETTINGS_KEY = 'smart';
// Stały nagłówek „State” wymagany przez API (jak w skrypcie).
const STATE = '012345678901234567890123456789012345678901234567890123456789';

export interface SmartConfig {
  authUrl: string;       // adres logowania
  apiUrl: string;        // adres funkcji rawdata (requestUrl)
  login: string;
  password: string;      // potrzebne przy każdym pobraniu tokenu – nie zwracamy go do przeglądarki
  loginDomain: string;   // „domain” wysyłane przy logowaniu
  clientId: string;
  domainSuffix: string;  // dopisywane do domeny klienta bez kropki, np. „.smartmetering24.pl”
  sort: string;          // parametr „sort”
  details: string;       // parametr „details” przy raportach
  tagId: number | null;  // tag klientów testowych
}

export const SMART_DEFAULTS = {
  authUrl: 'https://auth.smartmetering24.pl/api/login',
  apiUrl: 'https://rks.smartmetering24.pl/api/functions/rawdata',
  domainSuffix: '.smartmetering24.pl',
  sort: 'asc',
  details: '1',
};

export async function getSmartConfig(): Promise<SmartConfig | null> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  return (row?.value as SmartConfig | undefined) ?? null;
}

export async function saveSmartConfig(cfg: SmartConfig) {
  await db.insert(schema.appSettings).values({ key: SETTINGS_KEY, value: cfg })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: cfg } });
  token = null;
  resultCache.clear();
}

export async function removeSmartConfig() {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  token = null;
  resultCache.clear();
}

/** Pełna domena wodociągu: „olsztyn” → „olsztyn.smartmetering24.pl”; pełną zostawiamy bez zmian. */
export const fullDomain = (domain: string, cfg: Pick<SmartConfig, 'domainSuffix'>) =>
  (domain.includes('.') ? domain : `${domain}${cfg.domainSuffix}`);

// Serwery platformy SMART nie wysyłają pełnego łańcucha certyfikatów (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
// Na życzenie właściciela integracja łączy się bez sprawdzania certyfikatu – tylko zapytania do SMART;
// pozostałe połączenia aplikacji są weryfikowane.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

async function post(url: string, data: Record<string, string>, bearer?: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { State: STATE, Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: new URLSearchParams(data), // jak payload-obiekt w UrlFetchApp: application/x-www-form-urlencoded
      signal: AbortSignal.timeout(60_000),
      dispatcher: url.startsWith('https:') ? insecureAgent : undefined,
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    throw new Error(`Brak połączenia z ${new URL(url).host}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* niżej */ }
  if (!res.ok) {
    const msg = (json?.message ?? json?.error ?? text.slice(0, 200)) as string;
    const err = new Error(`${new URL(url).host} zwrócił błąd ${res.status}${msg ? `: ${msg}` : ''}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (!json) throw new Error(`${new URL(url).host} zwrócił odpowiedź, która nie jest JSON-em`);
  return json;
}

// Token zapamiętany na 30 min; przy odmowie (401) pobieramy nowy.
let token: { value: string; expires: number } | null = null;

export async function getToken(cfg: SmartConfig, fresh = false) {
  if (!fresh && token && token.expires > Date.now()) return token.value;
  const r = await post(cfg.authUrl, { login: cfg.login, password: cfg.password, domain: cfg.loginDomain, client_id: cfg.clientId });
  const value = r.access_token;
  if (typeof value !== 'string' || !value) throw new Error('Logowanie do SMART nie zwróciło tokenu (access_token) – sprawdź login, hasło, domenę i client_id.');
  token = { value, expires: Date.now() + 30 * 60_000 };
  return value;
}

/** Wywołanie funkcji rawdata; dane są w polu data.data. */
async function rawdata<T>(cfg: SmartConfig, params: Record<string, string>): Promise<T[]> {
  let r: Record<string, unknown>;
  try {
    r = await post(cfg.apiUrl, params, await getToken(cfg));
  } catch (err) {
    if ((err as { status?: number }).status !== 401) throw err;
    r = await post(cfg.apiUrl, params, await getToken(cfg, true));
  }
  const data = (r.data as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

interface RawMeter {
  number?: string; communicator?: string | null; communicator_installed?: string | null;
  last_reading_date?: string | null; address?: string; city?: string; name?: string;
}
interface RawReport { communicator?: string; date?: string; received_at?: string }

export type DayStatus = 'OK' | 'brak' | '';
export interface MeterResult {
  number: string; communicator: string; installed: string | null; lastReading: string | null;
  address: string | null; days: DayStatus[]; ok: number; missing: number; sla: number;
}
export interface PipelineResult {
  domain: string; devices: number; expected: number; delivered: number; sla: number | null;
  meters: MeterResult[];
}

/** Dni okresu (YYYY-MM-DD) od–do włącznie. */
export function dayList(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** Wyniki jednego wodociągu za okres – reguły jak w skrypcie (filterMetersByInstallationDate, addReadingsToAllMeters). */
async function pipeline(cfg: SmartConfig, domain: string, from: string, to: string): Promise<PipelineResult> {
  const [reports, meters] = await Promise.all([
    rawdata<RawReport>(cfg, { domain, type: 'reports', date_from: from, date_to: to, details: cfg.details, sort: cfg.sort }),
    rawdata<RawMeter>(cfg, { domain, type: 'meters', sort: cfg.sort }),
  ]);
  const days = dayList(from, to);

  // Raporty po kluczu nakładka + dzień.
  const byKey = new Map<string, RawReport>();
  for (const r of reports) if (r.communicator && r.date) byKey.set(`${r.communicator}_${day(r.date)}`, r);

  // Tylko wodomierze z nakładką zainstalowaną przed końcem okresu.
  const tested = meters.filter((m) => m.communicator && m.communicator_installed && day(m.communicator_installed)! < to);

  let ok = 0, missing = 0;
  const results = tested.map((m): MeterResult => {
    const installed = day(m.communicator_installed);
    let mOk = 0, mMissing = 0;
    const statuses = days.map((d): DayStatus => {
      if (installed && d < installed) return ''; // przed instalacją – raport nie był oczekiwany
      const r = byKey.get(`${m.communicator}_${d}`);
      const received = day(r?.received_at);
      // „OK”, gdy raport z dnia D dotarł najwcześniej dzień później (jak w skrypcie).
      const isOk = Boolean(r && received && (Date.parse(received) - Date.parse(d)) / 86_400_000 >= 1);
      if (isOk) mOk++; else mMissing++;
      return isOk ? 'OK' : 'brak';
    });
    ok += mOk; missing += mMissing;
    return {
      number: m.number ?? '', communicator: String(m.communicator), installed, lastReading: m.last_reading_date ?? null,
      address: [m.address, m.city].filter(Boolean).join(', ') || null,
      days: statuses, ok: mOk, missing: mMissing, sla: mOk + mMissing ? mOk / (mOk + mMissing) : 0,
    };
  });

  return {
    domain, devices: results.length, expected: ok + missing, delivered: ok,
    sla: results.length && ok + missing ? ok / (ok + missing) : null,
    meters: results,
  };
}

// Wyniki zapamiętane na 5 min (otwarcie zakładki przez kilka osób nie odpytuje API wielokrotnie).
const resultCache = new Map<string, { expires: number; value: Promise<PipelineResult> }>();

export function pipelineCached(cfg: SmartConfig, domain: string, from: string, to: string, fresh = false) {
  const key = `${domain}|${from}|${to}`;
  const hit = resultCache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  const value = pipeline(cfg, domain, from, to);
  resultCache.set(key, { expires: Date.now() + 5 * 60_000, value });
  value.catch(() => resultCache.delete(key));
  return value;
}
