# How the models work

This document explains the maths behind each module, the assumptions and how each one is tested.

## Coordinates and units

- Grid cell: 0.5 m. Room frame: +x east, +z south, +y up; the room's "N" wall is z = 0.
- `rotation` turns the room clockwise, so the "N" wall faces compass azimuth `rotation`. The sun's azimuth is rotated
  by `-rotation` into the room frame.
- Light is photosynthetic: PPFD in µmol/m²/s, and the daily light integral DLI = ∫PPFD dt in mol/m²/day.
  Broadband W/m² is converted with 2.0 µmol/J (≈ 0.45-0.5 PAR fraction × 4.57 µmol/J; ±10%).

## 1. Sun position (`solar.js`)

Two independent implementations:

- **Spencer (1971)** Fourier series for declination δ and the equation of time, used by the simulation in local
  apparent solar time:
  `sin(el) = sin φ sin δ + cos φ cos δ cos ω`, `az = atan2(sin ω, cos ω sin φ − tan δ cos φ) + 180°`,
  with hour angle ω = 15°·(t − 12).
- **NOAA**: the spreadsheet algorithm (Meeus-based) for a real UTC instant and longitude.

The test suite checks that they agree to within 0.6° of elevation across the year, and also checks solstice and
equinox declinations, equation-of-time extremes, noon elevation = 90° − |φ − δ|, morning/afternoon symmetry, sunrise
azimuth on the equinox, and polar day and night.

Each month is represented by Klein's (1977) recommended average day, the day whose declination is closest to the
monthly mean.

## 2. Sky irradiance (`solar.js`)

- Clear-sky global horizontal (GHI): Haurwitz, `1098 cos Z · exp(−0.057 / cos Z)`.
- Beam normal (DNI): Meinel, `I0 · 0.7^(AM^0.678)` with the Kasten-Young (1989) air mass. The beam on the horizontal
  is capped at 92% of GHI so diffuse never goes negative; DHI = GHI − DNI·cos Z.
- Clouds: Kasten & Czeplak (1980), `G = Gclear (1 − 0.75 C^3.4)`. The diffuse fraction moves from the clear-sky split
  towards 1 as C².

## 3. Daylight on the floor (`daylight.js`)

Receptor points sit at plant height (0.4 m) above each cell centre and face up.

**Direct beam.** For each time step, a ray from the receptor towards the sun counts if it:

1. crosses the window's wall plane inside the opening (between pos and pos + width, and between sill and head),
2. clears the overhang: a ray leaving at height y with outward component sₙ reaches y + (depth/sₙ)·s_y at the
   overhang's outer edge, and is blocked if that is above the head,
3. is above the exterior obstruction angle,
4. misses every furniture box (slab-method segment/AABB test).

Then `E_beam = DNI · sin(el) · τ · IAM(θ)`, where `IAM = 1 − 0.1·(1/cos θ − 1)` (ASHRAE) and θ is the angle of incidence
on the glass.

**Sky diffuse.** For an isotropic sky with radiance L = DHI/π, the irradiance from one window is
`∫ L τ IAM(θw) cos θr cos θw / r² dA` over the opening. It is integrated numerically on a ~10 cm grid. Samples below
the receptor's plane, behind the overhang or through furniture contribute nothing, and samples below the obstruction
angle see a building at 20% of the sky's brightness. This factor depends only on geometry, so it is computed once
per cell and multiplied by DHI at each time step. Tests check that it stays below 0.5, the limit for a vertical
opening seen by a horizontal receptor, and falls off with distance.

**Interior reflections.** BRE split-flux formula: `DF_irc = τ W (C·Rfw + 5·Rcw) / (A (1 − R))`. Here W is the
window area, A the total surface area, R the area-weighted reflectance, Rfw and Rcw the reflectances below and above
the window's mid-height, and C a function of the obstruction angle (39 with no obstruction, taken from the BRE table).
It is applied uniformly to the floor, scaled by GHI.

**Integration.** Midpoint rule from sunrise to sunset in 15-20 minute steps. A full year (12 days) is computed per
cell; per-cell minimum, mean and maximum over months feed the optimiser.

## 4. Placement (`optimizer.js`)

The state is a set of (plant, cell) pairs with unique plants and cells. The score is:

- **Light fit.** In log-DLI: 1 at the geometric centre of the plant's range, 0.75 at its edges, then a Gaussian
  outside it (σ = 0.35 in ln units). Each placed plant pays `empty = 0.2`, so a badly lit plant is worse than none.
- **Winter factor.** If the darkest month is below the plant's minimum, up to 40% of the fit is lost, smoothly.
- **Overlap.** A pair closer than 0.8 × the mean of their mature spreads is penalised in proportion.
- **Window blocking.** Plants over 1 m within two cells of a window opening are penalised.
- **Humidity grouping.** Pairs of plants needing ≥ 50% RH within 1.5 m get a small bonus (shared transpiration).
- **Variety.** A small bonus per distinct growth form.

Search: simulated annealing from a greedy layout, with moves to relocate, swap, replace, add and remove a plant. The
temperature falls geometrically from 0.4 to 0.002 over 5,000 steps, and the best state seen is returned. The PRNG is
seeded (mulberry32), so a room always gets the same answer.

## 5. Grow lamps (`growlight.js`)

A downward Lambertian LED with photon flux PPF = W × 2.3 µmol/J gives `E(r) = PPF·h² / (π (h² + r²)²)` at horizontal
distance r. That integrates to exactly PPF over the plane, which is checked numerically in the tests. Each plant's
deficit is `1.1 × min DLI − darkest-month DLI`.

Lamps are chosen by greedy set cover on deficit removed per watt, then downsized to the smallest wattage that still
works. Each lamp runs only in the months one of its own plants is short, and energy and cost follow from that.

## 6. Watering (`care.js`)

Each pot is a bucket of available water: `volume × available-water fraction` of its mix (standard 0.25, gritty 0.12,
...). The catalogue `water` interval calibrates a reference daily use for a 15 cm plastic pot of the plant's usual
mix at DLI 5, 21 °C and 45% RH:

`ET_ref = AW_ref × dryFraction / interval`

Daily use then scales by:

- light, sub-linearly, and more weakly for CAM succulents,
- vapour pressure deficit (Tetens),
- pot area,
- pot material (terracotta ×1.35, fabric ×1.5),
- season (×0.75 outside the growing months, which are flipped for the southern hemisphere).

The plant is watered when its used share reaches `dryFraction`. With chore days set, it is watered on the last
allowed day before it would run dry, and only off-schedule if waiting would overshoot by 15%.

A test checks that the model reproduces the catalogue interval in reference conditions for six plants.

`.ics` export follows RFC 5545: CRLF line endings, TEXT escaping and line folding at 75 octets (never inside a
multi-byte character).

## 7. Diagnosis (`diagnose.js`)

Naive Bayes: `log P(cause) + Σ log P(symptom | cause) + Σ log LR(context)`. Unlisted symptoms use a 0.03 leak, and
symptoms the user rules out use a softened `1 − 0.6p`. The context comes from the simulation and the care model: light
at the plant's spot versus its range, room humidity versus its needs, temperature, and the user's watering interval
versus the model's. Likelihoods are set by hand from horticultural guidance; the output is a ranked shortlist with
the evidence for each item.

## 8. Share links (`share.js`)

The format is a versioned binary record (dimensions, location, preferences, windows with every detail, doors,
furniture, chore days) followed by a CRC-32 (IEEE), encoded as base64url. A typical room fits in about 60 characters.
The tests flip every bit of an encoded link and check that the CRC rejects each one.
