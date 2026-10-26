import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, TRAILS, RIVER } from './data.js';
import { heightAt, cityMaskAt, terrainNormalAt } from './terrain.js';
import {
  mulberry32,
  distanceToPolyline,
  fbm,
  smoothstep,
  clamp,
} from './utils.js';

/* ──────────────────────────────────────────────────────────────
   Reusable instanced tree field
   positions: [{x, z, y?, type: 'broad'|'conifer', scale, tint?}]
   ────────────────────────────────────────────────────────────── */
export function createTreeInstances(scene, positions, opts = {}) {
  const castShadow = opts.castShadow ?? false;
  const branchALeft = new THREE.CylinderGeometry(0.07, 0.16, 2.3, 5);
  branchALeft.rotateZ(0.72);
  branchALeft.translate(-0.72, 4.1, 0.08);
  const branchARight = new THREE.CylinderGeometry(0.07, 0.16, 2.5, 5);
  branchARight.rotateZ(-0.66);
  branchARight.translate(0.72, 4.35, -0.08);
  const trunkGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.24, 0.46, 5.2, 7).translate(0, 2.6, 0),
    branchALeft,
    branchARight,
  ]);

  // A broadleaf crown made from several low-poly lobes reads as a tree from
  // every angle, unlike the single sphere used in the early build.
  const lobes = [
    { x: 0, y: 7.3, z: 0, r: 2.6, sx: 1.16, sy: 1.03, sz: 1.16 },
    { x: -1.75, y: 6.55, z: 0.85, r: 2.05, sx: 1.1, sy: 0.92, sz: 1.0 },
    { x: 1.72, y: 6.85, z: -0.65, r: 2.1, sx: 1.16, sy: 0.9, sz: 1.0 },
    { x: 0.15, y: 8.7, z: 0.25, r: 1.65, sx: 1.0, sy: 1.0, sz: 1.0 },
  ];
  const broadParts = lobes.map((lobe) => {
    const geo = new THREE.IcosahedronGeometry(lobe.r, 1);
    geo.scale(lobe.sx, lobe.sy, lobe.sz);
    geo.translate(lobe.x, lobe.y, lobe.z);
    return geo;
  });
  const broadGeo = mergeGeometries(broadParts);

  const coneParts = [
    new THREE.ConeGeometry(2.5, 5.8, 8).translate(0, 5.2, 0),
    new THREE.ConeGeometry(1.95, 5.2, 8).translate(0, 8.0, 0),
    new THREE.ConeGeometry(1.25, 4.1, 7).translate(0, 10.7, 0),
  ];
  const coneGeo = mergeGeometries(coneParts);

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b4937', roughness: 0.95 });
  const coniferMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
  const broadMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 });

  const conifers = positions.filter((p) => p.type !== 'broad');
  const broads = positions.filter((p) => p.type === 'broad');

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const coniferMesh = conifers.length
    ? new THREE.InstancedMesh(coneGeo, coniferMat, conifers.length)
    : null;
  const broadMesh = broads.length
    ? new THREE.InstancedMesh(broadGeo, broadMat, broads.length)
    : null;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rng = mulberry32(9834);

  positions.forEach((p, i) => {
    const y = p.y ?? heightAt(p.x, p.z);
    const s = (p.scale ?? 1) * (opts.scale ?? 1);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
  });

  const coniferBase = new THREE.Color('#365038');
  const coniferAlt = new THREE.Color('#4b6441');
  const broadBase = new THREE.Color('#55704a');
  const broadAlt = new THREE.Color('#768b55');

  conifers.forEach((p, i) => {
    const y = p.y ?? heightAt(p.x, p.z);
    const s = (p.scale ?? 1) * (opts.scale ?? 1);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s));
    coniferMesh.setMatrixAt(i, m);
    const c = coniferBase.clone().lerp(coniferAlt, rng());
    c.offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.07);
    coniferMesh.setColorAt(i, c);
  });
  broads.forEach((p, i) => {
    const y = p.y ?? heightAt(p.x, p.z);
    const s = (p.scale ?? 1) * (opts.scale ?? 1);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s));
    broadMesh.setMatrixAt(i, m);
    const c = broadBase.clone().lerp(broadAlt, rng());
    c.offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.07);
    broadMesh.setColorAt(i, c);
  });

  const all = [trunks, coniferMesh, broadMesh].filter(Boolean);
  for (const mesh of all) {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  return { trunks, conifers: coniferMesh, broads: broadMesh, trunkMat, coniferMat, broadMat };
}

/* ──────────────────────────────────────────────────────────────
   Mountain forests, valley trees, boulders
   ────────────────────────────────────────────────────────────── */
export function buildNature(scene) {
  const rng = mulberry32(29017);
  const trees = [];
  let guard = 0;

  const trailDist = (x, z) => {
    let best = Infinity;
    for (const trail of TRAILS) {
      best = Math.min(best, distanceToPolyline(x, z, trail.points));
    }
    return best;
  };

  while (trees.length < 4200 && guard++ < 30000) {
    const x = (rng() * 2 - 1) * (HALF - 140);
    const z = (rng() * 2 - 1) * (HALF - 140);
    const mask = cityMaskAt(x, z);
    if (mask > 0.025) continue;
    const h = heightAt(x, z);
    if (h < 0.6 || h > 880) continue;
    const riverD = distanceToPolyline(x, z, RIVER);
    if (riverD < 115) continue;
    if (trailDist(x, z) < 11) continue;

    const normal = terrainNormalAt(x, z, 4);
    if (normal.y < 0.63) continue;

    const cluster = fbm(x * 0.0033 + 8, z * 0.0033 - 3, 3);
    const nearValley = smoothstep(260, 0, h);
    if (cluster < 0.43 && rng() < 0.5 && nearValley < 0.6) continue;
    if (h > 820 && rng() < 0.5) continue;

    const conifer = h > 110 ? rng() < 0.9 : rng() < 0.42;
    trees.push({
      x,
      z,
      y: h,
      type: conifer ? 'conifer' : 'broad',
      scale: 0.65 + rng() * 0.85,
    });
  }

  // riverbank groves just outside the city
  for (let i = 0; i < 150 && guard < 22000; i++, guard++) {
    const t = rng();
    const ri = Math.floor(t * (RIVER.length - 1));
    const [ax, az] = RIVER[ri];
    const [bx, bz] = RIVER[ri + 1];
    const f = rng();
    const x = ax + (bx - ax) * f + (rng() - 0.5) * 180;
    const z = az + (bz - az) * f + (rng() - 0.5) * 120;
    if (cityMaskAt(x, z) > 0.02) continue;
    const h = heightAt(x, z);
    if (h < -1 || h > 12) continue;
    if (distanceToPolyline(x, z, RIVER) < 120) continue;
    trees.push({ x, z, y: h, type: 'broad', scale: 0.7 + rng() * 0.7 });
  }

  const treeField = createTreeInstances(scene, trees, { castShadow: false });

  /* ── boulders and cliff debris ── */
  const rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, flatShading: true });
  const rocks = [];
  let rockGuard = 0;
  while (rocks.length < 420 && rockGuard++ < 5000) {
    const x = (rng() * 2 - 1) * (HALF - 150);
    const z = (rng() * 2 - 1) * (HALF - 150);
    if (cityMaskAt(x, z) > 0.03) continue;
    const h = heightAt(x, z);
    if (h < 2) continue;
    const n = terrainNormalAt(x, z, 4);
    if (n.y > 0.9 && rng() < 0.75) continue;
    rocks.push({
      x,
      z,
      y: h,
      scale: 0.45 + rng() * 2.3,
      rot: rng() * Math.PI * 2,
    });
  }
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rockBase = new THREE.Color('#7b756a');
  rocks.forEach((rock, i) => {
    q.setFromEuler(new THREE.Euler(rng() * 0.7, rock.rot, rng() * 0.5));
    m.compose(
      new THREE.Vector3(rock.x, rock.y + rock.scale * 0.5, rock.z),
      q,
      new THREE.Vector3(rock.scale, rock.scale * (0.6 + rng() * 0.5), rock.scale)
    );
    rockMesh.setMatrixAt(i, m);
    const c = rockBase.clone();
    c.offsetHSL(0, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.14);
    rockMesh.setColorAt(i, c);
  });
  rockMesh.castShadow = false;
  rockMesh.receiveShadow = true;
  rockMesh.frustumCulled = false;
  scene.add(rockMesh);

  return { trees, treeField, rocks, rockMesh, rockMat };
}
