import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DataSource } from '@/lib/quotes-api';

/* ---------------- file / paste input ---------------- */

/** Opens the browser's file picker and returns the chosen file. Web only. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type { DataSource };

/**
 * A CSV the calculator needs: upload a file (web) or paste it. Uploaded files
 * are not put in a text box, since a year of hourly rows makes one crawl.
 * With fromXlsx, an .xlsx upload is converted to that CSV text first.
 */
export function DataSourceInput({
  value,
  onChange,
  placeholder,
  onSample,
  fromXlsx,
}: {
  value: DataSource;
  onChange: (next: DataSource) => void;
  placeholder: string;
  onSample?: () => void;
  fromXlsx?: (data: ArrayBuffer) => Promise<string>;
}) {
  const t = useTheme();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const lines = value.text ? value.text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length : 0;

  async function upload() {
    const file = await pickFile('.csv,text/csv,text/plain' + (fromXlsx ? `,.xlsx,${XLSX_TYPE}` : ''));
    if (!file) return;
    setUploadError(null);
    try {
      const text =
        fromXlsx && /\.xlsx$/i.test(file.name) ? await fromXlsx(await file.arrayBuffer()) : await file.text();
      onChange({ text, fileName: file.name });
    } catch (e) {
      setUploadError(`${file.name}: ${(e as Error).message}`);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      {value.fileName ? (
        <View style={[styles.file, { borderColor: t.lineStrong, backgroundColor: t.backgroundSelected }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {value.fileName}
            </ThemedText>
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
              {lines.toLocaleString('en-PH')} lines
            </ThemedText>
          </View>
          <SmallButton label="Remove" onPress={() => onChange({ text: '', fileName: null })} />
        </View>
      ) : (
        <TextInput
          value={value.text}
          onChangeText={(text) => onChange({ text, fileName: null })}
          multiline
          placeholder={placeholder}
          placeholderTextColor={t.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[styles.paste, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
        />
      )}
      <View style={styles.row}>
        {Platform.OS === 'web' ? (
          <SmallButton label={fromXlsx ? 'Upload CSV or Excel…' : 'Upload CSV…'} onPress={upload} />
        ) : null}
        {onSample ? <SmallButton label="Use sample data" onPress={onSample} /> : null}
        {value.text && !value.fileName ? (
          <SmallButton label="Clear" onPress={() => onChange({ text: '', fileName: null })} />
        ) : null}
      </View>
      {uploadError ? <MessageList title="Couldn't read the file" tone="warn" items={[uploadError]} /> : null}
    </View>
  );
}

export function SmallButton({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.small,
        { borderColor: strong ? t.accent : t.lineStrong, backgroundColor: strong ? t.accent : t.backgroundElement },
        pressed && { opacity: 0.7 },
      ]}>
      <ThemedText type="link" style={{ fontSize: 13, color: strong ? t.onAccent : t.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/* ---------------- multi-select with search ---------------- */

export type SelectOption = { value: string; label: string; count?: number };

/** Lower case without accents, so "canelar" finds "Cañelar". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A dropdown of checkable options with a search box. Nothing selected means
 * every option applies, which the closed field says with `allLabel`.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  noun,
  searchPlaceholder = 'Search…',
}: {
  options: SelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  /** Plural noun for the summary, e.g. "barangays" */
  noun: string;
  searchPlaceholder?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = new Set(selected);
  const q = fold(query.trim());
  const shown = q ? options.filter((o) => fold(o.label).includes(q)) : options;

  const toggle = (value: string) =>
    onChange(chosen.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const summary =
    selected.length === 0 ? allLabel : selected.length <= 2 ? selected.join(', ') : `${selected.length} ${noun} selected`;

  return (
    <View style={{ gap: Spacing.two }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Choose ${noun}: ${summary}`}
        style={[styles.select, { borderColor: open ? t.accent : t.lineStrong, backgroundColor: t.background }]}>
        <ThemedText type="small" numberOfLines={1} style={{ flex: 1, color: selected.length ? t.text : t.textSecondary }}>
          {summary}
        </ThemedText>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
          {open ? '▴' : '▾'}
        </ThemedText>
      </Pressable>

      {selected.length > 0 ? (
        <View style={styles.row}>
          {selected.map((v) => (
            <Pressable
              key={v}
              onPress={() => toggle(v)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${v}`}
              style={({ pressed }) => [styles.tag, { borderColor: t.accent, backgroundColor: t.backgroundSelected }, pressed && { opacity: 0.7 }]}>
              <ThemedText type="data" style={{ fontSize: 12 }}>
                {v} ×
              </ThemedText>
            </Pressable>
          ))}
          <SmallButton label="Clear" onPress={() => onChange([])} />
        </View>
      ) : null}

      {open ? (
        <View style={[styles.dropdown, { borderColor: t.lineStrong, backgroundColor: t.background }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={t.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={`Search ${noun}`}
            style={[styles.search, { color: t.text, borderBottomColor: t.line }]}
          />
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {shown.map((o) => {
              const on = chosen.has(o.value);
              return (
                <Pressable
                  key={o.value}
                  onPress={() => toggle(o.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.option,
                    (pressed || hovered) && { backgroundColor: t.backgroundElement },
                  ]}>
                  <View style={[styles.check, { borderColor: on ? t.accent : t.lineStrong, backgroundColor: on ? t.accent : 'transparent' }]}>
                    {on ? <ThemedText style={{ color: t.onAccent, fontSize: 11, lineHeight: 14 }}>✓</ThemedText> : null}
                  </View>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {o.label}
                  </ThemedText>
                  {o.count !== undefined ? (
                    <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
                      {o.count}
                    </ThemedText>
                  ) : null}
                </Pressable>
              );
            })}
            {shown.length === 0 ? (
              <ThemedText type="small" themeColor="textMuted" style={{ padding: Spacing.three }}>
                No {noun} match “{query.trim()}”.
              </ThemedText>
            ) : null}
          </ScrollView>
          <View style={[styles.dropdownFoot, { borderTopColor: t.line }]}>
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11, flex: 1 }}>
              {q ? `${shown.length} of ${options.length}` : `${options.length} ${noun}`}
              {selected.length ? ` · ${selected.length} selected` : ''}
            </ThemedText>
            <SmallButton label="Done" onPress={() => { setOpen(false); setQuery(''); }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ---------------- assumption fields ---------------- */

export function NumberInput({
  label,
  unit,
  value,
  onChange,
  changed,
  help,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  changed: boolean;
  help?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="eyebrow" style={{ color: changed ? t.accentWarm : t.textMuted }}>
        {label}
        {changed ? ' · edited' : ''}
      </ThemedText>
      <View style={[styles.fieldBox, { borderColor: changed ? t.accentWarm : t.lineStrong, backgroundColor: t.background }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
          accessibilityLabel={`${label} (${unit})`}
          style={[styles.fieldInput, { color: t.text }]}
        />
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
          {unit}
        </ThemedText>
      </View>
      {help ? (
        <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12, lineHeight: 16 }}>
          {help}
        </ThemedText>
      ) : null}
    </View>
  );
}

/* ---------------- display ---------------- */

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <ThemedText type="eyebrow" themeColor="textMuted">
          {title}
        </ThemedText>
        {right}
      </View>
      {children}
    </Card>
  );
}

/** Label on the left, figure on the right; `total` draws a rule above and bolds it. */
export function KeyValue({ label, value, total, sub }: { label: string; value: string; total?: boolean; sub?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.kv, total && { borderTopWidth: 1, borderTopColor: t.lineStrong, paddingTop: Spacing.two }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type={total ? 'smallBold' : 'small'} themeColor={total ? 'text' : 'textSecondary'}>
          {label}
        </ThemedText>
        {sub ? (
          <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11, lineHeight: 15 }}>
            {sub}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="data" style={{ fontSize: total ? 15 : 13, fontWeight: total ? '700' : '400', color: total ? t.accent : t.text }}>
        {value}
      </ThemedText>
    </View>
  );
}

/** A plain data table that scrolls sideways on narrow screens. Numbers right-aligned. */
export function Table({ head, rows, foot }: { head: string[]; rows: string[][]; foot?: string[] }) {
  const t = useTheme();
  const cell = (text: string, i: number, bold?: boolean) => (
    <ThemedText
      key={i}
      type="data"
      style={[styles.cell, i === 0 ? styles.firstCell : { textAlign: 'right' }, { fontSize: 12, fontWeight: bold ? '700' : '400' }]}>
      {text}
    </ThemedText>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minWidth: 600 }}>
        <View style={[styles.tr, { borderBottomColor: t.lineStrong }]}>
          {head.map((h, i) => (
            <ThemedText key={i} type="eyebrow" themeColor="textMuted" style={[styles.cell, i === 0 ? styles.firstCell : { textAlign: 'right' }]}>
              {h}
            </ThemedText>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={[styles.tr, { borderBottomColor: t.line }]}>
            {r.map((c, i) => cell(c, i))}
          </View>
        ))}
        {foot ? <View style={[styles.tr, { borderBottomWidth: 0 }]}>{foot.map((c, i) => cell(c, i, true))}</View> : null}
      </View>
    </ScrollView>
  );
}

/** Amber-edged list for warnings; muted for notes. */
export function MessageList({ title, items, tone }: { title: string; items: string[]; tone: 'warn' | 'note' }) {
  const t = useTheme();
  if (items.length === 0) return null;
  return (
    <View
      style={[
        styles.messages,
        {
          borderColor: t.line,
          borderLeftColor: tone === 'warn' ? t.sun : t.lineStrong,
          backgroundColor: tone === 'warn' ? t.backgroundSelected : t.background,
        },
      ]}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {title}
      </ThemedText>
      {items.map((m, i) => (
        <ThemedText key={i} type="small" themeColor="textSecondary">
          • {m}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  file: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.three },
  paste: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    textAlignVertical: 'top',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  tag: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  dropdown: { borderWidth: 1, borderRadius: Radius.sm, overflow: 'hidden' },
  search: { borderBottomWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  check: { width: 16, height: 16, borderWidth: 1, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  dropdownFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderTopWidth: 1, padding: Spacing.two },
  small: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two * 0.75 },
  field: { gap: Spacing.one, flexGrow: 1, flexBasis: 160, maxWidth: 260 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two },
  fieldInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: Spacing.two },
  kv: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.three },
  tr: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: Spacing.one + 2 },
  cell: { flex: 1, paddingHorizontal: Spacing.one },
  firstCell: { flex: 0.9, textAlign: 'left' },
  messages: { borderWidth: 1, borderLeftWidth: 3, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.one },
});
