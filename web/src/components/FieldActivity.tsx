import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Car, MapPin, Navigation, RefreshCw } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtNumber, initials } from '../lib/format';
import { useMe } from '../lib/queries';
import { Avatar } from './ui';
import { DriveCharts, type DriveProfile } from './DriveCharts';
import { PeriodPicker, isValidPeriod, periodLabel, presetPeriod, type Period } from './PeriodPicker';

interface Position { lat: number; lon: number; speed: number; heading: number; ignition: 'ON' | 'OFF' | 'UNKNOWN'; at: string | null; mileage: number | null }
interface Stats {
  distanceKm: number; drivingSec: number; parkingSec: number; trips: number; activeDays: number; avgSpeed: number;
  longestTripKm: number; longestTripAt: string | null; longestTripSec: number;
}
interface VehicleStatus { motion: boolean; since: string | null }
interface Row { userId: number; fullName: string; avatarUrl: string | null; serial: string; vehicle: { name: string; plateNo: string } | null; position: Position | null; status: VehicleStatus | null; stats: Stats | null; profile: DriveProfile | null }
interface Overview { configured: boolean; from?: string; to?: string; days?: number; weekdayDays?: number[]; rows?: Row[]; errors?: string[] }

/** Stan pojazdu – kolor zawsze z etykietą (nie sam kolor). */
type VehicleState = 'driving' | 'idle' | 'parked' | 'stale';
const STATES: Record<VehicleState, { label: string; color: string }> = {
  driving: { label: 'W trasie', color: '#16a34a' },
  idle: { label: 'Postój, stacyjka włączona', color: '#d97706' },
  parked: { label: 'Zaparkowany', color: '#2563eb' },
  stale: { label: 'Brak danych > 12 h', color: '#94a3b8' },
};

// Nadajniki na postoju raportują co 12 h: dopiero brak raportu dłużej niż 12 h to „brak danych”.
const STALE_MS = 12 * 3600e3;
// Prędkość i stacyjka z raportu pozycji są aktualne tylko, gdy raport jest świeży.
const LIVE_MS = 5 * 60e3;

const ageOf = (p: Position | null) => (p?.at ? Date.now() - new Date(p.at).getTime() : Infinity);

/**
 * Jazda / postój dokładnie wg funkcji „status” z E-SERVER. Raport pozycji uzupełnia tylko:
 * brak danych > 12 h oraz postój z włączoną stacyjką (gdy raport jest świeży).
 */
function stateOf(r: Row): VehicleState {
  const age = ageOf(r.position);
  if (r.status) {
    if (r.status.motion) return 'driving';
    if (age > STALE_MS) return 'stale';
    return r.position?.ignition === 'ON' && age <= LIVE_MS ? 'idle' : 'parked';
  }
  // Bez odpowiedzi funkcji status – ocena z ostatniego raportu pozycji.
  if (!r.position || age > STALE_MS) return 'stale';
  if (age > LIVE_MS) return 'parked';
  if (r.position.ignition === 'ON' && r.position.speed > 0) return 'driving';
  return r.position.ignition === 'ON' ? 'idle' : 'parked';
}

/** Np. „od 14:05 (40 min)”, „od 25.10, 18:30 (1 dzień 3 h)”. */
function sinceText(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  const sameDay = d.toDateString() === new Date().toDateString();
  const when = d.toLocaleString('pl-PL', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const days = Math.floor(mins / 1440), hours = Math.floor((mins % 1440) / 60), m = mins % 60;
  const dur = days ? `${days} ${days === 1 ? 'dzień' : 'dni'}${hours ? ` ${hours} h` : ''}` : hours ? `${hours} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return `od ${when} (${dur})`;
}

/** Kropka stanu; w trasie pulsuje, żeby jazdę było widać na pierwszy rzut oka. */
function StateDot({ state }: { state: VehicleState }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      {state === 'driving' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: STATES[state].color }} />}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATES[state].color }} />
    </span>
  );
}

export const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** Pulpit kierownika i admina: mapa bieżących lokalizacji, statystyki jazdy i rozkład jazdy – każda część z własnym okresem. */
export function FieldActivity() {
  const { data: me } = useMe();
  const [period, setPeriod] = useState<Period>(() => presetPeriod('week'));
  const [chartPeriod, setChartPeriod] = useState<Period>(() => presetPeriod('week'));
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ['gps-overview', period.from, period.to],
    queryFn: () => api.get<Overview>(`/api/gps/overview?from=${period.from}&to=${period.to}`),
    enabled: isValidPeriod(period),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  // Ten sam okres co tabela = to samo zapytanie (bez ponownego pobierania).
  const charts = useQuery({
    queryKey: ['gps-overview', chartPeriod.from, chartPeriod.to],
    queryFn: () => api.get<Overview>(`/api/gps/overview?from=${chartPeriod.from}&to=${chartPeriod.to}`),
    enabled: isValidPeriod(chartPeriod) && Boolean(data?.configured),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const [focus, setFocus] = useState<number | null>(null);

  if (data && !data.configured) {
    return (
      <section className="mb-6 flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 text-sm text-slate-500">
        <MapPin size={18} className="text-slate-400" />
        <span className="flex-1">Mapa i statystyki jazdy pojawią się po skonfigurowaniu integracji GPS.</span>
        {me?.role === 'ADMIN' && <Link to="/admin?tab=eserver" className="font-medium text-brand-600 hover:underline">Administracja → Integracja E-SERVER</Link>}
      </section>
    );
  }

  const rows = data?.rows ?? [];
  const withStats = rows.filter((r) => r.stats);
  const total = {
    km: withStats.reduce((s, r) => s + r.stats!.distanceKm, 0),
    sec: withStats.reduce((s, r) => s + r.stats!.drivingSec, 0),
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
        <h2 className="mr-auto flex items-center gap-2 font-semibold"><Car size={18} className="text-brand-600" /> Dane z E-SERVER – pojazdy w terenie</h2>
        <span className="text-xs text-slate-400">bieżące lokalizacje i stan, odświeżane co minutę</span>
        <button onClick={() => refetch()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Odśwież">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {(error || (data?.errors?.length ?? 0) > 0) && (
        <div className="mx-5 mb-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>{error ? (error as Error).message : data!.errors!.map((e) => <div key={e}>{e}</div>)}</div>
        </div>
      )}

      {rows.length === 0 && data ? (
        <p className="px-5 pb-5 text-sm text-slate-500">
          Żaden handlowiec nie ma przypisanego nadajnika GPS.{me?.role === 'ADMIN' && <> Przypisz je w <Link to="/admin?tab=eserver" className="text-brand-600 hover:underline">Administracja → Integracja E-SERVER</Link>.</>}
        </p>
      ) : (
        <>
          <VehicleMap rows={rows} focus={focus} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 text-xs text-slate-500">
            {(Object.keys(STATES) as VehicleState[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><StateDot state={k} />{STATES[k].label}</span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 pt-4 pb-3">
            <h3 className="mr-auto text-sm font-semibold text-slate-700">Statystyki jazdy <span className="font-normal text-slate-400">· {periodLabel(period)}</span></h3>
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 text-left">Handlowiec</th>
                  <th className="px-3 text-left">Teraz</th>
                  <th className="px-3 text-right">Dystans</th>
                  <th className="px-3 text-right">Czas jazdy</th>
                  <th className="px-3 text-right" title="Najdłuższy odcinek jazdy bez postoju">Najdłuższa trasa</th>
                  <th className="px-3 text-right" title="Liczba odcinków jazdy">Trasy</th>
                  <th className="px-3 text-right">Dni z jazdą</th>
                  <th className="px-5 text-right">Śr. prędkość</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = stateOf(r);
                  const s = r.stats;
                  return (
                    <tr key={r.userId} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setFocus(r.userId)}>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.fullName} src={r.avatarUrl} size={30} />
                          <div>
                            <div className="font-medium">{r.fullName}</div>
                            <div className="text-xs text-slate-400">{r.vehicle ? `${r.vehicle.plateNo} · ` : ''}nadajnik {r.serial}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${st === 'driving' ? 'font-semibold text-emerald-700' : ''}`}>
                          <StateDot state={st} />
                          {STATES[st].label}{st === 'driving' && r.position && r.position.speed > 0 && ageOf(r.position) <= LIVE_MS ? ` · ${r.position.speed} km/h` : ''}
                        </span>
                        <div className="whitespace-nowrap text-xs text-slate-400">
                          {r.status?.since && st !== 'stale' ? sinceText(r.status.since) : r.position?.at ? `raport ${fmtAgo(r.position.at)}` : ''}
                        </div>
                      </td>
                      {s ? (
                        <>
                          <td className="px-3 text-right font-medium tabular-nums">{fmtNumber(s.distanceKm)} km</td>
                          <td className="px-3 text-right tabular-nums">{fmtDuration(s.drivingSec)}</td>
                          <td className="px-3 text-right tabular-nums">
                            {s.longestTripKm ? <>{fmtNumber(s.longestTripKm)} km<div className="text-xs text-slate-400">{fmtDuration(s.longestTripSec)} · {s.longestTripAt && fmtDateTime(s.longestTripAt)}</div></> : '—'}
                          </td>
                          <td className="px-3 text-right tabular-nums">{s.trips}</td>
                          <td className="px-3 text-right tabular-nums">{s.activeDays}/{data?.days ?? 7}</td>
                          <td className="px-5 text-right tabular-nums">{s.avgSpeed ? `${fmtNumber(s.avgSpeed)} km/h` : '—'}</td>
                        </>
                      ) : <td colSpan={6} className="px-3 text-center text-xs text-slate-400">brak danych z E-SERVER</td>}
                    </tr>
                  );
                })}
                {withStats.length > 1 && (
                  <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold">
                    <td className="px-5 py-2.5 text-slate-600" colSpan={2}>Razem</td>
                    <td className="px-3 text-right tabular-nums">{fmtNumber(Math.round(total.km * 10) / 10)} km</td>
                    <td className="px-3 text-right tabular-nums">{fmtDuration(total.sec)}</td>
                    <td colSpan={4} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DriveCharts people={charts.data?.rows ?? []} weekdayDays={charts.data?.weekdayDays ?? [0, 0, 0, 0, 0, 0, 0]}
            period={chartPeriod} onPeriod={setChartPeriod} loading={charts.isFetching} />
        </>
      )}
    </section>
  );
}

/** Mapa Leaflet (OpenStreetMap) z pojazdami handlowców; kliknięcie wiersza tabeli przybliża pojazd. */
function VehicleMap({ rows, focus }: { rows: Row[]; focus: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, scrollWheelZoom: false }).setView([52.1, 19.4], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    return () => { map.current?.remove(); map.current = null; markers.current.clear(); fitted.current = false; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<number>();
    for (const r of rows) {
      if (!r.position) continue;
      seen.add(r.userId);
      const st = stateOf(r);
      const icon = L.divIcon({
        className: '',
        iconSize: r.avatarUrl ? [44, 44] : [34, 34],
        iconAnchor: r.avatarUrl ? [22, 22] : [17, 17],
        // Dymek nad ikoną, a nie na niej.
        popupAnchor: r.avatarUrl ? [0, -26] : [0, -21],
        // Ze zdjęciem: kolor stanu pojazdu jako obwódka; bez zdjęcia – inicjały na kolorowym tle.
        html: r.avatarUrl
          ? `<div style="width:44px;height:44px;border-radius:9999px;border:3px solid ${STATES[st].color};background:#fff;box-shadow:0 2px 6px rgba(15,23,42,.35);overflow:hidden"><img src="${r.avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;border:2px solid #fff;box-sizing:border-box"></div>`
          : `<div style="width:34px;height:34px;border-radius:9999px;background:${STATES[st].color};color:#fff;font:600 12px/34px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)">${initials(r.fullName)}</div>`,
      });
      const p = r.position;
      const popup = `<div style="font:13px system-ui,sans-serif;min-width:180px">
        <b>${escapeHtml(r.fullName)}</b><br>${r.vehicle ? escapeHtml(`${r.vehicle.name}`) + '<br>' : ''}
        <span style="color:${STATES[st].color}">●</span> ${STATES[st].label}${st === 'driving' && p.speed && ageOf(p) <= LIVE_MS ? ` · ${p.speed} km/h` : ''}${r.status?.since && st !== 'stale' ? ` · ${sinceText(r.status.since)}` : ''}<br>
        <span style="color:#64748b">Ostatni raport: ${p.at ? fmtDateTime(p.at) : '—'}</span>
        ${p.mileage != null ? `<br><span style="color:#64748b">Przebieg: ${fmtNumber(p.mileage)} km</span>` : ''}
        <br><a href="https://www.google.com/maps?q=${p.lat},${p.lon}" target="_blank" rel="noreferrer">Otwórz w Mapach Google</a></div>`;
      const existing = markers.current.get(r.userId);
      if (existing) existing.setLatLng([p.lat, p.lon]).setIcon(icon).setPopupContent(popup);
      else markers.current.set(r.userId, L.marker([p.lat, p.lon], { icon, title: r.fullName }).bindPopup(popup).addTo(m));
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
    // Przy pierwszym wczytaniu dopasuj widok do wszystkich pojazdów.
    if (!fitted.current && markers.current.size) {
      const bounds = L.latLngBounds([...markers.current.values()].map((mk) => mk.getLatLng()));
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      fitted.current = true;
    }
  }, [rows]);

  useEffect(() => {
    const mk = focus != null ? markers.current.get(focus) : null;
    if (mk && map.current) { map.current.flyTo(mk.getLatLng(), 13, { duration: 0.6 }); mk.openPopup(); }
  }, [focus]);

  return (
    <div className="relative mx-5">
      <div ref={el} className="h-[494px] overflow-hidden rounded-xl border border-slate-200" />
      <div className="pointer-events-none absolute left-14 top-3 z-[400] flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-600 shadow">
        <Navigation size={12} /> Bieżące lokalizacje
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
