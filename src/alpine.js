import * as THREE from 'three';
import { TRAILS, PISTES, LANDMARKS } from './data.js';
import { heightAt, slopeAt } from './terrain.js';
import {
  makeRibbon,
  catmullPoints2D,
  pointToPolylineDistance,
  makeSignTexture,
  canvasTexture,
  clamp,
  lerp,
  smoothstep,
  mulberry32,
  makeTextPlane,
  setShadowRecursive,
} from './utils.js';

function addBox(scene, mat, x, y, z, w, h, d, ry = 0, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addCyl(scene, mat, x, y, z, rTop, rBot, h, ry = 0, cast = true) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function signPanel(textLines, opts = {}) {
  const tex = makeSignTexture(textLines, {
    width: 512,
    height: 384,
    bg: opts.bg ?? '#2c3b2c',
    accent: opts.accent ?? '#ffb257',
    ...opts,
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.55), mat);
}

function woodenSign(scene, x, z, y, lines, facing = 0, accent = '#ffb257', width = 3.4) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#6b5137', roughness: 0.86 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.1, 6), wood);
    post.position.set(s * (width / 2 - 0.38), 1.55, 0);
    post.castShadow = true;
    group.add(post);
  }
  const panel = signPanel(lines, { accent });
  panel.scale.set(width / 3.4, 1, 1);
  panel.position.y = 2.5;
  group.add(panel);
  group.position.set(x, y, z);
  group.rotation.y = facing;
  scene.add(group);
  return group;
}

/* ──────────────────────────────────────────────────────────────
   Trails
   ────────────────────────────────────────────────────────────── */
function buildTrail(scene, trail) {
  const samples2D = catmullPoints2D(trail.points, 320);
  const pts = samples2D.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z));
  const width = 4.2;
  const shoulder = new THREE.Mesh(
    makeRibbon(pts, width + 2.4, 0.12),
    new THREE.MeshStandardMaterial({ color: '#6d5b43', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  shoulder.receiveShadow = true;
  scene.add(shoulder);
  const ribbon = new THREE.Mesh(
    makeRibbon(pts, width, 0.28),
    new THREE.MeshStandardMaterial({ color: '#a4885f', roughness: 0.98, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  );
  ribbon.receiveShadow = true;
  scene.add(ribbon);

  // cumulative distance + elevation
  let total = 0;
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    total += pts[i].distanceTo(pts[i + 1]);
    cum.push(total);
  }
  const start = pts[0];
  const end = pts[pts.length - 1];
  const gain = Math.round(end.y - start.y);

  // waypoint posts
  const postMat = new THREE.MeshStandardMaterial({ color: '#5e4a35', roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: trail.color, roughness: 0.6 });
  const postGroup = new THREE.Group();
  const stride = Math.max(24, Math.floor(pts.length / 13));
  for (let i = stride; i < pts.length - 4; i += stride) {
    const p = pts[i];
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.25, 6), postMat);
    post.position.set(p.x, p.y + 0.62, p.z);
    post.castShadow = true;
    postGroup.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.06), capMat);
    cap.position.set(p.x, p.y + 1.25, p.z);
    postGroup.add(cap);
  }
  scene.add(postGroup);

  // trailhead sign
  const yStart = start.y;
  woodenSign(
    scene,
    start.x,
    start.z,
    yStart,
    [
      { text: trail.name.toUpperCase(), accent: true },
      { text: `${trail.difficulty} · ${trail.duration} · +${gain} M`, small: true },
      { text: 'SENTIER BALISÉ', small: true },
    ],
    Math.PI,
    trail.color
  );
  // end sign
  woodenSign(
    scene,
    end.x,
    end.z,
    end.y,
    [
      { text: trail.en.toUpperCase(), accent: true },
      { text: `ALTITUDE ${Math.round(212 + end.y)} M`, small: true },
      { text: 'GRENOBLE ALPES', small: true },
    ],
    Math.PI * 0.85,
    trail.color
  );

  return {
    ...trail,
    pts,
    samples2D,
    cumulative: cum,
    total,
    gain,
    startElevation: 212 + start.y,
    endElevation: 212 + end.y,
    ribbon,
  };
}

/* ──────────────────────────────────────────────────────────────
   Pistes
   ────────────────────────────────────────────────────────────── */
function buildPiste(scene, piste, snowMaterials) {
  const samples2D = catmullPoints2D(piste.points, 180);
  const pts = samples2D.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z));
  const mat = new THREE.MeshStandardMaterial({
    color: '#9caa8b',
    roughness: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  snowMaterials.push({ mat, summer: new THREE.Color('#9caa8b'), winter: new THREE.Color('#edf3f5') });
  const mesh = new THREE.Mesh(makeRibbon(pts, 22, 0.24), mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // edge marker poles
  const poleMat = new THREE.MeshStandardMaterial({ color: '#d9d6cb', roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ color: piste.color, roughness: 0.5 });
  for (let i = 6; i < pts.length - 4; i += 9) {
    const p = pts[i];
    const next = pts[i + 1];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    for (const s of [-1, 1]) {
      const px = p.x + nx * s * 11.5;
      const pz = p.z + nz * s * 11.5;
      const py = heightAt(px, pz);
      addCyl(scene, poleMat, px, py, pz, 0.035, 0.05, 1.9, 0, false);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.38, 0.05), capMat);
      cap.position.set(px, py + 2.0, pz);
      scene.add(cap);
    }
  }

  // top sign
  const top = pts[pts.length - 1];
  const drop = Math.round(Math.abs(pts[0].y - top.y));
  woodenSign(
    scene,
    top.x,
    top.z,
    top.y,
    [
      { text: piste.name.toUpperCase(), accent: true },
      { text: `${piste.level} · ${drop} M DE DÉNIVELÉ`, small: true },
      { text: 'DOMAINE DE CHAMROUSSE', small: true },
    ],
    Math.PI * 0.8,
    piste.color
  );

  return { ...piste, pts, samples2D, mesh };
}

/* ──────────────────────────────────────────────────────────────
   Fort de la Bastille
   ────────────────────────────────────────────────────────────── */
function buildFort(scene, colliders) {
  const cx = -760;
  const cz = -2000;
  const baseY = heightAt(cx, cz);
  const stone = new THREE.MeshStandardMaterial({ color: '#a79b85', roughness: 0.93 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: '#817765', roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#5c696c', roughness: 0.7, metalness: 0.15 });
  const iron = new THREE.MeshStandardMaterial({ color: '#333b3c', roughness: 0.5, metalness: 0.6 });
  const flags = [];
  const animated = [];

  // courtyard slab
  const court = new THREE.Mesh(new THREE.CircleGeometry(97, 40), new THREE.MeshStandardMaterial({ color: '#b1a692', roughness: 0.94 }));
  court.rotation.x = -Math.PI / 2;
  court.position.set(cx, baseY + 0.12, cz);
  court.receiveShadow = true;
  scene.add(court);

  const R = 92;
  const sides = 12;
  const gapCenter = Math.PI / 2; // south
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const diff = Math.abs(((mid - gapCenter + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff < 0.27) continue; // gate opening
    const x0 = cx + Math.cos(a0) * R;
    const z0 = cz + Math.sin(a0) * R;
    const x1 = cx + Math.cos(a1) * R;
    const z1 = cz + Math.sin(a1) * R;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    addBox(scene, stoneDark, mx, baseY, mz, 3.8, 8.4, len, ry);
    colliders.add(mx, mz, Math.abs(x1 - x0) / 2 + 2, Math.abs(z1 - z0) / 2 + 2, 'fort-wall');
    // crenellations
    const n = Math.max(2, Math.floor(len / 6));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      addBox(scene, stone, px, baseY + 8.4, pz, 2.2, 1.6, 1.8, ry);
    }
    // towers at joints
    if (i % 2 === 0) {
      const tx = x0;
      const tz = z0;
      addCyl(scene, stone, tx, baseY, tz, 6.2, 7, 13, 0);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 6.5, 8), roofMat);
      roof.position.set(tx, baseY + 19.5, tz);
      roof.castShadow = true;
      scene.add(roof);
      colliders.add(tx, tz, 7, 7, 'fort-tower');
    }
  }

  // gate towers & arch
  const gateZ = cz + R - 2;
  for (const s of [-1, 1]) {
    addCyl(scene, stone, cx + s * 15, baseY, gateZ, 5.2, 6, 15, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 5.2, 8), roofMat);
    roof.position.set(cx + s * 15, baseY + 20.2, gateZ);
    roof.castShadow = true;
    scene.add(roof);
    colliders.add(cx + s * 15, gateZ, 6, 6, 'fort-gate');
  }
  addBox(scene, stone, cx, baseY + 11.5, gateZ, 25, 3.2, 3.6);
  const gateSign = makeTextPlane('FORT DE LA BASTILLE', {
    width: 1024,
    height: 160,
    fontSize: 64,
    bg: 'rgba(18,30,32,0.9)',
    accent: '#ffb257',
  });
  gateSign.position.set(cx, baseY + 10, gateZ + 2.1);
  gateSign.scale.set(15, 2.34, 1);
  scene.add(gateSign);

  // keep — set back from the courtyard so the téléphérique station stays clear
  addBox(scene, stone, cx + 45, baseY, cz - 38, 26, 13, 20);
  colliders.add(cx + 45, cz - 38, 14, 11, 'fort-keep');
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(19, 8, 4), roofMat);
  keepRoof.rotation.y = Math.PI / 4;
  keepRoof.position.set(cx + 45, baseY + 17, cz - 38);
  keepRoof.castShadow = true;
  scene.add(keepRoof);

  // chapel / museum
  addBox(scene, stoneDark, cx - 34, baseY, cz - 5, 20, 8, 13);
  const chapelRoof = new THREE.Mesh(new THREE.ConeGeometry(13, 5, 4), roofMat);
  chapelRoof.rotation.y = Math.PI / 4;
  chapelRoof.position.set(cx - 34, baseY + 10.5, cz - 5);
  chapelRoof.castShadow = true;
  scene.add(chapelRoof);
  colliders.add(cx - 34, cz - 5, 11, 8, 'fort-chapel');

  // terrace railing on the south edge
  for (let i = -12; i <= 12; i++) {
    const x = cx + i * 6;
    addCyl(scene, iron, x, baseY + 0.1, cz + R - 15, 0.06, 0.06, 1.15, 0, false);
  }
  addBox(scene, iron, cx, baseY + 1.15, cz + R - 15, 148, 0.08, 0.08);

  // telescopes
  for (const s of [-1, 1]) {
    const tx = cx + s * 35;
    const tz = cz + R - 24;
    addCyl(scene, iron, tx, baseY + 0.1, tz, 0.12, 0.22, 1.1, 0);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.3, 8), iron);
    scope.position.set(tx, baseY + 1.7, tz);
    scope.rotation.x = Math.PI / 2.5;
    scope.rotation.z = 0.2;
    scope.castShadow = true;
    scene.add(scope);
  }

  // café terrace
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx - 5 + Math.cos(a) * 38;
    const z = cz + Math.sin(a) * 38;
    addCyl(scene, stone, x, baseY + 0.12, z, 0.8, 0.14, 0.85, 0);
    addCyl(scene, iron, x, baseY + 0.12, z, 0.05, 0.05, 0.72, 0);
  }

  // flags
  const poleMat = new THREE.MeshStandardMaterial({ color: '#cfcfc6', roughness: 0.35, metalness: 0.7 });
  const flagDefs = [
    { color: '#ffffff', stripe: '#d43b3b', x: cx - 8, z: cz + R - 26 },
    { color: '#2e6fae', stripe: '#f4f1e8', x: cx + 45, z: cz + R - 30 },
  ];
  for (const f of flagDefs) {
    addCyl(scene, poleMat, f.x, baseY, f.z, 0.07, 0.09, 11, 0);
    const cloth = new THREE.Group();
    const tex = canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = f.stripe;
      ctx.fillRect(0, h * 0.33, w, h * 0.18);
      ctx.fillRect(0, h * 0.62, w, h * 0.18);
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.1, 6, 2),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 })
    );
    plane.position.set(1.7, 0, 0);
    cloth.add(plane);
    cloth.position.set(f.x, baseY + 9.7, f.z);
    scene.add(cloth);
    flags.push({ cloth, phase: Math.random() * 4 });
  }

  // fortress sign panel near gate
  woodenSign(
    scene,
    cx - 26,
    gateZ - 2,
    baseY,
    [
      { text: 'FORT DE LA BASTILLE', accent: true },
      { text: '476 M · PANORAMA SUR LES ALPES', small: true },
      { text: 'TÉLÉPHÉRIQUE · SENTIERS · CAFÉ', small: true },
    ],
    Math.PI,
    '#ffb257',
    4.2
  );

  // trees on the plateau edge
  const trees = [];
  const rng = mulberry32(5091);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = 60 + rng() * 25;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    trees.push({ x, z, y: heightAt(x, z), type: 'conifer', scale: 0.8 + rng() * 0.6 });
  }

  return {
    baseY,
    trees,
    flags,
    update(dt, time) {
      for (const f of flags) {
        f.cloth.rotation.y = Math.sin(time * 1.6 + f.phase) * 0.18 - 0.25;
        f.cloth.children[0].scale.y = 1 + Math.sin(time * 2.1 + f.phase) * 0.06;
      }
    },
  };
}

/* ──────────────────────────────────────────────────────────────
   Chamrousse snowfront & viewpoints
   ────────────────────────────────────────────────────────────── */
function buildChamrousse(scene, colliders) {
  const wood = new THREE.MeshStandardMaterial({ color: '#6a4d35', roughness: 0.85 });
  const woodLight = new THREE.MeshStandardMaterial({ color: '#b9a17e', roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: '#5b6365', roughness: 0.65, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: '#e6e1d4', roughness: 0.72 });
  const stone = new THREE.MeshStandardMaterial({ color: '#a89d8a', roughness: 0.94 });
  const flags = [];
  const animated = [];

  // top resort chalet
  const tx = 3380;
  const tz = 2470;
  const ty = heightAt(tx, tz);
  addBox(scene, wood, tx, ty, tz, 17, 6.4, 12);
  const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(13.5, 5, 4), roof);
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.position.set(tx, ty + 8.9, tz);
  roofMesh.castShadow = true;
  scene.add(roofMesh);
  colliders.add(tx, tz, 9, 7, 'chalet');
  const sign = makeTextPlane('CHAMROUSSE · BELLEDONNE', {
    width: 1024,
    height: 160,
    fontSize: 54,
    bg: 'rgba(12,26,32,0.9)',
    accent: '#ff8a65',
  });
  sign.position.set(tx, ty + 6.2, tz + 8.2);
  sign.scale.set(13, 2, 1);
  scene.add(sign);

  // base station chalet
  const bx = 2520;
  const bz = 1880;
  const by = heightAt(bx, bz);
  addBox(scene, wood, bx, by, bz, 20, 6, 13);
  const baseRoof = new THREE.Mesh(new THREE.ConeGeometry(15, 4.5, 4), roof);
  baseRoof.rotation.y = Math.PI / 4;
  baseRoof.position.set(bx, by + 8.2, bz);
  baseRoof.castShadow = true;
  scene.add(baseRoof);
  addBox(scene, white, bx + 18, by, bz + 4, 10, 3.4, 7);
  colliders.add(bx, bz, 11, 8, 'chalet');
  colliders.add(bx + 18, bz + 4, 5, 4, 'chalet');
  const baseSign = makeTextPlane('TÉLÉCABINE · CHAMROUSSE', {
    width: 1024,
    height: 160,
    fontSize: 44,
    bg: 'rgba(12,26,32,0.9)',
    accent: '#84e9ed',
  });
  baseSign.position.set(bx, by + 7.4, bz + 9);
  baseSign.scale.set(15, 2.3, 1);
  scene.add(baseSign);

  // flags along the snowfront
  for (let i = 0; i < 6; i++) {
    const x = tx - 50 + i * 20;
    const z = tz + 30;
    const y = heightAt(x, z);
    addCyl(scene, white, x, y, z, 0.05, 0.06, 5.5, 0, false);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.6),
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#e14b34' : '#f0eee5', side: THREE.DoubleSide, roughness: 0.9 })
    );
    cloth.position.set(x, y + 5.5, z);
    cloth.rotation.y = 0.3;
    scene.add(cloth);
    flags.push({ cloth, phase: i * 0.8 });
  }

  // simple chairlift sculpture with moving chairs
  const liftBase = { x: 2580, z: 2040 };
  const liftTop = { x: 3290, z: 2460 };
  const p0 = new THREE.Vector3(liftBase.x, heightAt(liftBase.x, liftBase.z) + 5, liftBase.z);
  const p1 = new THREE.Vector3(liftTop.x, heightAt(liftTop.x, liftTop.z) + 5, liftTop.z);
  const liftPoints = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const p = p0.clone().lerp(p1, t);
    p.y -= Math.sin(t * Math.PI * 3) * 4.5;
    liftPoints.push(p);
  }
  const liftCurve = new THREE.CatmullRomCurve3(liftPoints, false, 'centripetal');
  const cableGeo = new THREE.BufferGeometry().setFromPoints(liftCurve.getPoints(120));
  scene.add(new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: '#2f3637' })));
  const pylons = [0.18, 0.42, 0.64, 0.84];
  for (const t of pylons) {
    const p = liftCurve.getPointAt(t);
    const ground = heightAt(p.x, p.z);
    const h = Math.max(8, p.y - ground);
    addCyl(scene, white, p.x, ground, p.z, 0.14, 0.24, h, 0, true);
    addBox(scene, white, p.x, ground + h, p.z, 3.2, 0.22, 0.22);
  }
  const chairs = [];
  for (let i = 0; i < 10; i++) {
    const chair = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 4), white);
    bar.position.y = -0.65;
    chair.add(bar);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.5), new THREE.MeshStandardMaterial({ color: '#c94f3b', roughness: 0.7 }));
    seat.position.y = -1.3;
    seat.castShadow = true;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.08), white);
    back.position.set(0, -1.1, -0.22);
    chair.add(back);
    scene.add(chair);
    chairs.push({ chair, phase: i / 10 });
  }
  animated.push((dt, time) => {
    for (const c of chairs) {
      let t = (time * 0.025 + c.phase) % 1;
      const p = liftCurve.getPointAt(t);
      c.chair.position.set(p.x, p.y, p.z);
    }
    for (const f of flags) {
      f.cloth.rotation.y = 0.3 + Math.sin(time * 1.8 + f.phase) * 0.24;
    }
  });

  return { flags, animated, liftCurve };
}

function buildVercorsRefuge(scene, colliders) {
  const x = -1250;
  const z = 3400;
  const y = heightAt(x, z);
  const wood = new THREE.MeshStandardMaterial({ color: '#6c5239', roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#5b6164', roughness: 0.7 });
  const base = heightAt(x, z);
  addBox(scene, wood, x, base, z, 12, 4.6, 8);
  const r = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.6, 4), roof);
  r.rotation.y = Math.PI / 4;
  r.position.set(x, base + 6.4, z);
  r.castShadow = true;
  scene.add(r);
  colliders.add(x, z, 6.5, 4.5, 'refuge');
  woodenSign(
    scene,
    x - 10,
    z + 5,
    base,
    [
      { text: 'REFUGE DU VERCORS', accent: true },
      { text: `ALTITUDE ${Math.round(212 + base)} M`, small: true },
      { text: 'EAU · ABRI · PANORAMA', small: true },
    ],
    Math.PI * 0.8,
    '#a6f06c'
  );
  return { x, z, y: base };
}

function buildRachaisLookout(scene) {
  const x = 1550;
  const z = -3100;
  const y = heightAt(x, z);
  const stone = new THREE.MeshStandardMaterial({ color: '#a49c8e', roughness: 0.94 });
  addCyl(scene, stone, x, y, z, 4, 4.6, 1.1, 0, false);
  const crossMat = new THREE.MeshStandardMaterial({ color: '#dcd7c8', roughness: 0.5 });
  addBox(scene, crossMat, x, y + 1.1, z, 0.4, 5.2, 0.4);
  addBox(scene, crossMat, x, y + 4.6, z, 3, 0.4, 0.4);
  woodenSign(
    scene,
    x - 8,
    z + 8,
    y,
    [
      { text: 'MONT RACHAIS', accent: true },
      { text: `${Math.round(212 + y)} M · CHARTREUSE`, small: true },
      { text: 'GRENOBLE À VOS PIEDS', small: true },
    ],
    Math.PI * 0.9,
    '#84e9ed'
  );
}

/* ──────────────────────────────────────────────────────────────
   Main
   ────────────────────────────────────────────────────────────── */
export function buildAlpine(scene, colliders) {
  const trails = TRAILS.map((t) => buildTrail(scene, t));
  const pisteSnowMats = [];
  const pistes = PISTES.map((p) => buildPiste(scene, p, pisteSnowMats));
  const fort = buildFort(scene, colliders);
  const chamrousse = buildChamrousse(scene, colliders);
  buildVercorsRefuge(scene, colliders);
  buildRachaisLookout(scene);

  // extra wayfinding signs at trail starts along the valley
  const trailSigns = [
    { x: -410, z: -1360, text: 'BASTILLE · DÉPART', sub: 'MONTÉE DE CHALEMONT · 55 MIN', color: '#ffb257' },
    { x: 1390, z: -1490, text: 'MONT RACHAIS · DÉPART', sub: 'SENTIER DE LA CHARTREUSE · 2 H 05', color: '#84e9ed' },
    { x: -400, z: 2210, text: 'VERCORS · DÉPART', sub: 'BALCON DU VERCORS · 1 H 30', color: '#a6f06c' },
    { x: 2390, z: 1760, text: 'CHAMROUSSE · DÉPART', sub: 'TÉLÉCABINE OU SENTIER · 2 H 40', color: '#ff8a65' },
  ];
  for (const s of trailSigns) {
    const y = heightAt(s.x, s.z);
    woodenSign(
      scene,
      s.x,
      s.z,
      y,
      [
        { text: s.text, accent: true },
        { text: s.sub, small: true },
        { text: 'SENTIER BALISÉ · GRENOBLE ALPES', small: true },
      ],
      Math.PI,
      s.color,
      4.6
    );
  }

  // collect all fort trees
  const treePositions = [...fort.trees];
  const rng = mulberry32(77111);
  for (let i = 0; i < 26; i++) {
    const x = 2440 + rng() * 900;
    const z = 1800 + rng() * 720;
    treePositions.push({ x, z, y: heightAt(x, z), type: 'conifer', scale: 0.65 + rng() * 0.8 });
  }
  for (let i = 0; i < 18; i++) {
    const x = 3150 + rng() * 300;
    const z = 2350 + rng() * 500;
    treePositions.push({ x, z, y: heightAt(x, z), type: 'conifer', scale: 0.55 + rng() * 0.7 });
  }

  let time = 0;
  const update = (dt) => {
    time += dt;
    fort.update(dt, time);
    for (const a of chamrousse.animated) a(dt, time);
  };

  return {
    trails,
    pistes,
    fort,
    chamrousse,
    treePositions,
    pisteSnowMats,
    update,
    setSnow(amount) {
      for (const item of pisteSnowMats) {
        item.mat.color.copy(item.summer).lerp(item.winter, clamp(amount, 0, 1));
      }
    },
    findTrailAt(x, z) {
      let best = null;
      for (const trail of trails) {
        const d = pointToPolylineDistance(x, z, trail.samples2D);
        if (d.distance < 13 && (!best || d.distance < best.distance)) {
          const progress = clamp(d.along / trail.total, 0, 1);
          best = {
            trail,
            distance: d.distance,
            along: d.along,
            progress,
            elevation: 212 + heightAt(x, z),
          };
        }
      }
      return best;
    },
    isNearPiste(x, z) {
      for (const p of pistes) {
        if (pointToPolylineDistance(x, z, p.samples2D).distance < 18) return p;
      }
      return null;
    },
    fortPosition: { x: -760, z: -2000, y: fort.baseY },
  };
}
