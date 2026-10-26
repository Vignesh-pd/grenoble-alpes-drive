import * as THREE from 'three';
import { heightAt, groundHeightAt, isUnderwater, terrainNormalAt } from './terrain.js';
import { VEHICLE_SPAWNS } from './data.js';
import { clamp, damp, dampAngle, lerp, canvasTexture, makeTextPlane } from './utils.js';

export const VEHICLE_SPECS = {
  bike: {
    name: 'Vélo de ville',
    label: 'CITY BIKE',
    maxSpeed: 7.4,
    maxReverse: 2.5,
    accel: 4.8,
    brake: 9,
    drag: 0.8,
    radius: 0.62,
    turn: 1.5,
    width: 0.7,
    length: 1.8,
    lift: 0.02,
    wheelRadius: 0.38,
    twoWheels: true,
  },
  scooter: {
    name: 'Trottinette électrique',
    label: 'E-SCOOTER',
    maxSpeed: 9.4,
    maxReverse: 1.8,
    accel: 6.2,
    brake: 10,
    drag: 0.72,
    radius: 0.52,
    turn: 1.75,
    width: 0.55,
    length: 1.32,
    lift: 0.02,
    wheelRadius: 0.23,
    twoWheels: true,
  },
  motorcycle: {
    name: 'Café racer',
    label: 'MOTORCYCLE',
    maxSpeed: 30,
    maxReverse: 4,
    accel: 13,
    brake: 18,
    drag: 0.55,
    radius: 0.8,
    turn: 1.45,
    width: 0.8,
    length: 2.1,
    lift: 0.02,
    wheelRadius: 0.37,
    twoWheels: true,
  },
  car: {
    name: 'C3 Alpine',
    label: 'CITY CAR',
    maxSpeed: 25,
    maxReverse: 7,
    accel: 9.2,
    brake: 15,
    drag: 0.45,
    radius: 1.45,
    turn: 1.05,
    width: 1.86,
    length: 4.1,
    lift: 0.02,
    wheelRadius: 0.36,
  },
  taxi: {
    name: 'Taxi grenoblois',
    label: 'TAXI',
    maxSpeed: 26,
    maxReverse: 7,
    accel: 9.8,
    brake: 16,
    drag: 0.45,
    radius: 1.45,
    turn: 1.08,
    width: 1.86,
    length: 4.1,
    lift: 0.02,
    wheelRadius: 0.36,
  },
  van: {
    name: 'Trafic Express',
    label: 'CARGO VAN',
    maxSpeed: 21,
    maxReverse: 6,
    accel: 7.1,
    brake: 12,
    drag: 0.5,
    radius: 1.85,
    turn: 0.9,
    width: 2.0,
    length: 5.2,
    lift: 0.02,
    wheelRadius: 0.38,
  },
  bus: {
    name: 'TAG City Bus',
    label: 'CITY BUS',
    maxSpeed: 16,
    maxReverse: 4.5,
    accel: 4.6,
    brake: 9,
    drag: 0.55,
    radius: 3.45,
    turn: 0.62,
    width: 2.55,
    length: 11.2,
    lift: 0.02,
    wheelRadius: 0.46,
    heavy: true,
  },
  truck: {
    name: 'Master Livraison',
    label: 'DELIVERY TRUCK',
    maxSpeed: 17,
    maxReverse: 5,
    accel: 5.6,
    brake: 10,
    drag: 0.5,
    radius: 2.3,
    turn: 0.78,
    width: 2.4,
    length: 7.2,
    lift: 0.02,
    wheelRadius: 0.5,
    heavy: true,
  },
};

/* ──────────────────────────────────────────────────────────────
   Builders
   ────────────────────────────────────────────────────────────── */
function makeWheel(radius, width, mat, hubMat) {
  const holder = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), mat);
  wheel.rotation.z = Math.PI / 2;
  wheel.castShadow = true;
  holder.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width + 0.02, 10), hubMat);
  hub.rotation.z = Math.PI / 2;
  holder.add(hub);
  return holder;
}

function createRider(color = '#27506b', helmet = '#d9d2c4') {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#c99a78', roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const trouser = new THREE.MeshStandardMaterial({ color: '#2c3238', roughness: 0.85 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.4 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.26), jacket);
  torso.position.y = 1.18;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), skin);
  head.position.y = 1.65;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
  hat.position.y = 1.67;
  g.add(hat);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.11), jacket);
    arm.position.set(s * 0.26, 1.25, 0.06);
    arm.rotation.x = -0.55;
    arm.rotation.z = s * 0.15;
    g.add(arm);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), trouser);
    leg.position.set(s * 0.15, 0.65, 0.02);
    leg.rotation.x = 0.3;
    g.add(leg);
  }
  return g;
}

function makeCar({ paintColor = '#427a9b', darkColor = '#2e586f', taxi = false } = {}) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.32, metalness: 0.35 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: darkColor, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1e3037', roughness: 0.08, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141718', roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#b8bcbb', roughness: 0.25, metalness: 0.9 });
  const red = new THREE.MeshBasicMaterial({ color: '#b12424' });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.56, 4.05), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 4.0), darkPaint);
  lower.position.y = 0.33;
  g.add(lower);
  // bonnet + boot
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.2, 1.25), paint);
  bonnet.position.set(0, 0.96, 1.35);
  bonnet.castShadow = true;
  g.add(bonnet);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.24, 0.85), paint);
  boot.position.set(0, 0.98, -1.6);
  g.add(boot);
  // cabin glasshouse
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.63, 2.0), glass);
  cabin.position.set(0, 1.29, -0.16);
  cabin.castShadow = true;
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.14, 1.75), paint);
  roof.position.set(0, 1.65, -0.22);
  roof.castShadow = true;
  g.add(roof);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.08), paint);
    pillar.position.set(s * 0.82, 1.28, 0.5);
    g.add(pillar);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), darkPaint);
    mirror.position.set(s * 0.95, 1.28, 0.72);
    g.add(mirror);
  }
  // grille, bumpers, lights
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 0.18), darkPaint);
  bumperF.position.set(0, 0.48, 2.04);
  g.add(bumperF);
  const bumperR = bumperF.clone();
  bumperR.position.z = -2.04;
  g.add(bumperR);
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), light);
    hl.position.set(s * 0.6, 0.8, 2.04);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.06), red);
    tl.position.set(s * 0.65, 0.82, -2.04);
    g.add(tl);
  }
  const plate = makeTextPlane('GR · 38', { width: 512, height: 128, fontSize: 52, accent: '#2d5d8a', bg: 'rgba(240,238,228,0.95)', color: '#1b2326' });
  plate.scale.set(0.55, 0.16, 1);
  plate.position.set(0, 0.5, 2.14);
  g.add(plate);

  if (taxi) {
    const signBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.24), darkPaint);
    signBase.position.set(0, 1.77, -0.22);
    g.add(signBase);
    const taxiSign = makeTextPlane('TAXI', {
      width: 256,
      height: 112,
      fontSize: 62,
      accent: '#d3a23f',
      bg: 'rgba(248,241,220,0.98)',
      color: '#20272b',
    });
    taxiSign.scale.set(0.62, 0.62, 1);
    taxiSign.position.set(0, 1.93, -0.22);
    g.add(taxiSign);
    const checker = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.1, 0.055),
      new THREE.MeshBasicMaterial({ color: '#1f2427' })
    );
    checker.position.set(0, 1.08, 0.94);
    g.add(checker);
  }

  const wheels = [];
  for (const z of [-1.3, 1.3]) {
    for (const x of [-0.85, 0.85]) {
      const w = makeWheel(0.36, 0.24, rubber, chrome);
      w.position.set(x, 0.38, z);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels };
}

function makeTruck() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#e7e4d8', roughness: 0.55, metalness: 0.05 });
  const red = new THREE.MeshStandardMaterial({ color: '#a33a2b', roughness: 0.45, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: '#6c7373', roughness: 0.4, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d3038', roughness: 0.1, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141617', roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#b6b9b8', roughness: 0.3, metalness: 0.9 });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });

  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.35, 2.75, 4.7), white);
  cargo.position.set(0, 2.05, -1.2);
  cargo.castShadow = true;
  g.add(cargo);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.25, 4.72), red);
  stripe.position.set(0, 1.35, -1.2);
  g.add(stripe);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.25, 2.1, 2.15), white);
  cab.position.set(0, 1.72, 2.6);
  cab.castShadow = true;
  g.add(cab);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 0.1), glass);
  windshield.position.set(0, 2.18, 3.68);
  windshield.rotation.x = -0.09;
  g.add(windshield);
  const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 1.1), glass);
  sideGlass.position.set(1.13, 2.15, 2.7);
  g.add(sideGlass);
  const sideGlass2 = sideGlass.clone();
  sideGlass2.position.x = -1.13;
  g.add(sideGlass2);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.3, 0.22), metal);
  bumper.position.set(0, 0.62, 3.72);
  g.add(bumper);
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.06), light);
    hl.position.set(s * 0.75, 0.85, 3.74);
    g.add(hl);
  }

  const brand = makeTextPlane('GRENOBLE', { width: 1024, height: 200, fontSize: 100, bg: 'rgba(240,237,228,1)', color: '#21495c', accent: '#a33a2b' });
  for (const s of [-1, 1]) {
    const panel = brand.clone();
    panel.scale.set(3.6, 0.7, 1);
    panel.position.set(s * 1.19, 2.05, -1.2);
    panel.rotation.y = s * Math.PI / 2;
    g.add(panel);
  }

  const wheels = [];
  for (const z of [-2.7, -1.5, 2.55]) {
    for (const x of [-0.98, 0.98]) {
      const w = makeWheel(0.5, 0.3, rubber, chrome);
      w.position.set(x, 0.52, z);
      g.add(w);
      wheels.push(w);
    }
  }
  // rear doors
  const doorLine = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.65, 0.05), new THREE.MeshStandardMaterial({ color: '#d9d6ca', roughness: 0.6 }));
  doorLine.position.set(0, 2.05, -3.58);
  g.add(doorLine);
  return { group: g, wheels };
}

function makeVan() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#e9e6da', roughness: 0.52, metalness: 0.08 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f5f80', roughness: 0.45, metalness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1e3038', roughness: 0.1, metalness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: '#707676', roughness: 0.4, metalness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141718', roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#b8bcbb', roughness: 0.28, metalness: 0.9 });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });
  const red = new THREE.MeshBasicMaterial({ color: '#b12424' });

  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.82, 3.55), white);
  cargo.position.set(0, 1.3, -0.7);
  cargo.castShadow = true;
  g.add(cargo);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.94, 1.35, 1.55), white);
  cab.position.set(0, 1.28, 1.58);
  cab.castShadow = true;
  g.add(cab);
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.48, 0.8), white);
  bonnet.position.set(0, 0.86, 2.16);
  g.add(bonnet);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 4.65), white);
  roof.position.set(0, 2.24, 0.03);
  roof.castShadow = true;
  g.add(roof);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.03, 0.2, 3.9), blue);
  stripe.position.set(0, 1.02, -0.55);
  g.add(stripe);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.7, 0.07), glass);
  windshield.position.set(0, 1.82, 2.36);
  windshield.rotation.x = -0.08;
  g.add(windshield);
  for (const s of [-1, 1]) {
    const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.9), glass);
    sideWindow.position.set(s * 0.975, 1.8, 1.7);
    g.add(sideWindow);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.1), blue);
    mirror.position.set(s * 1.06, 1.72, 2.04);
    g.add(mirror);
  }
  const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 0.07), glass);
  rearWindow.position.set(0, 1.92, -2.49);
  g.add(rearWindow);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.24, 0.18), metal);
  bumper.position.set(0, 0.52, 2.55);
  g.add(bumper);
  const rearBumper = bumper.clone();
  rearBumper.position.z = -2.5;
  g.add(rearBumper);
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.06), light);
    hl.position.set(s * 0.68, 0.88, 2.56);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), red);
    tl.position.set(s * 0.74, 1.0, -2.52);
    g.add(tl);
  }
  const brand = makeTextPlane('EXPRESS · 38', {
    width: 1024,
    height: 220,
    fontSize: 96,
    accent: '#2f5f80',
    bg: 'rgba(235,232,220,0.98)',
    color: '#234457',
  });
  for (const s of [-1, 1]) {
    const panel = brand.clone();
    panel.scale.set(2.35, 0.5, 1);
    panel.position.set(s * 1.015, 1.52, -0.7);
    panel.rotation.y = (s * Math.PI) / 2;
    g.add(panel);
  }

  const wheels = [];
  for (const z of [-1.72, 1.72]) {
    for (const x of [-0.9, 0.9]) {
      const w = makeWheel(0.38, 0.26, rubber, chrome);
      w.position.set(x, 0.4, z);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels };
}

function makeBus() {
  const g = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: '#f1eee3', roughness: 0.48, metalness: 0.08 });
  const blue = new THREE.MeshStandardMaterial({ color: '#145c88', roughness: 0.4, metalness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: '#b23c31', roughness: 0.42, metalness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({ color: '#20343d', roughness: 0.08, metalness: 0.65 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141718', roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#b8bcbb', roughness: 0.28, metalness: 0.9 });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });
  const tail = new THREE.MeshBasicMaterial({ color: '#b12424' });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.42, 11.0), cream);
  body.position.set(0, 1.7, 0);
  body.castShadow = true;
  g.add(body);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.35, 11.02), blue);
  skirt.position.set(0, 0.47, 0);
  g.add(skirt);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.14, 10.86), cream);
  roof.position.set(0, 2.95, 0);
  roof.castShadow = true;
  g.add(roof);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(2.53, 0.09, 11.02), red);
  belt.position.set(0, 1.14, 0);
  g.add(belt);

  for (const s of [-1, 1]) {
    const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.74, 8.9), glass);
    windowBand.position.set(s * 1.255, 2.19, -0.32);
    g.add(windowBand);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.9, 1.15), glass);
    door.position.set(s * 1.26, 1.42, 2.55);
    g.add(door);
    const doorSplit = new THREE.Mesh(new THREE.BoxGeometry(0.085, 1.9, 0.08), blue);
    doorSplit.position.set(s * 1.265, 1.42, 2.55);
    g.add(doorSplit);
  }
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.02, 0.08), glass);
  windshield.position.set(0, 2.16, 5.52);
  windshield.rotation.x = -0.06;
  g.add(windshield);
  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.82, 0.08), glass);
  rearGlass.position.set(0, 2.18, -5.52);
  g.add(rearGlass);
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.38, 0.08),
    new THREE.MeshStandardMaterial({ color: '#242c2e', roughness: 0.62, metalness: 0.3 })
  );
  grille.position.set(0, 1.02, -5.56);
  g.add(grille);
  const roofUnit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.24, 2.4), glass);
  roofUnit.position.set(0, 3.05, 1.2);
  roofUnit.castShadow = true;
  g.add(roofUnit);
  const rearTag = makeTextPlane('TAG · 38', {
    width: 512,
    height: 128,
    fontSize: 70,
    accent: '#145c88',
    bg: 'rgba(14,20,23,0.96)',
    color: '#ffc76b',
  });
  rearTag.scale.set(1.25, 1.25, 1);
  rearTag.position.set(0, 2.73, -5.58);
  rearTag.rotation.y = Math.PI;
  g.add(rearTag);

  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.06), light);
    hl.position.set(s * 0.78, 0.88, 5.55);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.06), tail);
    tl.position.set(s * 0.82, 1.0, -5.54);
    g.add(tl);
  }
  const destination = makeTextPlane('TAG  ·  38  ·  GRENOBLE', {
    width: 1200,
    height: 190,
    fontSize: 86,
    accent: '#145c88',
    bg: 'rgba(14,20,23,0.96)',
    color: '#ffc76b',
  });
  destination.scale.set(2.1, 0.34, 1);
  destination.position.set(0, 2.78, 5.57);
  g.add(destination);
  const number = makeTextPlane('38', {
    width: 200,
    height: 180,
    fontSize: 120,
    accent: '#b23c31',
    bg: 'rgba(244,240,228,0.98)',
    color: '#21313a',
  });
  number.scale.set(0.44, 0.4, 1);
  for (const s of [-1, 1]) {
    const panel = number.clone();
    panel.position.set(s * 1.27, 1.72, 2.55);
    panel.rotation.y = (s * Math.PI) / 2;
    g.add(panel);
  }

  const wheels = [];
  for (const z of [-3.55, 3.55]) {
    for (const x of [-1.05, 1.05]) {
      const w = makeWheel(0.46, 0.3, rubber, chrome);
      w.position.set(x, 0.48, z);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels };
}

function makeScooter() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#2f7186', roughness: 0.38, metalness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: '#1a1e20', roughness: 0.82 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#c6cac7', roughness: 0.22, metalness: 0.92 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#151819', roughness: 0.95 });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });

  const wheels = [];
  for (const z of [-0.5, 0.52]) {
    const w = makeWheel(0.23, 0.1, rubber, chrome);
    w.position.set(0, 0.24, z);
    g.add(w);
    wheels.push(w);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.075, 0.78), black);
  deck.position.set(0, 0.26, 0.01);
  g.add(deck);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.9, 7), chrome);
  stem.position.set(0, 0.69, 0.42);
  stem.rotation.x = 0.1;
  g.add(stem);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6), black);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.14, 0.46);
  g.add(bar);
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.05), paint);
  display.position.set(0, 1.1, 0.5);
  g.add(display);
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), light);
  headlight.position.set(0, 1.02, 0.55);
  g.add(headlight);
  const rearLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: '#c2332d' }));
  rearLight.position.set(0, 0.38, -0.48);
  g.add(rearLight);

  const rider = createRider('#375d70', '#e6dcc8');
  rider.position.set(0, 0.23, -0.04);
  rider.scale.set(0.8, 0.8, 0.8);
  g.add(rider);
  rider.visible = false;
  return { group: g, wheels, rider };
}

function makeMotorcycle() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#a33a2b', roughness: 0.3, metalness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: '#181c1e', roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#c5c8c5', roughness: 0.2, metalness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#141617', roughness: 0.95 });
  const light = new THREE.MeshBasicMaterial({ color: '#fff3ce' });

  const wheels = [];
  for (const z of [-0.78, 0.78]) {
    const w = makeWheel(0.37, 0.16, rubber, chrome);
    w.position.set(0, 0.39, z);
    g.add(w);
    wheels.push(w);
  }
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.68), paint);
  tank.position.set(0, 0.88, 0.12);
  tank.castShadow = true;
  g.add(tank);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.65), black);
  seat.position.set(0, 0.83, -0.55);
  g.add(seat);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.5), chrome);
  engine.position.set(0, 0.56, 0.05);
  g.add(engine);
  const frame1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.2), black);
  frame1.position.set(0, 0.66, 0);
  g.add(frame1);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6), chrome);
  fork.position.set(0, 0.66, 0.72);
  fork.rotation.x = 0.28;
  g.add(fork);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.05, 0.6);
  g.add(bar);
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), light);
  headlight.position.set(0, 1.0, 0.78);
  g.add(headlight);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.1, 8), chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.23, 0.45, -0.3);
  g.add(exhaust);

  const rider = createRider('#2f4352', '#e6dcc8');
  rider.position.set(0, 0.42, -0.18);
  rider.scale.set(0.92, 0.92, 0.92);
  g.add(rider);
  rider.visible = false;
  return { group: g, wheels, rider };
}

function tubeBetween(a, b, radius, mat) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function makeBicycle() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#b74631', roughness: 0.35, metalness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: '#1d2022', roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#c8cbc8', roughness: 0.2, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#151819', roughness: 0.95 });

  const wheels = [];
  for (const z of [-0.62, 0.62]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 6, 20), rubber);
    tire.rotation.y = Math.PI / 2;
    w.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.016, 4, 20), chrome);
    rim.rotation.y = Math.PI / 2;
    w.add(rim);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.64, 3), chrome);
      spoke.rotation.x = (i / 5) * Math.PI;
      w.add(spoke);
    }
    w.position.set(0, 0.38, z);
    g.add(w);
    wheels.push(w);
  }

  const bottom = new THREE.Vector3(0, 0.38, -0.15);
  const seatTop = new THREE.Vector3(0, 0.92, -0.32);
  const headTop = new THREE.Vector3(0, 0.98, 0.42);
  const rear = new THREE.Vector3(0, 0.38, -0.62);
  const front = new THREE.Vector3(0, 0.38, 0.62);
  g.add(tubeBetween(rear, seatTop, 0.035, paint));
  g.add(tubeBetween(seatTop, bottom, 0.035, paint));
  g.add(tubeBetween(bottom, headTop, 0.04, paint));
  g.add(tubeBetween(seatTop, headTop, 0.035, paint));
  g.add(tubeBetween(headTop, front, 0.03, chrome));
  g.add(tubeBetween(bottom, rear, 0.03, paint));

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.34), black);
  seat.position.set(0, 1.0, -0.32);
  g.add(seat);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.06, 0.44);
  g.add(bar);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.24), black);
  basket.position.set(0, 1.05, 0.72);
  g.add(basket);

  const rider = createRider('#365f72', '#e2d7c2');
  rider.position.set(0, 0.35, -0.1);
  rider.rotation.x = -0.15;
  rider.scale.set(0.86, 0.86, 0.86);
  g.add(rider);
  rider.visible = false;
  return { group: g, wheels, rider };
}

/* ──────────────────────────────────────────────────────────────
   Vehicle
   ────────────────────────────────────────────────────────────── */
export class Vehicle {
  constructor(type, x, z, heading, scene) {
    this.type = type;
    this.spec = VEHICLE_SPECS[type];
    this.scene = scene;
    this.position = new THREE.Vector3(x, groundHeightAt(x, z), z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.driver = false;
    this.blockedByWater = false;
    this.collisionPulse = 0;

    let model;
    if (type === 'taxi') {
      model = makeCar({ paintColor: '#efe7d3', darkColor: '#8c322d', taxi: true });
    } else if (type === 'car') {
      model = makeCar();
    } else if (type === 'van') {
      model = makeVan();
    } else if (type === 'bus') {
      model = makeBus();
    } else if (type === 'truck') {
      model = makeTruck();
    } else if (type === 'scooter') {
      model = makeScooter();
    } else if (type === 'motorcycle') {
      model = makeMotorcycle();
    } else {
      model = makeBicycle();
    }
    this.group = model.group;
    this.wheels = model.wheels;
    this.rider = model.rider ?? null;
    this.group.position.copy(this.position);
    this.group.rotation.y = heading;
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(this.group);

    this.pitch = 0;
    this.roll = 0;
    this.lean = 0;
    this.wheelSpin = 0;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get right() {
    return new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  setDriver(on) {
    this.driver = on;
    if (this.rider) this.rider.visible = on;
  }

  update(dt, input, world, env = {}) {
    const spec = this.spec;
    const throttle = input.forward;
    const steerInput = input.steer;
    const boosting = input.boost;
    const snow = env.snow ?? 0;
    const maxSpeed = spec.maxSpeed * (boosting ? 1.12 : 1) * (1 - snow * 0.16);

    this.steer = damp(this.steer, steerInput, 7, dt);

    if (throttle > 0) {
      if (this.speed < -0.2) this.speed += spec.brake * dt;
      else this.speed += spec.accel * (1 - snow * 0.27) * dt;
    } else if (throttle < 0) {
      if (this.speed > 0.3) this.speed -= spec.brake * (1 - snow * 0.15) * dt;
      else this.speed -= spec.accel * 0.5 * (1 - snow * 0.3) * dt;
    } else {
      // rolling drag
      const drag = spec.drag * 1.7 + 0.8;
      const sign = Math.sign(this.speed);
      this.speed -= sign * Math.min(Math.abs(this.speed), drag * dt);
    }

    if (input.brake) {
      const sign = Math.sign(this.speed);
      this.speed -= sign * Math.min(Math.abs(this.speed), spec.brake * 1.5 * dt);
    }

    // slope gravity
    const fx = this.position.x + Math.sin(this.heading) * 2.4;
    const fz = this.position.z + Math.cos(this.heading) * 2.4;
    const bx = this.position.x - Math.sin(this.heading) * 2.4;
    const bz = this.position.z - Math.cos(this.heading) * 2.4;
    const grade = (groundHeightAt(fx, fz) - groundHeightAt(bx, bz)) / 4.8;
    const gravityFactor = spec.twoWheels ? 0.7 : spec.heavy ? 0.7 : 1;
    this.speed -= 9.81 * grade * dt * 0.55 * gravityFactor;

    // off-road / very steep terrain
    const slope = Math.acos(clamp(terrainNormalAt(this.position.x, this.position.z, 3).y, -1, 1));
    if (!spec.heavy && !spec.twoWheels && this.type !== 'bike' && slope > 0.5) {
      this.speed *= 1 - Math.min(0.7, (slope - 0.5) * 2.5) * dt;
    }

    this.speed = clamp(this.speed, -spec.maxReverse, maxSpeed);

    // steering
    if (Math.abs(this.speed) > 0.15) {
      const speedFactor = clamp(Math.abs(this.speed) / 5, 0.2, 1) * (1 - clamp(Math.abs(this.speed) / spec.maxSpeed, 0, 1) * 0.35);
      const direction = this.speed >= 0 ? 1 : -1;
      this.heading -= this.steer * spec.turn * speedFactor * dt * direction * (1 - snow * 0.2);
    }

    // two-wheelers lean into the turn with the whole body
    const twoWheels = Boolean(spec.twoWheels);
    const targetLean = twoWheels
      ? -this.steer * clamp(Math.abs(this.speed) / spec.maxSpeed, 0, 1) * 0.34
      : 0;
    this.lean = damp(this.lean, targetLean, 6, dt);

    // move
    const fx2 = Math.sin(this.heading);
    const fz2 = Math.cos(this.heading);
    let nx = this.position.x + fx2 * this.speed * dt;
    let nz = this.position.z + fz2 * this.speed * dt;

    // bounds
    nx = clamp(nx, -4350, 4350);
    nz = clamp(nz, -4350, 4350);

    // water
    this.blockedByWater = false;
    if (isUnderwater(nx, nz)) {
      nx = this.position.x;
      nz = this.position.z;
      this.speed *= 0.2;
      this.blockedByWater = true;
    }

    // buildings
    const push = world.resolveCircle(nx, nz, spec.radius, (b) => b.type !== 'parked');
    if (push.hit) {
      nx += push.x;
      nz += push.z;
      if (this.collisionPulse <= 0) {
        this.speed *= 0.18;
        this.collisionPulse = 0.45;
      }
    }
    this.collisionPulse = Math.max(0, this.collisionPulse - dt);

    this.position.x = nx;
    this.position.z = nz;
    this.position.y = groundHeightAt(nx, nz);

    // orientation on the ground
    const fwd = this.forward;
    const right = this.right;
    const hF = groundHeightAt(nx + fwd.x * spec.length * 0.42, nz + fwd.z * spec.length * 0.42);
    const hB = groundHeightAt(nx - fwd.x * spec.length * 0.42, nz - fwd.z * spec.length * 0.42);
    const hR = groundHeightAt(nx + right.x * spec.width * 0.5, nz + right.z * spec.width * 0.5);
    const hL = groundHeightAt(nx - right.x * spec.width * 0.5, nz - right.z * spec.width * 0.5);
    const targetPitch = Math.atan2(hF - hB, spec.length * 0.84);
    const targetRoll = Math.atan2(hR - hL, spec.width);
    this.pitch = damp(this.pitch, targetPitch, 7, dt);
    this.roll = damp(this.roll, targetRoll, 7, dt);

    this.group.position.copy(this.position);
    this.group.position.y += spec.lift;
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(this.pitch, this.heading, this.roll + this.lean);

    // wheel spin
    this.wheelSpin -= (this.speed * dt) / (spec.wheelRadius ?? 0.36);
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
  }

  exitPosition() {
    const right = this.right;
    const dist = this.spec.width * 0.5 + 1.2;
    let x = this.position.x + right.x * dist;
    let z = this.position.z + right.z * dist;
    if (isUnderwater(x, z)) {
      x = this.position.x - right.x * dist;
      z = this.position.z - right.z * dist;
    }
    return { x, z, heading: this.heading };
  }

  get label() {
    return this.spec.label;
  }
}

export function buildVehicles(scene, colliders) {
  const vehicles = [];
  for (const spawn of VEHICLE_SPAWNS) {
    vehicles.push(new Vehicle(spawn.type, spawn.x, spawn.z, spawn.heading, scene));
  }
  return vehicles;
}
