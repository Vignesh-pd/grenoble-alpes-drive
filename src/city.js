import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CITY,
  ROAD_X,
  ROAD_Z,
  WIDE_ROADS_X,
  WIDE_ROADS_Z,
  roadWidthX,
  roadWidthZ,
  SPECIAL_BLOCKS,
  specialAt,
  BRIDGES,
  LANDMARKS,
  TRAM_LINES,
} from './data.js';
import {
  mulberry32,
  clamp,
  smoothstep,
  makeFacadeTexture,
  canvasTexture,
  makeTextPlane,
  setShadowRecursive,
  seededPick,
  makeRibbon,
  catmullPoints2D,
} from './utils.js';
import { heightAt } from './terrain.js';
import { createTreeInstances } from './nature.js';

const PI2 = Math.PI / 2;

/* Tram reservations, pre-sampled in app-world metres so buildings never grow
   through a track bed or its platforms. The small per-line offset mirrors the
   lateral separation used by the transit builder. */
const TRAM_CORRIDORS = (() => {
  const segments = [];
  for (const line of TRAM_LINES) {
    const ox = line.offset?.[0] ?? 0;
    const oz = line.offset?.[1] ?? 0;
    for (let i = 0; i < line.route.length - 1; i++) {
      const [x1, z1] = line.route[i];
      const [x2, z2] = line.route[i + 1];
      segments.push({ x1: x1 + ox, z1: z1 + oz, x2: x2 + ox, z2: z2 + oz });
    }
  }
  return segments;
})();

function segmentHitsRect(s, cx, cz, hw, hd) {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const minX = cx - hw;
  const maxX = cx + hw;
  const minZ = cz - hd;
  const maxZ = cz + hd;
  if (
    Math.max(s.x1, s.x2) < minX ||
    Math.min(s.x1, s.x2) > maxX ||
    Math.max(s.z1, s.z2) < minZ ||
    Math.min(s.z1, s.z2) > maxZ
  ) {
    return false;
  }
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [s.x1 - minX, maxX - s.x1, s.z1 - minZ, maxZ - s.z1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-6) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function tramCorridorConflict(cx, cz, w, d) {
  const hw = w / 2 + 14;
  const hd = d / 2 + 14;
  for (const segment of TRAM_CORRIDORS) {
    if (segmentHitsRect(segment, cx, cz, hw, hd)) return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────
   Small helpers
   ────────────────────────────────────────────────────────────── */
function addBox(scene, material, x, y, z, w, h, d, ry = 0, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  scene.add(mesh);
  return mesh;
}

function addCyl(scene, material, x, y, z, rTop, rBottom, h, seg = 20, cast = true) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function gableGeometry() {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0.5, 1, 0.5]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([
    0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 3, 5, 3, 0, 4, 3, 4, 5, 0, 3, 2, 0, 2, 1,
  ]);
  geo.computeVertexNormals();
  return geo;
}

function pyramidGeometry() {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1]);
  geo.computeVertexNormals();
  return geo;
}

/* ──────────────────────────────────────────────────────────────
   City ground texture — roads, crossings, squares, parks
   ────────────────────────────────────────────────────────────── */
function createCityGroundTexture() {
  const cityW = CITY.x2 - CITY.x1;
  const cityD = CITY.z2 - CITY.z1;
  const W = 4096;
  const H = Math.round(W * (cityD / cityW));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pxX = W / cityW;
  const pxZ = H / cityD;
  const X = (x) => (x - CITY.x1) * pxX;
  const Z = (z) => (z - CITY.z1) * pxZ;
  const rng = mulberry32(778811);

  // base pavement / sidewalk
  ctx.fillStyle = '#a5a094';
  ctx.fillRect(0, 0, W, H);

  // individual blocks
  for (let i = 0; i < ROAD_X.length - 1; i++) {
    for (let j = 0; j < ROAD_Z.length - 1; j++) {
      const x1 = ROAD_X[i];
      const x2 = ROAD_X[i + 1];
      const z1 = ROAD_Z[j];
      const z2 = ROAD_Z[j + 1];
      const special = specialAt((x1 + x2) / 2, (z1 + z2) / 2);
      const l = 0.5 + rng() * 0.06;
      ctx.fillStyle = `rgb(${Math.round(138 * l)}, ${Math.round(134 * l)}, ${Math.round(125 * l)})`;
      ctx.fillRect(X(x1), Z(z1), (x2 - x1) * pxX, (z2 - z1) * pxZ);
      if (special) {
        if (special.type === 'park') {
          ctx.fillStyle = '#5f734b';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
          // park paths
          ctx.strokeStyle = '#b4ac9b';
          ctx.lineWidth = 5.5 * pxX;
          ctx.beginPath();
          ctx.moveTo(X((x1 + x2) / 2), Z(z1));
          ctx.lineTo(X((x1 + x2) / 2), Z(z2));
          ctx.moveTo(X(x1), Z((z1 + z2) / 2));
          ctx.lineTo(X(x2), Z((z1 + z2) / 2));
          ctx.stroke();
          ctx.fillStyle = '#4f6440';
          for (let t = 0; t < 12; t++) {
            const r = (3 + rng() * 5) * pxX;
            ctx.beginPath();
            ctx.arc(X(x1 + 20 + rng() * 220), Z(z1 + 20 + rng() * 220), r, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (special.type === 'plaza') {
          ctx.fillStyle = '#b9b0a0';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
          ctx.strokeStyle = 'rgba(70,62,50,0.18)';
          ctx.lineWidth = 1;
          const step = 7 * pxX;
          for (let px = X(x1); px < X(x2); px += step * 2) {
            for (let pz = Z(z1); pz < Z(z2); pz += step * 2) {
              ctx.strokeRect(px, pz, step, step);
            }
          }
        } else if (special.type === 'market') {
          ctx.fillStyle = '#aca394';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
        } else if (special.type === 'station') {
          ctx.fillStyle = '#9b988e';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
        } else if (special.type === 'stadium') {
          ctx.fillStyle = '#6d7c50';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
        } else if (special.type === 'campus') {
          ctx.fillStyle = '#697b50';
          ctx.fillRect(X(x1) + 1, Z(z1) + 1, (x2 - x1) * pxX - 2, (z2 - z1) * pxZ - 2);
        }
      }
    }
  }

  // asphalt
  ctx.fillStyle = '#3d4043';
  for (const x of ROAD_X) {
    const w = roadWidthX(x);
    ctx.fillRect(X(x - w / 2), 0, w * pxX, H);
  }
  for (const z of ROAD_Z) {
    const w = roadWidthZ(z);
    ctx.fillRect(0, Z(z - w / 2), W, w * pxZ);
  }

  // road edge lines
  ctx.fillStyle = 'rgba(220,216,203,0.28)';
  for (const x of ROAD_X) {
    const w = roadWidthX(x);
    ctx.fillRect(X(x - w / 2) + 1, 0, 1.2, H);
    ctx.fillRect(X(x + w / 2) - 2.2, 0, 1.2, H);
  }
  for (const z of ROAD_Z) {
    const w = roadWidthZ(z);
    ctx.fillRect(0, Z(z - w / 2) + 1, W, 1.2);
    ctx.fillRect(0, Z(z + w / 2) - 2.2, W, 1.2);
  }

  // center dashes on major avenues
  ctx.fillStyle = 'rgba(228,224,210,0.7)';
  const dash = 4 * pxX;
  const gap = 7 * pxX;
  for (const x of ROAD_X) {
    if (!WIDE_ROADS_X.has(x)) continue;
    for (let z = CITY.z1; z < CITY.z2; z += (dash + gap) / pxX) {
      ctx.fillRect(X(x) - 0.9, Z(z), 1.8, dash);
    }
  }
  for (const z of ROAD_Z) {
    if (!WIDE_ROADS_Z.has(z)) continue;
    for (let x = CITY.x1; x < CITY.x2; x += (dash + gap) / pxX) {
      ctx.fillRect(X(x), Z(z) - 0.9, dash, 1.8);
    }
  }

  // bike lane hints on the two main axes
  ctx.fillStyle = 'rgba(94, 154, 108, 0.24)';
  ctx.fillRect(X(-9), 0, 18 * pxX, H);
  ctx.fillRect(0, Z(260 - 9), W, 18 * pxZ);

  // crossings at every intersection
  ctx.fillStyle = 'rgba(232,228,214,0.72)';
  for (const x of ROAD_X) {
    for (const z of ROAD_Z) {
      const wx = roadWidthX(x);
      const wz = roadWidthZ(z);
      // across the north–south road (stripes long in z)
      for (let s = -1; s <= 1; s += 2) {
        const zc = z + s * (wz / 2 + 3.6);
        for (let k = 0; k < 7; k++) {
          const x0 = x - wx / 2 + 3 + k * (wx - 6) / 7;
          ctx.fillRect(X(x0), Z(zc - 2.2), 1.8 * pxX, 4.4 * pxZ);
        }
      }
      // across the east–west road (stripes long in x)
      for (let s = -1; s <= 1; s += 2) {
        const xc = x + s * (wx / 2 + 3.6);
        for (let k = 0; k < 7; k++) {
          const z0 = z - wz / 2 + 3 + k * (wz - 6) / 7;
          ctx.fillRect(X(xc - 2.2), Z(z0), 4.4 * pxX, 1.8 * pxZ);
        }
      }
    }
  }

  // reserved tram corridors, laid over the street grid before the grain pass
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of TRAM_LINES) {
    const ox = line.offset?.[0] ?? 0;
    const oz = line.offset?.[1] ?? 0;
    ctx.beginPath();
    line.route.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(X(x + ox), Z(z + oz));
      else ctx.lineTo(X(x + ox), Z(z + oz));
    });
    ctx.strokeStyle = 'rgba(48, 53, 55, 0.68)';
    ctx.lineWidth = 15.5 * pxX;
    ctx.stroke();
    ctx.strokeStyle = line.color;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 2.2 * pxX;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // asphalt grain & patches
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 16;
    data[i] = clamp(data[i] + n, 0, 255);
    data[i + 1] = clamp(data[i + 1] + n, 0, 255);
    data[i + 2] = clamp(data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* A warm, high-resolution paving texture for the central squares. The city-wide
   4096 px map can only resolve about one metre per pixel; this adds the stone
   joints and mottling you see underfoot. */
function createPavingTexture() {
  const rng = mulberry32(51307);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c9beab';
    ctx.fillRect(0, 0, w, h);
    const cols = 8;
    const rows = 8;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const l = 0.9 + rng() * 0.16;
        ctx.fillStyle = `rgb(${Math.round(193 * l)}, ${Math.round(183 * l)}, ${Math.round(163 * l)})`;
        ctx.fillRect(c * cw + 1.2, r * ch + 1.2, cw - 2.4, ch - 2.4);
        ctx.fillStyle = `rgba(95, 82, 65, ${0.02 + rng() * 0.045})`;
        for (let n = 0; n < 10; n++) {
          ctx.fillRect(c * cw + rng() * cw, r * ch + rng() * ch, 2 + rng() * 8, 1 + rng() * 3);
        }
      }
    }
    ctx.strokeStyle = 'rgba(82, 72, 59, 0.22)';
    ctx.lineWidth = 1.6;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cw, 0);
      ctx.lineTo(c * cw, h);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ch);
      ctx.lineTo(w, r * ch);
      ctx.stroke();
    }
    // a few darker, worn slabs break up the grid
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = 'rgba(84, 74, 61, 0.09)';
      ctx.fillRect(Math.floor(rng() * cols) * cw, Math.floor(rng() * rows) * ch, cw, ch);
    }
  }, { repeat: [11, 11], anisotropy: 8 });
}

/* ──────────────────────────────────────────────────────────────
   Main city builder
   ────────────────────────────────────────────────────────────── */
export function buildCity(scene, colliders) {  const rng = mulberry32(211291);
  const animated = [];
  const trees = [];
  const signs = [];
  const snowMaterials = [];

  /* ── ground plane ── */
  const cityTex = createCityGroundTexture();
  const groundMat = new THREE.MeshStandardMaterial({
    map: cityTex,
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
  });
  const groundGeo = new THREE.PlaneGeometry(CITY.x2 - CITY.x1, CITY.z2 - CITY.z1);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set((CITY.x1 + CITY.x2) / 2, 0.045, (CITY.z1 + CITY.z2) / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  snowMaterials.push({ mat: groundMat, base: new THREE.Color('#ffffff'), snow: new THREE.Color('#e4eaed') });

  /* ── shared materials ── */
  const stone = new THREE.MeshStandardMaterial({ color: '#b3a897', roughness: 0.88 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: '#8b8378', roughness: 0.92 });
  const stoneLight = new THREE.MeshStandardMaterial({ color: '#c7bcaa', roughness: 0.85 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#b9b7ae', roughness: 0.9 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: '#7d7d78', roughness: 0.9 });
  const zinc = new THREE.MeshStandardMaterial({ color: '#727f83', roughness: 0.7, metalness: 0.15 });
  const grassMat = new THREE.MeshStandardMaterial({ color: '#5e7449', roughness: 1 });
  const pathMat = new THREE.MeshStandardMaterial({ color: '#b8ae9b', roughness: 0.96 });
  const darkGlass = new THREE.MeshStandardMaterial({
    color: '#4e6b76',
    roughness: 0.16,
    metalness: 0.55,
    transparent: true,
    opacity: 0.78,
  });
  const paleGlass = new THREE.MeshStandardMaterial({
    color: '#a8c7ce',
    roughness: 0.12,
    metalness: 0.45,
    transparent: true,
    opacity: 0.66,
  });
  const white = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.8 });
  const redMat = new THREE.MeshStandardMaterial({ color: '#a13b2c', roughness: 0.8 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#4f7d83',
    roughness: 0.25,
    metalness: 0.35,
    transparent: true,
    opacity: 0.9,
  });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6e523a', roughness: 0.85 });
  const ironMat = new THREE.MeshStandardMaterial({ color: '#30393b', roughness: 0.55, metalness: 0.6 });
  snowMaterials.push({ mat: grassMat, base: new THREE.Color('#5e7449'), snow: new THREE.Color('#e4e9e2') });

  const materials = {
    stone, stoneDark, stoneLight, concrete, concreteDark, zinc, grassMat, pathMat,
    darkGlass, paleGlass, white, redMat, waterMat, woodMat, ironMat,
  };

  /* ── buildings ── */
  const facadeDefs = [
    { style: 'classic', tint: 0 },
    { style: 'classic', tint: 1 },
    { style: 'classic', tint: 2 },
    { style: 'classic', tint: 3 },
    { style: 'brick', tint: 0 },
    { style: 'brick', tint: 1 },
    { style: 'modern', tint: 0 },
    { style: 'modern', tint: 1 },
  ];
  const facadeGroups = facadeDefs.map((d) => ({
    ...d,
    mat: new THREE.MeshStandardMaterial({
      map: makeFacadeTexture(d.style, d.tint),
      roughness: d.style === 'modern' ? 0.55 : 0.82,
      metalness: d.style === 'modern' ? 0.15 : 0.02,
      color: '#ffffff',
      vertexColors: true,
    }),
    list: [],
  }));
  const roofList = [];
  const trimGeoms = [];
  const trimMat = new THREE.MeshStandardMaterial({ color: '#c9beac', roughness: 0.84 });
  const roofH = 4.4;

  // BoxGeometry UVs are per-face 0..1. Cities look wrong when one window grid is
  // stretched over a 90 m block, so re-scale the façade UVs to a ~22 m bay and
  // merge all buildings of one material into a single draw call.
  function tiledFacadeGeometry(w, h, d, color) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const bay = 22;
    const storey = 22.5;
    const uFront = w / bay;
    const uSide = d / bay;
    const v = h / storey;
    const scales = [
      [uSide, v],
      [uSide, v],
      [1, 1],
      [1, 1],
      [uFront, v],
      [uFront, v],
    ];
    for (let face = 0; face < 6; face++) {
      for (let corner = 0; corner < 4; corner++) {
        const i = face * 4 + corner;
        uv.setXY(i, uv.getX(i) * scales[face][0], uv.getY(i) * scales[face][1]);
      }
    }
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  function queueBuilding(cx, cz, w, d, h, style, tint, kind = 'block') {
    if (tramCorridorConflict(cx, cz, w, d)) return;
    const group = facadeGroups.find((g) => g.style === style && g.tint === tint) || facadeGroups[0];
    const y = 0.05 + h / 2;
    const m = new THREE.Matrix4().makeTranslation(cx, y, cz);
    const tintColor = new THREE.Color().setHSL(
      0.09 + rng() * 0.025,
      0.02 + rng() * 0.05,
      0.86 + rng() * 0.13
    );
    const geo = tiledFacadeGeometry(w, h, d, tintColor);
    geo.applyMatrix4(m);
    group.list.push(geo);

    colliders.add(cx, cz, w / 2 + 0.5, d / 2 + 0.5, 'building');

    const roofChance = style === 'modern' ? 0 : 0.84;
    if (style !== 'modern' && rng() < roofChance) {
      const rm = new THREE.Matrix4();
      const rq = new THREE.Quaternion();
      const rw = w + 0.7;
      const rd = d + 0.7;
      const rh = roofH * (0.72 + rng() * 0.6);
      rm.compose(
        new THREE.Vector3(cx, 0.05 + h, cz),
        rq,
        new THREE.Vector3(rw, rh, rd)
      );
      const rc = new THREE.Color().setHSL(0.55 + rng() * 0.04, 0.05 + rng() * 0.05, 0.3 + rng() * 0.09);
      roofList.push({ matrix: rm, color: rc });
    }

    // A cornice and a ground-floor string course give the flat boxes a human
    // scale, even when seen from the far side of the plaza.
    const corniceH = 0.48;
    const cornice = new THREE.BoxGeometry(w + 0.75, corniceH, d + 0.75);
    cornice.translate(cx, 0.05 + h - corniceH / 2, cz);
    trimGeoms.push(cornice);
    if (style !== 'modern' && h > 10) {
      const band = new THREE.BoxGeometry(w + 0.22, 0.2, d + 0.22);
      band.translate(cx, 0.05 + 3.8, cz);
      trimGeoms.push(band);
    }
  }

  function fillCell(x1, z1, x2, z2) {
    const innerX1 = x1 + 16;
    const innerX2 = x2 - 16;
    const innerZ1 = z1 + 16;
    const innerZ2 = z2 - 16;
    const innerW = innerX2 - innerX1;
    const innerD = innerZ2 - innerZ1;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const central = Math.abs(cx) < 750 && Math.abs(cz) < 650;
    const modern = rng() < (central ? 0.04 : 0.2);
    const brick = !modern && rng() < 0.13;
    const style = modern ? 'modern' : brick ? 'brick' : 'classic';

    const heightFor = () => {
      if (modern) {
        return 18 + rng() * (central ? 20 : 34) + (rng() < 0.06 ? 22 : 0);
      }
      return 12 + rng() * (central ? 10 : 15) + (rng() < 0.08 ? 8 : 0);
    };

    const lot = (lx, lz, lw, ld, kind) => {
      const h = heightFor();
      const tint =
        style === 'classic' ? Math.floor(rng() * 4) : Math.floor(rng() * 2);
      queueBuilding(lx, lz, lw, ld, h, style, tint, kind);
    };

    // north edge
    let cursor = innerX1;
    while (cursor < innerX2 - 20) {
      const w = Math.min(48 + rng() * 52, innerX2 - cursor);
      if (w < 30) break;
      const depth = 19 + rng() * 15;
      lot(cursor + w / 2, innerZ1 + depth / 2, w, depth, 'edge');
      cursor += w;
    }
    // south edge
    cursor = innerX1;
    while (cursor < innerX2 - 20) {
      const w = Math.min(48 + rng() * 52, innerX2 - cursor);
      if (w < 30) break;
      const depth = 19 + rng() * 15;
      lot(cursor + w / 2, innerZ2 - depth / 2, w, depth, 'edge');
      cursor += w;
    }
    // west edge
    cursor = innerZ1 + 40;
    while (cursor < innerZ2 - 60) {
      const d = Math.min(44 + rng() * 38, innerZ2 - 30 - cursor);
      if (d < 28) break;
      const width = 19 + rng() * 14;
      lot(innerX1 + width / 2, cursor + d / 2, width, d, 'edge');
      cursor += d;
    }
    // east edge
    cursor = innerZ1 + 40;
    while (cursor < innerZ2 - 60) {
      const d = Math.min(44 + rng() * 38, innerZ2 - 30 - cursor);
      if (d < 28) break;
      const width = 19 + rng() * 14;
      lot(innerX2 - width / 2, cursor + d / 2, width, d, 'edge');
      cursor += d;
    }

    // occasional courtyard tower / green heart
    if (modern && innerW > 170 && rng() < 0.55) {
      const w = 38 + rng() * 30;
      const d = 32 + rng() * 26;
      lot(cx, cz, w, d, 'tower');
      colliders.add(cx, cz, w / 2 + 1, d / 2 + 1, 'building');
    } else if (rng() < 0.32) {
      trees.push({
        x: cx + (rng() - 0.5) * 40,
        z: cz + (rng() - 0.5) * 40,
        type: 'broad',
        scale: 0.55 + rng() * 0.4,
      });
    }
  }

  for (let i = 0; i < ROAD_X.length - 1; i++) {
    for (let j = 0; j < ROAD_Z.length - 1; j++) {
      const x1 = ROAD_X[i];
      const x2 = ROAD_X[i + 1];
      const z1 = ROAD_Z[j];
      const z2 = ROAD_Z[j + 1];
      if (specialAt((x1 + x2) / 2, (z1 + z2) / 2)) continue;
      fillCell(x1, z1, x2, z2);
    }
  }

  // Grenoble's central squares are enclosed by continuous Haussmann-style
  // blocks. Fill their edges so they read as rooms in the city, not empty lots.
  function fillPlazaPerimeter(block) {
    const margin = 8;
    const northDepth = 27 + rng() * 7;
    const southDepth = 24 + rng() * 8;
    const x1 = block.x1 + margin;
    const x2 = block.x2 - margin;
    const z1 = block.z1 + margin;
    const z2 = block.z2 - margin;
    const pickStyle = () => {
      const r = rng();
      return r < 0.7 ? 'classic' : r < 0.87 ? 'brick' : 'modern';
    };
    const heightFor = (style) => (style === 'modern' ? 21 + rng() * 13 : 13 + rng() * 9.5);

    const row = (from, to, fixedCenter, depth, horizontal) => {
      let cursor = from;
      while (cursor < to - 12) {
        let w = 28 + rng() * 25;
        if (to - cursor - w < 18) w = to - cursor;
        const style = pickStyle();
        const tint = Math.floor(rng() * (style === 'classic' ? 4 : 2));
        const cc = cursor + w / 2;
        const h = heightFor(style);
        if (horizontal) queueBuilding(cc, fixedCenter, w - 0.9, depth, h, style, tint, 'edge');
        else queueBuilding(fixedCenter, cc, depth, w - 0.9, h, style, tint, 'edge');
        cursor += w;
      }
    };

    row(x1, x2, z1 + northDepth / 2, northDepth, true);
    row(x1, x2, z2 - southDepth / 2, southDepth, true);
    row(z1 + northDepth + 3, z2 - southDepth - 3, x1 + 15, 28, false);
    row(z1 + northDepth + 3, z2 - southDepth - 3, x2 - 15, 28, false);
  }

  for (const block of SPECIAL_BLOCKS) {
    if (block.type === 'plaza') fillPlazaPerimeter(block);
  }

  // merge façades by material (one draw call each) instead of instancing one
  // stretched box per building
  for (const group of facadeGroups) {
    if (!group.list.length) continue;
    const merged = mergeGeometries(group.list, false);
    for (const geo of group.list) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, group.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  if (trimGeoms.length) {
    const mergedTrim = mergeGeometries(trimGeoms, false);
    for (const geo of trimGeoms) geo.dispose();
    const trim = new THREE.Mesh(mergedTrim, trimMat);
    trim.castShadow = true;
    trim.receiveShadow = true;
    scene.add(trim);
  }

  // roofs
  const roofMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.74, metalness: 0.1 });
  const roofGeo = pyramidGeometry();
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, roofList.length);
  roofList.forEach((it, i) => {
    roofs.setMatrixAt(i, it.matrix);
    roofs.setColorAt(i, it.color);
  });
  roofs.castShadow = true;
  roofs.receiveShadow = true;
  roofs.frustumCulled = false;
  scene.add(roofs);

  /* ── lane markings ── */
  buildLaneMarkings(scene);

  /* ── landmarks and special blocks ── */
  for (const block of SPECIAL_BLOCKS) {
    const cx = (block.x1 + block.x2) / 2;
    const cz = (block.z1 + block.z2) / 2;
    const w = block.x2 - block.x1;
    const d = block.z2 - block.z1;
    if (block.type === 'plaza') buildPlaza(scene, colliders, block, materials, trees, rng);
    else if (block.type === 'park') buildPark(scene, colliders, block, materials, trees, animated, rng);
    else if (block.type === 'cathedral') buildCathedral(scene, colliders, block, materials);
    else if (block.type === 'market') buildMarket(scene, colliders, block, materials, rng);
    else if (block.type === 'station') buildStation(scene, colliders, block, materials, animated);
    else if (block.type === 'museum') buildMuseum(scene, colliders, block, materials);
    else if (block.type === 'campus') buildCampus(scene, colliders, block, materials, trees, rng);
    else if (block.type === 'stadium') buildStadium(scene, colliders, block, materials);
  }

  // Tour Perret (inside Paul Mistral park block)
  buildTourPerret(scene, colliders, materials);

  /* ── river promenade & bridges ── */
  buildRiverPromenade(scene, colliders, materials, trees);
  for (const b of BRIDGES) buildBridge(scene, colliders, b, materials);

  /* ── distant trailhead signposts near the city ── */
  addCitySign(scene, -215, 0, 'PLACE GRENETTE', 'VIEUX CENTRE · 212 M', '#ffb257');
  addCitySign(scene, -40, 200, 'GARE', 'TGV · TRAM A/C/D', '#84e9ed');
  addCitySign(scene, 1080, 1120, 'PARIS', 'TGV · 3 H 05', '#84e9ed');
  addCitySign(scene, -1120, 1220, 'CHAMONIX', 'MONT-BLANC · 150 KM', '#ffb257');

  /* ── street lights ── */
  buildStreetLights(scene);

  /* ── parked cars ── */
  buildParkedCars(scene, colliders, rng);

  /* ── benches ── */
  buildBenches(scene, materials, trees);

  /* ── trees (city) ── */
  const treeField = createTreeInstances(scene, trees, { scale: 1.25, castShadow: true });

  /* ── update ── */
  const update = (dt) => {
    for (const a of animated) a.update?.(dt);
  };

  return {
    update,
    materials,
    snowMaterials,
    cityGround: ground,
    treeField,
    treePositions: trees,
    temp: null,
  };
}

/* ──────────────────────────────────────────────────────────────
   Special block builders
   ────────────────────────────────────────────────────────────── */
function buildPlaza(scene, colliders, block, M, trees, rng) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const isGrenette = block.name === 'Place Grenette';
  const width = block.x2 - block.x1 - 16;
  const depth = block.z2 - block.z1 - 16;

  const pavingMat = new THREE.MeshStandardMaterial({
    map: createPavingTexture(),
    roughness: 0.93,
    metalness: 0,
  });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, depth), pavingMat);
  slab.position.set(cx, 0.12, cz);
  slab.receiveShadow = true;
  scene.add(slab);

  // darker stone border makes the huge surface feel drawn rather than poured
  for (const s of [-1, 1]) {
    addBox(scene, M.stoneDark, cx + s * (width / 2 - 0.8), 0.2, cz, 1.6, 0.035, depth);
    addBox(scene, M.stoneDark, cx, 0.2, cz + s * (depth / 2 - 0.8), width, 0.035, 1.6);
  }

  // fountain
  addCyl(scene, M.stone, cx, 0.12, cz, 9.5, 10.5, 1.1, 40);
  const basinWater = new THREE.Mesh(new THREE.CylinderGeometry(8.7, 8.7, 0.06, 40), M.waterMat);
  basinWater.position.set(cx, 1.18, cz);
  scene.add(basinWater);
  addCyl(scene, M.stone, cx, 1.1, cz, 1.2, 1.8, 3.2, 16);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 1.3, 0.9, 24), M.stone);
  bowl.position.set(cx, 4.1, cz);
  bowl.castShadow = true;
  scene.add(bowl);
  addCyl(scene, M.stoneDark, cx, 4.4, cz, 0.5, 0.7, 4.2, 12);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), M.stoneLight);
  globe.position.set(cx, 9, cz);
  globe.castShadow = true;
  scene.add(globe);
  colliders.add(cx, cz, 10.5, 10.5, 'fountain');
  const waterJets = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.06, 3.2, 5),
      new THREE.MeshBasicMaterial({ color: '#bce6ea', transparent: true, opacity: 0.55 })
    );
    const a = (i / 8) * Math.PI * 2;
    jet.position.set(cx + Math.cos(a) * 2.2, 2.8, cz + Math.sin(a) * 2.2);
    waterJets.add(jet);
  }
  scene.add(waterJets);

  // circular inlay and a ring of low granite bollards
  const ringMat = new THREE.MeshStandardMaterial({ color: '#8e8577', roughness: 0.9 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(13.4, 15.2, 72), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, 0.211, cz);
  scene.add(ring);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    addCyl(scene, M.ironMat, cx + Math.cos(a) * 19, 0.2, cz + Math.sin(a) * 19, 0.12, 0.15, 0.85, 6, false);
  }

  // central greenery: planters and flower beds
  const flowerMat = new THREE.MeshStandardMaterial({ color: '#b74536', roughness: 0.8 });
  const flowerGold = new THREE.MeshStandardMaterial({ color: '#dfb35c', roughness: 0.8 });
  const flowerGeo = new THREE.IcosahedronGeometry(0.14, 0);
  const flowerInstances = new THREE.InstancedMesh(flowerGeo, flowerMat, 64);
  const flowerGoldInstances = new THREE.InstancedMesh(flowerGeo, flowerGold, 32);
  const flowerM = new THREE.Matrix4();
  const flowerQ = new THREE.Quaternion();
  let flowerIndex = 0;
  let goldIndex = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = cx + Math.cos(a) * 24;
    const pz = cz + Math.sin(a) * 24;
    addBox(scene, M.stoneDark, px, 0.21, pz, 4.2, 0.55, 1.2, -a + PI2, false, true);
    addBox(scene, M.grassMat, px, 0.73, pz, 3.9, 0.22, 0.95, -a + PI2, false, true);
    for (let n = 0; n < 8; n++) {
      const off = (n / 7 - 0.5) * 3.4;
      flowerM.compose(
        new THREE.Vector3(px + Math.sin(a) * off, 1.02 + (n % 2) * 0.08, pz + Math.cos(a) * off),
        flowerQ,
        new THREE.Vector3(1, 1, 1)
      );
      flowerInstances.setMatrixAt(flowerIndex++, flowerM);
    }
    for (let n = 0; n < 4; n++) {
      const off = (n / 3 - 0.5) * 1.9;
      flowerM.compose(
        new THREE.Vector3(px - Math.sin(a) * off, 1.0, pz - Math.cos(a) * off),
        flowerQ,
        new THREE.Vector3(0.9, 0.9, 0.9)
      );
      flowerGoldInstances.setMatrixAt(goldIndex++, flowerM);
    }
  }
  flowerInstances.castShadow = false;
  flowerGoldInstances.castShadow = false;
  flowerInstances.instanceMatrix.needsUpdate = true;
  flowerGoldInstances.instanceMatrix.needsUpdate = true;
  scene.add(flowerInstances);
  scene.add(flowerGoldInstances);

  // café clusters under striped parasols
  const fabricMats = [
    new THREE.MeshStandardMaterial({ color: '#a84034', roughness: 0.82, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: '#e8dfca', roughness: 0.85, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: '#4e776d', roughness: 0.85, side: THREE.DoubleSide }),
  ];
  function cafeSet(x, z, material) {
    addCyl(scene, M.ironMat, x, 0.22, z, 0.07, 0.07, 2.9, 6, false);
    const parasol = new THREE.Mesh(new THREE.ConeGeometry(2.45, 0.72, 12, 1, true), material);
    parasol.position.set(x, 3.12, z);
    parasol.castShadow = true;
    scene.add(parasol);
    addCyl(scene, M.white, x, 1.1, z, 0.72, 0.12, 0.09, 12, false);
    addCyl(scene, M.ironMat, x, 0.22, z, 0.055, 0.055, 0.92, 5, false);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.35;
      const chx = x + Math.cos(a) * 1.85;
      const chz = z + Math.sin(a) * 1.85;
      addBox(scene, M.ironMat, chx, 0.25, chz, 0.46, 0.08, 0.46, -a, true, true);
      addBox(scene, M.ironMat, chx + Math.cos(a) * 0.23, 0.33, chz + Math.sin(a) * 0.23, 0.46, 0.52, 0.08, -a, true, true);
    }
  }
  const cafeAngles = [0.58, 2.12, 3.58, 5.05];
  cafeAngles.forEach((a, i) => {
    cafeSet(
      cx + Math.cos(a) * 76,
      cz + Math.sin(a) * 76,
      fabricMats[i % fabricMats.length]
    );
  });

  // trees and benches frame the square
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.18;
    const r = 57 + (i % 2) * 4;
    trees.push({
      x: cx + Math.cos(a) * r,
      z: cz + Math.sin(a) * r,
      type: 'broad',
      scale: 0.82 + rng() * 0.32,
    });
  }
  const benchMat = M.woodMat;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.1;
    const r = 32;
    const bx = cx + Math.cos(a) * r;
    const bz = cz + Math.sin(a) * r;
    addBox(scene, benchMat, bx, 0.22, bz, 3.1, 0.42, 0.72, -a + PI2, true, true);
    addBox(scene, benchMat, bx + Math.cos(a) * 0.3, 0.64, bz + Math.sin(a) * 0.3, 3.1, 0.72, 0.12, -a + PI2, true, true);
    addBox(scene, M.ironMat, bx - Math.cos(a) * 1.1, 0.22, bz - Math.sin(a) * 1.1, 0.12, 0.55, 0.5, -a, true, true);
    addBox(scene, M.ironMat, bx + Math.cos(a) * 1.1, 0.22, bz + Math.sin(a) * 1.1, 0.12, 0.55, 0.5, -a, true, true);
  }

  // lamp standards
  const lampGlass = new THREE.MeshStandardMaterial({
    color: '#fff0c9',
    emissive: '#ffdd9e',
    emissiveIntensity: 0.35,
    roughness: 0.3,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = cx + Math.cos(a) * 39;
    const lz = cz + Math.sin(a) * 39;
    addCyl(scene, M.ironMat, lx, 0.22, lz, 0.1, 0.16, 6.2, 7, false);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), lampGlass);
    lantern.position.set(lx, 6.55, lz);
    scene.add(lantern);
    addCyl(scene, M.ironMat, lx, 6.86, lz, 0.04, 0.24, 0.35, 7, false);
  }

  // kiosk
  const kx = cx + 67;
  const kz = cz + 67;
  addBox(scene, M.white, kx, 0, kz, 9, 3.2, 6);
  addBox(scene, M.redMat, kx, 3.2, kz, 10, 0.4, 7);
  const kioskSign = makeTextPlane('JOURNAUX · FLEURS', {
    width: 640,
    height: 110,
    fontSize: 44,
    accent: '#c64938',
    bg: 'rgba(18, 27, 30, 0.92)',
  });
  kioskSign.position.set(kx, 3.62, kz + 3.03);
  kioskSign.scale.set(6.2, 1.06, 1);
  scene.add(kioskSign);
  colliders.add(kx, kz, 5, 3.5, 'kiosk');

  // sign
  const signTex = makeTextPlane(isGrenette ? 'PLACE GRENETTE' : 'PLACE VICTOR HUGO', {
    width: 640,
    height: 128,
    fontSize: 46,
  });
  signTex.position.set(cx - 55, 4.6, cz - 70);
  signTex.scale.set(9, 1.8, 1);
  scene.add(signTex);
  addCyl(scene, M.ironMat, cx - 63, 0.1, cz - 70, 0.08, 0.1, 4.4, 6);
  addCyl(scene, M.ironMat, cx - 47, 0.1, cz - 70, 0.08, 0.1, 4.4, 6);
}

function buildPark(scene, colliders, block, M, trees, animated, rng) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const w = block.x2 - block.x1 - 24;
  const d = block.z2 - block.z1 - 24;

  const lawn = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), M.grassMat);
  lawn.position.set(cx, 0.09, cz);
  lawn.receiveShadow = true;
  scene.add(lawn);

  // paths
  addBox(scene, M.pathMat, cx, 0.18, cz, w, 0.05, 7);
  addBox(scene, M.pathMat, cx, 0.18, cz, 7, 0.05, d);

  // trees
  for (let i = 0; i < 16; i++) {
    const x = block.x1 + 30 + rng() * (block.x2 - block.x1 - 60);
    const z = block.z1 + 30 + rng() * (block.z2 - block.z1 - 60);
    if (Math.abs(x - cx) < 12 || Math.abs(z - cz) < 12) continue;
    trees.push({ x, z, type: rng() < 0.6 ? 'broad' : 'conifer', scale: 0.9 + rng() * 0.6 });
  }

  if (block.name === 'Jardin de Ville') {
    // Ferris wheel — the Grande Roue
    const wheel = new THREE.Group();
    wheel.position.set(cx + 10, 0, cz - 26);
    const radius = 27;
    const hubY = 32;
    const ringGeo = new THREE.TorusGeometry(radius, 0.42, 8, 56);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#d7d3c7', roughness: 0.4, metalness: 0.5 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.position.y = hubY;
    ring1.castShadow = true;
    wheel.add(ring1);
    const spin = new THREE.Group();
    spin.position.y = hubY;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, radius * 2, 6), ringMat);
      spoke.rotation.z = a;
      spoke.castShadow = true;
      spin.add(spoke);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.2, 2), i % 3 === 0 ? M.redMat : M.white);
      cabin.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      cabin.castShadow = true;
      spin.add(cabin);
    }
    wheel.add(spin);
    // support legs
    for (let s = -1; s <= 1; s += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, hubY + 4, 8), ringMat);
      leg.position.set(s * 8, (hubY + 4) / 2, 0);
      leg.rotation.z = s * 0.24;
      leg.castShadow = true;
      wheel.add(leg);
    }
    scene.add(wheel);
    colliders.add(cx + 10, cz - 26, 10, 10, 'ferris');
    animated.push({ update: (dt) => { spin.rotation.z += dt * 0.055; } });

    // pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(16, 32), M.waterMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cx - 50, 0.21, cz + 45);
    pond.scale.set(1.5, 1, 1);
    scene.add(pond);
    // benches
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addBox(scene, M.woodMat, cx + Math.cos(a) * 70, 0.18, cz + Math.sin(a) * 70, 3.2, 0.5, 0.8, -a);
    }
  } else {
    // Paul Mistral / Villeneuve / Jardin des Plantes
    if (block.name === 'Jardin des Plantes') {
      // glasshouse
      const gh = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 28, 18, 1, false, 0, Math.PI), M.paleGlass);
      gh.rotation.z = Math.PI / 2;
      gh.position.set(cx - 30, 7.2, cz - 25);
      scene.add(gh);
      addBox(scene, M.stoneDark, cx - 30, 0, cz - 25, 30, 7, 14);
      colliders.add(cx - 30, cz - 25, 16, 8, 'greenhouse');
    } else {
      // pond
      const pond = new THREE.Mesh(new THREE.CircleGeometry(20, 32), M.waterMat);
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(cx + 30, 0.2, cz + 25);
      pond.scale.set(1.7, 1, 1);
      scene.add(pond);
    }
    for (let i = 0; i < 6; i++) {
      addBox(scene, M.woodMat, cx - 60 + i * 24, 0.18, cz + 55, 3, 0.5, 0.8);
    }
  }
}

function buildCathedral(scene, colliders, block, M) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const naveW = 36;
  const naveD = 84;
  const naveH = 19;
  addBox(scene, M.stone, cx, 0.05, cz, naveW, naveH, naveD);
  colliders.add(cx, cz, naveW / 2, naveD / 2, 'cathedral');

  const roof = new THREE.Mesh(gableGeometry(), M.zinc);
  roof.scale.set(naveW + 1, 9, naveD + 1);
  roof.position.set(cx, naveH + 0.05, cz);
  roof.rotation.y = Math.PI / 2;
  roof.castShadow = true;
  scene.add(roof);

  // towers
  for (const s of [-1, 1]) {
    const tx = cx + s * 16;
    const tz = block.z2 - 22;
    addBox(scene, M.stone, tx, 0.05, tz, 12, 40, 12);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(8.5, 13, 8), M.zinc);
    spire.position.set(tx, 53, tz);
    spire.castShadow = true;
    scene.add(spire);
    colliders.add(tx, tz, 6.5, 6.5, 'cathedral');
    // clock / window
    const win = new THREE.Mesh(new THREE.CircleGeometry(3.1, 20), M.darkGlass);
    win.position.set(tx, 30, tz + 6.06);
    scene.add(win);
  }

  // rose window
  const rose = new THREE.Mesh(new THREE.CircleGeometry(5.4, 24), M.darkGlass);
  rose.position.set(cx, 24, block.z2 - 27.9);
  scene.add(rose);

  // portal
  addBox(scene, M.woodMat, cx, 0.05, block.z2 - 28, 7, 7.5, 1.2);
  addBox(scene, M.stoneDark, cx, 7.55, block.z2 - 28, 10, 0.6, 2.5);

  // buttresses
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      addBox(scene, M.stoneDark, cx + s * (naveW / 2 + 0.8), 0.05, cz + i * 15, 2.4, 12, 3.2);
    }
  }

  // plaza
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(block.x2 - block.x1 - 20, 0.08, 30), M.stoneLight);
  plaza.position.set(cx, 0.09, block.z2 - 20);
  plaza.receiveShadow = true;
  scene.add(plaza);
}

function buildMarket(scene, colliders, block, M, rng) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const hallW = 70;
  const hallD = 54;
  addBox(scene, M.stoneDark, cx, 0.05, cz, hallW, 1, hallD);
  // pillars
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      addCyl(scene, M.ironMat, cx + s * (hallW / 2 - 5), 1, cz + i * 10, 0.35, 0.4, 7, 8);
    }
  }
  const roof = new THREE.Mesh(gableGeometry(), M.redMat);
  roof.scale.set(hallW + 2, 12, hallD + 2);
  roof.position.set(cx, 8, cz);
  roof.rotation.y = Math.PI / 2;
  roof.castShadow = true;
  scene.add(roof);
  colliders.add(cx, cz, hallW / 2, hallD / 2, 'market');

  // stalls
  for (let i = 0; i < 5; i++) {
    const x = cx - 26 + i * 13;
    addBox(scene, M.white, x, 0.1, cz + 38, 8, 1, 4);
    addBox(scene, i % 2 ? M.redMat : M.stoneDark, x, 1.1, cz + 38, 8.4, 0.2, 4.4);
  }
  // vegetables (small colored boxes)
  const colors = ['#c65032', '#e0b23e', '#5e8a3e', '#7a4f86'];
  for (let i = 0; i < 36; i++) {
    addBox(
      scene,
      new THREE.MeshStandardMaterial({ color: colors[Math.floor(rng() * colors.length)], roughness: 0.8 }),
      cx - 28 + (i % 6) * 9,
      1.2,
      cz + 34 + Math.floor(i / 6) * 2,
      1.6,
      0.5,
      1.2,
      0,
      false
    );
  }
}

function buildStation(scene, colliders, block, M, animated) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const facadeZ = cz + 22;

  // main hall
  addBox(scene, M.stoneLight, cx, 0.05, cz + 2, 260, 15, 42);
  colliders.add(cx, cz + 2, 130, 21, 'station');
  // stone base
  addBox(scene, M.stoneDark, cx, 0.05, facadeZ + 3, 268, 2.4, 6);

  // arched glass canopy over the platforms
  const canopy = new THREE.Group();
  const canopyGeo = new THREE.CylinderGeometry(18, 18, 180, 24, 1, true, 0, Math.PI);
  const canopyMesh = new THREE.Mesh(canopyGeo, M.paleGlass);
  canopyMesh.rotation.z = Math.PI / 2;
  canopyMesh.rotation.y = Math.PI / 2;
  canopyMesh.position.set(cx - 20, 15 + 2, cz - 16);
  canopy.add(canopyMesh);
  for (let i = 0; i < 11; i++) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(18, 0.26, 5, 24, Math.PI), M.ironMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(cx - 100 + i * 20, 17, cz - 16);
    canopy.add(arch);
  }
  scene.add(canopy);

  // clock
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 24),
    new THREE.MeshStandardMaterial({ color: '#f0e8d6', roughness: 0.5 })
  );
  clockFace.position.set(cx, 10.5, facadeZ + 23.1);
  scene.add(clockFace);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.1), M.ironMat);
  hand.position.set(cx, 10.8, facadeZ + 23.2);
  scene.add(hand);
  animated.push({ update: (dt) => { hand.rotation.z -= dt * 0.05; } });

  // sign
  const sign = makeTextPlane('GRENOBLE', { width: 1024, height: 160, fontSize: 92, bg: 'rgba(16,32,38,0.88)' });
  sign.position.set(cx, 13.4, facadeZ + 23.3);
  sign.scale.set(32, 5, 1);
  scene.add(sign);
  const sub = makeTextPlane('GARE SNCF · TGV', { width: 1024, height: 128, fontSize: 46, accent: '#84e9ed' });
  sub.position.set(cx, 11.7, facadeZ + 23.32);
  sub.scale.set(22, 2.75, 1);
  scene.add(sub);

  // entrances
  for (let i = -1; i <= 1; i++) {
    addBox(scene, M.darkGlass, cx + i * 42, 0.1, facadeZ + 21.5, 18, 8, 1.2);
  }

  // tracks / platforms
  const trackMat = new THREE.MeshStandardMaterial({ color: '#494b4d', roughness: 0.94 });
  for (let i = 0; i < 4; i++) {
    addBox(scene, trackMat, cx - 45 + i * 30, 0.07, cz - 32, 4, 0.12, 150);
    addBox(scene, M.stoneLight, cx - 30 + i * 30, 0.08, cz - 32, 8, 0.5, 150);
  }
}

function buildMuseum(scene, colliders, block, M) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  // two volumes
  addBox(scene, M.stoneLight, cx - 25, 0.05, cz, 74, 16, 74);
  addBox(scene, M.darkGlass, cx + 45, 0.05, cz + 6, 46, 22, 66);
  colliders.add(cx - 25, cz, 37, 37, 'museum');
  colliders.add(cx + 45, cz + 6, 23, 33, 'museum');
  // portico
  for (let i = 0; i < 6; i++) {
    addCyl(scene, M.white, cx - 58 + i * 8, 0.05, cz - 38, 0.6, 0.7, 11, 12);
  }
  addBox(scene, M.concrete, cx - 38, 11, cz - 38, 52, 1.2, 6);
  // plaza
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(block.x2 - block.x1 - 30, 0.08, 45), M.pathMat);
  plaza.position.set(cx, 0.09, block.z2 - 25);
  plaza.receiveShadow = true;
  scene.add(plaza);
  // sculpture
  const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(3.2, 0.75, 70, 10), M.ironMat);
  sculpt.position.set(cx + 20, 5, block.z2 - 28);
  sculpt.castShadow = true;
  scene.add(sculpt);
  colliders.add(cx + 20, block.z2 - 28, 4.5, 4.5, 'sculpture');
}

function buildCampus(scene, colliders, block, M, trees, rng) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  addBox(scene, M.darkGlass, cx - 20, 0.05, cz - 15, 55, 18, 36);
  addBox(scene, M.stoneLight, cx + 28, 0.05, cz + 22, 46, 14, 30);
  colliders.add(cx - 20, cz - 15, 28, 18, 'campus');
  colliders.add(cx + 28, cz + 22, 23, 15, 'campus');
  for (let i = 0; i < 8; i++) {
    trees.push({ x: cx - 70 + rng() * 140, z: cz + 50 + rng() * 25, type: 'broad', scale: 0.8 + rng() * 0.4 });
  }
  const sign = makeTextPlane('UNIVERSITÉ GRENOBLE-ALPES', {
    width: 1024,
    height: 128,
    fontSize: 48,
    bg: 'rgba(18,38,46,0.92)',
  });
  sign.position.set(cx, 6.5, block.z2 - 16);
  sign.scale.set(22, 2.75, 1);
  scene.add(sign);
}

function buildStadium(scene, colliders, block, M) {
  const cx = (block.x1 + block.x2) / 2;
  const cz = (block.z1 + block.z2) / 2;
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(85, 72, 19, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#c8c6bd', roughness: 0.82, side: THREE.DoubleSide })
  );
  bowl.position.set(cx, 9.5, cz);
  bowl.scale.set(1.25, 1, 1);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  scene.add(bowl);
  const pitch = new THREE.Mesh(new THREE.CircleGeometry(58, 40), M.grassMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(cx, 0.17, cz);
  scene.add(pitch);
  const lines = new THREE.Mesh(new THREE.RingGeometry(55, 55.5, 40), new THREE.MeshBasicMaterial({ color: '#e7e2cf' }));
  lines.rotation.x = -Math.PI / 2;
  lines.position.set(cx, 0.19, cz);
  scene.add(lines);

  const roof = new THREE.Mesh(new THREE.TorusGeometry(84, 3.2, 8, 56), M.white);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(cx, 19, cz);
  roof.scale.set(1.25, 1, 1);
  scene.add(roof);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = cx + Math.cos(a) * 105;
    const pz = cz + Math.sin(a) * 105;
    addCyl(scene, M.ironMat, px, 0.05, pz, 0.6, 0.8, 38, 8);
    addBox(scene, M.white, px, 38, pz, 7, 1.2, 3.5);
  }
  // stands colliders
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    colliders.add(cx + Math.cos(a) * 85, cz + Math.sin(a) * 85, 40, 16, 'stadium');
  }
}

function buildTourPerret(scene, colliders, M) {
  const x = 910;
  const z = 920;
  const height = 98;
  const base = 14;
  const mat = new THREE.MeshStandardMaterial({ color: '#c2beb0', roughness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: '#8f8c82', roughness: 0.85 });

  // base
  addBox(scene, mat, x, 0.05, z, base, 8, base);
  // four piers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(scene, mat, x + sx * 4.8, 8, z + sz * 4.8, 3.8, height - 8, 3.8);
    }
  }
  // cross bracing every 12 m
  for (let y = 12; y < height - 8; y += 11) {
    addBox(scene, dark, x, y, z - 4.8, 12, 0.55, 0.55);
    addBox(scene, dark, x, y, z + 4.8, 12, 0.55, 0.55);
    addBox(scene, dark, x - 4.8, y, z, 0.55, 0.55, 12);
    addBox(scene, dark, x + 4.8, y, z, 0.55, 0.55, 12);
    for (const s of [-1, 1]) {
      const brace = addBox(scene, dark, x, y + 5.5, z + s * 1.6, 10.5, 0.35, 0.35);
      brace.rotation.z = 0.72 * s;
    }
  }
  // observation levels
  addBox(scene, dark, x, 70, z, 17, 2.2, 17);
  addBox(scene, mat, x, 74, z, 15, 1.4, 15);
  addBox(scene, mat, x, height, z, 20, 2, 20);
  addBox(scene, dark, x, height + 2, z, 2, 18, 2);
  addCyl(scene, dark, x, height + 20, z, 0.3, 0.6, 8, 6);
  // red beacon
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#ff4f3c' })
  );
  beacon.position.set(x, height + 30, z);
  scene.add(beacon);
  colliders.add(x, z, 12, 12, 'tower');
  // plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(46, 36), M.stoneLight);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(x, 0.1, z);
  scene.add(plaza);
}

/* ──────────────────────────────────────────────────────────────
   Streets, props
   ────────────────────────────────────────────────────────────── */
function buildLaneMarkings(scene) {
  const mats = new THREE.MeshStandardMaterial({ color: '#ddd8c8', roughness: 0.75 });
  const dashGeo = new THREE.BoxGeometry(3.2, 0.025, 0.22);
  const transforms = [];
  const pickLines = [...WIDE_ROADS_X].map((v) => ({ axis: 'x', v }))
    .concat([...WIDE_ROADS_Z].map((v) => ({ axis: 'z', v })));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const line of pickLines) {
    if (line.axis === 'x') {
      const w = roadWidthX(line.v);
      for (const off of [-w / 4, w / 4]) {
        for (let z = CITY.z1 + 12; z < CITY.z2 - 12; z += 9) {
          m.compose(
            new THREE.Vector3(line.v + off, 0.075, z),
            q,
            new THREE.Vector3(1, 1, 1)
          );
          transforms.push(m.clone());
        }
      }
    } else {
      const w = roadWidthZ(line.v);
      for (const off of [-w / 4, w / 4]) {
        for (let x = CITY.x1 + 12; x < CITY.x2 - 12; x += 9) {
          const mm = new THREE.Matrix4();
          mm.compose(
            new THREE.Vector3(x, 0.075, line.v + off),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
            new THREE.Vector3(1, 1, 1)
          );
          transforms.push(mm);
        }
      }
    }
  }
  const inst = new THREE.InstancedMesh(dashGeo, mats, transforms.length);
  transforms.forEach((t, i) => inst.setMatrixAt(i, t));
  inst.receiveShadow = true;
  scene.add(inst);
}

function buildStreetLights(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 7.2, 6);
  const armGeo = new THREE.BoxGeometry(1.8, 0.14, 0.14);
  const lampGeo = new THREE.BoxGeometry(0.55, 0.18, 0.28);
  const metal = new THREE.MeshStandardMaterial({ color: '#343d3f', roughness: 0.55, metalness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({
    color: '#fff1cf',
    emissive: '#ffd9a0',
    emissiveIntensity: 0.45,
    roughness: 0.4,
  });

  const positions = [];
  const mainX = [...WIDE_ROADS_X];
  const mainZ = [...WIDE_ROADS_Z];
  for (const x of mainX) {
    for (let z = CITY.z1 + 35; z < CITY.z2; z += 58) {
      positions.push({ x: x + roadWidthX(x) / 2 - 1.2, z, ry: Math.PI });
      positions.push({ x: x - roadWidthX(x) / 2 + 1.2, z: z + 26, ry: 0 });
    }
  }
  for (const z of mainZ) {
    for (let x = CITY.x1 + 35; x < CITY.x2; x += 58) {
      positions.push({ x, z: z + roadWidthZ(z) / 2 - 1.2, ry: -PI2 });
      positions.push({ x: x + 26, z: z - roadWidthZ(z) / 2 + 1.2, ry: PI2 });
    }
  }

  const poles = new THREE.InstancedMesh(poleGeo, metal, positions.length);
  const arms = new THREE.InstancedMesh(armGeo, metal, positions.length);
  const lamps = new THREE.InstancedMesh(lampGeo, glow, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  positions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
    m.compose(new THREE.Vector3(p.x, 3.62, p.z), q, one);
    poles.setMatrixAt(i, m);
    const dx = Math.sin(p.ry) * 0.9;
    const dz = Math.cos(p.ry) * 0.9;
    m.compose(new THREE.Vector3(p.x + dx, 7.15, p.z + dz), q, one);
    arms.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x + dx * 1.9, 7.02, p.z + dz * 1.9), q, one);
    lamps.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  scene.add(poles, arms, lamps);
}

function buildParkedCars(scene, colliders, rng) {
  const bodyGeoRaw = new THREE.BoxGeometry(4.1, 0.75, 1.75);
  bodyGeoRaw.translate(0, 0.62, 0);
  const cabinGeoRaw = new THREE.BoxGeometry(2.15, 0.62, 1.6);
  cabinGeoRaw.translate(-0.1, 1.3, 0);
  const wheelGeoRaw = new THREE.BoxGeometry(0.62, 0.62, 0.18);
  const wheels = [];
  for (const x of [-1.35, 1.35]) {
    for (const z of [-0.88, 0.88]) {
      const g = wheelGeoRaw.clone();
      g.translate(x, 0.36, z);
      wheels.push(g);
    }
  }
  const wheelGeo = mergeGeometries(wheels);
  const bodyGeo = mergeGeometries([bodyGeoRaw]);
  const cabinGeo = mergeGeometries([cabinGeoRaw]);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#243238', roughness: 0.2, metalness: 0.4 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#15191b', roughness: 0.9 });

  const palette = ['#c8c9c2', '#6b7b86', '#9d3c33', '#354f6b', '#d3b265', '#4d5e50', '#e5e3dc', '#222a2d'];
  const placements = [];
  let guard = 0;
  while (placements.length < 150 && guard++ < 800) {
    const horizontal = rng() < 0.5;
    if (horizontal) {
      const zLine = ROAD_Z[1 + Math.floor(rng() * (ROAD_Z.length - 2))];
      const side = rng() < 0.5 ? 1 : -1;
      const z = zLine + side * (roadWidthZ(zLine) / 2 - 2.4);
      const x = CITY.x1 + 40 + rng() * (CITY.x2 - CITY.x1 - 80);
      if (nearIntersection(x, z, 22)) continue;
      if (Math.abs(z - 0) < 8 && x > -260 && x < -20) continue;
      if (Math.abs(x - 910) < 80 && Math.abs(z - 910) < 80) continue;
      const ry = side > 0 ? Math.PI : 0;
      placements.push({ x, z, ry, hw: 2.2, hd: 1.05 });
    } else {
      const xLine = ROAD_X[1 + Math.floor(rng() * (ROAD_X.length - 2))];
      const side = rng() < 0.5 ? 1 : -1;
      const x = xLine + side * (roadWidthX(xLine) / 2 - 2.4);
      const z = CITY.z1 + 40 + rng() * (CITY.z2 - CITY.z1 - 80);
      if (nearIntersection(x, z, 22)) continue;
      if (Math.abs(x - 260) < 8 && Math.abs(z) < 300) continue;
      const ry = side > 0 ? -PI2 : PI2;
      placements.push({ x, z, ry, hw: 1.05, hd: 2.2 });
    }
  }

  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, placements.length);
  const cabins = new THREE.InstancedMesh(cabinGeo, glassMat, placements.length);
  const wheelMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  placements.forEach((p, i) => {
    q.setFromAxisAngle(up, p.ry);
    m.compose(new THREE.Vector3(p.x, 0.06, p.z), q, new THREE.Vector3(1, 1, 1));
    bodies.setMatrixAt(i, m);
    cabins.setMatrixAt(i, m);
    wheelMesh.setMatrixAt(i, m);
    bodies.setColorAt(i, new THREE.Color(palette[Math.floor(rng() * palette.length)]));
    colliders.add(p.x, p.z, p.hw, p.hd, 'parked');
  });
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  bodies.castShadow = true;
  cabins.castShadow = true;
  bodies.receiveShadow = true;
  scene.add(bodies, cabins, wheelMesh);
}

function nearIntersection(x, z, r) {
  for (const rx of ROAD_X) {
    if (Math.abs(x - rx) < r) {
      for (const rz of ROAD_Z) if (Math.abs(z - rz) < r) return true;
    }
  }
  return false;
}

function buildBenches(scene, M, trees) {
  const seatGeo = new THREE.BoxGeometry(2.8, 0.16, 0.7);
  const backGeo = new THREE.BoxGeometry(2.8, 0.7, 0.14);
  backGeo.rotateX(-0.12);
  backGeo.translate(0, 0.45, -0.28);
  const merged = mergeGeometries([seatGeo, backGeo]);
  const rng = mulberry32(556);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spots = [];

  // Jardin de Ville ring
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    spots.push({ x: 390 + Math.cos(a) * 62, z: -130 + Math.sin(a) * 62, ry: -a + PI2 });
  }
  // Place Grenette ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    spots.push({ x: 130 + Math.cos(a) * 44, z: 130 + Math.sin(a) * 44, ry: -a + PI2 });
  }
  // Paul Mistral
  for (let i = 0; i < 8; i++) {
    spots.push({ x: 830 + rng() * 160, z: 830 + rng() * 160, ry: rng() * Math.PI * 2 });
  }
  // Jardin des Plantes
  for (let i = 0; i < 8; i++) {
    spots.push({ x: -1260 + rng() * 160, z: 1340 + rng() * 180, ry: rng() * Math.PI * 2 });
  }
  // Quays of the Isère
  for (let i = 0; i < 16; i++) {
    spots.push({ x: -660 + i * 30, z: -874, ry: 0 });
  }
  // Place Victor Hugo
  for (let i = 0; i < 6; i++) {
    spots.push({ x: 550 + rng() * 190, z: 30 + rng() * 190, ry: rng() * Math.PI * 2 });
  }

  const inst = new THREE.InstancedMesh(merged, M.woodMat, spots.length);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
    m.compose(new THREE.Vector3(p.x, 0.25, p.z), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m);
  });
  inst.castShadow = true;
  scene.add(inst);
}

/* ──────────────────────────────────────────────────────────────
   Riverbank & bridges
   ────────────────────────────────────────────────────────────── */
function buildRiverPromenade(scene, colliders, M, trees) {
  // A gravel texture that repeats in metres, used by all the ribbon paths.
  const gravel = canvasTexture(256, 256, (ctx, w, h) => {
    const rng = mulberry32(6612);
    ctx.fillStyle = '#a99d88';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 130 + rng() * 90;
      ctx.fillStyle = `rgba(${v}, ${v * 0.95}, ${v * 0.84}, ${0.2 + rng() * 0.45})`;
      const r = 0.6 + rng() * 2.2;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(81, 70, 55, 0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);
  }, { repeat: [1, 1], anisotropy: 8 });
  gravel.wrapS = gravel.wrapT = THREE.RepeatWrapping;
  const pathMat = new THREE.MeshStandardMaterial({
    map: gravel,
    roughness: 0.98,
    color: '#d4c6ae',
  });

  const makePath = (points2d, width, yOffset = 0.16) => {
    const smooth = catmullPoints2D(points2d, 46);
    const points = smooth.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + yOffset, z));
    const geo = makeRibbon(points, width, 0, 0.28);
    const mesh = new THREE.Mesh(geo, pathMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // main riverside walk, following the south bank between the Bastille bridge
  // and the eastern quays
  const riverWalk = [
    [-690, -892],
    [-580, -905],
    [-460, -918],
    [-340, -928],
    [-200, -936],
    [-40, -946],
    [140, -956],
    [340, -968],
    [520, -980],
  ];
  makePath(riverWalk, 11);

  // approach from the old town / Saint-Laurent to the téléphérique
  makePath([
    [-430, -782],
    [-430, -815],
    [-430, -855],
    [-430, -895],
    [-430, -930],
    [-430, -955],
  ], 12);

  // broad forecourt in front of the lower lift station
  makePath([
    [-430, -936],
    [-430, -950],
    [-430, -962],
    [-430, -974],
  ], 28);

  // branching link between the river walk and the lift forecourt
  makePath([
    [-540, -907],
    [-500, -920],
    [-465, -935],
  ], 8);

  const benchSpots = [
    [-612, -890], [-460, -906], [-300, -921], [-120, -936],
    [70, -946], [250, -959], [435, -971],
  ];
  for (const [x, z] of benchSpots) {
    const y = heightAt(x, z + 9) + 0.14;
    addBox(scene, M.woodMat, x, y, z + 9, 3.2, 0.42, 0.75, 0, true, true);
    addBox(scene, M.woodMat, x, y + 0.42, z + 9.31, 3.2, 0.68, 0.12, 0, true, true);
    addBox(scene, M.ironMat, x - 1.15, y, z + 9, 0.12, 0.5, 0.55, 0, true, true);
    addBox(scene, M.ironMat, x + 1.15, y, z + 9, 0.12, 0.5, 0.55, 0, true, true);
  }

  // poplars and park trees on the city side of the walk
  const treeSpots = [
    [-655, -876], [-550, -888], [-405, -902], [-255, -914], [-90, -925],
    [85, -937], [255, -948], [430, -962],
  ];
  for (const [x, z] of treeSpots) {
    trees.push({ x, z, type: 'broad', scale: 1.0 + ((x + z) % 3) * 0.08 });
    if ((x + z) % 2 === 0) {
      trees.push({ x: x + 13, z: z + 13, type: 'broad', scale: 0.78 });
    }
  }

  // lamps along the Isère
  const lampGlass = new THREE.MeshStandardMaterial({
    color: '#fff0c9',
    emissive: '#ffdf9d',
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });
  for (let i = 0; i < 7; i++) {
    const x = -620 + i * 180;
    const z = -884 - i * 7.1;
    const y = heightAt(x, z) + 0.1;
    addCyl(scene, M.ironMat, x, y, z, 0.08, 0.13, 5.6, 7, false);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), lampGlass);
    lamp.position.set(x, y + 5.9, z);
    scene.add(lamp);
  }

  // interpretation signs at the lift and the bridge
  const riverSign = makeTextPlane("PROMENADE DE L'ISÈRE", {
    width: 1024,
    height: 170,
    fontSize: 64,
    accent: '#78c9cd',
    bg: 'rgba(10, 24, 29, 0.92)',
  });
  const signY = heightAt(-430, -905) + 2.5;
  riverSign.position.set(-430, signY, -905);
  riverSign.scale.set(9.5, 1.58, 1);
  scene.add(riverSign);
  addCyl(scene, M.ironMat, -438, heightAt(-430, -905), -905, 0.08, 0.11, 3.3, 7, false);
  addCyl(scene, M.ironMat, -422, heightAt(-430, -905), -905, 0.08, 0.11, 3.3, 7, false);

  addBox(scene, M.stoneDark, -430, heightAt(-430, -994) + 0.1, -994, 40, 0.8, 5, 0, false, true);

  // a small boat landing and mooring posts give the river an inhabited edge
  const landingY = heightAt(-190, -1002) + 0.1;
  addBox(scene, M.woodMat, -190, landingY, -1002, 26, 0.35, 7, 0, false, true);
  for (let i = 0; i < 4; i++) {
    addCyl(scene, M.woodMat, -202 + i * 8, landingY - 0.4, -1004, 0.16, 0.2, 1.8, 6, false);
  }
}

function buildBridge(scene, colliders, bridge, M) {
  const length = bridge.z2 - bridge.z1;
  const cz = (bridge.z1 + bridge.z2) / 2;
  const width = 34;

  // deck
  const deck = addBox(scene, M.concreteDark, bridge.x, 0.03, cz, width, 0.9, length, 0, true, true);
  deck.receiveShadow = true;
  // asphalt top
  addBox(
    scene,
    new THREE.MeshStandardMaterial({ color: '#3f4245', roughness: 0.92 }),
    bridge.x,
    0.93,
    cz,
    width - 6,
    0.06,
    length - 2
  );
  // sidewalks
  for (const s of [-1, 1]) {
    addBox(scene, M.stoneLight, bridge.x + s * (width / 2 - 2), 0.95, cz, 4, 0.25, length);
    addBox(scene, M.stoneDark, bridge.x + s * (width / 2 - 0.5), 1.0, cz, 1, 1.4, length);
    colliders.add(bridge.x + s * (width / 2 - 0.5), cz, 0.6, length / 2, 'parapet');
  }
  // piers and shallow arches, all kept below the deck
  const inner = Math.max(140, length - 160);
  const bays = Math.max(2, Math.round(inner / 150));
  const spacing = inner / bays;
  for (let i = 0; i <= bays; i++) {
    const z = bridge.z1 + 80 + i * spacing;
    if (z > bridge.z2 - 40) break;
    addBox(scene, M.stoneDark, bridge.x, -10.6, z, width - 4, 10, 6);
  }
  // lamps follow the actual span of each bridge
  const lamps = Math.max(2, Math.round(length / 90));
  for (let i = 0; i < lamps; i++) {
    const z = bridge.z1 + 30 + (i * (length - 60)) / (lamps - 1);
    for (const s of [-1, 1]) {
      addCyl(scene, M.ironMat, bridge.x + s * (width / 2 - 1.4), 1.2, z, 0.08, 0.1, 4.2, 6);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshStandardMaterial({ color: '#ffe8bb', emissive: '#ffd28e', emissiveIntensity: 0.6 })
      );
      lamp.position.set(bridge.x + s * (width / 2 - 1.4), 5.5, z);
      scene.add(lamp);
    }
  }
}

function addCitySign(scene, x, z, main, sub, accent) {
  const y = heightAt(x, z);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.18, 3.4, 6),
    new THREE.MeshStandardMaterial({ color: '#4b4b45', roughness: 0.8 })
  );
  post.position.set(x, y + 1.7, z);
  scene.add(post);
  const sign = makeTextPlane(main, {
    width: 768,
    height: 192,
    fontSize: 58,
    accent,
    bg: 'rgba(10,22,28,0.9)',
  });
  sign.position.set(x, y + 4, z);
  sign.scale.set(6, 1.5, 1);
  scene.add(sign);
  const detail = makeTextPlane(sub, { width: 768, height: 96, fontSize: 30, bg: 'rgba(10,22,28,0.85)' });
  detail.position.set(x, y + 3.1, z + 0.01);
  detail.scale.set(6, 0.75, 1);
  scene.add(detail);
}
