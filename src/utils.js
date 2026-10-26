import * as THREE from 'three';

/* ──────────────────────────────────────────────────────────────
   Math
   ────────────────────────────────────────────────────────────── */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function smootherstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
export function dampAngle(current, target, lambda, dt) {
  let d = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return current + d * (1 - Math.exp(-lambda * dt));
}
export const distance2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/* ──────────────────────────────────────────────────────────────
   Deterministic noise
   ────────────────────────────────────────────────────────────── */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise2(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, z, octaves = 4, lacunarity = 2.02, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridgedFbm(x, z, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2(x * freq, z * freq);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return sum / norm;
}

/* ──────────────────────────────────────────────────────────────
   Canvas textures
   ────────────────────────────────────────────────────────────── */
export function canvasTexture(w, h, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 4;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

export function makeNoiseTexture(size = 256, base = 235, spread = 20) {
  const rnd = mulberry32(9182);
  return canvasTexture(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = base - spread * 0.5 + rnd() * spread;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [1, 1] });
}

function windowGrid(ctx, w, h, cols, rows, palette, style) {
  const { wall, wallDark, glass, glassLight, frame } = palette;
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);

  // subtle plaster streaks
  const rnd = mulberry32(style === 'modern' ? 33 : 87);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.022})`;
    ctx.fillRect(rnd() * w, 0, 1 + rnd() * 4, h);
  }

  // stone / floor bands
  if (style !== 'modern') {
    for (let r = 0; r <= rows; r++) {
      const y = (r / rows) * h;
      ctx.fillStyle = wallDark;
      ctx.fillRect(0, y, w, style === 'brick' ? 2 : 1);
    }
  }

  const mx = w * 0.06;
  const my = h * 0.05;
  const cw = (w - mx * 2) / cols;
  const ch = (h - my * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = mx + c * cw + cw * 0.2;
      const y = my + r * ch + ch * 0.2;
      const ww = cw * 0.6;
      const wh = ch * 0.52;
      // window recess
      ctx.fillStyle = frame;
      ctx.fillRect(x - 1.5, y - 1.5, ww + 3, wh + 3);
      const lit = rnd() > 0.86;
      const g = ctx.createLinearGradient(x, y, x + ww, y + wh);
      if (lit) {
        g.addColorStop(0, '#e8c784');
        g.addColorStop(1, '#b78847');
      } else {
        g.addColorStop(0, glassLight);
        g.addColorStop(0.45, glass);
        g.addColorStop(1, '#1b2830');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, ww, wh);
      // mullions
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + ww * 0.48, y, 1, wh);
      ctx.fillRect(x, y + wh * 0.46, ww, 1);
      // sill
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x - 2, y + wh + 1, ww + 4, 1.5);
      // tiny balcony on some floors for classic
      if (style === 'classic' && r % 2 === 1 && rnd() > 0.6) {
        ctx.strokeStyle = 'rgba(36, 42, 44, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 3, y + wh + 5);
        ctx.lineTo(x + ww + 3, y + wh + 5);
        ctx.stroke();
      }
    }
  }

  if (style === 'classic') {
    // cornice
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 3, w, 2);
    // shopfronts at base
    ctx.fillStyle = '#2d312f';
    ctx.fillRect(0, h - h * 0.075, w, h * 0.075);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(255, 219, 165, 0.22)';
      ctx.fillRect(6 + i * (w / 4), h - h * 0.06, w / 4 - 12, h * 0.04);
    }
  } else if (style === 'modern') {
    // strong horizontal glass bands
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * h;
      ctx.fillStyle = 'rgba(130, 180, 200, 0.1)';
      ctx.fillRect(0, y, w, 1);
    }
  }
}

export function makeFacadeTexture(style = 'classic', tint = 0) {
  const palettes = {
    classic: [
      { wall: '#d8cdbb', wallDark: 'rgba(60,48,36,0.18)', glass: '#40515b', glassLight: '#7d98a4', frame: '#b0a694' },
      { wall: '#cdbda9', wallDark: 'rgba(72,52,34,0.2)', glass: '#3a4a50', glassLight: '#77909a', frame: '#a59884' },
      { wall: '#e0d6c6', wallDark: 'rgba(60,48,36,0.16)', glass: '#42535c', glassLight: '#89a3ae', frame: '#bdb1a0' },
      { wall: '#c9b89d', wallDark: 'rgba(70,50,30,0.22)', glass: '#38474d', glassLight: '#738a92', frame: '#a1937d' },
    ],
    brick: [
      { wall: '#b98a6c', wallDark: 'rgba(70,32,20,0.24)', glass: '#3b4a4f', glassLight: '#7b929a', frame: '#96705a' },
      { wall: '#a9785a', wallDark: 'rgba(60,26,14,0.24)', glass: '#3b4a4f', glassLight: '#7b929a', frame: '#87624d' },
    ],
    modern: [
      { wall: '#b7c1c3', wallDark: 'rgba(40,60,70,0.16)', glass: '#5d7d89', glassLight: '#a8c3ca', frame: '#819196' },
      { wall: '#9faeb3', wallDark: 'rgba(40,60,70,0.2)', glass: '#4d6b77', glassLight: '#9bb8c1', frame: '#76888e' },
    ],
  };
  const list = palettes[style] || palettes.classic;
  const palette = list[tint % list.length];
  const rows = style === 'modern' ? 11 : 8;
  const cols = style === 'modern' ? 9 : 7;
  return canvasTexture(style === 'modern' ? 256 : 256, 512, (ctx, w, h) => {
    windowGrid(ctx, w, h, cols, rows, palette, style);
  }, { repeat: [1, 1], anisotropy: 8 });
}

export function makeSignTexture(lines, opts = {}) {
  const {
    width = 512,
    height = 256,
    bg = '#1a2a30',
    accent = '#ffb257',
    color = '#f7f0e4',
    border = true,
    font = 'Barlow Condensed',
    align = 'left',
  } = opts;
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.strokeRect(10, 10, w - 20, h - 20);
    }
    ctx.textAlign = align;
    const x = align === 'center' ? w / 2 : 32;
    let y = 56;
    for (const line of lines) {
      const isSmall = line.small;
      const isAccent = line.accent;
      ctx.fillStyle = isAccent ? accent : color;
      const size = isSmall ? Math.round(height * 0.1) : Math.round(height * 0.17);
      ctx.font = `${isSmall ? 500 : 700} ${size}px "${font}", sans-serif`;
      ctx.fillText(line.text || line, x, y);
      y += size * (isSmall ? 1.5 : 1.3);
    }
  });
}

export function makeTextPlane(text, opts = {}) {
  const {
    width = 512,
    height = 128,
    font = 'Barlow Condensed',
    fontSize = 64,
    color = '#f7f0e4',
    bg = 'rgba(8,18,24,0.8)',
    accent = '#ffb257',
  } = opts;
  const tex = canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 7, w, 7);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontSize}px "${font}", sans-serif`;
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, height / width), mat);
}

export function makeSprite(text, opts = {}) {
  const {
    fontSize = 44,
    color = '#ffffff',
    bg = 'rgba(8,16,22,0.7)',
    padding = 16,
    scale = 10,
  } = opts;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `700 ${fontSize}px "Barlow Condensed", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width + padding * 2);
  const h = fontSize + padding * 2;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = color;
  c.font = `700 ${fontSize}px "Barlow Condensed", sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((scale * w) / h, scale, 1);
  return sprite;
}

/* ──────────────────────────────────────────────────────────────
   Collision
   ────────────────────────────────────────────────────────────── */
export class ColliderWorld {
  constructor() {
    this.boxes = [];
    this._set = new Set();
  }

  add(x, z, hw, hd, type = 'building', data = null) {
    const box = { x, z, hw, hd, type, data };
    this.boxes.push(box);
    return box;
  }

  resolveCircle(px, pz, radius, filter = null) {
    let pushX = 0;
    let pushZ = 0;
    let hit = null;
    for (const b of this.boxes) {
      if (filter && !filter(b)) continue;
      const cx = clamp(px, b.x - b.hw, b.x + b.hw);
      const cz = clamp(pz, b.z - b.hd, b.z + b.hd);
      let dx = px - cx;
      let dz = pz - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      hit = b;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const overlap = radius - d;
        pushX += (dx / d) * overlap;
        pushZ += (dz / d) * overlap;
      } else {
        // center is inside the box — push out through the nearest face
        const left = px - (b.x - b.hw);
        const right = b.x + b.hw - px;
        const front = pz - (b.z - b.hd);
        const back = b.z + b.hd - pz;
        const m = Math.min(left, right, front, back);
        if (m === left) pushX -= left + radius;
        else if (m === right) pushX += right + radius;
        else if (m === front) pushZ -= front + radius;
        else pushZ += back + radius;
      }
    }
    return { x: pushX, z: pushZ, hit };
  }

  nearBox(x, z, radius) {
    const out = [];
    for (const b of this.boxes) {
      if (Math.abs(x - b.x) < b.hw + radius && Math.abs(z - b.z) < b.hd + radius) out.push(b);
    }
    return out;
  }
}

/* ──────────────────────────────────────────────────────────────
   Misc
   ────────────────────────────────────────────────────────────── */
export function setShadowRecursive(object, cast = true, receive = true) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function seededPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function makeRibbon(points, width, yOffset = 0.1, uvScale = 1) {
  // points: array of THREE.Vector3
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz;
    const nz = dx;
    const hw = width * 0.5;
    positions.push(p.x + nx * hw, p.y + yOffset, p.z + nz * hw);
    positions.push(p.x - nx * hw, p.y + yOffset, p.z - nz * hw);
    uvs.push(0, i * uvScale, 1, i * uvScale);
    if (i < n - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function catmullPoints2D(pts, samples = 120) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    false,
    'catmullrom',
    0.35
  );
  return curve.getPoints(samples).map((p) => [p.x, p.z]);
}

export function pointToPolylineDistance(x, z, pts) {
  let best = Infinity;
  let bestIndex = 0;
  let bestT = 0;
  let acc = 0;
  let bestAcc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0], bz = pts[i + 1][1];
    const abx = bx - ax, abz = bz - az;
    const len2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
    const px = ax + abx * t;
    const pz = az + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestIndex = i;
      bestT = t;
      bestAcc = acc + Math.sqrt(len2) * t;
    }
    acc += Math.sqrt(len2);
  }
  return { distance: best, index: bestIndex, t: bestT, along: bestAcc };
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return l;
}

// Simplified distance to a polyline (fast enough for terrain generation).
export function distanceToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0], bz = pts[i + 1][1];
    const abx = bx - ax, abz = bz - az;
    const len2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
    const px = ax + abx * t;
    const pz = az + abz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
