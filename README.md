# Grenoble — Alpes Drive

A procedural 3D playable replica of Grenoble and the surrounding Alpine landscape, built with Vite and Three.js.

**Live demo:** https://vignesh-pd.github.io/grenoble-alpes-drive/

## Features

- Walk, run, cycle, drive cars/vans/trucks, ride the téléphérique and ski lifts, hike the surrounding trails, and ski the snow-covered pistes.
- Five TAG tram lines with official line colours and GTFS-derived schedules: A blue, B green, C pink, D orange, E purple.
- Live `TAG · LIVE ARRIVALS` boards at tram stops, first-person tram cabins, onboard next-stop displays, and boarding/alighting only while stopped at a real platform.
- Always-visible minimap plus a full Grenoble map with player position and heading, terrain relief, tram network, lifts and trails.
- Sunny, rain and snow weather; distance-based reward points and explorer ranks.
- Grenoble city centre, the Isère, bridges, the Bastille, Chamrousse and the surrounding Chartreuse, Vercors and Belledonne mountains.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move / drive / steer |
| `Mouse` | Look |
| `Shift` | Sprint / boost |
| `Space` | Jump / brake |
| `E` | Enter or exit a vehicle, tram or lift |
| `M` | Full city map |
| `1` / `2` / `3` | Sunny / rain / snow |
| `R` | Skis (snow, slopes and pistes only) |
| `H` | Help |
| `Esc` | Release the mouse |

## Local development

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173/`.

## Production build

```bash
npm run build
npm run preview
```

The build is emitted to `dist/`.

## Deployment

The built game is published from the `gh-pages` branch to GitHub Pages. Run `npm run build`, then publish the contents of `dist/` to the `gh-pages` branch to update the live site.

## Data and attribution

Tram routes, stops, colours and timetables are derived from the official TAG / M’réso GTFS feed and are used here for a fan-made procedural tribute. This project is not affiliated with TAG, M’réso, Grenoble-Alpes Métropole or the city of Grenoble.
