// Day/night environment model for the 3D house. Pure functions (tested in Node).
//
// Mapping (documented, easy to tune):
//   1. Sun position from the browser's LOCAL clock time and date — no timezone or city is assumed:
//        declination  δ = 23.44° · sin(2π · (284 + dayOfYear) / 365)
//        hour angle   H = 15° · (localHours − 12)          (local clock time used as solar time)
//        elevation    = asin(sin φ sin δ + cos φ cos δ cos H)
//        azimuth      = atan2(sin H, cos H sin φ − tan δ cos φ) + 180°   (0° = north, clockwise)
//      φ (latitude) is a Settings value (default 20°) used only for seasonal day length; the
//      browser's location is never requested.
//   2. Elevation drives every lighting parameter through the KEYS table below (linear blend
//      between neighbouring keys), so changes are smooth: sky colours, sun/moon intensity and
//      colour, hemisphere (ambient) light, exposure and star visibility.
//   3. Scene orientation: the front facade faces +Z (south); north is −Z, east is +X.
// The deterministic replay clock in Replay Lab is separate and never uses this.

export const DEFAULT_LATITUDE = 20;

export const KEYS = [
  // elev°  skyTop     skyHorizon  sun   sunColor   hemi  moon  exposure stars  phase
  { e: -90, top: '#04080f', hor: '#0c1626', sun: 0.0, sunC: '#ffd2a0', hemi: 0.2, moon: 0.4, exp: 1.05, stars: 1.0, phase: 'Night' },
  { e: -12, top: '#060d1a', hor: '#111f33', sun: 0.0, sunC: '#ffd2a0', hemi: 0.2, moon: 0.4, exp: 1.05, stars: 1.0, phase: 'Night' },
  { e: -6,  top: '#0b1831', hor: '#2c2b4a', sun: 0.0, sunC: '#ff9a62', hemi: 0.26, moon: 0.25, exp: 1.0,  stars: 0.55, phase: 'Twilight' },
  { e: -1,  top: '#1f3459', hor: '#c46c4d', sun: 0.15, sunC: '#ff8a52', hemi: 0.34, moon: 0.05, exp: 0.98, stars: 0.12, phase: 'Twilight' },
  { e: 4,   top: '#3f6d9e', hor: '#efa66a', sun: 1.5, sunC: '#ffb57a', hemi: 0.58, moon: 0.0,  exp: 0.95, stars: 0.0, phase: 'Golden hour' },
  { e: 15,  top: '#4a84c0', hor: '#b9d2e6', sun: 2.5, sunC: '#ffe3bd', hemi: 0.82, moon: 0.0,  exp: 0.92, stars: 0.0, phase: 'Day' },
  { e: 40,  top: '#3b7ac2', hor: '#a8c8e4', sun: 3.1, sunC: '#fff4e2', hemi: 0.98, moon: 0.0,  exp: 0.9,  stars: 0.0, phase: 'Day' },
  { e: 90,  top: '#3474c0', hor: '#a3c4e2', sun: 3.2, sunC: '#fff7ea', hemi: 1.0,  moon: 0.0,  exp: 0.9,  stars: 0.0, phase: 'Day' },
];

const rad = (d) => d * Math.PI / 180; const deg = (r) => r * 180 / Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join(''); }

export function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

export function solarPosition(date, latitude = DEFAULT_LATITUDE) {
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const decl = 23.44 * Math.sin(2 * Math.PI * (284 + dayOfYear(date)) / 365);
  const H = 15 * (hours - 12);
  const phi = rad(latitude), d = rad(decl), h = rad(H);
  const elev = deg(Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h)));
  let az = deg(Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(d) * Math.cos(phi))) + 180;
  az = ((az % 360) + 360) % 360;
  return { elevation: elev, azimuth: az, declination: decl, hours };
}

/** Unit vector pointing TOWARD the sun in scene space (front = +Z = south, east = +X). */
export function sunVector(elevation, azimuth) {
  const e = rad(elevation), a = rad(azimuth);
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

export function lightingForElevation(elev) {
  let i = 0; while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (elev - A.e) / (B.e - A.e)));
  return {
    skyTop: mixHex(A.top, B.top, t), skyHorizon: mixHex(A.hor, B.hor, t),
    sunIntensity: lerp(A.sun, B.sun, t), sunColor: mixHex(A.sunC, B.sunC, t),
    hemiIntensity: lerp(A.hemi, B.hemi, t), moonIntensity: lerp(A.moon, B.moon, t),
    exposure: lerp(A.exp, B.exp, t), stars: lerp(A.stars, B.stars, t),
    phase: t < 0.5 ? A.phase : B.phase,
  };
}

export function environmentFor(date, { latitude = DEFAULT_LATITUDE } = {}) {
  const sp = solarPosition(date, latitude);
  const L = lightingForElevation(sp.elevation);
  return {
    ...L, elevation: sp.elevation, azimuth: sp.azimuth,
    sun: sunVector(Math.max(sp.elevation, 2), sp.azimuth),
    isNight: sp.elevation < -6, isDark: sp.elevation < 0,
  };
}

/** Resolve the date the environment should show: auto = browser local time, manual = chosen time/date. */
export function environmentDate(time, now = new Date()) {
  if (!time || time.mode !== 'manual') return now;
  const [y, mo, d] = String(time.date || '').split('-').map(Number);
  const [h, mi] = String(time.time || '12:00').split(':').map(Number);
  const base = new Date(now);
  if (y && mo && d) base.setFullYear(y, mo - 1, d);
  base.setHours(h || 0, mi || 0, 0, 0);
  return base;
}

export const fmtClock = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
