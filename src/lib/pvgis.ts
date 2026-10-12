import { pvgisAspect, type RoofFace, type Yields } from '@calculator/pvDesign';
import { useEffect, useRef, useState } from 'react';

import { jsonEndpoint } from '@/lib/api-request';

/** PVGIS sun data through public/api/pvgis.php (owner only, cached on the server). */
const request = jsonEndpoint('/api/pvgis.php', 'Sun data');

type Reply = { monthly: number[]; daily: number; source: string; angle?: number; aspect?: number };

const memo = new Map<string, Promise<Reply>>();

/** One PVGIS query; the same rounded inputs are only ever asked once per page load. */
function query(params: string): Promise<Reply> {
  let hit = memo.get(params);
  if (!hit) {
    hit = request<Reply>(`?${params}`).then(({ monthly, daily, source, angle, aspect }) => ({ monthly, daily, source, angle, aspect }));
    hit.catch(() => memo.delete(params));
    memo.set(params, hit);
  }
  return hit;
}

/** Rounded as the server rounds, so a face nudged by a degree is still the same question. */
const faceParams = (lat: number, lng: number, f: Pick<RoofFace, 'pitchDeg' | 'azimuthDeg'>) =>
  `lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}&angle=${Math.round(Math.min(90, Math.max(0, f.pitchDeg)))}&aspect=${Math.round(pvgisAspect(f.azimuthDeg) / 5) * 5}`;

/** A key that changes only when the answer could: the site and each face's rounded pitch and facing. */
export function yieldsKey(lat: number, lng: number, roofs: RoofFace[] | undefined): string {
  return [`${lat.toFixed(2)},${lng.toFixed(2)}`, ...(roofs ?? []).map((f) => `${f.id}:${faceParams(lat, lng, f)}`)].join('|');
}

/** Monthly PVGIS kWh/kWp/day for every face, a flat roof and the best orientation at the site. */
export async function loadYields(lat: number, lng: number, roofs: RoofFace[] | undefined): Promise<{ yields: Yields; source: string }> {
  const site = `lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`;
  const [flat, best, ...faces] = await Promise.all([
    query(`${site}&angle=0&aspect=0`),
    query(`${site}&optimal=1`),
    ...(roofs ?? []).map((f) => query(faceParams(lat, lng, f))),
  ]);
  return {
    yields: {
      flat: flat.monthly,
      // PVGIS aspect back to a compass bearing: 0 south → 180
      best: { pitchDeg: best.angle ?? 0, azimuthDeg: (((best.aspect ?? 0) + 180) % 360 + 360) % 360, monthly: best.monthly },
      faces: Object.fromEntries((roofs ?? []).map((f, i) => [f.id, faces[i].monthly])),
    },
    source: flat.source,
  };
}

export type SunData = { yields: Yields | null; source: string | null; error: string | null; loading: boolean };

/**
 * Sun data for a design, refetched only when the site or a face's rounded
 * pitch or facing changes. The last answer stays in use while a new one loads.
 */
export function useYields(center: { lat: number; lng: number } | null, roofs: RoofFace[] | undefined): SunData {
  const key = center ? yieldsKey(center.lat, center.lng, roofs) : '';
  const [state, setState] = useState<{ key: string; yields: Yields | null; source: string | null; error: string | null }>({
    key: '',
    yields: null,
    source: null,
    error: null,
  });
  const args = useRef({ center, roofs });
  useEffect(() => {
    args.current = { center, roofs };
  });
  useEffect(() => {
    const { center: c, roofs: r } = args.current;
    if (!key || !c) return;
    let live = true;
    loadYields(c.lat, c.lng, r)
      .then(({ yields, source }) => live && setState({ key, yields, source, error: null }))
      .catch((e: Error) => live && setState((s) => ({ ...s, key, error: e.message })));
    return () => {
      live = false;
    };
  }, [key]);
  return { yields: state.yields, source: state.source, error: state.key === key ? state.error : null, loading: !!key && state.key !== key };
}
