import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ImageryCredit } from '@/components/internal/design/imagery-credit';
import { geocode, metresPerPixel, type GeocodeHit } from '@/lib/design-geo';
import { loadImagery, type Imagery } from '@/lib/imagery';
import type { DesignSite } from '@/lib/designs-api';

/** Zamboanga City, for a project with no address yet. */
const START = { lat: 6.9214, lng: 122.079, zoom: 14 };

/**
 * Step 1: find the house on satellite imagery and drag a rectangle around the
 * roof. Leaflet touches `window` when imported, so it loads in an effect; the
 * static HTML only ever has the empty box.
 */
export function SiteMap({
  site,
  address,
  onChange,
}: {
  site: DesignSite | null;
  address: string;
  onChange: (site: DesignSite) => void;
}) {
  const t = useTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const rect = useRef<Leaflet.Rectangle | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [query, setQuery] = useState(address);
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  /** Deepest zoom with real imagery under the map's centre */
  const [native, setNative] = useState<{ z: number; lat: number } | null>(null);
  const imagery = useRef<Imagery | null>(null);
  const [credit, setCredit] = useState<{
    provider: Imagery['provider'];
    text: string;
    note: string | null;
  } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Create the map once.
  useEffect(() => {
    let live = true;
    Promise.all([import('leaflet'), loadImagery()]).then(([mod, img]) => {
      if (!live || !box.current || map.current) return;
      const lib = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet);
      L.current = lib;
      imagery.current = img;
      // Attribution is drawn by ImageryCredit, which also carries Google's logo.
      const m = lib.map(box.current, {
        zoomControl: true,
        maxZoom: 22,
        attributionControl: false,
      });
      // Past the deepest real imagery Leaflet enlarges that level instead of fetching "no data" tiles.
      const layer = lib.tileLayer(img.template, { maxNativeZoom: 18, maxZoom: 22 }).addTo(m);
      const probe = () => {
        const c = m.getCenter();
        const b = m.getBounds();
        img.maxZoom(c.lat, c.lng).then((z) => {
          if (!live) return;
          setNative({ z, lat: c.lat });
          if (layer.options.maxNativeZoom !== z) {
            layer.options.maxNativeZoom = z;
            layer.redraw();
          }
        });
        img
          .copyright(
            {
              north: b.getNorth(),
              south: b.getSouth(),
              east: b.getEast(),
              west: b.getWest(),
            },
            Math.min(m.getZoom(), 22),
          )
          .then((text) => live && setCredit({ provider: img.provider, text, note: img.note }));
      };
      m.on('moveend', probe);
      if (site) {
        m.fitBounds(
          [
            [site.south, site.west],
            [site.north, site.east],
          ],
          { padding: [40, 40] },
        );
      } else {
        m.setView([START.lat, START.lng], START.zoom);
      }
      map.current = m;
      drawRect(site);
      probe();
    });
    return () => {
      live = false;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawRect(s: DesignSite | null) {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    rect.current?.remove();
    rect.current = s
      ? lib
          .rectangle(
            [
              [s.south, s.west],
              [s.north, s.east],
            ],
            { color: '#E7A93C', weight: 2, fillOpacity: 0.08 },
          )
          .addTo(m)
      : null;
  }

  // Drag-to-draw: while drawing, the map stops panning and the drag makes the rectangle.
  useEffect(() => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m || !drawing) return;
    m.dragging.disable();
    m.getContainer().style.cursor = 'crosshair';
    let start: Leaflet.LatLng | null = null;
    const down = (e: Leaflet.LeafletMouseEvent) => {
      start = e.latlng;
    };
    const move = (e: Leaflet.LeafletMouseEvent) => {
      if (!start) return;
      const b = lib.latLngBounds(start, e.latlng);
      drawRect({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
        zoom: 19,
        scale: 1,
      });
    };
    const up = (e: Leaflet.LeafletMouseEvent) => {
      if (!start) return;
      const b = lib.latLngBounds(start, e.latlng);
      start = null;
      setDrawing(false);
      if (b.getNorth() === b.getSouth() || b.getEast() === b.getWest()) return;
      // The layout's background uses the sharpest imagery that exists at the site.
      const c = b.getCenter();
      (imagery.current?.maxZoom(c.lat, c.lng) ?? Promise.resolve(18)).then((zoom) =>
        onChangeRef.current({
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
          zoom,
          scale: site?.scale ?? 1,
        }),
      );
    };
    m.on('mousedown', down);
    m.on('mousemove', move);
    m.on('mouseup', up);
    return () => {
      m.off('mousedown', down);
      m.off('mousemove', move);
      m.off('mouseup', up);
      m.dragging.enable();
      m.getContainer().style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  useEffect(() => {
    if (!drawing) drawRect(site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await geocode(query.trim());
      setHits(found);
      if (!found.length) setSearchError('No match. Try the barangay and city, or pan the map by hand.');
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function go(hit: GeocodeHit) {
    map.current?.setView([hit.lat, hit.lng], 19);
    setHits([]);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.row}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="Search an address, barangay or landmark"
          placeholderTextColor={t.textMuted}
          style={[
            styles.input,
            {
              borderColor: t.lineStrong,
              color: t.text,
              backgroundColor: t.background,
            },
          ]}
        />
        <SmallButton label={searching ? 'Searching…' : 'Search'} onPress={search} />
        <SmallButton
          label={drawing ? 'Drag on the map…' : site ? 'Redraw rectangle' : 'Draw rectangle'}
          onPress={() => setDrawing((d) => !d)}
          strong
        />
      </View>
      {searchError ? (
        <ThemedText type="small" themeColor="accentWarm">
          {searchError}
        </ThemedText>
      ) : null}
      {hits.length ? (
        <View style={[styles.hits, { borderColor: t.line, backgroundColor: t.backgroundElement }]}>
          {hits.map((h) => (
            <Pressable key={`${h.lat},${h.lng}`} onPress={() => go(h)} style={styles.hit}>
              <ThemedText type="small" numberOfLines={1}>
                {h.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ position: 'relative' }}>
        <div
          ref={box}
          style={{
            height: 520,
            borderRadius: Radius.md,
            overflow: 'hidden',
            border: `1px solid ${t.line}`,
          }}
        />
        {credit ? <ImageryCredit provider={credit.provider} text={credit.text} /> : null}
      </View>
      {credit?.note ? (
        <ThemedText type="small" themeColor="accentWarm">
          {credit.note}
        </ThemedText>
      ) : null}
      {native ? (
        <ThemedText type="small" themeColor="textMuted">
          {`${credit?.provider === 'google' ? 'Google' : 'Esri'} imagery. Sharpest here: zoom ${native.z}, about ${metresPerPixel(native.lat, native.z).toFixed(2)} m per pixel. Zooming in past that enlarges the same photo.`}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textMuted">
        Zoom in until the roof fills the screen, press Draw rectangle, then drag from one corner of the property to the other.
        Leave a few metres around the roof so the meter and inverter fit inside.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flexGrow: 1,
    minWidth: 240,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  hits: { borderWidth: 1, borderRadius: Radius.sm },
  hit: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
