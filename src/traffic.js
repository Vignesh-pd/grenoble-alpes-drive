import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_X, ROAD_Z, SPAWN, roadWidthX, roadWidthZ } from './data.js';
import { groundHeightAt } from './terrain.js';
import { clamp, mulberry32, makeTextPlane } from './utils.js';

/* ──────────────────────────────────────────────────────────────
   Ambient traffic — light, merged meshes circulating on the grid.
   The city uses 260 m blocks: every edge is a straight, so a small
   directed graph plus right-hand lane offsets is enough.
   ────────────────────────────────────────────────────────────── */

const LANE_FACTOR = 0.235;
const ARRIVE_RADIUS = 11;
const ENTRY_LOOKAHEAD = 18;

const TRAFFIC_SPECS = {
  car: {
    radius: 1.48,
    width: 1.86,
    length: 4.1,
    height: 1.7,
    cruise: [8.4, 12.2],
    accel: 4.6,
    brake: 8.5,
    turnRate: 1.65,
    palette: ['#c7c9c2', '#31506a', '#8f3b32', '#d8b96a', '#45584b', '#e6e3dc', '#20282b', '#6b7b86'],
  },
  taxi: {
    radius: 1.48,
    width: 1.86,
    length: 4.1,
    height: 1.7,
    cruise: [9.2, 13.2],
    accel: 5.2,
    brake: 9.2,
    turnRate: 1.7,
    palette: ['#efe7d3', '#e4dcc7', '#f2ebdb'],
  },
  van: {
    radius: 1.92,
    width: 2.0,
    length: 5.2,
    height: 2.3,
    cruise: [7.4, 10.2],
    accel: 3.9,
    brake: 7.4,
    turnRate: 1.25,
    palette: ['#e9e6da', '#d8d4c7', '#9a3c31', '#3a5f7d', '#d3b265'],
  },
  bus: {
    radius: 3.42,
    width: 2.55,
    length: 11.2,
    height: 3.1,
    cruise: [6.1, 8.1],
    accel: 2.8,
    brake: 5.4,
    turnRate: 0.85,
    palette: ['#f1eee3'],
  },
  truck: {
    radius: 2.32,
    width: 2.4,
    length: 7.2,
    height: 3.4,
    cruise: [6.8, 8.8],
    accel: 3.2,
    brake: 6.2,
    turnRate: 1.0,
    palette: ['#e7e4d8', '#d9d6ca', '#d7d0bf'],
  },
};

/* ── geometry helpers ── */
function box(w, h, d, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

function wheelGeo(radius, width, x, y, z) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 12);
  geo.rotateZ(Math.PI / 2);
  geo.translate(x, y, z);
  return geo;
}

function merge(list) {
  return list.length ? mergeGeometries(list) : null;
}

function carTemplate() {
  const paint = [
    box(1.82, 0.5, 3.98, 0, 0.68, 0),
    box(1.7, 0.2, 1.12, 0, 0.97, 1.3),
    box(1.7, 0.22, 0.82, 0, 0.99, -1.56),
    box(1.56, 0.16, 1.72, 0, 1.62, -0.18),
    box(0.08, 0.48, 0.08, 0.78, 1.32, 0.55),
    box(0.08, 0.48, 0.08, -0.78, 1.32, 0.55),
  ];
  const glass = [box(1.58, 0.55, 1.9, 0, 1.27, -0.16)];
  const dark = [
    box(1.86, 0.16, 3.94, 0, 0.4, 0),
    box(1.88, 0.2, 0.16, 0, 0.56, 2.02),
    box(1.88, 0.2, 0.16, 0, 0.56, -2.02),
    wheelGeo(0.34, 0.22, 0.82, 0.35, 1.28),
    wheelGeo(0.34, 0.22, -0.82, 0.35, 1.28),
    wheelGeo(0.34, 0.22, 0.82, 0.35, -1.28),
    wheelGeo(0.34, 0.22, -0.82, 0.35, -1.28),
  ];
  const head = [
    box(0.34, 0.14, 0.06, 0.58, 0.8, 2.03),
    box(0.34, 0.14, 0.06, -0.58, 0.8, 2.03),
  ];
  const tail = [
    box(0.26, 0.14, 0.06, 0.62, 0.82, -2.02),
    box(0.26, 0.14, 0.06, -0.62, 0.82, -2.02),
  ];
  return { paint, glass, dark, head, tail, accent: [] };
}

function vanTemplate() {
  const paint = [
    box(1.98, 1.72, 3.62, 0, 1.24, -0.62),
    box(1.9, 1.22, 1.55, 0, 1.24, 1.55),
    box(1.86, 0.12, 4.56, 0, 2.18, 0),
    box(1.86, 0.42, 0.7, 0, 0.88, 2.14),
  ];
  const glass = [
    box(1.7, 0.68, 0.07, 0, 1.8, 2.34),
    box(0.07, 0.58, 0.88, 0.97, 1.77, 1.68),
    box(0.07, 0.58, 0.88, -0.97, 1.77, 1.68),
    box(1.68, 0.58, 0.07, 0, 1.87, -2.46),
  ];
  const dark = [
    box(2.0, 0.2, 4.5, 0, 0.38, -0.15),
    box(2.02, 0.22, 0.18, 0, 0.56, 2.54),
    box(2.02, 0.22, 0.18, 0, 0.56, -2.48),
    wheelGeo(0.38, 0.26, 0.9, 0.4, 1.72),
    wheelGeo(0.38, 0.26, -0.9, 0.4, 1.72),
    wheelGeo(0.38, 0.26, 0.9, 0.4, -1.72),
    wheelGeo(0.38, 0.26, -0.9, 0.4, -1.72),
  ];
  const accent = [box(2.0, 0.18, 3.94, 0, 1.02, -0.58)];
  const head = [
    box(0.34, 0.18, 0.06, 0.66, 0.86, 2.56),
    box(0.34, 0.18, 0.06, -0.66, 0.86, 2.56),
  ];
  const tail = [
    box(0.26, 0.2, 0.06, 0.72, 1.0, -2.49),
    box(0.26, 0.2, 0.06, -0.72, 1.0, -2.49),
  ];
  return { paint, glass, dark, head, tail, accent };
}

function busTemplate() {
  const paint = [
    box(2.5, 2.4, 11.0, 0, 1.7, 0),
    box(2.46, 0.14, 10.84, 0, 2.96, 0),
  ];
  const glass = [
    box(0.065, 0.74, 8.9, 1.255, 2.19, -0.32),
    box(0.065, 0.74, 8.9, -1.255, 2.19, -0.32),
    box(0.075, 1.9, 1.18, 1.26, 1.42, 2.5),
    box(0.075, 1.9, 1.18, -1.26, 1.42, 2.5),
    box(2.2, 1.02, 0.08, 0, 2.16, 5.52),
    box(2.06, 0.82, 0.08, 0, 2.18, -5.52),
  ];
  const dark = [
    box(2.54, 0.2, 11.0, 0, 0.36, 0),
    box(2.56, 0.26, 0.2, 0, 0.58, 5.5),
    box(2.56, 0.26, 0.2, 0, 0.58, -5.5),
    box(1.45, 0.38, 0.08, 0, 1.02, -5.56),
    box(1.2, 0.24, 2.4, 0, 3.04, 1.2),
    wheelGeo(0.46, 0.3, 1.05, 0.48, 3.55),
    wheelGeo(0.46, 0.3, -1.05, 0.48, 3.55),
    wheelGeo(0.46, 0.3, 1.05, 0.48, -3.55),
    wheelGeo(0.46, 0.3, -1.05, 0.48, -3.55),
  ];
  const accent = [
    box(2.52, 0.34, 11.02, 0, 0.47, 0),
    box(2.53, 0.08, 11.02, 0, 1.15, 0),
    box(0.085, 1.9, 0.08, 1.265, 1.42, 2.5),
    box(0.085, 1.9, 0.08, -1.265, 1.42, 2.5),
  ];
  const head = [
    box(0.4, 0.22, 0.06, 0.78, 0.88, 5.55),
    box(0.4, 0.22, 0.06, -0.78, 0.88, 5.55),
  ];
  const tail = [
    box(0.32, 0.24, 0.06, 0.82, 1.0, -5.54),
    box(0.32, 0.24, 0.06, -0.82, 1.0, -5.54),
  ];
  return { paint, glass, dark, head, tail, accent };
}

function truckTemplate() {
  const paint = [
    box(2.34, 2.6, 4.6, 0, 2.02, -1.15),
    box(2.18, 1.95, 2.08, 0, 1.58, 2.56),
  ];
  const glass = [
    box(1.95, 0.92, 0.08, 0, 2.08, 3.61),
    box(0.07, 0.78, 1.0, 1.1, 2.02, 2.66),
    box(0.07, 0.78, 1.0, -1.1, 2.02, 2.66),
  ];
  const dark = [
    box(2.36, 0.26, 0.22, 0, 0.5, 3.66),
    box(2.36, 0.26, 0.22, 0, 0.5, -3.45),
    wheelGeo(0.5, 0.3, 0.98, 0.52, 2.55),
    wheelGeo(0.5, 0.3, -0.98, 0.52, 2.55),
    wheelGeo(0.5, 0.3, 0.98, 0.52, -2.45),
    wheelGeo(0.5, 0.3, -0.98, 0.52, -2.45),
  ];
  const accent = [box(2.37, 0.22, 4.62, 0, 1.32, -1.15)];
  const head = [
    box(0.36, 0.2, 0.06, 0.76, 0.86, 3.66),
    box(0.36, 0.2, 0.06, -0.76, 0.86, 3.66),
  ];
  const tail = [
    box(0.28, 0.2, 0.06, 0.86, 1.02, -3.46),
    box(0.28, 0.2, 0.06, -0.86, 1.02, -3.46),
  ];
  return { paint, glass, dark, head, tail, accent };
}

const BUILDERS = {
  car: carTemplate,
  taxi: carTemplate,
  van: vanTemplate,
  bus: busTemplate,
  truck: truckTemplate,
};

const TEMPLATE_CACHE = new Map();
const PAINT_CACHE = new Map();

const GLASS_MAT = new THREE.MeshStandardMaterial({ color: '#1d3139', roughness: 0.08, metalness: 0.6 });
const DARK_MAT = new THREE.MeshStandardMaterial({ color: '#191d1f', roughness: 0.86 });
const HEAD_MAT = new THREE.MeshBasicMaterial({ color: '#fff3ce' });
const TAIL_MAT = new THREE.MeshBasicMaterial({ color: '#b12424' });
const ACCENT_MAT = new THREE.MeshStandardMaterial({ color: '#2f5f80', roughness: 0.42, metalness: 0.2 });

function templateFor(type) {
  if (!TEMPLATE_CACHE.has(type)) {
    const raw = BUILDERS[type]();
    TEMPLATE_CACHE.set(type, {
      paint: merge(raw.paint),
      glass: merge(raw.glass),
      dark: merge(raw.dark),
      head: merge(raw.head),
      tail: merge(raw.tail),
      accent: merge(raw.accent),
    });
  }
  return TEMPLATE_CACHE.get(type);
}

function paintMaterial(color) {
  if (!PAINT_CACHE.has(color)) {
    PAINT_CACHE.set(
      color,
      new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.16 })
    );
  }
  return PAINT_CACHE.get(color);
}

let taxiSignMaterial = null;
let busSignMaterial = null;
let busNumberMaterial = null;

function addSigns(group, type) {
  if (type === 'taxi') {
    if (!taxiSignMaterial) {
      const sign = makeTextPlane('TAXI', {
        width: 256,
        height: 112,
        fontSize: 62,
        accent: '#d3a23f',
        bg: 'rgba(248,241,220,0.98)',
        color: '#20272b',
      });
      taxiSignMaterial = sign.material;
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.24), DARK_MAT);
    base.position.set(0, 1.77, -0.22);
    group.add(base);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.27), taxiSignMaterial);
    sign.position.set(0, 1.93, -0.22);
    group.add(sign);
  } else if (type === 'bus') {
    if (!busSignMaterial) {
      const sign = makeTextPlane('TAG  ·  38  ·  GRENOBLE', {
        width: 1200,
        height: 190,
        fontSize: 86,
        accent: '#145c88',
        bg: 'rgba(14,20,23,0.96)',
        color: '#ffc76b',
      });
      busSignMaterial = sign.material;
    }
    if (!busNumberMaterial) {
      const number = makeTextPlane('38', {
        width: 200,
        height: 180,
        fontSize: 120,
        accent: '#b23c31',
        bg: 'rgba(244,240,228,0.98)',
        color: '#21313a',
      });
      busNumberMaterial = number.material;
    }
    const destination = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.335), busSignMaterial);
    destination.position.set(0, 2.78, 5.57);
    group.add(destination);
    for (const s of [-1, 1]) {
      const number = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.4), busNumberMaterial);
      number.position.set(s * 1.27, 1.7, 2.5);
      number.rotation.y = (s * Math.PI) / 2;
      group.add(number);
    }
  }
}

function makeGroup(type, color) {
  const t = templateFor(type);
  const group = new THREE.Group();
  const body = new THREE.Mesh(t.paint, paintMaterial(color));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const glass = new THREE.Mesh(t.glass, GLASS_MAT);
  group.add(glass);
  const dark = new THREE.Mesh(t.dark, DARK_MAT);
  group.add(dark);
  const head = new THREE.Mesh(t.head, HEAD_MAT);
  group.add(head);
  const tail = new THREE.Mesh(t.tail, TAIL_MAT);
  group.add(tail);
  if (t.accent) group.add(new THREE.Mesh(t.accent, ACCENT_MAT));
  addSigns(group, type);
  return group;
}

/* ── road graph ── */
function buildGraph() {
  const nodeMap = new Map();
  const nodes = [];
  const key = (ix, iz) => `${ix}:${iz}`;
  for (let ix = 0; ix < ROAD_X.length; ix++) {
    for (let iz = 0; iz < ROAD_Z.length; iz++) {
      const node = {
        x: ROAD_X[ix],
        z: ROAD_Z[iz],
        ix,
        iz,
        neighbors: [],
      };
      nodeMap.set(key(ix, iz), node);
      nodes.push(node);
    }
  }

  const edges = [];
  const addEdge = (a, b, horizontal, roadCoord, laneOffset) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const edge = {
      a,
      b,
      horizontal,
      roadCoord,
      laneOffset,
      length,
      fx: (b.x - a.x) / length,
      fz: (b.z - a.z) / length,
    };
    edges.push(edge);
    a.neighbors.push(edge);
  };

  for (const node of nodes) {
    if (node.ix + 1 < ROAD_X.length) {
      const b = nodeMap.get(key(node.ix + 1, node.iz));
      const width = roadWidthZ(node.z);
      const lane = width * LANE_FACTOR;
      addEdge(node, b, true, node.z, lane);
      addEdge(b, node, true, node.z, -lane);
    }
    if (node.iz + 1 < ROAD_Z.length) {
      const b = nodeMap.get(key(node.ix, node.iz + 1));
      const width = roadWidthX(node.x);
      const lane = width * LANE_FACTOR;
      addEdge(node, b, false, node.x, -lane);
      addEdge(b, node, false, node.x, lane);
    }
  }
  return { nodes, edges };
}

function pointOnEdge(edge, distance) {
  const t = clamp(distance / edge.length, 0, 1);
  const x = edge.a.x + (edge.b.x - edge.a.x) * t;
  const z = edge.a.z + (edge.b.z - edge.a.z) * t;
  if (edge.horizontal) return { x, z: edge.roadCoord + edge.laneOffset };
  return { x: edge.roadCoord + edge.laneOffset, z };
}

function angleDelta(target, current) {
  return ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/* ── traffic vehicle ── */
class TrafficVehicle {
  constructor(system, type, edge, distance, color, id) {
    this.id = id;
    this.system = system;
    this.type = type;
    this.spec = TRAFFIC_SPECS[type];
    this.edge = edge;
    this.leg = 'exit';
    this.target = pointOnEdge(edge, edge.length);
    const start = pointOnEdge(edge, distance);
    this.position = new THREE.Vector3(start.x, groundHeightAt(start.x, start.z) + 0.02, start.z);
    this.heading = Math.atan2(edge.fx, edge.fz);
    this.speed = 0;
    this.cruise = this.spec.cruise[0] + system.rng() * (this.spec.cruise[1] - this.spec.cruise[0]);
    this.blocked = 0;
    this.group = makeGroup(type, color);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;
    system.scene.add(this.group);
  }

  chooseEdge() {
    const old = this.edge;
    let candidates = old.b.neighbors.filter((edge) => edge.b !== old.a);
    if (!candidates.length) candidates = old.b.neighbors;
    if (!candidates.length) return old;
    let total = 0;
    const weighted = candidates.map((edge) => {
      const dot = old.fx * edge.fx + old.fz * edge.fz;
      const weight = dot > 0.85 ? 3.4 : dot > -0.1 ? 1.35 : 0.55;
      total += weight;
      return { edge, weight };
    });
    let pick = this.system.rng() * total;
    for (const item of weighted) {
      pick -= item.weight;
      if (pick <= 0) return item.edge;
    }
    return weighted[weighted.length - 1].edge;
  }

  advanceLeg() {
    if (this.leg === 'entry') {
      this.leg = 'exit';
      this.target = pointOnEdge(this.edge, this.edge.length);
      return;
    }
    const next = this.chooseEdge();
    this.edge = next;
    this.leg = 'entry';
    this.target = pointOnEdge(next, Math.min(ENTRY_LOOKAHEAD, next.length * 0.4));
  }

  blockingAhead(target, radius, forwardX, forwardZ, gap, sideAllowance = 0.45) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const ahead = dx * forwardX + dz * forwardZ;
    const lateral = Math.abs(-dx * forwardZ + dz * forwardX);
    return ahead > 1.2 && ahead < gap && lateral < radius + this.spec.width * 0.5 + sideAllowance;
  }

  update(dt, focus, allVehicles, snow) {
    const spec = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let targetSpeed = this.cruise * (1 - snow * 0.28);

    const toNodeX = this.edge.b.x - this.position.x;
    const toNodeZ = this.edge.b.z - this.position.z;
    if (Math.hypot(toNodeX, toNodeZ) < 42) targetSpeed = Math.min(targetSpeed, spec.cruise[0] * 0.62);

    this.blocked = Math.max(0, this.blocked - dt);
    if (focus) {
      const gap = 12 + Math.abs(this.speed) * 1.45;
      if (this.blockingAhead(focus, focus.radius ?? 0.6, fx, fz, gap, 0.7)) {
        targetSpeed = 0;
        this.blocked = 0.35;
      }
    }

    for (const other of allVehicles) {
      if (other === this) continue;
      const dot = fx * Math.sin(other.heading) + fz * Math.cos(other.heading);
      if (dot < 0.72) continue;
      const gap = 7 + Math.abs(this.speed) * 0.85 + other.spec.length * 0.5;
      if (this.blockingAhead(other.position, other.spec.radius, fx, fz, gap, 0.25)) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed * 0.8));
        if (targetSpeed < 0.4) targetSpeed = 0;
        break;
      }
    }

    const dx = this.target.x - this.position.x;
    const dz = this.target.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const desiredHeading = Math.atan2(dx, dz);
    const delta = angleDelta(desiredHeading, this.heading);
    if (Math.abs(delta) > 0.36) targetSpeed = Math.min(targetSpeed, Math.abs(delta) > 1.0 ? 2.6 : 4.2);

    if (distance < ARRIVE_RADIUS) this.advanceLeg();

    const rate = targetSpeed > this.speed ? spec.accel : spec.brake;
    this.speed += clamp(targetSpeed - this.speed, -rate * dt, rate * dt);
    if (this.speed < 0) this.speed = 0;

    const turn = spec.turnRate * (0.55 + 0.45 * clamp(this.speed / 6, 0, 1));
    this.heading += clamp(delta, -turn * dt, turn * dt);

    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    this.position.y = groundHeightAt(this.position.x, this.position.z) + 0.02;

    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;
  }
}

/* ── system ── */
export class TrafficSystem {
  constructor(scene, { count = 40, seed = 20261021 } = {}) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.graph = buildGraph();
    this.vehicles = [];
    this.spawn(count);
  }

  spawn(count) {
    const plan = [
      'car', 'taxi', 'car', 'van', 'bus', 'car', 'car', 'taxi', 'van', 'car',
      'car', 'bus', 'taxi', 'car', 'van', 'car', 'car', 'bus', 'taxi', 'van',
      'car', 'truck', 'car', 'car', 'taxi', 'van', 'car', 'truck', 'car', 'car',
    ];
    const nearEdges = this.graph.edges.filter((edge) => {
      const mx = (edge.a.x + edge.b.x) * 0.5;
      const mz = (edge.a.z + edge.b.z) * 0.5;
      return Math.hypot(mx - SPAWN.x, mz - SPAWN.z) < 1150;
    });
    const allEdges = this.graph.edges;

    for (let i = 0; i < count; i++) {
      const type = plan[i % plan.length];
      let placed = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const pool = i < 24 ? nearEdges : allEdges;
        const edge = pool[Math.floor(this.rng() * pool.length)];
        const distance = edge.length * (0.14 + this.rng() * 0.72);
        const point = pointOnEdge(edge, distance);
        let clear = true;
        for (const other of this.vehicles) {
          if (Math.hypot(point.x - other.position.x, point.z - other.position.z) < 34) {
            clear = false;
            break;
          }
        }
        if (clear) {
          placed = { edge, distance, point };
          break;
        }
      }
      if (!placed) continue;
      const spec = TRAFFIC_SPECS[type];
      const color = spec.palette[Math.floor(this.rng() * spec.palette.length)];
      this.vehicles.push(new TrafficVehicle(this, type, placed.edge, placed.distance, color, i));
    }
  }

  update(dt, focus, snow = 0) {
    for (const vehicle of this.vehicles) {
      vehicle.update(dt, focus, this.vehicles, snow);
    }
  }

  resolvePlayer(player) {
    if (!player) return;
    for (const vehicle of this.vehicles) {
      const dx = player.position.x - vehicle.position.x;
      const dz = player.position.z - vehicle.position.z;
      const min = player.radius + vehicle.spec.radius * 0.82;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        player.position.x += dx * push;
        player.position.z += dz * push;
        player.model.position.copy(player.position);
      }
    }
  }

  resolveVehicle(vehicle) {
    if (!vehicle) return;
    for (const other of this.vehicles) {
      const dx = vehicle.position.x - other.position.x;
      const dz = vehicle.position.z - other.position.z;
      const min = (vehicle.spec.radius + other.spec.radius) * 0.88 + 0.2;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        vehicle.position.x += dx * push;
        vehicle.position.z += dz * push;
        vehicle.position.y = groundHeightAt(vehicle.position.x, vehicle.position.z);
        vehicle.speed *= 0.24;
        vehicle.collisionPulse = 0.5;
        vehicle.group.position.copy(vehicle.position);
        vehicle.group.position.y += vehicle.spec.lift;
      }
    }
  }
}

export function buildTraffic(scene) {
  return new TrafficSystem(scene, { count: 40 });
}
