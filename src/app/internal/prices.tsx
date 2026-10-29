import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { InternalPage } from '@/components/internal/internal-page';
import { MessageList, Panel, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PRICE_GROUPS, PRICE_ITEMS, type PriceOverrides } from '@/lib/price-list';
import { loadPrices, savePrices, type PriceUpdate } from '@/lib/prices-api';
import { manilaTime } from '@/lib/quotes-api';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const toNumber = (s: string) => Number(s.replace(/[,\s₱]/g, ''));

/** /internal/prices — what every item costs. Designs price their bill of materials from here. */
export default function PricesPage() {
  const t = useTheme();
  const [saved, setSaved] = useState<{ prices: PriceOverrides; updated: Record<string, PriceUpdate> } | null>(null);
  /** Typed but not saved, by key; '' means back to the default */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);

  useEffect(() => {
    loadPrices()
      .then(setSaved)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!saved) {
    return (
      <InternalPage eyebrow="Prices" title="Price list">
        {error ? <MessageList title="Could not load prices" items={[error]} tone="warn" /> : <ActivityIndicator color={t.accent} />}
      </InternalPage>
    );
  }

  const bad = Object.entries(edits).filter(([, v]) => v.trim() !== '' && !(toNumber(v) >= 0));
  const changed = Object.keys(edits).length;

  async function save() {
    if (bad.length) return;
    setBusy(true);
    setError(null);
    try {
      const changes = Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, v.trim() === '' ? null : toNumber(v)]));
      setSaved(await savePrices(changes));
      setEdits({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = (key: string, fallback: number | null) => (key in saved.prices ? saved.prices[key] : fallback);
  const unpricedCount = PRICE_ITEMS.filter((i) => current(i.key, i.defaultPhp) === null).length;

  return (
    <InternalPage
      eyebrow="Prices"
      title="Price list"
      lede="What each item costs, in pesos. Designs price their bill of materials from this list; an item with no price is left out of the total and named on the design. Blank a price to go back to its default.">
      <View style={styles.bar}>
        <SmallButton label={busy ? 'Saving…' : changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'Saved'} onPress={save} strong={changed > 0} />
        {changed ? <SmallButton label="Discard" onPress={() => setEdits({})} /> : null}
        <SmallButton label={onlyUnpriced ? 'Show all items' : `Show only unpriced (${unpricedCount})`} onPress={() => setOnlyUnpriced((v) => !v)} />
      </View>
      {error ? <MessageList title="Problem" items={[error]} tone="warn" /> : null}
      {bad.length ? <MessageList title="Not a price" items={bad.map(([k]) => PRICE_ITEMS.find((i) => i.key === k)?.name ?? k)} tone="warn" /> : null}

      {PRICE_GROUPS.map((group) => {
        const items = PRICE_ITEMS.filter((i) => i.group === group && (!onlyUnpriced || current(i.key, i.defaultPhp) === null));
        if (!items.length) return null;
        return (
          <Panel key={group} title={group}>
            {items.map((item) => {
              const edited = item.key in edits;
              const value = edited ? edits[item.key] : item.key in saved.prices ? String(saved.prices[item.key]) : '';
              const set = item.key in saved.prices;
              const upd = saved.updated[item.key];
              return (
                <View key={item.key} style={[styles.row, { borderBottomColor: t.line }]}>
                  <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
                    <ThemedText type="small">{item.name}</ThemedText>
                    <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
                      {[
                        `per ${item.unit}`,
                        item.basis ? `${item.qty} per ${item.basis}` : null,
                        item.defaultPhp === null ? 'no default' : `default ${peso(item.defaultPhp)}`,
                        set && upd ? `set by ${upd.by}, ${manilaTime(upd.at)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  </View>
                  <View style={[styles.field, { borderColor: edited ? t.accentWarm : set ? t.accent : t.lineStrong, backgroundColor: t.background }]}>
                    <ThemedText type="data" themeColor="textMuted">
                      ₱
                    </ThemedText>
                    <TextInput
                      value={value}
                      placeholder={item.defaultPhp === null ? 'no price' : String(item.defaultPhp)}
                      placeholderTextColor={item.defaultPhp === null ? t.accentWarm : t.textMuted}
                      onChangeText={(v) => setEdits((e) => ({ ...e, [item.key]: v }))}
                      inputMode="decimal"
                      accessibilityLabel={`${item.name} price`}
                      style={[styles.input, { color: t.text }]}
                    />
                  </View>
                </View>
              );
            })}
          </Panel>
        );
      })}
    </InternalPage>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, width: 150 },
  input: { flex: 1, minWidth: 0, paddingVertical: 6, textAlign: 'right' },
});
