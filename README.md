# Room Plant Matchmaker

Describe a room (its size, compass orientation, windows, doors and furniture) and where it is on Earth. The app simulates
the room's daylight through the whole year, then picks plants and spots for them, sizes grow lamps where light falls
short, and builds a watering and feeding calendar. Everything is shown in a Minecraft-style 3D room with real sun shadows.

## Run

```bash
npm start        # serves http://localhost:8000 (no build step, three.js loads from a CDN)
npm test         # 114 tests: solar geometry, daylight, optimiser, care model, lamps, diagnosis, share links, pipeline
npm run bench    # timing and optimiser-quality benchmark
```

Node ≥ 20 for the tests. No dependencies.

## What it does

| Step | Module | Method |
|---|---|---|
| Sun position | `src/solar.js` | NOAA solar position algorithm, cross-checked against the Spencer (1971) series; Klein (1977) representative day per month |
| Sky | `src/solar.js` | Haurwitz clear-sky global, Meinel beam with Kasten-Young air mass, Kasten-Czeplak cloud correction |
| Daylight on the floor | `src/daylight.js` | Per cell: direct-beam ray casting through each window (overhangs, buildings opposite, furniture shadows, glass angle loss), sky light as a numerical configuration factor, BRE split-flux interior reflections. Output: DLI (mol/m²/day) per cell per month |
| Room model | `src/floorplan.js` | Walls, rotation, window sill/head/glazing/curtain, doors with walkway clearance, furniture footprints, validation |
| Plants | `src/plants.js` | 38 species with DLI range, water use, humidity, temperature, size, ASPCA toxicity |
| Placement | `src/optimizer.js` | Simulated annealing over (plant, spot) pairs: light fit in log-DLI, winter penalty, spread overlap, window blocking, humidity grouping, variety |
| Grow lamps | `src/growlight.js` | Lambertian LED model, greedy set cover of each plant's light deficit, downsizing, per-lamp months, kWh and cost |
| Care | `src/care.js` | Daily soil-water balance per pot, scaled by light, vapour pressure deficit, pot size and material and season; chore-day scheduling; RFC 5545 `.ics` export |
| Diagnosis | `src/diagnose.js` | Naive Bayes over 13 causes and 22 symptoms, with evidence from the simulation (light at the spot, humidity, watering rhythm) |
| Sharing | `src/share.js` | The whole room packed into ~60 characters: versioned binary record, CRC-32, base64url in the URL hash |
| Pipeline | `src/pipeline.js` | Pure function from app state to everything the UI shows |
| UI | `src/app.js`, `src/voxel.js` | Editors, results, 3D scene with the real sun, live "right now" light map |

The physics and the modelling choices are written up in [docs/light-model.md](docs/light-model.md).

## Results worth knowing

- **Summer is not always brighter indoors.** In a south-facing room at 33° N the high June sun lights only a strip by the
  window, while the low December sun reaches deep into the room. The floor-average DLI is higher in winter. The year chart
  in the app shows it.
- **Overcast can beat clear sky.** For a north window (no direct sun) a cloudy sky gives more diffuse light than a blue
  one. There is a test for it.
- **An overhang is a seasonal filter.** 0.8 m above a south window removes most summer sun and keeps most winter sun.
- **Annealing vs. greedy.** On the benchmark rooms, annealing improves the greedy layout's score by 1-3% on average in
  about 7 ms per run.

## Limits

- The light model is for comparing spots and seasons, not a lux meter: isotropic sky (no circumsolar brightening),
  uniform interior reflections, one horizon angle per window for exterior obstructions, and no trees or snow.
- The cloud setting is one number for the year, not a climate record.
- Plant light and water numbers are rules of thumb from extension-service guidance. The care schedule starts from
  them; the soil check comes first.
- The photo upload only uses average brightness as a rough multiplier; it cannot see geometry.
- Diagnosis likelihoods are set by hand, not learned from data.
