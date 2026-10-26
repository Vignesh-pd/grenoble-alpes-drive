import * as THREE from 'three';
import { TRAM_LINES, AERIAL_LIFTS, CITY, bridgeLift } from './data.js';
import { heightAt } from './terrain.js';
import {
  canvasTexture,
  makeTextPlane,
  clamp,
  lerp,
  mulberry32,
  setShadowRecursive,
} from './utils.js';

const TRACK_OFFSET = 3.7;
const WIRE_HEIGHT = 6.2;

function addBox(scene, material, x, y, z, w, h, d, ry = 0, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function lineBadgeTexture(line) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f3f1e9';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = line.color;
    ctx.fillRect(0, h - 22, w, 22);
    ctx.fillStyle = '#182024';
    ctx.font = '800 86px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line.id, w / 2, h / 2 - 8);
  });
}

/* ──────────────────────────────────────────────────────────────
   Tram builder
   ────────────────────────────────────────────────────────────── */
export function buildTransit(scene, colliders) {
  const trams = [];
  const stops = [];
  const animated = [];
  const railTransforms = [];
  const wirePositions = [];
  const polePositions = [];
  const platformTransforms = [];
  const signInstancesByLine = new Map();

  const steel = new THREE.MeshStandardMaterial({
    color: '#9aa0a1',
    roughness: 0.32,
    metalness: 0.82,
  });
  const trackBedMat = new THREE.MeshStandardMaterial({
    color: '#35393b',
    roughness: 0.94,
    side: THREE.DoubleSide,
  });
  const concrete = new THREE.MeshStandardMaterial({ color: '#b4b0a4', roughness: 0.92 });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#363d3f', roughness: 0.5, metalness: 0.5 });

  for (const line of TRAM_LINES) {
    const lineX = line.offset?.[0] ?? 0;
    const lineZ = line.offset?.[1] ?? 0;
    const centerCurve = new THREE.CatmullRomCurve3(
      line.route.map(([x, z]) => new THREE.Vector3(x + lineX, 0.2, z + lineZ)),
      false,
      'centripetal'
    );
    const length = centerCurve.getLength();
    const N = Math.max(40, Math.round(length / 5));
    const centerPts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      centerPts.push(centerCurve.getPointAt(t));
    }

    // stop distance along the line
    for (const stop of line.stops) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < centerPts.length; i++) {
        const dx = centerPts[i].x - stop.x;
        const dz = centerPts[i].z - stop.z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      const t = best / N;
      const ref = centerPts[best];
      const tan = centerCurve.getTangentAt(t);
      stop._t = t;
      stop._dist = t * length;
      stop._x = ref.x;
      stop._z = ref.z;
      stop._nx = -tan.z;
      stop._nz = tan.x;
      stop.line = line.id;
      stop.lineName = line.name;
      stop.color = line.color;
      stop.schedule = line.schedule ?? null;
      stops.push(stop);

      // platforms, both sides
      for (const side of [-1, 1]) {
        const px = ref.x + stop._nx * side * 9.4;
        const pz = ref.z + stop._nz * side * 9.4;
        const m = new THREE.Matrix4();
        m.compose(
          new THREE.Vector3(px, 0.11, pz),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tan.x, tan.z)),
          new THREE.Vector3(3.4, 0.22, 16)
        );
        platformTransforms.push(m);

        // sign pole on the outer side
        const ox = ref.x + stop._nx * side * 12.2;
        const oz = ref.z + stop._nz * side * 12.2;
        polePositions.push({ x: ox, z: oz, h: 3.6, r: 0.07, y: 0, sign: true });
        const arr = signInstancesByLine.get(line.id) || [];
        arr.push({
          x: ox,
          z: oz,
          y: 3.55,
          ry: Math.atan2(-stop._nx * side, -stop._nz * side),
        });
        signInstancesByLine.set(line.id, arr);
      }
    }

    // lanes (one per direction)
    for (const dir of [1, -1]) {
      const lanePts = [];
      const offset = TRACK_OFFSET * dir;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = centerCurve.getPointAt(t);
        const tan = centerCurve.getTangentAt(t);
        const nx = -tan.z;
        const nz = tan.x;
        const wx = p.x + nx * offset;
        const wz = p.z + nz * offset;
        lanePts.push(new THREE.Vector3(wx, 0.18 + bridgeLift(wx, wz), wz));
      }

      // rails
      for (let i = 0; i < lanePts.length - 1; i++) {
        const a = lanePts[i];
        const b = lanePts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.01) continue;
        const angle = Math.atan2(dx, dz);
        const nx = -dz / segLen;
        const nz = dx / segLen;
        for (const railOff of [-0.72, 0.72]) {
          const m = new THREE.Matrix4();
          m.compose(
            new THREE.Vector3(
              (a.x + b.x) / 2 + nx * railOff,
              (a.y + b.y) / 2 - 0.03,
              (a.z + b.z) / 2 + nz * railOff
            ),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
            new THREE.Vector3(1, 1, segLen + 0.08)
          );
          railTransforms.push(m);
        }
      }

      // track bed ribbon, with solid skirts on bridge approaches
      const bedGeo = (() => {
        const positions = [];
        const indices = [];
        const uvs = [];
        for (let i = 0; i < lanePts.length; i++) {
          const p = lanePts[i];
          const next = lanePts[Math.min(lanePts.length - 1, i + 1)];
          const prev = lanePts[Math.max(0, i - 1)];
          let dx = next.x - prev.x;
          let dz = next.z - prev.z;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          const nx = -dz;
          const nz = dx;
          const hw = 1.55;
          const topY = p.y - 0.09;
          positions.push(p.x + nx * hw, topY, p.z + nz * hw);
          positions.push(p.x - nx * hw, topY, p.z - nz * hw);
          positions.push(p.x + nx * hw, 0.02, p.z + nz * hw);
          positions.push(p.x - nx * hw, 0.02, p.z - nz * hw);
          uvs.push(0, i * 0.1, 1, i * 0.1, 0, i * 0.1, 1, i * 0.1);
          if (i < lanePts.length - 1) {
            const a = i * 4;
            indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
            indices.push(a, a + 2, a + 4, a + 4, a + 2, a + 6);
            indices.push(a + 1, a + 5, a + 3, a + 3, a + 5, a + 7);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(indices);
        g.computeVertexNormals();
        return g;
      })();
      const bed = new THREE.Mesh(bedGeo, trackBedMat);
      bed.receiveShadow = true;
      scene.add(bed);

      // overhead wire
      for (let i = 0; i < lanePts.length - 2; i += 2) {
        const a = lanePts[i];
        const b = lanePts[Math.min(lanePts.length - 1, i + 2)];
        wirePositions.push(
          a.x, a.y + WIRE_HEIGHT - 0.18, a.z,
          b.x, b.y + WIRE_HEIGHT - 0.18, b.z
        );
      }

      // catenary poles every ~55 m on the outward side
      for (let i = 8; i < lanePts.length - 8; i += 11) {
        const p = lanePts[i];
        const a = lanePts[i - 1];
        const b = lanePts[i + 1];
        const angle = Math.atan2(b.x - a.x, b.z - a.z);
        const nx = -Math.cos(angle);
        const nz = Math.sin(angle);
        const ox = p.x + nx * 8.4;
        const oz = p.z + nz * 8.4;
        polePositions.push({ x: ox, z: oz, h: 7.2, r: 0.11, y: bridgeLift(ox, oz) });
      }

      // tram fleet, evenly phased to reproduce the real TAG headway
      const fleetSize = Math.max(1, line.schedule?.tramsPerDirection ?? 1);
      const phase = dir > 0 ? 0.03 : 0.29;
      for (let fleetIndex = 0; fleetIndex < fleetSize; fleetIndex++) {
        const startT = (fleetIndex / fleetSize + phase) % 1;
        const tram = new Tram(line, lanePts, length, startT, dir, scene, fleetIndex);
        trams.push(tram);
      }
    }
  }

  /* rails */
  const railGeo = new THREE.BoxGeometry(0.14, 0.12, 1);
  const railMesh = new THREE.InstancedMesh(railGeo, steel, railTransforms.length);
  railTransforms.forEach((m, i) => railMesh.setMatrixAt(i, m));
  railMesh.frustumCulled = false;
  railMesh.receiveShadow = true;
  scene.add(railMesh);

  /* wires */
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
  const wire = new THREE.LineSegments(
    wireGeo,
    new THREE.LineBasicMaterial({ color: '#343b3c', transparent: true, opacity: 0.8 })
  );
  scene.add(wire);

  /* poles */
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 7.4, 6);
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, polePositions.length);
  const armGeo = new THREE.BoxGeometry(8.6, 0.1, 0.1);
  const armMesh = new THREE.InstancedMesh(armGeo, poleMat, polePositions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  placheck: {
    polePositions.forEach((p, i) => {
      const base = p.y ?? 0;
      m.compose(
        new THREE.Vector3(p.x, base + p.h / 2, p.z),
        q,
        new THREE.Vector3(1, p.h / 7.4, 1)
      );
      poleMesh.setMatrixAt(i, m);
      m.compose(
        new THREE.Vector3(p.x, base + WIRE_HEIGHT - 0.35, p.z),
        q,
        p.sign ? new THREE.Vector3(0.001, 0.001, 0.001) : new THREE.Vector3(1, 1, 1)
      );
      armMesh.setMatrixAt(i, m);
    });
  }
  poleMesh.castShadow = true;
  scene.add(poleMesh, armMesh);

  /* platforms */
  const platformGeo = new THREE.BoxGeometry(1, 1, 1);
  const platformMesh = new THREE.InstancedMesh(platformGeo, concrete, platformTransforms.length);
  platformTransforms.forEach((mat, i) => platformMesh.setMatrixAt(i, mat));
  platformMesh.receiveShadow = true;
  scene.add(platformMesh);

  /* stop signs */
  for (const line of TRAM_LINES) {
    const cars = signInstancesByLine.get(line.id) || [];
    if (!cars.length) continue;
    const tex = lineBadgeTexture(line);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(1.8, 0.85);
    const mesh = new THREE.InstancedMesh(geo, mat, cars.length);
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    cars.forEach((s, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      mm.compose(new THREE.Vector3(s.x, s.y, s.z), qq, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, mm);
    });
    scene.add(mesh);
  }

  const aerialLifts = AERIAL_LIFTS.map((cfg) => new AerialLift(cfg, scene, colliders));

  const update = (dt) => {
    for (const tram of trams) tram.update(dt);
    for (const lift of aerialLifts) lift.update(dt);
    for (const a of animated) a.update?.(dt);
  };

  return {
    trams,
    stops,
    aerialLifts,
    update,
    nearestTram(x, z, radius = 16) {
      let best = null;
      let bestD = radius;
      for (const tram of trams) {
        const d = Math.hypot(tram.position.x - x, tram.position.z - z);
        if (d < bestD) {
          bestD = d;
          best = tram;
        }
      }
      return best ? { tram: best, distance: bestD } : null;
    },
    nearestStop(x, z, radius = 100) {
      let best = null;
      let bestD = radius;
      for (const stop of stops) {
        const d = Math.hypot(stop._x - x, stop._z - z);
        if (d < bestD) {
          bestD = d;
          best = stop;
        }
      }
      return best ? { stop: best, distance: bestD } : null;
    },
    arrivalsAt(stop, perDirection = 2) {
      if (!stop) return null;
      const directions = [];
      for (const dir of [1, -1]) {
        const next = trams
          .filter((tram) => tram.line.id === stop.line && tram.dir === dir)
          .map((tram) => ({ eta: tram.etaToStop(stop), tram }))
          .sort((a, b) => a.eta - b.eta)
          .slice(0, perDirection);
        if (!next.length) continue;
        directions.push({
          dir,
          destination: destinationFor(stop, dir),
          color: stop.color,
          trams: next,
        });
      }
      return {
        stop: stop.name,
        line: stop.line,
        color: stop.color,
        schedule: stop.schedule,
        directions,
      };
    },
  };
}

function destinationFor(stop, dir) {
  const line = TRAM_LINES.find((candidate) => candidate.id === stop.line);
  if (!line) return '';
  return line.stops[dir > 0 ? line.stops.length - 1 : 0].name;
}

/* ──────────────────────────────────────────────────────────────
   Tram car
   ────────────────────────────────────────────────────────────── */
class Tram {
  constructor(line, lanePts, length, startT, dir, scene, fleetIndex = 0) {
    this.line = line;
    this.lanePts = lanePts;
    this.length = length;
    this.dir = dir;
    this.fleetIndex = fleetIndex;
    this.dist = clamp(startT, 0, 1) * length;
    const schedule = line.schedule ?? {};
    this.speed = schedule.speed ?? 10.4;
    this.dwell = schedule.dwell ?? 5.2;
    this.terminusWait = schedule.terminusWait ?? 6;
    this.wait = 0.45 + fleetIndex * 0.18;
    this.group = new THREE.Group();
    this.group.name = `tram-${line.id}-${dir}`;
    this.buildModel();
    scene.add(this.group);
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.lastStop = null;
    this._setPositionFromDist();
  }

  buildModel() {
    const white = new THREE.MeshStandardMaterial({ color: '#f2f1e9', roughness: 0.4, metalness: 0.15 });
    const stripe = new THREE.MeshStandardMaterial({ color: this.line.color, roughness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({
      color: '#23363f',
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.87,
    });
    const metal = new THREE.MeshStandardMaterial({ color: '#687276', roughness: 0.4, metalness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#1b1d1e', roughness: 0.9 });
    this.bodyTrim = [];
    this.noses = [];

    const sections = [
      { z: -7.4, len: 7.0 },
      { z: 0, len: 7.0 },
      { z: 7.4, len: 7.0 },
    ];
    for (const s of sections) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.6, s.len), white);
      body.position.set(0, 1.95, s.z);
      body.castShadow = true;
      this.group.add(body);

      const lowStripe = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.22, s.len - 0.15), stripe);
      lowStripe.position.set(0, 0.96, s.z);
      this.group.add(lowStripe);
      this.bodyTrim.push(lowStripe);

      const accent = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.12, s.len - 0.1), stripe);
      accent.position.set(0, 1.14, s.z);
      this.group.add(accent);
      this.bodyTrim.push(accent);

      const windows = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.94, s.len - 0.55), glass);
      windows.position.set(0, 2.3, s.z);
      this.group.add(windows);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.26, s.len - 0.25), metal);
      roof.position.set(0, 3.36, s.z);
      this.group.add(roof);

      for (const x of [-0.85, 0.85]) {
        for (const wz of [s.z - 2.2, s.z + 2.2]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10), rubber);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.38, wz);
          this.group.add(wheel);
        }
      }
    }

    // gangway joints — hidden while riding so the cabin sightline stays open
    this.bellows = [];
    for (const z of [-3.7, 3.7]) {
      const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.05, 2.3, 0.6), rubber);
      bellows.position.set(0, 1.95, z);
      this.group.add(bellows);
      this.bellows.push(bellows);
    }

    // sloped noses
    for (const s of [-1, 1]) {
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.24, 1.2, 1.4), white);
      nose.position.set(0, 1.4, s * 11.6);
      nose.rotation.x = s * 0.28;
      nose.castShadow = true;
      this.group.add(nose);
      const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 0.1), glass);
      windscreen.position.set(0, 2.55, s * 11.3);
      windscreen.rotation.x = -s * 0.16;
      this.group.add(windscreen);
      this.noses.push(nose, windscreen);
    }

    // destination scroll
    const signTex = canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#0c1418';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = this.line.color;
      ctx.fillRect(0, 0, 58, h);
      ctx.fillStyle = '#f5f0e4';
      ctx.font = '800 76px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.line.id, 29, h / 2 + 2);
      ctx.font = '600 34px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.line.stops[this.dir > 0 ? this.line.stops.length - 1 : 0].name.toUpperCase(), 76, h / 2 + 2);
    });
    const destMat = new THREE.MeshBasicMaterial({ map: signTex });
    for (const s of [-1, 1]) {
      const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.46), destMat);
      dest.position.set(0, 3.12, s * 11.42);
      if (s < 0) dest.rotation.y = Math.PI;
      this.group.add(dest);
      const headlight = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 10),
        new THREE.MeshBasicMaterial({ color: '#fff4cd' })
      );
      headlight.position.set(s * 0.72, 1.35, s * 11.34);
      if (s < 0) headlight.rotation.y = Math.PI;
      this.group.add(headlight);
    }

    // pantograph
    const pant = new THREE.Group();
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.06), metal);
      arm.position.set(0, 4.1, 0);
      arm.rotation.x = s * 0.62;
      pant.add(arm);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.08), metal);
    bar.position.set(0, 5.15, 0);
    pant.add(bar);
    pant.position.set(0, 0, 1.5);
    this.group.add(pant);

    setShadowRecursive(this.group, true, false);

    /* ── passenger cabin ────────────────────────────────────────
       Only switched on while the player is riding. The outer body is
       single-sided, so this inward-facing shell supplies floor, walls,
       ceiling, seating and grab rails without costing draw calls when
       the tram is seen from the street. */
    const interior = new THREE.Group();
    interior.name = `tram-interior-${this.line.id}`;
    interior.visible = false;

    const cabinFloor = new THREE.MeshStandardMaterial({ color: '#242b2c', roughness: 0.94 });
    const cabinWall = new THREE.MeshStandardMaterial({ color: '#e7e6d9', roughness: 0.74 });
    const cabinSeat = new THREE.MeshStandardMaterial({ color: '#29546b', roughness: 0.72 });
    const cabinDark = new THREE.MeshStandardMaterial({ color: '#252d2f', roughness: 0.56, metalness: 0.22 });
    const cabinMetal = new THREE.MeshStandardMaterial({ color: '#b6bdbd', roughness: 0.3, metalness: 0.78 });
    const cabinTrim = new THREE.MeshStandardMaterial({ color: this.line.color, roughness: 0.46 });
    const cabinGlow = new THREE.MeshBasicMaterial({ color: '#fff2cf' });
    const cabinGlass = new THREE.MeshStandardMaterial({
      color: '#a9c9d5',
      roughness: 0.12,
      metalness: 0.32,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const part = (material, x, y, z, w, h, d) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      interior.add(mesh);
      return mesh;
    };

    part(cabinFloor, 0, 0.7, 0, 2.3, 0.08, 22.4);
    part(cabinWall, 0, 3.11, 0, 2.3, 0.08, 22.4);
    part(cabinTrim, 0, 0.747, 0, 0.32, 0.012, 20.4);

    for (const x of [-1.16, 1.16]) {
      part(cabinWall, x, 1.28, 0, 0.055, 1.12, 22.4);
      part(cabinWall, x, 2.94, 0, 0.055, 0.34, 22.4);
      part(cabinTrim, x, 1.79, 0, 0.035, 0.09, 22.1);
      part(cabinGlass, x, 2.3, 0, 0.02, 0.94, 22.1);
      for (let z = -9.9; z <= 10; z += 2.2) {
        part(cabinDark, x, 2.3, z, 0.06, 0.98, 0.09);
      }
    }

    // ceiling light strips
    for (const x of [-0.55, 0.55]) {
      part(cabinGlow, x, 3.06, 0, 0.24, 0.035, 18.5);
    }

    // forward-facing bench pairs along both sides of the aisle
    for (const z of [-6.6, -4.3, -2, 0.3, 2.6, 4.9, 7.2]) {
      for (const x of [-0.78, 0.78]) {
        part(cabinSeat, x, 1.03, z, 0.64, 0.11, 1.05);
        part(cabinSeat, x, 1.43, z - 0.48, 0.64, 0.73, 0.11);
        part(cabinDark, x, 1.86, z - 0.48, 0.42, 0.14, 0.1);
      }
    }

    // longitudinal grab rail and vertical poles
    for (const x of [-0.46, 0.46]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 18, 6), cabinMetal);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, 2.78, 0);
      interior.add(rail);
      for (const z of [-6.2, -2, 2.2, 6.4, 9.2]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.95, 6), cabinMetal);
        pole.position.set(x, 1.92, z);
        interior.add(pole);
      }
    }

    // driver's desk, windscreen frame and rear bulkhead
    part(cabinDark, 0, 1.28, 10.15, 1.95, 0.7, 0.5);
    part(cabinTrim, 0, 1.69, 10.12, 2.02, 0.06, 0.55);
    part(cabinDark, 0, 2.02, 10.4, 2.05, 0.2, 0.25);
    part(cabinWall, 0, 3.0, 10.72, 2.3, 0.24, 0.24);
    part(cabinWall, 0, 1.0, 10.9, 2.3, 0.58, 0.18);
    for (const x of [-1.08, 1.08]) part(cabinWall, x, 2.25, 10.8, 0.14, 1.32, 0.2);
    part(cabinGlass, 0, 2.3, 10.84, 2.06, 1.06, 0.02);

    part(cabinWall, 0, 0.98, -11.02, 2.3, 0.56, 0.18);
    part(cabinWall, 0, 3.02, -11.02, 2.3, 0.2, 0.18);
    for (const x of [-1.07, 1.07]) part(cabinWall, x, 2.22, -11.0, 0.16, 1.36, 0.18);
    part(cabinGlass, 0, 2.3, -10.94, 1.94, 1.06, 0.02);

    // warm interior fill light, disabled with the cabin
    const cabinLight = new THREE.PointLight('#ffe8c2', 10, 15, 2);
    cabinLight.position.set(0, 2.66, -1.5);
    interior.add(cabinLight);

    setShadowRecursive(interior, false, false);
    this.group.add(interior);
    this.interior = interior;
  }

  setInteriorVisible(visible) {
    if (this.interior) this.interior.visible = !!visible;
    for (const bellows of this.bellows ?? []) bellows.visible = !visible;
    for (const trim of this.bodyTrim ?? []) trim.visible = !visible;
    for (const nose of this.noses ?? []) nose.visible = !visible;
  }

  _setPositionFromDist() {
    const total = this.lanePts.length - 1;
    const f = clamp(this.dist / this.length, 0, 0.99999) * total;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.lanePts[Math.min(i, total)];
    const b = this.lanePts[Math.min(i + 1, total)];
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = a.y + (b.y - a.y) * t;
    this.position.set(x, y - 0.02, z);
    this.group.position.copy(this.position);
    const dx = (b.x - a.x) * this.dir;
    const dz = (b.z - a.z) * this.dir;
    this.heading = Math.atan2(dx, dz);
    this.group.rotation.y = this.heading;
  }

  update(dt) {
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const step = this.speed * dt * this.dir;
    const nextDist = this.dist + step;

    // stop at the next station
    let crossStop = null;
    for (const stop of this.line.stops) {
      const d = stop._dist;
      if (this.dir > 0 ? d > this.dist + 0.4 && d <= nextDist + 0.4 : d < this.dist - 0.4 && d >= nextDist - 0.4) {
        if (!crossStop || (this.dir > 0 ? d < crossStop._dist : d > crossStop._dist)) crossStop = stop;
      }
    }
    if (crossStop) {
      this.dist = crossStop._dist;
      this.wait = this.dwell;
      this.lastStop = crossStop;
      this._setPositionFromDist();
      return;
    }

    this.dist = nextDist;
    if (this.dist > this.length) {
      this.dist = 0;
      this.wait = this.terminusWait;
    } else if (this.dist < 0) {
      this.dist = this.length;
      this.wait = this.terminusWait;
    }
    this._setPositionFromDist();
  }

  /**
   * Seconds until this tram next reaches a stop, including the dwell it will
   * serve at intermediate stations, its current dwell and any terminus layover.
   * This keeps the live platform board in sync with the physical tram.
   */
  etaToStop(stop) {
    const target = stop._dist;
    if (!Number.isFinite(target)) return Infinity;
    if (Math.abs(this.dist - target) < 0.9 && this.wait > 0.05) return 0;

    const eps = 1.2;
    const stops = this.line.stops;
    let distance = 0;
    let passed = 0;
    let wraps = false;

    if (this.dir > 0) {
      if (target >= this.dist - eps) {
        distance = Math.max(0, target - this.dist);
        passed = stops.filter((s) => s._dist > this.dist + eps && s._dist < target - eps).length;
      } else {
        wraps = true;
        distance = this.length - this.dist + target;
        passed = stops.filter((s) => s._dist > this.dist + eps || s._dist < target - eps).length;
      }
    } else if (target <= this.dist + eps) {
      distance = Math.max(0, this.dist - target);
      passed = stops.filter((s) => s._dist < this.dist - eps && s._dist > target + eps).length;
    } else {
      wraps = true;
      distance = this.dist + this.length - target;
      passed = stops.filter((s) => s._dist < this.dist - eps || s._dist > target + eps).length;
    }

    return (
      Math.max(0, this.wait) +
      distance / Math.max(0.1, this.speed) +
      passed * this.dwell +
      (wraps ? this.terminusWait : 0)
    );
  }

  /** Stops still ahead in the current direction, nearest first. */
  upcomingStops(count = 3) {
    const eps = 1.2;
    return this.line.stops
      .filter((stop) => (this.dir > 0 ? stop._dist > this.dist + eps : stop._dist < this.dist - eps))
      .sort((a, b) => (this.dir > 0 ? a._dist - b._dist : b._dist - a._dist))
      .slice(0, count)
      .map((stop) => stop.name);
  }

  /**
   * The next stop served after the current one, with a live countdown that
   * includes any dwell already running. At the terminus, `terminus` is true.
   */
  nextStopInfo() {
    const eps = 1.2;
    const next = this.line.stops
      .filter((stop) => (this.dir > 0 ? stop._dist > this.dist + eps : stop._dist < this.dist - eps))
      .sort((a, b) => (this.dir > 0 ? a._dist - b._dist : b._dist - a._dist))[0];

    if (!next) {
      return { name: this.destination, eta: 0, distance: 0, terminus: true };
    }
    const distance = Math.abs(next._dist - this.dist);
    return {
      name: next.name,
      eta: Math.max(0, this.wait) + distance / Math.max(0.1, this.speed),
      distance,
      terminus: false,
    };
  }

  get destination() {
    return this.line.stops[this.dir > 0 ? this.line.stops.length - 1 : 0].name;
  }

  /** The platform the tram is standing at, if it is serving a stop. */
  currentStop() {
    return this.line.stops.find((stop) => Math.abs(stop._dist - this.dist) < 2.6) ?? null;
  }

  get isStopped() {
    return this.wait > 0.15;
  }

  get lineId() {
    return this.line.id;
  }
}

/* ──────────────────────────────────────────────────────────────
   Aerial lifts
   ────────────────────────────────────────────────────────────── */
class AerialLift {
  constructor(cfg, scene, colliders) {
    this.cfg = cfg;
    this.scene = scene;
    this.elapsed = 0;
    this.length = 1;
    this.ride = null;
    this.rideComplete = false;

    const lowerY = heightAt(cfg.lower.x, cfg.lower.z);
    const upperY = heightAt(cfg.upper.x, cfg.upper.z);
    this.lowerY = lowerY;
    this.upperY = upperY;

    this.lower = new THREE.Vector3(cfg.lower.x, lowerY, cfg.lower.z);
    this.upper = new THREE.Vector3(cfg.upper.x, upperY, cfg.upper.z);
    const base = new THREE.Vector3(cfg.lower.x, lowerY + 9, cfg.lower.z);
    const top = new THREE.Vector3(cfg.upper.x, upperY + 8, cfg.upper.z);
    const distance = base.distanceTo(top);
    this.length = distance;

    const dir = top.clone().sub(base).setY(0).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);

    // cable polyline with catenary sag between pylons
    const sag = cfg.type === 'spheres' ? 5.5 : 11;
    const supports = [0, 0.34, 0.68, 1];
    const points = [];
    const SEG = 120;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      let localT = 0;
      let span = 0;
      for (let s = 0; s < supports.length - 1; s++) {
        if (t >= supports[s] && t <= supports[s + 1]) {
          span = s;
          localT = (t - supports[s]) / (supports[s + 1] - supports[s]);
          break;
        }
      }
      const linear = base.clone().lerp(top, t);
      linear.y -= Math.sin(localT * Math.PI) * sag * (0.75 + 0.25 * Math.sin(span));
      points.push(linear);
    }
    this.cablePath = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.cablePath.arcLengthDivisions = 500;

    const cableCurveA = new THREE.CatmullRomCurve3(
      points.map((p) => p.clone().addScaledVector(perp, 2.2)),
      false,
      'centripetal'
    );
    const cableCurveB = new THREE.CatmullRomCurve3(
      points.map((p) => p.clone().addScaledVector(perp, -2.2)),
      false,
      'centripetal'
    );
    this.cables = [cableCurveA, cableCurveB];

    // cable lines
    const cableMat = new THREE.LineBasicMaterial({ color: '#2d3334' });
    for (const c of this.cables) {
      const pts = c.getPoints(180);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(geo, cableMat));
    }

    // pylons
    this.pylons = [];
    for (const t of [0.34, 0.68]) {
      const p = this.cablePath.getPointAt(t);
      const ground = heightAt(p.x, p.z);
      this.buildPylon(p, ground, perp);
    }

    // stations
    this.buildStation(this.lower, cfg.lower, this.upper, 'lower', colliders);
    this.buildStation(this.upper, cfg.upper, this.lower, 'upper', colliders);

    // ambient cabins
    this.cabins = [];
    const count = cfg.cabins;
    for (let i = 0; i < count; i++) {
      const cabin = this.buildCabin();
      cabin.visible = true;
      scene.add(cabin);
      this.cabins.push({
        group: cabin,
        phase: i / count,
        cable: i % 2,
        reverse: i % 2 === 1,
        sway: Math.random() * 6,
      });
    }

    this.rideCabin = this.buildCabin();
    this.rideCabin.visible = false;
    scene.add(this.rideCabin);
  }

  buildPylon(cablePoint, groundY, perp) {
    const height = Math.max(14, cablePoint.y - groundY + 3);
    const mat = new THREE.MeshStandardMaterial({ color: '#7b8182', roughness: 0.55, metalness: 0.55 });
    const group = new THREE.Group();
    group.position.set(cablePoint.x, groundY, cablePoint.z);
    // four legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, height, 6), mat);
        leg.position.set(sx * 2.5, height / 2, sz * 2.5);
        leg.rotation.z = -sx * 0.03;
        leg.rotation.x = sz * 0.03;
        leg.castShadow = true;
        group.add(leg);
      }
    }
    // cross braces
    const braces = Math.max(2, Math.floor(height / 12));
    for (let i = 1; i <= braces; i++) {
      const y = (i / (braces + 1)) * height;
      const brace = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.16, 0.16), mat);
      brace.position.set(0, y, 2.5);
      group.add(brace);
      const brace2 = brace.clone();
      brace2.position.z = -2.5;
      group.add(brace2);
      const brace3 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.2), mat);
      brace3.position.set(2.5, y, 0);
      group.add(brace3);
      const brace4 = brace3.clone();
      brace4.position.x = -2.5;
      group.add(brace4);
    }
    // top cross arm
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 7.2), mat);
    arm.position.set(0, height, 0);
    arm.rotation.y = Math.atan2(perp.x, perp.z);
    group.add(arm);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(group);
    this.pylons.push(group);
  }

  buildStation(worldPos, cfgPos, other, side, colliders) {
    const y = heightAt(cfgPos.x, cfgPos.z);
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#b9b3a2', roughness: 0.82 });
    const glass = new THREE.MeshStandardMaterial({
      color: '#9fc0c8',
      roughness: 0.1,
      metalness: 0.4,
      transparent: true,
      opacity: 0.62,
    });
    const metal = new THREE.MeshStandardMaterial({ color: '#5b6465', roughness: 0.4, metalness: 0.6 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(27, 1, 20), stone);
    base.position.y = 0.5;
    base.receiveShadow = true;
    group.add(base);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(23, 7.4, 16), glass);
    hall.position.y = 4.7;
    hall.castShadow = true;
    group.add(hall);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 19), metal);
    roof.position.y = 8.6;
    roof.castShadow = true;
    group.add(roof);
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8.4, 6), metal);
      col.position.set(i * 5, 4.2, 8.4);
      group.add(col);
    }
    group.position.set(worldPos.x, y + 0.1, worldPos.z);
    group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    this.scene.add(group);

    // sign
    const label = side === 'lower'
      ? (this.cfg.id === 'bastille' ? 'TÉLÉPHÉRIQUE · BASTILLE' : 'TÉLÉCABINE · CHAMROUSSE')
      : (this.cfg.id === 'bastille' ? 'FORT DE LA BASTILLE · 476 M' : 'CHAMROUSSE · BELLEDONNE');
    const sign = makeTextPlane(label, {
      width: 1024,
      height: 160,
      fontSize: 48,
      bg: 'rgba(14,30,36,0.9)',
      accent: this.cfg.color,
    });
    sign.position.set(worldPos.x, y + 10.8, worldPos.z + 9);
    sign.scale.set(16, 2.5, 1);
    this.scene.add(sign);

    colliders.add(worldPos.x, worldPos.z, 14, 10, 'lift-station');
    this.stations = this.stations || {};
    this.stations[side] = { x: worldPos.x, z: worldPos.z, y };
  }

  buildCabin() {
    const g = new THREE.Group();
    const isSphere = this.cfg.type === 'spheres';
    const metal = new THREE.MeshStandardMaterial({ color: '#5c6668', roughness: 0.45, metalness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: '#ece8dc', roughness: 0.5 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#b7d7dc',
      metalness: 0.05,
      roughness: 0.05,
      transparent: true,
      opacity: 0.36,
      transmission: 0.35,
      side: THREE.DoubleSide,
    });

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 6), metal);
    arm.position.y = -1.45;
    g.add(arm);

    if (isSphere) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), glass);
      ball.position.y = -4.2;
      g.add(ball);
      for (const rot of [0, Math.PI / 2]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.09, 6, 28), metal);
        ring.position.y = -4.2;
        ring.rotation.y = rot;
        g.add(ring);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.09, 6, 28), metal);
      ring.position.y = -4.2;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.18, 18), white);
      floor.position.y = -5.6;
      g.add(floor);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.9), glass);
      body.position.y = -4.15;
      g.add(body);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.14, 2.98), white);
      frame.position.y = -2.9;
      g.add(frame);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 2.8), white);
      floor.position.y = -5.35;
      g.add(floor);
      for (const x of [-1.24, 1.24]) {
        for (const z of [-1.42, 1.42]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), metal);
          post.position.set(x, -4.15, z);
          g.add(post);
        }
      }
    }

    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    return g;
  }

  update(dt) {
    this.elapsed += dt;
    const speed = this.length / this.cfg.duration;
    for (const c of this.cabins) {
      let t = (this.elapsed * speed) / this.length + c.phase;
      t = t % 1;
      if (c.reverse) t = 1 - t;
      const curve = this.cables[c.cable];
      const p = curve.getPointAt(clamp(t, 0, 1));
      c.group.position.copy(p);
      c.group.rotation.y = Math.sin(this.elapsed * 0.4 + c.sway) * 0.06;
    }
    if (this.ride) {
      this.rideCabin.visible = true;
      const step = (dt * speed) / this.length * this.ride.dir;
      this.ride.t = clamp(this.ride.t + step, 0, 1);
      const p = this.cables[0].getPointAt(this.ride.t);
      this.rideCabin.position.copy(p);
      this.rideCabin.rotation.y = Math.sin(this.elapsed * 0.5) * 0.04;
      if ((this.ride.dir > 0 && this.ride.t >= 1) || (this.ride.dir < 0 && this.ride.t <= 0)) {
        this.rideComplete = true;
      }
    }
  }

  getStation(x, z) {
    let best = null;
    for (const side of ['lower', 'upper']) {
      const s = this.stations[side];
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < 22 && (!best || d < best.distance)) best = { side, station: s, distance: d };
    }
    return best;
  }

  startRide(side) {
    this.ride = { t: side === 'lower' ? 0 : 1, dir: side === 'lower' ? 1 : -1 };
    this.rideComplete = false;
    this.rideCabin.visible = true;
    const p = this.cables[0].getPointAt(this.ride.t);
    this.rideCabin.position.copy(p);
    return { from: side, to: side === 'lower' ? 'upper' : 'lower', duration: this.cfg.duration };
  }

  getRidePose() {
    if (!this.ride) return null;
    const p = this.rideCabin.position;
    return {
      position: new THREE.Vector3(p.x, p.y - 4.0, p.z),
      target: this.cables[0].getPointAt(clamp(this.ride.t + this.ride.dir * 0.03, 0, 1)).clone().setY(p.y - 5),
      progress: this.ride.dir > 0 ? this.ride.t : 1 - this.ride.t,
    };
  }

  endRide() {
    this.ride = null;
    this.rideComplete = false;
    this.rideCabin.visible = false;
  }
}
