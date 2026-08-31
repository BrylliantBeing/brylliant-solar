# Solar quotation calculator — model specification

Numbers for implementing residential and commercial array sizing on a website. Companion file: `solar-calculator-model.json`.

All figures derived from a 5-minute interval dispatch simulation over a full month, validated against three ZAMCELCO invoices (commercial) and LBNL load-shape research covering 2,353 metered commercial buildings.

---

## 1. The one formula you need

Array sizing is **exactly linear** in monthly consumption and **exactly inverse** in specific yield. Verified across 150–800 kWh/month residential and 1,500–8,000 kWh/month commercial: 0.00% deviation. So you do not need to run a simulation on the server.

```
kWp = monthly_kWh × B / yield
```

- `monthly_kWh` — from the customer's bill
- `yield` — kWh generated per kWp per day at the site (Zamboanga measured: **3.5**)
- `B` — dimensionless coefficient from the table in §3

Then:

```
panels        = ceil(kWp / panel_watts × 1000)
installed_kWp = panels × panel_watts / 1000
inverter_kW   = installed_kWp / 1.20
```

Round panels **up**. Report the achieved reduction from the rounded array, not the target — at residential scale one panel is a large step and the overshoot is material.

---

## 2. Load profiles

### Residential — relative hourly weights, midnight to 23:00

Normalise so the curve integrates to `monthly_kWh / 30` per day. Interpolate linearly between hour centres (each weight sits at HH:30).

| Profile key | Weights |
|---|---|
| `typical` | 1.1, 1.0, 1.0, 1.0, 1.0, 1.2, 2.2, 2.4, 1.6, 1.4, 1.4, 1.8, 2.0, 1.7, 1.6, 1.6, 1.7, 2.2, 3.0, 3.4, 3.3, 2.9, 2.3, 1.6 |
| `away` | 1.2, 1.1, 1.1, 1.1, 1.1, 1.3, 2.4, 2.6, 1.2, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.8, 3.2, 3.8, 3.7, 3.2, 2.5, 1.7 |
| `home` | 1.2, 1.1, 1.1, 1.1, 1.1, 1.3, 2.2, 2.3, 2.0, 2.2, 2.4, 2.6, 2.6, 2.5, 2.6, 2.6, 2.5, 2.6, 3.0, 3.2, 3.1, 2.7, 2.1, 1.5 |
| `aircon` | 2.6, 2.5, 2.5, 2.4, 2.4, 2.3, 2.4, 2.2, 1.5, 1.4, 1.5, 1.8, 2.0, 2.2, 2.4, 2.5, 2.6, 2.8, 3.4, 3.8, 3.9, 3.6, 3.2, 2.9 |

**Provenance:** constructed archetypes, not measured data — no public dataset of hourly Philippine household consumption exists. Built on documented facts: air conditioning is the largest household load in the Philippines at roughly 27% of consumption, refrigerators around 15% running flat 24/7, and demand peaking in the evening. Every profile peaks 18:00–21:00, after solar has reached zero. Label them as estimates in your UI.

### Commercial — parametric

Piecewise shape multiplier `S(t)` applied above a constant base load:

| Segment | Value |
|---|---|
| t < 8.0 or t ≥ 18.0 | 0 |
| 8.0 ≤ t < 10.0 | 0.85 × (t − 8) / 2 |
| 10.0 ≤ t < 15.0 | 0.85 + 0.15 × (t − 10) / 5 |
| 15.0 ≤ t < 18.0 | (18 − t) / 3 |

Equivalent peak-hours: **8.1917** per working day (area under S).

```
base_kW = monthly_kWh / (days × 24 + workdays × 8.1917 × (peak_base_ratio − 1))
peak_kW = base_kW × peak_base_ratio
load(t) = base_kW + (peak_kW − base_kW) × S(t)     # working days
load(t) = base_kW                                   # closed days
```

**Provenance:** LBNL clustering of 2,353 metered commercial buildings. 65% of small offices rise at 8am and fall around 6pm; small buildings average ~10 hours on-duration. In cooling seasons peak load appears at 15:00, which is why the plateau climbs rather than sitting flat — the Philippines is a cooling climate year-round.

**Peak-to-base ratio** is the input that matters. Observed range across the dataset is roughly 1–30. Use **20** as default for a small office. Offer 10 (poorly shut down at night) to 30 (shuts down completely).

To measure it for a real customer: read the meter Friday 18:00 and Monday 08:00. That 62-hour window is almost pure base load, and the candidate ratios separate cleanly — 43 kWh at 30:1, 61 kWh at 20:1, 105 kWh at 10:1.

---

## 3. Coefficient table

`B` values. `kWp = monthly_kWh × B / yield`.

### Export ratio 2:1 (kWh exported per 1 kWh credited)

| Profile | 50% | 60% | 70% | 80% | 90% |
|---|---|---|---|---|---|
| `typical` | 0.0203 | 0.0262 | 0.0323 | **0.0386** | 0.0449 |
| `away` | 0.0237 | 0.0298 | 0.0359 | **0.0422** | 0.0486 |
| `home` | 0.0182 | 0.0238 | 0.0298 | **0.0360** | 0.0423 |
| `aircon` | 0.0217 | 0.0278 | 0.0340 | **0.0404** | 0.0469 |
| commercial 10:1 | 0.0181 | 0.0220 | 0.0259 | **0.0300** | 0.0342 |
| commercial 15:1 | 0.0184 | 0.0223 | 0.0263 | **0.0303** | 0.0343 |
| commercial 20:1 | 0.0186 | 0.0225 | 0.0265 | **0.0305** | 0.0345 |
| commercial 30:1 | 0.0188 | 0.0227 | 0.0267 | **0.0307** | 0.0347 |

### Export ratio 1:1

| Profile | 50% | 60% | 70% | 80% | 90% |
|---|---|---|---|---|---|
| all residential | 0.0167 | 0.0200 | 0.0233 | 0.0267 | 0.0300 |
| all commercial | 0.0161 | 0.0194 | 0.0226 | 0.0258 | 0.0290 |

Profiles converge at 1:1 because when exports earn full credit only total generation matters and load shape becomes irrelevant. Useful as an implementation sanity check.

Ratios 1.5, 2.5 and 3.0 are in the JSON under `coefficient_table_B`.

---

## 4. Self-consumption shares

Drives the "how much of your solar do you actually use" line, and battery relevance.

| Profile | Used on site | Exported |
|---|---|---|
| `home` | 48% | 52% |
| `typical` | 38% | 62% |
| `aircon` | 32% | 68% |
| `away` | 26% | 74% |
| commercial 20:1 | **69%** | 31% |

Commercial beats every household pattern because office demand happens while the sun is up. This is the single most useful number to surface to a customer.

---

## 5. Solar generation model

```
if sunrise ≤ t ≤ sunset:  g(t) = sin(π × (t − sunrise) / (sunset − sunrise))
else:                      g(t) = 0
scale = kWp × yield / (Σ g(t) × Δt)
output(t) = g(t) × scale
```

Zamboanga July: sunrise **5.73**, sunset **18.18**. Half-sine normalised to daily energy, so total output is exact regardless of the shape assumption; only the intraday distribution is approximate.

---

## 6. Billing

```
self      = Σ min(load, solar) × Δt
export    = Σ max(solar − load, 0) × Δt
import    = Σ max(load − solar, 0) × Δt
billed_kWh = import − export / export_ratio
bill       = billed_kWh × rate
```

Self-consumed solar always offsets 1:1. Only exports take the ratio haircut.

**Watch the fixed charges.** On the ZAMCELCO invoices analysed, every line except a ₱5.00/month metering retail charge is volumetric, so an 80% kWh cut really is an 80% peso cut. This is not universal — check the tariff before promising peso savings that track kWh savings.

---

## 7. Test vectors

Reproduce these exactly before going live.

**Residential** — `typical`, 300 kWh/month, 3.30 kWp, yield 3.5, ratio 2:1, 30 days

| Output | Value |
|---|---|
| Peak load | 0.765 kW |
| Generation | 346.5 kWh |
| Self-consumed | 132.7 kWh |
| Exported | 213.8 kWh |
| Imported | 167.3 kWh |
| Net billed | 60.4 kWh |

**Commercial** — 20:1, 3,720 kWh/month, 32.37 kWp, yield 3.5, ratio 2:1, 31 days, 23 working

| Output | Value |
|---|---|
| Base load | 0.981 kW |
| Peak load | 19.62 kW |
| Generation | 3,512.1 kWh |
| Self-consumed | 2,439.0 kWh |
| Exported | 1,073.1 kWh |
| Imported | 1,281.0 kWh |
| Net billed | 744.4 kWh |

Invariant that must always hold: **self + import = monthly consumption.** If it drifts, the dispatch loop is wrong.

---

## 8. Cost model

Only the module line is grounded in a real quote. Everything else is a benchmark you should replace with your own supplier pricing.

```
module_cost = panels × unit_price_usd × fx_rate × (1 + vat_rate)
bos_cost    = installed_kWp × bos_rate
total       = (module_cost + bos_cost) × (1 + contingency)
```

| Parameter | Value | Note |
|---|---|---|
| Panel unit price | USD 82.80 / 720 W | USD 0.115/W. Confirm FOB vs delivered |
| FX | ₱62 / USD | Ran 61.7–62.3 late Aug 2026 |
| VAT | 12% | Zero only if RA 9513 exemption confirmed |
| BOS, commercial | ₱38,000–45,000/kWp | Larger systems spread fixed cost further |
| BOS, residential | ₱45,000–55,000/kWp | Fixed costs over fewer kW |
| Contingency | 8% | |

At these module prices panels are only **13–18%** of project cost. Quotation accuracy depends on the BOS rate, not the panel price.

---

## 9. Battery

Only worth offering where self-consumption is low. Dispatch: charge from surplus, discharge into deficit, state of charge carried between days.

| Parameter | Value |
|---|---|
| Round-trip efficiency | 0.90 |
| Charge/discharge limit | 0.5 C |
| Cost | ₱11,250/kWh |

Value per kWh cycled = `0.5 × rate × 0.90` ≈ ₱4.94 at ₱10.97/kWh.

**Commercial:** marginal payback 8.0 years for the first 4.8 kWh module, 12.2 by the third, beyond 40 after that — against about 2.0 years for one more panel. Do not recommend by default.

**Residential:** evening peaks line up with discharge, so storage performs far better. Worth offering on `away` and `aircon` profiles.

**Both reverse if net metering is denied or export is capped.** With exports worth nothing the commercial battery pays back in about 3.5 years. Consider a toggle for customers without net metering approval.

---

## 10. Caveats to surface in the UI

1. **Yield is the dominant input.** Everything scales inversely with it. 3.5 is measured for one Zamboanga array; other sites differ, and a wrong yield moves the quote ±30%.
2. **Average-day model.** No individual cloudy days, no seasonal variation, load shape assumed to repeat. Fine for quotation, not for final electrical design.
3. **Residential profiles are archetypes, not measurements.**
4. **Payback ignores** degradation (~0.4%/yr), maintenance, rate inflation and cost of capital.
5. **Three-phase customers** must confirm delta vs wye before an inverter is specified — both print as "3 phase" on a bill and an inverter for one will not run on the other.
6. Annual figures scale one month by twelve; real months differ in irradiance and working-day count.

Present output as a range, not a single number, and label it an estimate pending a site survey.
