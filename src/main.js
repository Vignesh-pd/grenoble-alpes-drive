import * as THREE from 'three';
import {
  SPAWN,
  DISTRICTS,
  VALLEY_ALTITUDE,
  DISTANCE_REWARDS,
  EXPLORER_RANKS,
} from './data.js';
import { ColliderWorld, clamp, damp, dampAngle } from './utils.js';
import {
  buildTerrain,
  groundHeightAt,
  heightAt,
  slopeAt,
  isUnderwater,
} from './terrain.js';
import { buildCity } from './city.js';
import { buildNature } from './nature.js';
import { buildAlpine } from './alpine.js';
import { buildTransit } from './transit.js';
import { buildVehicles } from './vehicles.js';
import { buildTraffic } from './traffic.js';
import { Player } from './player.js';
import { WeatherSystem } from './weather.js';
import { HUD } from './hud.js';

/* ──────────────────────────────────────────────────────────────
   Boot screen helpers
   ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const loadBar = $('loadProgress');
const loadStatus = $('loadStatus');
const loadTip = $('loadTip');

const TIPS = [
  'Tip — Use the trams to cross town without traffic.',
  'Tip — Taxis, vans and TAG buses now share the grid. Look both ways.',
  'Tip — The téléphérique leaves from the Isère bank and climbs to the Bastille.',
  'Tip — Press 3 for snow, then R on a piste to ski.',
  'Tip — Bicycles cut through the old town faster than any car.',
  'Tip — Follow the wooden signs north of the river for the Bastille trail.',
  'Tip — The télécabine at Chamrousse climbs to the Belledonne snowfront.',
];
let tipIndex = 0;
const tipTimer = setInterval(() => {
  tipIndex = (tipIndex + 1) % TIPS.length;
  if (loadTip) loadTip.textContent = TIPS[tipIndex];
}, 3800);

function setLoad(pct, text) {
  if (loadBar) loadBar.style.width = `${clamp(pct, 0, 100)}%`;
  if (loadStatus && text) loadStatus.textContent = text;
}

const nextFrame = () =>
  new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // requestAnimationFrame is ideal, but background/automated tabs may throttle it
    // completely. The timer fallback keeps world generation moving regardless.
    requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 140);
  });

/* ──────────────────────────────────────────────────────────────
   Renderer, scene, camera
   ────────────────────────────────────────────────────────────── */
const app = $('app');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label', 'Grenoble Alpes Drive');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c8d8de');

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.12,
  18000
);
camera.position.set(1450, 720, 2250);
camera.lookAt(0, 140, -250);

const canvas = renderer.domElement;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TRAM_EYE_LOCAL = new THREE.Vector3(0, 2.05, -9.2);

/* ──────────────────────────────────────────────────────────────
   World & game state
   ────────────────────────────────────────────────────────────── */
const colliders = new ColliderWorld();

const state = {
  ready: false,
  started: false,
  mode: 'walk', // walk | vehicle | tram | lift
  activeVehicle: null,
  activeTram: null,
  activeLift: null,
  liftFrom: null,
  liftTimer: 0,
  camYaw: SPAWN.heading,
  camPitch: 0.28,
  camDist: 8,
  lastMouseLook: -999,
  time: 0,
  clockMinutes: 16 * 60 + 40,
  interaction: null,
  weatherMode: 'sunny',
  hikeMeters: 0,
  skiMeters: 0,
  lastX: SPAWN.x,
  lastZ: SPAWN.z,
  totalDistance: 0,
  rewardPoints: 0,
  rewardCheckpoint: 0,
  explorerRank: 0,
  travelX: SPAWN.x,
  travelZ: SPAWN.z,
  helpOpen: false,
  mapOpen: false,
};

let world = null;
let terrain = null;
let city = null;
let nature = null;
let alpine = null;
let transit = null;
let vehicles = null;
let traffic = null;
let player = null;
let weather = null;
let hud = null;

let jumpQueued = false;
let skiHintCooldown = 0;

const keys = new Set();
let pointerLocked = false;
let dragDown = null;
let dragging = false;
let dragDistance = 0;

const pisteLengths = new Map();
const clock = new THREE.Clock();

/* ──────────────────────────────────────────────────────────────
   Input
   ────────────────────────────────────────────────────────────── */
function inputAxis() {
  const forward =
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
    (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const steer =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  return {
    forward,
    steer,
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    brake: keys.has('Space'),
    jump: false,
  };
}

function requestLock() {
  if (!state.started || state.helpOpen || state.mapOpen) return;
  if (document.pointerLockElement === canvas) return;
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* pointer lock can be denied in automation or embedded browsers */
  }
}

function setUpPointerLock() {
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (hud) {
      hud.setLockHint(state.started && !pointerLocked && !state.helpOpen && !state.mapOpen);
    }
  });
  document.addEventListener('pointerlockerror', () => {
    pointerLocked = false;
    if (hud) hud.setLockHint(false);
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.started || state.helpOpen || state.mapOpen) return;
    if (document.pointerLockElement === canvas) {
      lookBy(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (dragDown) {
      const dx = e.clientX - dragDown.x;
      const dy = e.clientY - dragDown.y;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      if (dragDistance > 4) dragging = true;
      if (dragging) {
        lookBy(dx, dy);
        dragDown = { x: e.clientX, y: e.clientY };
      }
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || state.helpOpen || state.mapOpen) return;
    dragDown = { x: e.clientX, y: e.clientY };
    dragging = false;
    dragDistance = 0;
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const wasClick = dragDown && !dragging;
    dragDown = null;
    dragging = false;
    if (wasClick && state.started && !state.helpOpen && !state.mapOpen && !document.pointerLockElement) {
      requestLock();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    if (!state.started || state.mode === 'lift' || state.mapOpen) return;
    e.preventDefault();
    state.camDist = clamp(state.camDist + Math.sign(e.deltaY) * 0.9, 3.2, 38);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
      e.preventDefault();
    }
    if (!state.started) return;

    if (e.code === 'KeyM') {
      e.preventDefault();
      if (!e.repeat) hud?.toggleMap();
      return;
    }
    if (e.code === 'Escape') {
      if (hud?.mapOpen) {
        hud.closeMap();
        return;
      }
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      else if (hud?.helpOpen) hud.closeHelp();
      return;
    }
    if (state.mapOpen) return;
    if (e.code === 'KeyH') {
      e.preventDefault();
      if (!e.repeat) hud?.toggleHelp();
      return;
    }
    if (hud?.helpOpen) return;

    if (e.code === 'Digit1' || e.code === 'Numpad1') setWeather('sunny');
    else if (e.code === 'Digit2' || e.code === 'Numpad2') setWeather('rain');
    else if (e.code === 'Digit3' || e.code === 'Numpad3') setWeather('snow');
    else if (e.code === 'KeyE' && !e.repeat) interact();
    else if (e.code === 'KeyR' && !e.repeat) toggleSkis();
    else if (e.code === 'Space' && !e.repeat && state.mode === 'walk' && !player?.skiing) {
      jumpQueued = true;
    }

    keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => keys.clear());
}

function lookBy(dx, dy) {
  const sens = 0.0023;
  const ridingTram = state.mode === 'tram';
  state.camYaw -= dx * sens;
  state.camPitch = clamp(
    state.camPitch + dy * 0.0018,
    ridingTram ? -0.45 : -0.08,
    ridingTram ? 0.62 : 1.12
  );
  state.lastMouseLook = state.time;
}

/* ──────────────────────────────────────────────────────────────
   Weather
   ────────────────────────────────────────────────────────────── */
function setWeather(mode) {
  if (!weather || !hud) return;
  if (mode === state.weatherMode) {
    hud.toast(`${weather.info.label} — ${weather.info.temp}°C`, 'MÉTÉO');
    return;
  }
  state.weatherMode = mode;
  weather.setMode(mode, false);
  hud.setWeather(weather.info, mode);
  const info = weather.info;
  hud.toast(`${info.label} · ${info.temp}°C · ${info.wind}`, 'MÉTÉO');

  if (mode === 'snow') {
    hud.toast('Snow is settling. Chamrousse pistes and the Bastille slopes are skiable — R to put skis on.', 'SNOW');
    if (player?.skiing) {
      // skis remain useful while snow is falling
    }
  } else if (player?.skiing) {
    player.setSkiing(false);
    hud.toast('The snow is melting — skis off.', 'SKIS');
  }
}

/* ──────────────────────────────────────────────────────────────
   Skis
   ────────────────────────────────────────────────────────────── */
function skiConditions() {
  if (!player || !alpine || !weather) return { ok: false, reason: 'no world' };
  if (weather.snowAmount < 0.45) {
    return { ok: false, reason: 'weather' };
  }
  const x = player.position.x;
  const z = player.position.z;
  const piste = alpine.isNearPiste(x, z);
  const slope = slopeAt(x, z);
  const chamrousse = x > 2320 && z > 1620;
  const bastille = Math.hypot(x + 760, z + 2000) < 420;
  if (piste) return { ok: true, where: 'piste', piste };
  if (slope > 0.1) return { ok: true, where: 'slope' };
  if (chamrousse) return { ok: true, where: 'chamrousse' };
  if (bastille && slope > 0.055) return { ok: true, where: 'bastille' };
  return { ok: false, reason: 'flat' };
}

function toggleSkis() {
  if (!player || !state.ready) return;
  if (state.mode !== 'walk') {
    hud?.toast('Get out of the vehicle first, then put your skis on.', 'SKIS');
    return;
  }
  if (player.skiing) {
    player.setSkiing(false);
    state.skiMeters = 0;
    state.camYaw = player.heading;
    hud?.toast('Skis off. Back on foot.', 'SKIS');
    return;
  }
  const conditions = skiConditions();
  if (!conditions.ok) {
    if (conditions.reason === 'weather') {
      hud?.toast('No snow yet — switch the weather to SNOW with 3.', 'SKIS');
    } else {
      hud?.toast('Find a marked piste or a real slope — the city floor is too flat.', 'SKIS');
    }
    return;
  }
  player.setSkiing(true);
  state.skiMeters = 0;
  state.camYaw = player.heading;
  state.camPitch = 0.22;
  state.camDist = 9.5;
  hud?.toast('Skis on. Point downhill, A/D to carve, SPACE to brake, R to walk.', 'SKIS');
}

/* ──────────────────────────────────────────────────────────────
   Interaction & boarding
   ────────────────────────────────────────────────────────────── */
function canStandAt(x, z, radius = 0.5) {
  if (isUnderwater(x, z)) return false;
  if (slopeAt(x, z) > 1.16) return false;
  const push = colliders.resolveCircle(x, z, radius);
  return !push.hit;
}

function safeExitAround(x, z, heading, radius = 0.55) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = -Math.cos(heading);
  const rz = Math.sin(heading);
  const candidates = [
    [rx * 2.2, rz * 2.2],
    [-rx * 2.2, -rz * 2.2],
    [-fx * 3.0, -fz * 3.0],
    [fx * 3.0, fz * 3.0],
    [rx * 3.8, rz * 3.8],
    [-rx * 3.8, -rz * 3.8],
  ];
  for (const [dx, dz] of candidates) {
    if (canStandAt(x + dx, z + dz, radius)) return { x: x + dx, z: z + dz };
  }
  return { x, z };
}

function enterVehicle(vehicle) {
  if (!vehicle) return;
  if (player.skiing) {
    player.setSkiing(false);
    state.skiMeters = 0;
  }
  if (state.activeTram) state.activeTram.setInteriorVisible(false);
  state.mode = 'vehicle';
  state.activeVehicle = vehicle;
  state.activeTram = null;
  vehicle.setDriver(true);
  player.setVisible(false);
  state.camYaw = vehicle.heading;
  state.camPitch = 0.22;
  state.camDist =
    vehicle.type === 'bus'
      ? 20
      : vehicle.type === 'truck'
        ? 14
        : vehicle.type === 'van'
          ? 11.5
          : vehicle.type === 'car' || vehicle.type === 'taxi'
            ? 9.5
            : vehicle.type === 'motorcycle'
              ? 6.6
              : vehicle.type === 'scooter'
                ? 4.6
                : 5.6;
  state.lastMouseLook = -999;
  resetTravelTracker();
  hud?.setMissionDone('wheels');
  hud?.toast(`${vehicle.spec.name} · ${vehicle.spec.label}`, 'KEYS');
}

function exitVehicle() {
  const vehicle = state.activeVehicle;
  if (!vehicle) return;
  const base = safeExitAround(vehicle.position.x, vehicle.position.z, vehicle.heading, 0.55);
  vehicle.setDriver(false);
  state.activeVehicle = null;
  state.mode = 'walk';
  player.setVisible(true);
  player.teleport(base.x, base.z, vehicle.heading);
  state.camYaw = vehicle.heading;
  state.camPitch = 0.28;
  state.camDist = 8;
  state.lastMouseLook = -999;
  resetTravelTracker();
  hud?.toast('On foot. E to get back in.', 'EXIT');
}

function enterTram(tram, force = false) {
  if (!tram) return;
  if (!force && (!tram.isStopped || !tram.currentStop())) {
    hud?.toast('Trams can only be boarded when stopped at a TAG platform.', 'TAG');
    return;
  }
  if (player.skiing) {
    player.setSkiing(false);
    state.skiMeters = 0;
  }
  if (state.activeVehicle) state.activeVehicle.setDriver(false);
  if (state.activeTram && state.activeTram !== tram) state.activeTram.setInteriorVisible(false);
  state.mode = 'tram';
  state.activeTram = tram;
  state.activeVehicle = null;
  tram.setInteriorVisible(true);
  player.setVisible(false);
  state.camYaw = tram.heading;
  state.camPitch = 0.03;
  state.camDist = 0;
  state.lastMouseLook = -999;
  resetTravelTracker();
  hud?.setMissionDone('tram');
  hud?.toast(`${tram.line.name} — direction ${tram.destination}. Next stop live on the cabin board.`, 'TAG');
}

function exitTram(force = false) {
  const tram = state.activeTram;
  if (!tram) return;
  if (!force && (!tram.isStopped || !tram.currentStop())) {
    hud?.toast('Hold on — doors open at the next TAG platform.', 'TAG');
    return;
  }
  const fx = Math.sin(tram.heading);
  const fz = Math.cos(tram.heading);
  const rx = -Math.cos(tram.heading);
  const rz = Math.sin(tram.heading);
  let landing = null;
  for (const side of [1, -1]) {
    for (const along of [0, 4, -4]) {
      const x = tram.position.x + rx * side * 8.8 + fx * along;
      const z = tram.position.z + rz * side * 8.8 + fz * along;
      if (canStandAt(x, z, 0.55)) {
        landing = { x, z };
        break;
      }
    }
    if (landing) break;
  }
  if (!landing) landing = { x: tram.position.x + rx * 9, z: tram.position.z + rz * 9 };
  tram.setInteriorVisible(false);
  state.activeTram = null;
  state.mode = 'walk';
  player.setVisible(true);
  player.teleport(landing.x, landing.z, tram.heading);
  state.camYaw = tram.heading;
  state.camPitch = 0.28;
  state.camDist = 8;
  state.lastMouseLook = -999;
  resetTravelTracker();
  hud?.toast('Off the tram. Mind the traffic.', 'TAG');
}

function enterLift(lift, station) {
  if (!lift || !station) return;
  if (player.skiing) {
    player.setSkiing(false);
    state.skiMeters = 0;
  }
  const ride = lift.startRide(station.side);
  if (state.activeVehicle) state.activeVehicle.setDriver(false);
  if (state.activeTram) state.activeTram.setInteriorVisible(false);
  state.mode = 'lift';
  state.activeLift = lift;
  state.liftFrom = station.side;
  state.liftTimer = 0;
  state.activeVehicle = null;
  state.activeTram = null;
  player.setVisible(false);
  state.lastMouseLook = -999;
  resetTravelTracker();
  hud?.toast(`${lift.cfg.short} — ${ride.duration} s to ${ride.to === 'upper' ? 'the top' : 'the valley'}.`, 'AERIAL');
}

function finishLift() {
  const lift = state.activeLift;
  if (!lift) return;
  const from = state.liftFrom;
  const to = from === 'lower' ? 'upper' : 'lower';
  const station = lift.stations[to];
  lift.endRide();
  state.activeLift = null;
  state.mode = 'walk';
  player.setVisible(true);
  const heading = to === 'upper' ? Math.PI : 0;
  const zOffset = to === 'upper' ? 17 : 15;
  player.teleport(station.x, station.z + zOffset, heading);

  state.camYaw = heading;
  state.camPitch = 0.28;
  state.camDist = 8;
  state.lastMouseLook = -999;
  resetTravelTracker();

  if (lift.cfg.id === 'bastille' && to === 'upper') {
    hud?.setMissionDone('bulles');
    hud?.setMissionDone('summit');
    hud?.toast('Fort de la Bastille — 476 m above the Isère. The whole basin is below you.', 'ARRIVAL');
  } else if (lift.cfg.id === 'chamrousse' && to === 'upper') {
    hud?.toast('Chamrousse · 1 700 m. In snow, press R on a piste to ski.', 'ARRIVAL');
  } else {
    hud?.toast('Back down in the valley.', 'ARRIVAL');
  }
}

function currentInteraction() {
  if (!state.ready) return null;
  if (state.mode === 'vehicle') {
    return { key: 'E', action: 'exit-vehicle', text: 'Get out of the vehicle' };
  }
  if (state.mode === 'tram') {
    const tram = state.activeTram;
    const stop = tram?.currentStop();
    if (tram?.isStopped && stop) {
      return { key: 'E', action: 'exit-tram', text: `Get off — ${stop.name}` };
    }
    return null;
  }
  if (state.mode === 'lift') return null;
  if (!player) return null;

  const px = player.position.x;
  const pz = player.position.z;
  let best = null;
  const consider = (candidate) => {
    if (!candidate) return;
    if (!best || candidate.distance < best.distance) best = candidate;
  };

  for (const vehicle of vehicles) {
    if (vehicle.driver) continue;
    const distance = Math.hypot(vehicle.position.x - px, vehicle.position.z - pz);
    const reach = vehicle.spec.radius + 3.2;
    if (distance <= reach) {
      consider({
        distance,
        key: 'E',
        action: 'enter-vehicle',
        vehicle,
        text: `Enter — ${vehicle.spec.label}`,
      });
    }
  }

  for (const lift of transit.aerialLifts) {
    const station = lift.getStation(px, pz);
    if (!station) continue;
    const toTop = station.side === 'lower';
    const destination = lift.cfg.id === 'bastille' ? 'the Bastille' : 'Chamrousse';
    consider({
      distance: station.distance * 1.35,
      key: 'E',
      action: 'enter-lift',
      lift,
      station,
      text: toTop ? `Take the ${lift.cfg.short.toLowerCase()} to ${destination}` : `Ride down to the valley`,
    });
  }

  let tramHit = null;
  for (const tram of transit.trams) {
    if (!tram.isStopped) continue;
    const stop = tram.currentStop();
    if (!stop) continue;
    const atPlatform = Math.hypot(stop._x - px, stop._z - pz);
    if (atPlatform > 22) continue;
    const distance = Math.hypot(tram.position.x - px, tram.position.z - pz);
    if (distance <= 21 && (!tramHit || distance < tramHit.distance)) {
      tramHit = { tram, distance, stop };
    }
  }
  if (tramHit) {
    consider({
      distance: tramHit.distance,
      key: 'E',
      action: 'enter-tram',
      tram: tramHit.tram,
      text: `Board ${tramHit.tram.line.name} — ${tramHit.stop.name}`,
    });
  }

  if (!best && !player.skiing) {
    const conditions = skiConditions();
    if (conditions.ok) {
      best = { distance: 999, key: 'R', action: 'skis', text: 'Put on skis for the snow' };
    }
  }
  return best;
}

function interact() {
  if (!state.ready) return;
  if (state.mode === 'vehicle') {
    exitVehicle();
    return;
  }
  if (state.mode === 'tram') {
    exitTram();
    return;
  }
  if (state.mode === 'lift') return;
  const interaction = state.interaction;
  if (!interaction || interaction.key !== 'E') return;
  if (interaction.action === 'enter-vehicle') enterVehicle(interaction.vehicle);
  else if (interaction.action === 'enter-tram') enterTram(interaction.tram);
  else if (interaction.action === 'enter-lift') enterLift(interaction.lift, interaction.station);
}

/* ──────────────────────────────────────────────────────────────
   HUD state
   ────────────────────────────────────────────────────────────── */
function districtAt(x, z) {
  if (z < -1500) return x > 700 ? 'MONT RACHAIS' : 'BASTILLE · CHARTREUSE';
  if (x > 2650 && z > 1000) return 'CHAMROUSSE · BELLEDONNE';
  if (z > 2180) return 'VERCORS · MONTAGNE';
  for (const district of DISTRICTS) {
    if (district.test(x, z)) return district.name;
  }
  return 'ISÈRE · GRENOBLE';
}

function focusPosition() {
  if (state.mode === 'vehicle' && state.activeVehicle) return state.activeVehicle.position;
  if (state.mode === 'tram' && state.activeTram) return state.activeTram.position;
  if (state.mode === 'lift' && state.activeLift?.rideCabin) return state.activeLift.rideCabin.position;
  return player.position;
}

function focusHeading() {
  if (state.mode === 'vehicle' && state.activeVehicle) return state.activeVehicle.heading;
  if (state.mode === 'tram' && state.activeTram) return state.activeTram.heading;
  return player.heading;
}

function trafficFocus() {
  const focus = focusPosition();
  const radius =
    state.mode === 'vehicle' && state.activeVehicle ? state.activeVehicle.spec.radius : 0.65;
  return { x: focus.x, z: focus.z, radius };
}

function nearestTrailInfo() {
  if (!alpine || !player) return null;
  return alpine.findTrailAt(player.position.x, player.position.z);
}

function pisteProgressInfo(piste) {
  const px = player.position.x;
  const pz = player.position.z;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < piste.pts.length; i++) {
    const p = piste.pts[i];
    const d = (p.x - px) ** 2 + (p.z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const progress = piste.pts.length > 1 ? best / (piste.pts.length - 1) : 0;
  const length = pisteLengths.get(piste.id) || 0;
  return { progress, remaining: length * (1 - progress) };
}

function buildTelemetry() {
  if (!state.ready) return null;
  if (state.mode === 'lift' && state.activeLift) {
    const pose = state.activeLift.getRidePose();
    const progress = pose?.progress ?? 0;
    return {
      label: 'AERIAL LINE',
      name: state.activeLift.cfg.name,
      progress,
      remaining: state.activeLift.cfg.duration * (1 - progress),
      remainingText: `${Math.max(0, Math.round(state.activeLift.cfg.duration * (1 - progress)))} S`,
      state: progress > 0.97 ? 'ARRIVING' : 'IN TRANSIT',
      elevation: VALLEY_ALTITUDE + (pose?.position.y ?? 0),
    };
  }
  if (state.mode !== 'walk') return null;

  if (player.skiing) {
    const piste = alpine.isNearPiste(player.position.x, player.position.z);
    if (piste) {
      const info = pisteProgressInfo(piste);
      return {
        label: 'SKI AREA',
        name: piste.name,
        progress: info.progress,
        remaining: info.remaining,
        remainingText: `${Math.round(info.remaining)} M`,
        state: 'SKIING',
        elevation: VALLEY_ALTITUDE + player.position.y,
      };
    }
    if (weather?.snowAmount > 0.3) {
      return {
        label: 'OFF-PISTE',
        name: 'Belledonne backcountry',
        progress: 0.5,
        remaining: 0,
        remainingText: 'OPEN',
        state: player.skiSpeed > 1 ? 'SKIING' : 'STOPPED',
        elevation: VALLEY_ALTITUDE + player.position.y,
      };
    }
  }

  const trail = nearestTrailInfo();
  if (trail) {
    return {
      label: 'ON TRAIL',
      name: trail.trail.name,
      progress: trail.progress,
      remaining: Math.max(0, Math.round(trail.trail.total - trail.along)),
      remainingText: `${Math.max(0, Math.round(trail.trail.total - trail.along))} M`,
      state: 'HIKING',
      elevation: trail.elevation,
    };
  }
  return null;
}

function clockLabel(minutes) {
  const total = Math.floor(minutes) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildStationInfo() {
  if (!state.ready || !transit || !player || state.mode !== 'walk') return null;
  const near = transit.nearestStop(player.position.x, player.position.z, 95);
  if (!near) return null;
  const board = transit.arrivalsAt(near.stop, 2);
  if (!board) return null;
  return {
    ...board,
    distance: near.distance,
    stopX: near.stop._x,
    stopZ: near.stop._z,
  };
}

function buildOnboardInfo() {
  if (!state.ready || state.mode !== 'tram' || !state.activeTram) return null;
  const tram = state.activeTram;
  return {
    line: tram.line.id,
    lineName: tram.line.name,
    color: tram.line.color,
    destination: tram.destination,
    next: tram.nextStopInfo(),
    upcoming: tram.upcomingStops(4),
    remainingStops: tram.upcomingStops(99).length,
    speedKmh: tram.isStopped ? 0 : tram.speed * 3.6,
  };
}

function buildHudState() {
  const focus = focusPosition();
  const heading = focusHeading();
  const district = districtAt(focus.x, focus.z);
  const altitude = VALLEY_ALTITUDE + focus.y;
  const lat = 45.1885 - focus.z / 111000;
  const lon = 5.7245 + focus.x / 78500;
  const nextReward = DISTANCE_REWARDS[state.rewardCheckpoint] ?? null;
  const previousRewardAt =
    state.rewardCheckpoint > 0 ? DISTANCE_REWARDS[state.rewardCheckpoint - 1].at : 0;
  const rewardProgress = nextReward
    ? clamp(
        (state.totalDistance - previousRewardAt) / Math.max(1, nextReward.at - previousRewardAt),
        0,
        1
      )
    : 1;
  const rewards = {
    points: Math.round(state.rewardPoints),
    distance: state.totalDistance,
    rank: EXPLORER_RANKS[state.explorerRank]?.name ?? EXPLORER_RANKS[0].name,
    next: nextReward,
    progress: rewardProgress,
  };

  let modeLabel = 'ON FOOT';
  let modeMeta = district;
  let speedKmh = player ? Math.abs(player.speed) * 3.6 : 0;
  let speedFraction = speedKmh / 34;
  let gear = '—';
  let speedHint = 'WASD MOVE · SHIFT RUN · E ENTER';
  let prompt = state.interaction
    ? { key: state.interaction.key, text: state.interaction.text }
    : null;

  if (state.mode === 'walk') {
    if (player.skiing) {
      modeLabel = 'SKIS';
      modeMeta = alpine.isNearPiste(player.position.x, player.position.z) ? 'PISTE' : 'OFF-PISTE';
      speedKmh = player.skiSpeed * 3.6;
      speedFraction = speedKmh / 128;
      gear = 'SKI';
      speedHint = 'A/D CARVE · W TUCK · SPACE BRAKE · R WALK';
    } else {
      speedKmh = Math.abs(player.speed) * 3.6;
      speedFraction = speedKmh / 34;
      speedHint = weather?.snowAmount > 0.3
        ? 'WASD MOVE · E ENTER · R SKIS'
        : 'WASD MOVE · SHIFT RUN · E ENTER';
    }
  } else if (state.mode === 'vehicle' && state.activeVehicle) {
    const v = state.activeVehicle;
    modeLabel = v.spec.label;
    modeMeta = v.spec.name.toUpperCase();
    speedKmh = v.speedKmh;
    speedFraction = speedKmh / (v.spec.maxSpeed * 3.6);
    gear = v.speed < -0.2 ? 'R' : v.type === 'bike' || v.type === 'scooter' ? '—' : `D${Math.min(6, 1 + Math.floor(speedFraction * 5))}`;
    speedHint = 'W/S THROTTLE · A/D STEER · SPACE BRAKE · E EXIT';
  } else if (state.mode === 'tram' && state.activeTram) {
    const tram = state.activeTram;
    modeLabel = `TRAM ${tram.line.id}`;
    modeMeta = `${tram.line.name.toUpperCase()} · ${tram.line.stops[tram.dir > 0 ? tram.line.stops.length - 1 : 0].name.toUpperCase()}`;
    speedKmh = tram.isStopped ? 0 : tram.speed * 3.6;
    speedFraction = tram.isStopped ? 0 : 0.8;
    gear = 'TAG';
    const tramStop = tram.currentStop();
    speedHint =
      tram.isStopped && tramStop
        ? 'DOORS OPEN · E TO GET OFF · MOUSE LOOK'
        : 'E AT THE NEXT PLATFORM · MOUSE LOOK';
  } else if (state.mode === 'lift' && state.activeLift) {
    const lift = state.activeLift;
    const pose = lift.getRidePose();
    modeLabel = lift.cfg.short;
    modeMeta = lift.cfg.name.toUpperCase();
    speedKmh = 18;
    speedFraction = pose?.progress ?? 0;
    gear = 'CAB';
    speedHint = 'ENJOY THE VIEW · MOUSE TO LOOK AROUND';
  }

  return {
    x: focus.x,
    z: focus.z,
    heading,
    district,
    lat,
    lon,
    altitude,
    clock: clockLabel(state.clockMinutes),
    modeLabel,
    modeMeta,
    speedKmh,
    speedFraction,
    gear,
    speedHint,
    prompt,
    station: buildStationInfo(),
    onboard: buildOnboardInfo(),
    telemetry: buildTelemetry(),
    rewards,
  };
}

/* ──────────────────────────────────────────────────────────────
   Distance rewards
   ────────────────────────────────────────────────────────────── */
function resetTravelTracker() {
  const focus = focusPosition();
  state.travelX = focus.x;
  state.travelZ = focus.z;
}

function formatDistance(meters) {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} KM`;
  }
  return `${Math.round(meters)} M`;
}

function updateTravelRewards() {
  if (!state.ready || !state.started || !player) return;
  const focus = focusPosition();
  const moved = Math.hypot(focus.x - state.travelX, focus.z - state.travelZ);
  state.travelX = focus.x;
  state.travelZ = focus.z;
  // Ignore sub-millimetre jitter and teleports / respawn jumps.
  if (!Number.isFinite(moved) || moved <= 0.002 || moved > 60) return;

  state.totalDistance += moved;
  state.rewardPoints += moved;

  while (
    state.rewardCheckpoint < DISTANCE_REWARDS.length &&
    state.totalDistance >= DISTANCE_REWARDS[state.rewardCheckpoint].at
  ) {
    const milestone = DISTANCE_REWARDS[state.rewardCheckpoint];
    state.rewardCheckpoint++;
    state.rewardPoints += milestone.bonus;
    hud?.toast(
      `${formatDistance(milestone.at)} covered — distance bonus +${milestone.bonus} points.`,
      'REWARD'
    );
  }

  let rank = state.explorerRank;
  for (let i = 0; i < EXPLORER_RANKS.length; i++) {
    if (state.totalDistance >= EXPLORER_RANKS[i].at) rank = i;
  }
  if (rank > state.explorerRank) {
    state.explorerRank = rank;
    hud?.toast(`New explorer rank — ${EXPLORER_RANKS[rank].name}.`, 'RANK UP');
  }
}

/* ──────────────────────────────────────────────────────────────
   Missions & trail progress
   ────────────────────────────────────────────────────────────── */
function updateProgression(dt) {
  if (!player || !alpine) return;
  const x = player.position.x;
  const z = player.position.z;
  const moved = Math.hypot(x - state.lastX, z - state.lastZ);
  state.lastX = x;
  state.lastZ = z;

  if (state.mode === 'walk' && !player.skiing) {
    const trail = alpine.findTrailAt(x, z);
    if (trail) {
      state.hikeMeters += Math.min(moved, 6);
      if (state.hikeMeters >= 150) hud?.setMissionDone('hike');
    }
  }

  if (state.mode === 'walk' && player.skiing && weather?.snowAmount > 0.45) {
    const onPiste = alpine.isNearPiste(x, z);
    const atChamrousse = x > 2360 && z > 1660;
    if (onPiste || atChamrousse) {
      state.skiMeters += player.skiSpeed * dt;
      if (state.skiMeters >= 120) hud?.setMissionDone('snow');
    }
  }

  if (state.mode === 'walk' && Math.hypot(x + 760, z + 2000) < 115) {
    hud?.setMissionDone('summit');
  }

  skiHintCooldown = Math.max(0, skiHintCooldown - dt);
}

/* ──────────────────────────────────────────────────────────────
   Camera
   ────────────────────────────────────────────────────────────── */
function cameraDistanceClearance(target, yaw, pitch, distance) {
  const samples = 9;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const horizontal = Math.cos(pitch) * distance * t;
    const cx = target.x - Math.sin(yaw) * horizontal;
    const cz = target.z - Math.cos(yaw) * horizontal;
    const cy = target.y + Math.sin(pitch) * distance * t;
    if (cy < groundHeightAt(cx, cz) + 0.55) {
      return Math.max(1.9, distance * t - 0.8);
    }
    const push = colliders.resolveCircle(
      cx,
      cz,
      0.38,
      (box) => box.type !== 'parked' && box.type !== 'parapet'
    );
    if (push.hit) {
      return Math.max(1.9, distance * t - 0.9);
    }
  }
  return distance;
}

function placeCamera(target, distance, pitch, yaw) {
  const clear = cameraDistanceClearance(target, yaw, pitch, distance);
  const horizontal = Math.cos(pitch) * clear;
  const x = target.x - Math.sin(yaw) * horizontal;
  const z = target.z - Math.cos(yaw) * horizontal;
  let y = target.y + Math.sin(pitch) * clear;
  const ground = groundHeightAt(x, z) + 0.65;
  if (y < ground) y = ground;
  camera.position.set(x, y, z);
  camera.lookAt(target.x, target.y + 0.18, target.z);
}

function updateGameCamera(dt) {
  if (!player) return;
  let target = new THREE.Vector3();

  if (state.mode === 'walk') {
    target.copy(player.position);
    target.y += player.skiing ? 1.05 : 1.48;
    if (player.skiing) {
      state.camYaw = dampAngle(state.camYaw, player.heading, 2.5, dt);
    }
    placeCamera(target, state.camDist, state.camPitch, state.camYaw);
  } else if (state.mode === 'vehicle' && state.activeVehicle) {
    const v = state.activeVehicle;
    target.copy(v.position);
    target.y +=
      v.type === 'bus'
        ? 3.25
        : v.type === 'truck'
          ? 2.7
          : v.type === 'van'
            ? 2.15
            : v.type === 'car' || v.type === 'taxi'
              ? 1.3
              : 1.15;
    if (Math.abs(v.speed) > 1.6 && state.time - state.lastMouseLook > 0.75) {
      state.camYaw = dampAngle(state.camYaw, v.heading, 2.1, dt);
    }
    placeCamera(target, state.camDist, state.camPitch, state.camYaw);
  } else if (state.mode === 'tram' && state.activeTram) {
    const tram = state.activeTram;
    const eye = TRAM_EYE_LOCAL.clone().applyAxisAngle(Y_AXIS, tram.heading).add(tram.position);
    camera.position.copy(eye);
    if (state.time - state.lastMouseLook > 1.8) {
      state.camYaw = dampAngle(state.camYaw, tram.heading, 1.35, dt);
    }
    const pitch = clamp(state.camPitch, -0.45, 0.62);
    const reach = 30;
    const horizontal = Math.cos(pitch) * reach;
    camera.lookAt(
      eye.x + Math.sin(state.camYaw) * horizontal,
      eye.y - Math.sin(pitch) * reach,
      eye.z + Math.cos(state.camYaw) * horizontal
    );
  } else if (state.mode === 'lift' && state.activeLift) {
    const pose = state.activeLift.getRidePose();
    if (pose) {
      camera.position.set(pose.position.x, pose.position.y + 1.15, pose.position.z);
      const look = pose.target;
      camera.lookAt(look.x, look.y + 1.0, look.z);
    }
  }

  const speedFrac =
    state.mode === 'vehicle'
      ? clamp(state.activeVehicle?.speedKmh / (state.activeVehicle?.spec.maxSpeed * 3.6 || 1), 0, 1)
      : state.mode === 'walk' && player.skiing
        ? clamp(player.skiSpeed / 35, 0, 1)
        : 0;
  const targetFov =
    state.mode === 'tram'
      ? 68
      : state.mode === 'walk' && !player.skiing
        ? 61
        : 62 + speedFrac * 9;
  const nextFov = damp(camera.fov, targetFov, 2.2, dt);
  if (Math.abs(nextFov - camera.fov) > 0.001) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
}

function updateIntroCamera(dt) {
  const t = state.time * 0.045;
  const radius = 2800;
  const x = Math.cos(t) * radius + 150;
  const z = Math.sin(t) * radius + 350;
  const y = 620 + Math.sin(t * 1.7) * 65;
  camera.position.lerp(new THREE.Vector3(x, y, z), 1 - Math.exp(-1.1 * dt));
  camera.lookAt(0, 140, -180);
}

/* ──────────────────────────────────────────────────────────────
   Simulation
   ────────────────────────────────────────────────────────────── */
function resolvePlayerAgainstVehicles() {
  if (!player) return;
  for (const vehicle of vehicles) {
    if (vehicle.driver) continue;
    const dx = player.position.x - vehicle.position.x;
    const dz = player.position.z - vehicle.position.z;
    const min = player.radius + vehicle.spec.radius * 0.9;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1e-6 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = (min - d) / d;
      player.position.x += dx * push;
      player.position.z += dz * push;
      player.model.position.copy(player.position);
    }
  }
  // trams are 22 m long: collide with the nearest point on the tram's spine
  const tramHit = transit.nearestTram(player.position.x, player.position.z, 15);
  if (tramHit) {
    const tram = tramHit.tram;
    const fx = Math.sin(tram.heading);
    const fz = Math.cos(tram.heading);
    const along = clamp(
      (player.position.x - tram.position.x) * fx + (player.position.z - tram.position.z) * fz,
      -11.5,
      11.5
    );
    const nx = tram.position.x + fx * along;
    const nz = tram.position.z + fz * along;
    const dx = player.position.x - nx;
    const dz = player.position.z - nz;
    const min = 2.1;
    const d = Math.hypot(dx, dz) || 0.001;
    if (d < min) {
      player.position.x += (dx / d) * (min - d);
      player.position.z += (dz / d) * (min - d);
      player.model.position.copy(player.position);
    }
  }
}

function updateGame(dt) {
  if (!state.ready) return;
  state.clockMinutes = (state.clockMinutes + dt / 60) % (24 * 60);
  state.interaction = currentInteraction();

  if (state.mode === 'walk') {
    const input = inputAxis();
    input.jump = jumpQueued;
    if (!player.skiing) input.brake = false;
    player.update(dt, input, state.camYaw, colliders, {
      snow: weather?.snowAmount ?? 0,
      rain: weather?.rainAmount ?? 0,
    });
    resolvePlayerAgainstVehicles();
    traffic?.resolvePlayer(player);
    updateProgression(dt);
  } else if (state.mode === 'vehicle' && state.activeVehicle) {
    const input = inputAxis();
    state.activeVehicle.update(dt, input, colliders, {
      snow: weather?.snowAmount ?? 0,
      rain: weather?.rainAmount ?? 0,
    });
    traffic?.resolveVehicle(state.activeVehicle);
    updateProgression(dt);
  } else if (state.mode === 'tram' && state.activeTram) {
    updateProgression(dt);
  } else if (state.mode === 'lift' && state.activeLift) {
    if (state.activeLift.rideComplete) {
      state.liftTimer += dt;
      if (state.liftTimer > 0.9) finishLift();
    }
  }

  jumpQueued = false;

  // skis are only meaningful while snow lies on the ground
  if (player?.skiing && weather && weather.snowAmount < 0.08) {
    player.setSkiing(false);
    state.skiMeters = 0;
    hud?.toast('The snow has gone — skis off.', 'SKIS');
  }

  updateTravelRewards();
  updateGameCamera(dt);
}

/* ──────────────────────────────────────────────────────────────
   Intro / start flow
   ────────────────────────────────────────────────────────────── */
function snapCameraToPlayer() {
  if (!player) return;
  state.camYaw = player.heading;
  state.camPitch = 0.28;
  state.camDist = 8;
  camera.fov = 61;
  camera.updateProjectionMatrix();
  const target = new THREE.Vector3(player.position.x, player.position.y + 1.48, player.position.z);
  placeCamera(target, state.camDist, state.camPitch, state.camYaw);
}

function startGame(fromQuery = false) {
  if (state.started || !state.ready) return;
  state.started = true;
  $('intro')?.classList.add('hidden');
  hud.show();
  hud.setWeather(weather.info, state.weatherMode);
  hud.setDistrict(districtAt(player.position.x, player.position.z));
  hud.setLockHint(!fromQuery);
  resetTravelTracker();
  snapCameraToPlayer();
  requestLock();
  hud.toast('Bienvenue à Grenoble. The city and the massifs are yours.', 'ALPES DRIVE');
  setTimeout(() => {
    hud.toast('Follow the checklist. H opens the field manual.', 'TIP');
  }, 2200);
  setTimeout(() => {
    if (state.started && state.mode === 'walk' && !state.activeVehicle) {
      hud.toast('Your C3 Alpine is parked just ahead on Place Grenette. Walk up and press E to drive.', 'DRIVE');
    }
  }, 4700);
  if (fromQuery) hud.setLockHint(true);
}

/* ──────────────────────────────────────────────────────────────
   Build the world
   ────────────────────────────────────────────────────────────── */
async function buildWorld() {
  await Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  setLoad(4, 'Surveying the Isère valley…');
  await nextFrame();

  terrain = await (async () => {
    setLoad(10, 'Carving the Chartreuse, Vercors and Belledonne…');
    await nextFrame();
    const result = buildTerrain(scene);
    await nextFrame();
    return result;
  })();

  city = await (async () => {
    setLoad(30, 'Laying Grenoble streets and façades…');
    await nextFrame();
    const result = buildCity(scene, colliders);
    await nextFrame();
    return result;
  })();

  nature = await (async () => {
    setLoad(55, 'Planting the forests and scattering boulders…');
    await nextFrame();
    const result = buildNature(scene);
    await nextFrame();
    return result;
  })();

  alpine = await (async () => {
    setLoad(70, 'Painting trails, pistes and the Fort de la Bastille…');
    await nextFrame();
    const result = buildAlpine(scene, colliders);
    await nextFrame();
    return result;
  })();

  transit = await (async () => {
    setLoad(82, 'Rigging five tram lines and two aerial lifts…');
    await nextFrame();
    const result = buildTransit(scene, colliders);
    await nextFrame();
    return result;
  })();

  vehicles = await (async () => {
    setLoad(90, 'Parking bicycles, scooters, motorcycles, taxis, cars, vans and buses…');
    await nextFrame();
    const result = buildVehicles(scene, colliders);
    await nextFrame();
    return result;
  })();

  traffic = await (async () => {
    setLoad(94, 'Releasing taxis, vans and TAG buses into live traffic…');
    await nextFrame();
    const result = buildTraffic(scene);
    await nextFrame();
    return result;
  })();

  setLoad(96, 'Building the player and the weather…');
  await nextFrame();

  player = new Player(scene, SPAWN.x, SPAWN.z, SPAWN.heading);
  player.model.visible = true;
  weather = new WeatherSystem(scene, renderer, terrain, alpine, city);

  for (const piste of alpine.pistes) {
    let total = 0;
    for (let i = 1; i < piste.pts.length; i++) total += piste.pts[i].distanceTo(piste.pts[i - 1]);
    pisteLengths.set(piste.id, total);
  }

  hud = new HUD({
    onWeather: (mode) => setWeather(mode),
    onHelp: (open) => {
      state.helpOpen = open;
      if (open) {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        keys.clear();
        hud.setLockHint(false);
      } else {
        hud.setLockHint(state.started && !document.pointerLockElement && !state.mapOpen);
      }
    },
    onMap: (open) => {
      state.mapOpen = open;
      if (open) {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        keys.clear();
        hud.setLockHint(false);
      } else {
        hud.setLockHint(state.started && !document.pointerLockElement && !state.helpOpen);
      }
    },
  });
  hud.setWeather(weather.info, 'sunny');

  world = { terrain, city, nature, alpine, transit, vehicles, traffic, player, weather, hud, colliders };
  state.ready = true;
  state.lastX = player.position.x;
  state.lastZ = player.position.z;
  state.weatherMode = 'sunny';

  setLoad(100, 'Grenoble is ready.');
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 350));
  clearInterval(tipTimer);

  $('loading')?.classList.add('fade-out');
  await new Promise((resolve) => setTimeout(resolve, 850));
  $('loading')?.classList.add('hidden');

  const params = new URLSearchParams(window.location.search);
  if (params.has('skipintro')) {
    startGame(true);
  } else {
    $('intro')?.classList.remove('hidden');
  }

  window.__grenoble = {
    state,
    world,
    scene,
    camera,
    renderer,
    player,
    vehicles,
    traffic,
    transit,
    alpine,
    weather,
    hud,
    colliders,
    start: () => startGame(true),
    setWeather,
    step: (dt = 1 / 60, frames = 1) => {
      const count = Math.max(1, Math.min(2000, Math.floor(frames)));
      const delta = clamp(dt, 0.0005, 0.05);
      for (let i = 0; i < count; i++) {
        state.time += delta;
        transit.update(delta);
        traffic?.update(delta, state.started && state.mode !== 'lift' ? trafficFocus() : null, weather?.snowAmount ?? 0);
        city.update(delta);
        alpine.update(delta);
        terrain.water?.userData?.update?.(delta, camera);
        if (!state.started) {
          updateIntroCamera(delta);
          weather.update(delta, camera, player.position, { x: 0, z: 0 });
        } else {
          updateGame(delta);
          const focus = focusPosition();
          weather.update(delta, camera, player.position, { x: focus.x, z: focus.z });
          hud.update(delta, buildHudState(), { vehicles, traffic, trams: transit.trams });
        }
      }
      renderer.render(scene, camera);
      return {
        time: state.time,
        mode: state.mode,
        weather: state.weatherMode,
        snow: weather.snowAmount,
        traffic: traffic?.vehicles.length ?? 0,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        interaction: state.interaction?.text ?? null,
      };
    },
    input: (codes, held = true) => {
      const list = Array.isArray(codes) ? codes : [codes];
      for (const code of list) {
        if (held) keys.add(code);
        else keys.delete(code);
      }
      return [...keys];
    },
    release: () => {
      keys.clear();
      return [];
    },
    tap: (code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      keys.delete(code);
      return code;
    },
    interact: () => {
      interact();
      return state.interaction?.text ?? null;
    },
    enterVehicle: (index = 0) => {
      const vehicle = vehicles[Number(index)] || vehicles.find((v) => v.type === index) || vehicles[0];
      if (vehicle) enterVehicle(vehicle);
      return vehicle?.spec?.name ?? null;
    },
    boardTram: (index = 0) => {
      const tram = transit.trams[Number(index)] || transit.trams.find((t) => t.line.id === index) || transit.trams[0];
      if (tram) enterTram(tram, true);
      return tram?.line?.name ?? null;
    },
    stationInfo: () => buildStationInfo(),
    onboardInfo: () => buildOnboardInfo(),
    arrivalsAt: (lineId = 'A', stopIndex = 0) => {
      const stop = transit.stops.filter((s) => s.line === lineId)[Number(stopIndex)] ?? transit.stops[0];
      return transit.arrivalsAt(stop, 3);
    },
    trams: () => transit.trams.map((tram) => ({
      line: tram.line.id,
      dir: tram.dir,
      dist: Math.round(tram.dist),
      wait: Number(tram.wait.toFixed(1)),
      speed: tram.speed,
      x: Math.round(tram.position.x),
      z: Math.round(tram.position.z),
    })),
    rideLift: (id = 'bastille', side = 'lower') => {
      const lift = transit.aerialLifts.find((l) => l.cfg.id === id) || transit.aerialLifts[0];
      if (!lift) return null;
      const station = { ...lift.stations[side], side };
      enterLift(lift, station);
      return `${lift.cfg.id}:${side}`;
    },
    teleport: (x, z) => {
      if (state.mode !== 'walk') {
        if (state.activeVehicle) exitVehicle();
        else if (state.activeTram) exitTram(true);
        else if (state.activeLift) {
          state.activeLift.endRide();
          state.activeLift = null;
          state.mode = 'walk';
          player.setVisible(true);
        }
      }
      player.teleport(x, z);
      state.camYaw = player.heading;
      resetTravelTracker();
      preloadCamera();
    },
    setCamera: (yaw, pitch, dist) => {
      state.camYaw = yaw;
      state.camPitch = pitch ?? state.camPitch;
      state.camDist = dist ?? state.camDist;
      preloadCamera();
    },
    setMode: (mode) => setWeather(mode),
    rewards: () => ({
      points: Math.round(state.rewardPoints),
      distance: state.totalDistance,
      rank: EXPLORER_RANKS[state.explorerRank]?.name ?? EXPLORER_RANKS[0].name,
      next: DISTANCE_REWARDS[state.rewardCheckpoint] ?? null,
    }),
    capture: (name = 'grenoble.jpg', quality = 0.86) => {
      renderer.render(scene, camera);
      const data = renderer.domElement.toDataURL('image/jpeg', quality);
      const link = document.createElement('a');
      link.href = data;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return { name, dataLength: data.length };
    },
  };

  window.addEventListener('resize', onResize);
  setUpPointerLock();
  requestAnimationFrame(frame);
  console.info('[Grenoble] world ready', {
    vehicles: vehicles.length,
    traffic: traffic?.vehicles.length ?? 0,
    trams: transit.trams.length,
    trails: alpine.trails.length,
    pistes: alpine.pistes.length,
    colliders: colliders.boxes.length,
  });
}

function preloadCamera() {
  if (!player) return;
  const target = new THREE.Vector3(player.position.x, player.position.y + 1.48, player.position.z);
  placeCamera(target, state.camDist, state.camPitch, state.camYaw);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ──────────────────────────────────────────────────────────────
   Main loop
   ────────────────────────────────────────────────────────────── */
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, clock.getDelta()));
  state.time += dt;

  if (world) {
    transit.update(dt);
    traffic?.update(dt, state.started && state.mode !== 'lift' ? trafficFocus() : null, weather?.snowAmount ?? 0);
    city.update(dt);
    alpine.update(dt);
    terrain.water?.userData?.update?.(dt, camera);

    if (!state.started) {
      updateIntroCamera(dt);
      weather.update(dt, camera, player.position, { x: 0, z: 0 });
    } else {
      updateGame(dt);
      const focus = focusPosition();
      weather.update(dt, camera, player.position, { x: focus.x, z: focus.z });
      hud.update(dt, buildHudState(), { vehicles, traffic, trams: transit.trams });
    }
  }

  renderer.render(scene, camera);
}

/* ──────────────────────────────────────────────────────────────
   Start
   ────────────────────────────────────────────────────────────── */
$('startBtn')?.addEventListener('click', () => startGame(false));

buildWorld().catch((error) => {
  console.error('[Grenoble] failed to build world', error);
  setLoad(100, `Could not build Grenoble: ${error?.message ?? error}`);
  if (loadStatus) loadStatus.style.color = '#ff5a52';
});
