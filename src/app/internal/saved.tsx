import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { InternalPage } from '@/components/internal/internal-page';
import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { num, peso } from '@/lib/quote-input';
import { deleteQuote, listQuotes, manilaTime, type SavedQuoteSummary } from '@/lib/quotes-api';

export default function SavedQuotes() {
  const t = useTheme();
  const [search, setSearch] = useState('');
  const [quotes, setQuotes] = useState<SavedQuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Delete asks twice: the first tap arms this id, the second deletes. */
  const [confirming, setConfirming] = useState<number | null>(null);

  // Reload as the search changes, after a short pause in typing.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      listQuotes(search)
        .then((rows) => {
          if (!live) return;
          setQuotes(rows);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  async function remove(id: number) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    try {
      await deleteQuote(id);
      setQuotes((prev) => prev?.filter((q) => q.id !== id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <InternalPage eyebrow="Quotes" title="Saved quotes" lede="Every quote saved from the calculator, newest first. Open one to review, recalculate or update it.">
      <View style={styles.toolbar}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by customer"
          placeholderTextColor={t.textMuted}
          accessibilityLabel="Search saved quotes by customer"
          autoCorrect={false}
          style={[styles.search, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
        />
        <SmallButton label="New quote" onPress={() => router.push('/internal/quote')} strong />
      </View>

      {error ? <MessageList title="Could not load quotes" tone="warn" items={[error]} /> : null}

      {quotes === null && !error ? (
        <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} />
      ) : quotes && quotes.length === 0 ? (
        <Card>
          <ThemedText type="heading">{search.trim() ? 'No matching quotes' : 'No saved quotes yet'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Calculate a quote and press Save quote to keep it here.
          </ThemedText>
        </Card>
      ) : (
        <View style={{ gap: Spacing.two }}>
          {quotes?.map((q) => (
            <View key={q.id} style={[styles.row, { borderColor: t.line, backgroundColor: t.backgroundElement }]}>
              <Pressable
                onPress={() => router.push({ pathname: '/internal/quote', params: { id: String(q.id) } })}
                accessibilityRole="link"
                style={({ pressed }) => [styles.main, pressed && { opacity: 0.7 }]}>
                <ThemedText type="heading">{q.customer}</ThemedText>
                <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 12 }}>
                  {num(q.systemKwp, 2)} kWp · {num(q.batteryKwh, 1)} kWh battery · {num(q.reductionPct, 1)}% lower bill
                </ThemedText>
                <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
                  #{q.id} · updated {manilaTime(q.updatedAt)} by {q.updatedBy}
                  {q.createdBy !== q.updatedBy ? ` · created by ${q.createdBy}` : ''}
                </ThemedText>
              </Pressable>
              <View style={styles.side}>
                <ThemedText type="dataLarge" style={{ fontSize: 18, color: t.accent }}>
                  {peso(q.totalPrice)}
                </ThemedText>
                <View style={styles.buttons}>
                  <SmallButton label="Open" onPress={() => router.push({ pathname: '/internal/quote', params: { id: String(q.id) } })} />
                  <SmallButton label={confirming === q.id ? 'Confirm delete' : 'Delete'} onPress={() => remove(q.id)} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </InternalPage>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  search: {
    flexGrow: 1,
    flexBasis: 240,
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  main: { flexGrow: 1, flexBasis: 280, gap: 2 },
  side: { alignItems: 'flex-end', gap: Spacing.two },
  buttons: { flexDirection: 'row', gap: Spacing.two },
});
