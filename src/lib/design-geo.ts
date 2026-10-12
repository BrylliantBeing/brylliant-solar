import type { DesignSite } from '@/lib/designs-api';

/**
 * The site rectangle as a flat plan in metres: origin at the rectangle's
 * centre, x east, y south. Over a roof-sized area the equirectangular
 * approximation is off by millimetres, far below what the imagery resolves.
 */

const M_PER_DEG_LAT = 111_320;

export const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const siteCenter = (s: DesignSite) => ({ lat: (s.north + s.south) / 2, lng: (s.east + s.west) / 2 });

const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

export function toLocal(s: DesignSite, lat: number, lng: number): { x: number; y: number } {
  const c = siteCenter(s);
  return { x: (lng - c.lng) * mPerDegLng(c.lat) * s.scale, y: (c.lat - lat) * M_PER_DEG_LAT * s.scale };
}

export function toLatLng(s: DesignSite, x: number, y: number): { lat: number; lng: number } {
  const c = siteCenter(s);
  return { lat: c.lat - y / s.scale / M_PER_DEG_LAT, lng: c.lng + x / s.scale / mPerDegLng(c.lat) };
}

/** The rectangle's extent in metres. */
export function siteBox(s: DesignSite) {
  const nw = toLocal(s, s.north, s.west);
  const se = toLocal(s, s.south, s.east);
  return { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y };
}

/* Slippy-map tile maths (Web Mercator). */
const tileX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const tileLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

export type PlacedTile = { url: string; x: number; y: number; w: number; h: number };

/** The tiles covering the site (plus a margin), each placed in plan metres. Capped so a huge rectangle stays light. */
export function siteTiles(s: DesignSite, template = ESRI_IMAGERY, marginM = 10, maxTiles = 100): PlacedTile[] {
  const pad = toLatLng(s, 0, 0);
  const dLat = marginM / M_PER_DEG_LAT;
  const dLng = marginM / mPerDegLng(pad.lat);
  let z = Math.round(s.zoom);
  for (; z > 10; z -= 1) {
    const cols = Math.floor(tileX(s.east + dLng, z)) - Math.floor(tileX(s.west - dLng, z)) + 1;
    const rows = Math.floor(tileY(s.south - dLat, z)) - Math.floor(tileY(s.north + dLat, z)) + 1;
    if (cols * rows <= maxTiles) break;
  }
  const out: PlacedTile[] = [];
  for (let tx = Math.floor(tileX(s.west - dLng, z)); tx <= Math.floor(tileX(s.east + dLng, z)); tx += 1) {
    for (let ty = Math.floor(tileY(s.north + dLat, z)); ty <= Math.floor(tileY(s.south - dLat, z)); ty += 1) {
      const nw = toLocal(s, tileLat(ty, z), tileLng(tx, z));
      const se = toLocal(s, tileLat(ty + 1, z), tileLng(tx + 1, z));
      out.push({
        url: template.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty)),
        x: nw.x,
        y: nw.y,
        w: se.x - nw.x,
        h: se.y - nw.y,
      });
    }
  }
  return out;
}

/** Tiles for a small map around one point, e.g. the vicinity map: n × n tiles centred on it. */
export function tilesAround(lat: number, lng: number, z: number, n = 3, template = OSM_TILES) {
  const cx = tileX(lng, z);
  const cy = tileY(lat, z);
  const x0 = Math.floor(cx) - Math.floor(n / 2);
  const y0 = Math.floor(cy) - Math.floor(n / 2);
  const tiles: { url: string; col: number; row: number }[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      tiles.push({ url: template.replace('{z}', String(z)).replace('{x}', String(x0 + c)).replace('{y}', String(y0 + r)), col: c, row: r });
    }
  }
  // Where the point falls, in tile units from the grid's top-left
  return { tiles, px: cx - x0, py: cy - y0 };
}

export type GeocodeHit = { label: string; lat: number; lng: number };

/** OpenStreetMap Nominatim search, Philippines only. Their policy: at most one request a second. */
export async function geocode(q: string): Promise<GeocodeHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ph&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is not responding. Pan the map by hand.');
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
