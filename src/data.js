/* ──────────────────────────────────────────────────────────────
   GRENOBLE — world data
   A stylised but geography-led replica of the Grenoble basin.
   +X = east · −Z = north · 1 world unit = 1 metre.
   ────────────────────────────────────────────────────────────── */

export const WORLD = 9000;
export const HALF = WORLD / 2;
export const WATER_LEVEL = -2.9;
export const VALLEY_ALTITUDE = 212; // metres above sea level, for the HUD

export const CITY = { x1: -2340, x2: 2340, z1: -780, z2: 2080 };
export const CITY_GRID = { x0: -2340, x1: 2340, z0: -780, z1: 2080, step: 260 };

export const ROAD_X = [];
export const ROAD_Z = [];
for (let x = CITY_GRID.x0; x <= CITY_GRID.x1; x += CITY_GRID.step) ROAD_X.push(x);
for (let z = CITY_GRID.z0; z <= CITY_GRID.z1; z += CITY_GRID.step) ROAD_Z.push(z);

export const WIDE_ROADS_X = new Set([-780, 0, 260, 1040]);
export const WIDE_ROADS_Z = new Set([-520, 0, 260, 1040, 1820]);

export function roadWidthX(x) {
  return WIDE_ROADS_X.has(x) ? 30 : 23;
}
export function roadWidthZ(z) {
  return WIDE_ROADS_Z.has(z) ? 30 : 23;
}

/* ── The Isère: from the Grésivaudan in the north-east to the Vercors gate ── */
export const RIVER = [
  [4550, -2450],
  [3900, -2260],
  [3250, -2020],
  [2600, -1810],
  [2000, -1610],
  [1450, -1450],
  [900, -1310],
  [380, -1200],
  [-200, -1150],
  [-820, -1050],
  [-1500, -870],
  [-2200, -560],
  [-2900, -100],
  [-3500, 480],
  [-4100, 1000],
  [-4650, 1450],
];

/* ── Bridges over the Isère (x, z-start, z-end) ── */
export const BRIDGES = [
  { x: -780, z1: -1200, z2: -760, name: 'Pont de la Bastille' },
  { x: 0, z1: -1330, z2: -760, name: 'Pont Marius Gontard' },
  { x: 780, z1: -1430, z2: -760, name: 'Pont de la Porte de France' },
  { x: 1820, z1: -1700, z2: -1400, name: 'Pont de la Tronche' },
];

const smooth01 = (t) => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};

/** Track deck lift over / approaching a bridge, in metres. */
export function bridgeLift(x, z) {
  let lift = 0;
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) > 13) continue;
    const ramp = 70;
    if (z < b.z1 - ramp || z > b.z2 + ramp) continue;
    let value = 0;
    if (z <= b.z1) value = smooth01((z - (b.z1 - ramp)) / ramp);
    else if (z >= b.z2) value = smooth01((b.z2 + ramp - z) / ramp);
    else value = 1;
    lift = Math.max(lift, value);
  }
  return lift * 0.95;
}

/* ── Quarters & landmarks ── */
export const DISTRICTS = [
  { name: 'BASTILLE · CHARTREUSE', test: (x, z) => z < -1500 },
  { name: 'CHAMROUSSE · BELLEDONNE', test: (x, z) => x > 2650 && z > 1000 },
  { name: 'VERCORS · MONTAGNE', test: (x, z) => z > 2180 },
  { name: 'MONT RACHAIS', test: (x, z) => z < -1000 && x > 700 },
  { name: 'PRESQU’ÎLE · ISÈRE', test: (x, z) => z < -650 },
  { name: 'NOTRE-DAME', test: (x, z) => z < -180 && x > -600 && x < 600 },
  { name: 'GARE · EUROPOLE', test: (x, z) => x < -650 && z > 700 },
  { name: 'CHAVANT · PAUL MISTRAL', test: (x, z) => x > 500 && z > 500 && z < 1500 },
  { name: 'GRENETTE · VIEUX CENTRE', test: (x, z) => z >= -180 && z < 600 && x > -650 && x < 650 },
  { name: 'VILLAGE OLYMPIQUE', test: (x, z) => z > 1500 && x > 1300 },
  { name: 'STADE DES ALPES', test: (x, z) => x > 1700 && z > 1200 },
  { name: 'UNIVERSITÉ · DOMAINE', test: (x, z) => x > 1300 && z > 900 },
  { name: 'EUROPOLE', test: (x, z) => x < -600 },
  { name: 'ÎLE VERTE', test: (x, z) => z < 300 },
];

export const LANDMARKS = [
  { id: 'grenette', name: 'Place Grenette', x: 130, z: 130, kind: 'plaza' },
  { id: 'jardin', name: 'Jardin de Ville', x: 390, z: -130, kind: 'park' },
  { id: 'cathedrale', name: 'Cathédrale Notre-Dame', x: 130, z: -390, kind: 'church' },
  { id: 'gare', name: 'Gare de Grenoble', x: -1040, z: 1170, kind: 'station' },
  { id: 'perret', name: 'Tour Perret', x: 910, z: 920, kind: 'tower' },
  { id: 'musee', name: 'Musée de Grenoble', x: 650, z: 650, kind: 'museum' },
  { id: 'stade', name: 'Stade des Alpes', x: 1950, z: 1430, kind: 'stadium' },
  { id: 'bastille', name: 'Fort de la Bastille', x: -760, z: -2000, kind: 'fort' },
  { id: 'telepherique', name: 'Téléphérique · Bastille', x: -430, z: -960, kind: 'lift' },
  { id: 'gondola', name: 'Télécabine de Chamrousse', x: 2420, z: 1760, kind: 'lift' },
  { id: 'chamrousse', name: 'Chamrousse · Belledonne', x: 3340, z: 2530, kind: 'ski' },
  { id: 'rachais', name: 'Mont Rachais', x: 1550, z: -3100, kind: 'peak' },
  { id: 'vercors', name: 'Belvédère du Vercors', x: -1250, z: 3400, kind: 'peak' },
  { id: 'universite', name: 'Université Grenoble-Alpes', x: 1690, z: 1430, kind: 'campus' },
];

export const SPECIAL_BLOCKS = [
  { x1: 0, z1: 0, x2: 260, z2: 260, type: 'plaza', name: 'Place Grenette' },
  { x1: 260, z1: -260, x2: 520, z2: 0, type: 'park', name: 'Jardin de Ville' },
  { x1: 0, z1: -520, x2: 260, z2: -260, type: 'cathedral', name: 'Notre-Dame' },
  { x1: -520, z1: 260, x2: -260, z2: 520, type: 'market', name: 'Marché de l’Estacade' },
  { x1: 520, z1: 0, x2: 780, z2: 260, type: 'plaza', name: 'Place Victor Hugo' },
  { x1: 520, z1: 520, x2: 780, z2: 780, type: 'museum', name: 'Musée de Grenoble' },
  { x1: 780, z1: 780, x2: 1040, z2: 1040, type: 'park', name: 'Parc Paul Mistral' },
  { x1: -1300, z1: 1040, x2: -780, z2: 1300, type: 'station', name: 'Gare de Grenoble' },
  { x1: -1300, z1: 1300, x2: -1040, z2: 1560, type: 'park', name: 'Jardin des Plantes' },
  { x1: 1560, z1: 1300, x2: 1820, z2: 1560, type: 'campus', name: 'Université' },
  { x1: 1820, z1: 1300, x2: 2080, z2: 1560, type: 'stadium', name: 'Stade des Alpes' },
  { x1: 1040, z1: 1820, x2: 1300, z2: 2080, type: 'park', name: 'Parc de la Villeneuve' },
];

export function specialAt(x, z) {
  for (const b of SPECIAL_BLOCKS) {
    if (x >= b.x1 && x < b.x2 && z >= b.z1 && z < b.z2) return b;
  }
  return null;
}

/* TAG tram network - five lines, official TAG/M'reso network */
export const TRAM_LINES = [
  {
    id: 'A',
    name: 'Ligne A',
    color: '#3376B8',
    termini: ["Fontaine La Poya","Le Pont-de-Claix L'Étoile"],
    offset: [0, 0],
    schedule: {
      source: 'TAG · M’réso GTFS',
      profile: 'Weekday afternoon peak',
      headway: 4.9,
      tramsPerDirection: 3,
      speed: 16,
      dwell: 10,
      terminusWait: 20,
    },
    route: [
      [-2740, 360],
      [-2520, 400],
      [-2280, 440],
      [-2020, 480],
      [-1720, 560],
      [-1380, 640],
      [-1020, 700],
      [-800, 800],
      [-520, 540],
      [-520, 260],
      [0, 280],
      [520, 280],
      [780, 280],
      [1040, 300],
      [1040, 560],
      [1040, 800],
      [1040, 1040],
      [1040, 1280],
      [1040, 1520],
      [1040, 1760],
      [1340, 1900],
      [1520, 1940],
      [1760, 1980],
      [1920, 2020],
      [2040, 2060],
      [2140, 2080],
      [2240, 2060],
      [2320, 2020],
      [2380, 1960],
      [2420, 1900],
      [2460, 1840],
      [2500, 1780],
    ],
    stops: [
      { x: -2740, z: 360, name: "La Poya" },
      { x: -2520, z: 400, name: "Charles Michels" },
      { x: -2280, z: 440, name: "Fontaine Hôtel de Ville" },
      { x: -2020, z: 480, name: "Louis Maisonnat" },
      { x: -1720, z: 560, name: "Les Fontainades" },
      { x: -1380, z: 640, name: "Berriat" },
      { x: -1020, z: 700, name: "Saint-Bruno" },
      { x: -800, z: 800, name: "Gares" },
      { x: -520, z: 540, name: "Alsace-Lorraine" },
      { x: 0, z: 280, name: "Victor Hugo" },
      { x: 520, z: 280, name: "Hubert Dubedout" },
      { x: 780, z: 280, name: "Verdun" },
      { x: 1040, z: 300, name: "Chavant" },
      { x: 1040, z: 560, name: "Albert 1er" },
      { x: 1040, z: 800, name: "Mounier" },
      { x: 1040, z: 1040, name: "MC2" },
      { x: 1040, z: 1280, name: "Malherbe" },
      { x: 1040, z: 1520, name: "La Bruyère" },
      { x: 1040, z: 1760, name: "Arlequin" },
      { x: 1340, z: 1900, name: "Grand'Place" },
      { x: 1520, z: 1940, name: "Polesud" },
      { x: 1760, z: 1980, name: "Les Granges" },
      { x: 1920, z: 2020, name: "Surieux" },
      { x: 2040, z: 2060, name: "Essarts" },
      { x: 2140, z: 2080, name: "Échirolles Gare" },
      { x: 2240, z: 2060, name: "La Rampe" },
      { x: 2320, z: 2020, name: "Marie Curie" },
      { x: 2380, z: 1960, name: "Auguste Delaune" },
      { x: 2420, z: 1900, name: "Denis Papin" },
      { x: 2460, z: 1840, name: "Edmée Chandon" },
      { x: 2500, z: 1780, name: "L'Étoile" },
    ],
  },
  {
    id: 'B',
    name: 'Ligne B',
    color: '#479A45',
    termini: ["Grenoble Oxford","Gières Plaine des Sports"],
    offset: [7, 7],
    schedule: {
      source: 'TAG · M’réso GTFS',
      profile: 'Weekday afternoon peak',
      headway: 4.8,
      tramsPerDirection: 3,
      speed: 18,
      dwell: 8,
      terminusWait: 20,
    },
    route: [
      [-1180, -760],
      [-1080, -700],
      [-960, -620],
      [-840, -540],
      [-1020, 700],
      [-800, 800],
      [-520, 540],
      [-520, 260],
      [0, 280],
      [520, 280],
      [780, 280],
      [780, 0],
      [520, 0],
      [520, -140],
      [520, -280],
      [260, -280],
      [260, -720],
      [0, -690],
      [0, -760],
      [0, -1330],
      [300, -1370],
      [620, -1440],
      [920, -1490],
      [1240, -1575],
      [1580, -1650],
      [1820, -1700],
      [1820, -1400],
      [1820, -900],
      [1950, -500],
      [2050, -100],
      [2150, 300],
      [2250, 600],
      [2320, 900],
      [2400, 1160],
    ],
    stops: [
      { x: -1180, z: -760, name: "Oxford" },
      { x: -1080, z: -700, name: "CEA" },
      { x: -960, z: -620, name: "Cité Internationale" },
      { x: -840, z: -540, name: "Palais de Justice" },
      { x: -1020, z: 700, name: "Saint-Bruno" },
      { x: -800, z: 800, name: "Gares" },
      { x: -520, z: 540, name: "Alsace-Lorraine" },
      { x: 0, z: 280, name: "Victor Hugo" },
      { x: 520, z: 280, name: "Hubert Dubedout" },
      { x: 780, z: 280, name: "Sainte-Claire" },
      { x: 520, z: -140, name: "Notre-Dame" },
      { x: 260, z: -720, name: "Île Verte" },
      { x: 920, z: -1490, name: "Hôpital Couple Enfant" },
      { x: 1240, z: -1575, name: "Hôpital Michallon" },
      { x: 1580, z: -1650, name: "Grand Sablon" },
      { x: 1820, z: -900, name: "Les Taillées" },
      { x: 1950, z: -500, name: "Gabriel Fauré" },
      { x: 2050, z: -100, name: "Bibliothèques" },
      { x: 2150, z: 300, name: "Condillac" },
      { x: 2250, z: 600, name: "Mayencin" },
      { x: 2320, z: 900, name: "Gières Gare" },
      { x: 2400, z: 1160, name: "Plaine des Sports" },
    ],
  },
  {
    id: 'C',
    name: 'Ligne C',
    color: '#C20078',
    termini: ["Seyssins Le Prisme","Condillac Universités"],
    offset: [-7, 7],
    schedule: {
      source: 'TAG · M’réso GTFS',
      profile: 'Weekday afternoon peak',
      headway: 5.3,
      tramsPerDirection: 2,
      speed: 19,
      dwell: 10,
      terminusWait: 20,
    },
    route: [
      [-2380, 1860],
      [-2180, 1860],
      [-1960, 1840],
      [-1720, 1800],
      [-1460, 1760],
      [-1200, 1680],
      [-980, 1580],
      [-760, 1440],
      [-520, 1320],
      [-260, 1180],
      [1040, 300],
      [1040, 780],
      [780, 780],
      [520, 780],
      [520, 520],
      [800, 520],
      [1060, 420],
      [1560, -240],
      [1820, -900],
      [1950, -500],
      [2050, -100],
      [2150, 300],
    ],
    stops: [
      { x: -2380, z: 1860, name: "Le Prisme" },
      { x: -2180, z: 1860, name: "Mas des Îles" },
      { x: -1960, z: 1840, name: "Grand Pré" },
      { x: -1720, z: 1800, name: "Fauconnière" },
      { x: -1460, z: 1760, name: "Seyssinet Hôtel de Ville" },
      { x: -1200, z: 1680, name: "Vallier Catane" },
      { x: -980, z: 1580, name: "Vallier Calmette" },
      { x: -760, z: 1440, name: "Vallier Libération" },
      { x: -520, z: 1320, name: "Foch-Ferrié" },
      { x: -260, z: 1180, name: "Gustave Rivet" },
      { x: 1040, z: 300, name: "Chavant" },
      { x: 520, z: 780, name: "Hôtel de Ville" },
      { x: 800, z: 520, name: "Flandrin" },
      { x: 1060, z: 420, name: "Péri" },
      { x: 1560, z: -240, name: "Neyrpic" },
      { x: 1820, z: -900, name: "Les Taillées" },
      { x: 1950, z: -500, name: "Gabriel Fauré" },
      { x: 2050, z: -100, name: "Bibliothèques" },
      { x: 2150, z: 300, name: "Condillac" },
    ],
  },
  {
    id: 'D',
    name: 'Ligne D',
    color: '#DE9917',
    termini: ["Grenoble Gares","Saint-Martin-d'Hères Étienne Grappe"],
    offset: [-7, -7],
    schedule: {
      source: 'TAG · M’réso GTFS',
      profile: 'Weekday afternoon peak',
      headway: 14.3,
      tramsPerDirection: 1,
      speed: 18,
      dwell: 10,
      terminusWait: 300,
    },
    route: [
      [-800, 800],
      [-520, 540],
      [-520, 260],
      [0, 280],
      [520, 280],
      [780, 280],
      [780, 0],
      [520, 0],
      [520, -140],
      [520, -280],
      [260, -280],
      [260, -720],
      [0, -690],
      [0, -760],
      [0, -1330],
      [300, -1370],
      [620, -1440],
      [920, -1490],
      [1240, -1575],
      [1580, -1650],
      [1820, -1700],
      [1820, -1400],
      [1820, -900],
      [1560, -240],
      [1660, 180],
      [1760, 580],
      [1880, 940],
      [2000, 1260],
    ],
    stops: [
      { x: -800, z: 800, name: "Gares" },
      { x: -520, z: 540, name: "Alsace-Lorraine" },
      { x: 0, z: 280, name: "Victor Hugo" },
      { x: 520, z: 280, name: "Hubert Dubedout" },
      { x: 780, z: 280, name: "Sainte-Claire" },
      { x: 520, z: -140, name: "Notre-Dame" },
      { x: 260, z: -720, name: "Île Verte" },
      { x: 920, z: -1490, name: "Hôpital Couple Enfant" },
      { x: 1240, z: -1575, name: "Hôpital Michallon" },
      { x: 1580, z: -1650, name: "Grand Sablon" },
      { x: 1820, z: -900, name: "Les Taillées" },
      { x: 1560, z: -240, name: "Neyrpic" },
      { x: 1660, z: 180, name: "Maison Communale" },
      { x: 1760, z: 580, name: "Édouard Vaillant" },
      { x: 1880, z: 940, name: "Parc Jo Blanchon" },
      { x: 2000, z: 1260, name: "Étienne Grappe" },
    ],
  },
  {
    id: 'E',
    name: 'Ligne E',
    color: '#533786',
    termini: ["Fontanil-Cornillon Palluel","Grenoble Louise Michel"],
    offset: [7, -7],
    schedule: {
      source: 'TAG · M’réso GTFS',
      profile: 'Weekday afternoon peak',
      headway: 8,
      tramsPerDirection: 1,
      speed: 14,
      dwell: 10,
      terminusWait: 30,
    },
    route: [
      [-2700, -372],
      [-2500, -503],
      [-2300, -634],
      [-2100, -744],
      [-1900, -833],
      [-1700, -922],
      [-1480, -1015],
      [-1260, -1080],
      [-1040, -1160],
      [-900, -1180],
      [-800, -1200],
      [-780, -1200],
      [-780, -1160],
      [-780, -1080],
      [-780, -1000],
      [-780, -920],
      [-780, -840],
      [-780, -760],
      [-780, -700],
      [-780, -620],
      [-700, -340],
      [-520, 540],
      [-520, 820],
      [-760, 1440],
      [-820, 1600],
      [-980, 1740],
    ],
    stops: [
      { x: -2700, z: -372, name: "Palluel" },
      { x: -2500, z: -503, name: "Rafour" },
      { x: -2300, z: -634, name: "Karben" },
      { x: -2100, z: -744, name: "La Pinéa" },
      { x: -1900, z: -833, name: "Pont de Vence" },
      { x: -1700, z: -922, name: "Muret" },
      { x: -1480, z: -1015, name: "Fiancey" },
      { x: -1260, z: -1080, name: "Néron" },
      { x: -1040, z: -1160, name: "L'Horloge" },
      { x: -900, z: -1180, name: "Saint-Martin Hôtel de Ville" },
      { x: -780, z: -620, name: "Casamaures" },
      { x: -700, z: -340, name: "Esplanade" },
      { x: -520, z: 540, name: "Alsace-Lorraine" },
      { x: -520, z: 820, name: "Estacade" },
      { x: -760, z: 1440, name: "Vallier Libération" },
      { x: -820, z: 1600, name: "Alliés" },
      { x: -980, z: 1740, name: "Louise Michel" },
    ],
  },
];

/* ── Mountain trails ── */
export const TRAILS = [
  {
    id: 'chalemont',
    name: 'Montée de Chalemont',
    en: 'Bastille via Chalemont',
    color: '#ffb257',
    difficulty: 'MODERATE',
    duration: '55 MIN',
    points: [
      [-430, -1390],
      [-300, -1500],
      [-520, -1580],
      [-280, -1680],
      [-560, -1760],
      [-360, -1840],
      [-660, -1900],
      [-760, -1990],
    ],
    description:
      'Historic switchbacks above the Isère. Stone stairs, old bastion walls and a panoramic terrace at the fort.',
  },
  {
    id: 'rachais',
    name: 'Sentier du Mont Rachais',
    en: 'Chartreuse balcony',
    color: '#84e9ed',
    difficulty: 'HARD',
    duration: '2 H 05',
    points: [
      [1420, -1520],
      [1520, -1740],
      [1320, -1930],
      [1560, -2160],
      [1340, -2380],
      [1510, -2620],
      [1410, -2840],
      [1550, -3040],
      [1550, -3120],
    ],
    description:
      'A long balcony traverse in the Chartreuse, high above the city roofs. Exposed in places, huge views.',
  },
  {
    id: 'vercors',
    name: 'Balcon du Vercors',
    en: 'Vercors belvedere',
    color: '#a6f06c',
    difficulty: 'MODERATE',
    duration: '1 H 30',
    points: [
      [-430, 2250],
      [-650, 2410],
      [-900, 2600],
      [-740, 2760],
      [-990, 2920],
      [-1210, 3110],
      [-1050, 3260],
      [-1250, 3400],
    ],
    description:
      'Limestone ledges, mountain pines and the great Vercors wall. The sunset view back over Grenoble is the reward.',
  },
  {
    id: 'belledonne',
    name: 'Montée de Chamrousse',
    en: 'Belledonne ski-tour',
    color: '#ff8a65',
    difficulty: 'HARD',
    duration: '2 H 40',
    points: [
      [2430, 1800],
      [2520, 1930],
      [2680, 2020],
      [2790, 2160],
      [2930, 2240],
      [3050, 2370],
      [3190, 2430],
      [3340, 2530],
    ],
    description:
      'The classic Chamrousse climb. In summer, wildflowers and marmots; after snowfall, a lift-served powder playground.',
  },
];

export const PISTES = [
  {
    id: 'croix',
    name: 'Piste de la Croix',
    level: 'RED',
    color: '#e6423a',
    points: [
      [3380, 2540],
      [3200, 2380],
      [3050, 2280],
      [2920, 2140],
      [2780, 2010],
      [2640, 1900],
    ],
  },
  {
    id: 'cretes',
    name: 'Piste des Crêtes',
    level: 'BLUE',
    color: '#2f7fdf',
    points: [
      [3440, 2650],
      [3300, 2500],
      [3140, 2410],
      [3000, 2310],
      [2860, 2180],
      [2720, 2050],
    ],
  },
  {
    id: 'lac',
    name: 'Piste du Lac',
    level: 'BLACK',
    color: '#1c1c22',
    points: [
      [3320, 2700],
      [3180, 2600],
      [3040, 2500],
      [2900, 2380],
      [2760, 2260],
      [2620, 2130],
    ],
  },
];

/* ── districts for the minimap backdrop ── */
export const PARKS = [
  { x: 390, z: -130, w: 210, d: 210, name: 'Jardin de Ville' },
  { x: 910, z: 910, w: 190, d: 190, name: 'Paul Mistral' },
  { x: 650, z: 650, w: 180, d: 180, name: 'Musée' },
  { x: -1170, z: 1430, w: 210, d: 190, name: 'Jardin des Plantes' },
  { x: 1170, z: 1950, w: 200, d: 200, name: 'Villeneuve' },
];

/* ── Tram line for camera / narrative ── */
export const SPAWN = { x: 130, z: 172, heading: Math.PI };

export const VEHICLE_SPAWNS = [
  // Starter car: parked on the open side of Place Grenette, in view of the spawn.
  { type: 'car', x: 133, z: 157, heading: Math.PI / 2 },
  { type: 'bike', x: -40, z: -8, heading: Math.PI / 2 },
  { type: 'scooter', x: 220, z: -10, heading: Math.PI / 2 },
  { type: 'motorcycle', x: -90, z: -8, heading: Math.PI / 2 },
  { type: 'car', x: -150, z: -8, heading: Math.PI / 2 },
  { type: 'taxi', x: -410, z: 514, heading: Math.PI / 2 },
  { type: 'truck', x: -220, z: -8, heading: Math.PI / 2 },
  { type: 'bike', x: 330, z: 1052, heading: -Math.PI / 2 },
  { type: 'car', x: 520, z: 1032, heading: -Math.PI / 2 },
  { type: 'van', x: 526, z: 700, heading: 0 },
  { type: 'bus', x: -680, z: 774, heading: Math.PI / 2 },
  { type: 'scooter', x: 1310, z: 774, heading: Math.PI / 2 },
  { type: 'car', x: -258, z: 520, heading: Math.PI },
  { type: 'taxi', x: -774, z: 1160, heading: 0 },
  { type: 'truck', x: 1028, z: 780, heading: -Math.PI / 2 },
  { type: 'motorcycle', x: 1560, z: 514, heading: Math.PI / 2 },
  { type: 'car', x: 1814, z: 1040, heading: Math.PI },
  { type: 'bus', x: 774, z: 1560, heading: 0 },
  { type: 'van', x: -260, z: 774, heading: Math.PI / 2 },
  { type: 'bike', x: 1300, z: 1566, heading: Math.PI / 2 },
  { type: 'scooter', x: -1560, z: 1300, heading: Math.PI / 2 },
  { type: 'taxi', x: 0, z: 1560, heading: Math.PI / 2 },
  { type: 'car', x: 1560, z: 1300, heading: 0 },
  { type: 'truck', x: -2080, z: 520, heading: Math.PI / 2 },
  { type: 'bus', x: 1560, z: 1820, heading: Math.PI / 2 },
  { type: 'van', x: 1040, z: 520, heading: 0 },
  { type: 'scooter', x: 2400, z: 1750, heading: Math.PI },
];

export const AERIAL_LIFTS = [
  {
    id: 'bastille',
    name: 'Téléphérique Grenoble — Bastille',
    short: 'TÉLÉPHÉRIQUE',
    type: 'spheres',
    color: '#f4f1e8',
    lower: { x: -430, z: -985 },
    upper: { x: -760, z: -2010 },
    cabins: 3,
    duration: 42,
    price: 'Billet 7,10 €',
    blurb: 'The famous glass “bulles” rising 260 m over the Isère since 1934.',
  },
  {
    id: 'chamrousse',
    name: 'Télécabine de Chamrousse',
    short: 'TÉLÉCABINE',
    type: 'gondola',
    color: '#dfe9ec',
    lower: { x: 2420, z: 1760 },
    upper: { x: 3340, z: 2530 },
    cabins: 8,
    duration: 58,
    price: 'Forfait 32,50 €',
    blurb: 'Climb from the valley floor to the Belledonne snowfront at Chamrousse.',
  },
];

export const MISSIONS = [
  { id: 'wheels', label: 'Take the wheel of any vehicle', tag: 'DRIVE' },
  { id: 'tram', label: 'Ride a Grenoble tram', tag: 'TAG' },
  { id: 'bulles', label: 'Ride the téléphérique to the Bastille', tag: 'AIR' },
  { id: 'hike', label: 'Hike 150 m on a marked trail', tag: 'HIKE' },
  { id: 'snow', label: 'Ski the powder above Chamrousse', tag: 'SKI' },
  { id: 'summit', label: 'Reach Fort de la Bastille', tag: 'PEAK' },
];

/* Every metre travelled earns a reward point; these milestones pay a bonus. */
export const DISTANCE_REWARDS = [
  { at: 100, bonus: 50 },
  { at: 250, bonus: 75 },
  { at: 500, bonus: 150 },
  { at: 1000, bonus: 300 },
  { at: 2500, bonus: 750 },
  { at: 5000, bonus: 1500 },
  { at: 10000, bonus: 3000 },
  { at: 25000, bonus: 7500 },
  { at: 50000, bonus: 15000 },
];

export const EXPLORER_RANKS = [
  { at: 0, name: 'VISITEUR' },
  { at: 250, name: 'FLÂNEUR' },
  { at: 1000, name: 'EXPLORATEUR' },
  { at: 3000, name: 'GRENOBLOIS' },
  { at: 7500, name: 'ALPINISTE' },
  { at: 15000, name: 'LÉGENDE DES ALPES' },
  { at: 30000, name: 'AMBASSADEUR DU VERCORS' },
];
