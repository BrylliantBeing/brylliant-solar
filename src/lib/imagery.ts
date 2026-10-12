import { jsonEndpoint } from '@/lib/api-request';
import { ESRI_ATTRIBUTION, ESRI_IMAGERY, maxImageryZoom } from '@/lib/design-geo';

/**
 * Satellite imagery for the design tool: Google (Map Tiles API) when the
 * server has GOOGLE_MAPS_KEY, else Esri. Google is much sharper over
 * Zamboanga, where Esri stops at zoom 18 (≈0.6 m per pixel).
 *
 * Google's terms: show its logo and the copyright text from its viewport
 * endpoint on the map, and don't store tiles. Both providers here are only
 * ever drawn live, never saved or printed.
 */

const request = jsonEndpoint('/api/imagery.php', 'Imagery');

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type Imagery = {
  provider: 'google' | 'esri';
  /** {z}/{x}/{y} template */
  template: string;
  /** Deepest zoom with real imagery at a point */
  maxZoom: (lat: number, lng: number) => Promise<number>;
  /** The attribution to show for this view */
  copyright: (b: Bounds, zoom: number) => Promise<string>;
  /** Why Google isn't in use, when it was expected */
  note: string | null;
};

const esri = (note: string | null = null): Imagery => ({
  provider: 'esri',
  template: ESRI_IMAGERY,
  maxZoom: maxImageryZoom,
  copyright: async () => ESRI_ATTRIBUTION,
  note,
});

type ZoomRect = {
  maxZoom: number;
  north: number;
  south: number;
  east: number;
  west: number;
};
type Viewport = { copyright: string; maxZoomRects: ZoomRect[] };

function google(key: string, session: string): Imagery {
  const viewports = new Map<string, Promise<Viewport>>();
  const viewport = (b: Bounds, zoom: number) => {
    const q = `?viewport=1&zoom=${Math.round(zoom)}&north=${b.north.toFixed(5)}&south=${b.south.toFixed(5)}&east=${b.east.toFixed(5)}&west=${b.west.toFixed(5)}`;
    let hit = viewports.get(q);
    if (!hit) {
      hit = request<Viewport>(q).then(({ copyright, maxZoomRects }) => ({
        copyright,
        maxZoomRects,
      }));
      hit.catch(() => viewports.delete(q));
      viewports.set(q, hit);
    }
    return hit;
  };
  return {
    provider: 'google',
    template: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`,
    async maxZoom(lat, lng) {
      const d = 0.0005; // ≈50 m around the point
      try {
        const v = await viewport({ north: lat + d, south: lat - d, east: lng + d, west: lng - d }, 18);
        const here = v.maxZoomRects.filter((r) => lat <= r.north && lat >= r.south && lng <= r.east && lng >= r.west);
        return here.length ? Math.max(...here.map((r) => r.maxZoom)) : 20;
      } catch {
        return 20;
      }
    },
    async copyright(b, zoom) {
      // Google's text names the imagery providers ("Imagery ©2026 Airbus, Maxar Technologies"); the logo beside it credits Google.
      try {
        return (await viewport(b, zoom)).copyright || 'Imagery © Google';
      } catch {
        return 'Imagery © Google';
      }
    },
    note: null,
  };
}

let loaded: Promise<Imagery> | null = null;

/** Asked once per page load; the session it brings lasts about two weeks. */
export function loadImagery(): Promise<Imagery> {
  loaded ??= request<{
    google: { key: string; session: string } | null;
    error?: string;
  }>('')
    .then(({ google: g, error }) => (g ? google(g.key, g.session) : esri(error ?? null)))
    .catch(() => esri('Could not reach the imagery service; using Esri.'));
  return loaded;
}
