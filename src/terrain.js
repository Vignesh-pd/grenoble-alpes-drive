import * as THREE from 'three';
import {
  HALF,
  WORLD,
  RIVER,
  WATER_LEVEL,
  CITY,
  BRIDGES,
  TRAM_LINES,
} from './data.js';
import {
  clamp,
  smoothstep,
  lerp,
  fbm,
  ridgedFbm,
  valueNoise2,
  mulberry32,
  distanceToPolyline,
  catmullPoints2D,
  makeRibbon,
  makeNoiseTexture,
} from './utils.js';

/* ──────────────────────────────────────────────────────────────
   Heightfield
   ────────────────────────────────────────────────────────────── */
export function cityMaskAt(x, z) {
  const xm = smoothstep(-2820, -2420, x) * (1 - smoothstep(2420, 2820, x));
  const zm = smoothstep(-1250, -830, z) * (1 - smoothstep(2140, 2480, z));
  return xm * zm;
}

const FORT = { x: -760, z: -2000, h: 302 };

/* Rail corridors cut a level shelf through the foothills so tracks, platforms
   and catenary masts stay on grade instead of being buried by the terrain. */
const TRAM_CORRIDORS = TRAM_LINES.map((line) => {
  const ox = line.offset?.[0] ?? 0;
  const oz = line.offset?.[1] ?? 0;
  const pts = line.route.map(([x, z]) => [x + ox, z + oz]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { pts, minX: minX - 64, maxX: maxX + 64, minZ: minZ - 64, maxZ: maxZ + 64 };
});

export function heightAt(x, z) {
  // Chartreuse · the great northern balcony
  const north = smoothstep(1500, 3900, -z);
  let h = 780 * Math.pow(north, 1.5);
  h += 265 * Math.exp(-(((x - 1220) ** 2) / (2 * 850 ** 2) + ((z + 2870) ** 2) / (2 * 700 ** 2)));

  // La Bastille, the sentinel above the Isère
  h += 310 * Math.exp(-(((x + 760) ** 2) / (2 * 640 ** 2) + ((z + 2000) ** 2) / (2 * 440 ** 2)));

  // Vercors · the limestone wall to the south
  const south = smoothstep(1950, 3950, z);
  h += 980 * Math.pow(south, 1.4);
  h += 265 * Math.exp(-(((x + 1200) ** 2) / (2 * 1100 ** 2) + ((z - 3620) ** 2) / (2 * 760 ** 2)));

  // Belledonne · Chamrousse and the eastern high ground
  const east = smoothstep(2460, 4400, x);
  const eastBand = 0.42 + 0.58 * smoothstep(-700, 1750, z);
  h += 1750 * Math.pow(east, 1.4) * eastBand;

  // soft western hills, where the Isère leaves the basin
  const west = smoothstep(2900, 4500, -x);
  h += 250 * west * west;

  // mountain texture
  const high = clamp(h / 540, 0, 1);
  const ridge = ridgedFbm(x * 0.00072 + 11.3, z * 0.00072 - 7.9, 4) - 0.46;
  h += ridge * 250 * high;
  h += (fbm(x * 0.0019 + 2.2, z * 0.0019 - 5.4, 3) - 0.5) * (18 + 68 * high);
  h += (fbm(x * 0.0082, z * 0.0082, 3) - 0.5) * 2.6;

  // valley floor + river corridor flattening
  const cityMask = cityMaskAt(x, z);
  const riverD = distanceToPolyline(x, z, RIVER);
  const riverFlat = 1 - smoothstep(150, 640, riverD);
  const flatten = Math.max(cityMask, riverFlat);

  // keep outlying TAG trackbeds, platforms and masts on a level shelf
  let railFlat = 0;
  if (cityMask < 0.999) {
    for (const corridor of TRAM_CORRIDORS) {
      if (
        x < corridor.minX ||
        x > corridor.maxX ||
        z < corridor.minZ ||
        z > corridor.maxZ
      ) {
        continue;
      }
      const railD = distanceToPolyline(x, z, corridor.pts);
      if (railD < 58) {
        railFlat = Math.max(railFlat, 1 - smoothstep(24, 58, railD));
      }
    }
  }

  h *= 1 - Math.max(0.987 * flatten, 0.999 * railFlat);

  // carve the Isère — a defined channel, then real banks above the waterline
  const carve = 6.4 * (1 - smoothstep(45, 132, riverD));
  h -= carve;
  // lift the floodplain immediately beside the channel so the quays stay dry
  const bank = smoothstep(108, 190, riverD) * (1 - smoothstep(190, 520, riverD));
  h += bank * 1.35 * (1 - railFlat);

  // levelled fort plateau
  const fortD = Math.hypot(x - FORT.x, z - FORT.z);
  h = lerp(FORT.h, h, smoothstep(150, 285, fortD));

  // high ground at the world edges so the map never ends in a cliff
  const edge = Math.max(
    smoothstep(3960, 4500, Math.abs(x)),
    smoothstep(3960, 4500, Math.abs(z))
  );
  h += 240 * edge * edge;

  // tiny undulation of fields outside the city
  h += (valueNoise2(x * 0.03, z * 0.03) - 0.5) * 0.4 * (1 - railFlat);

  return h;
}

export function terrainNormalAt(x, z, eps = 2.2) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const n = new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
  return n;
}

export function slopeAt(x, z) {
  const n = terrainNormalAt(x, z, 3);
  return Math.acos(clamp(n.y, -1, 1));
}

export function isWater(x, z) {
  return heightAt(x, z) < WATER_LEVEL;
}

export const BRIDGE_DECK_Y = 1.02;

export function bridgeAt(x, z) {
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) <= 17 && z >= b.z1 && z <= b.z2) return b;
  }
  return null;
}

/** Walkable/drivable surface, accounting for the city slab and bridge decks. */
export function groundHeightAt(x, z) {
  const bridge = bridgeAt(x, z);
  const h = heightAt(x, z);
  if (bridge) return Math.max(h, BRIDGE_DECK_Y);
  if (x >= CITY.x1 - 30 && x <= CITY.x2 + 30 && z >= CITY.z1 - 30 && z <= CITY.z2 + 30) {
    return Math.max(h, 0.05);
  }
  return h;
}

export function isUnderwater(x, z) {
  if (bridgeAt(x, z)) return false;
  return heightAt(x, z) < WATER_LEVEL - 0.35;
}

/* ──────────────────────────────────────────────────────────────
   Terrain mesh
   ────────────────────────────────────────────────────────────── */
export function buildTerrain(scene) {
  const SEGMENTS = 440;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  geo.computeVertexNormals();

  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color('#5d7449');
  const cGrassDry = new THREE.Color('#85835b');
  const cForest = new THREE.Color('#33492f');
  const cRock = new THREE.Color('#7a756b');
  const cRockDark = new THREE.Color('#5e5b55');
  const cSnow = new THREE.Color('#edf1f2');
  const cUrban = new THREE.Color('#7c796e');
  const cField = new THREE.Color('#718454');
  const cRiverBank = new THREE.Color('#7d7c66');
  const tmp = new THREE.Color();

  const rnd = mulberry32(44101);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const ny = normals.getY(i);
    const slope = 1 - Math.abs(ny);

    const mask = cityMaskAt(x, z);
    const riverD = distanceToPolyline(x, z, RIVER);
    const n = fbm(x * 0.012 + 4, z * 0.012 - 2, 3);
    const n2 = fbm(x * 0.0018 - 8, z * 0.0018 + 3, 3);
    const high = smoothstep(220, 900, y);

    if (mask > 0.28) {
      tmp.copy(cUrban);
      tmp.offsetHSL(0, 0, (n - 0.5) * 0.055);
      tmp.lerp(cField, clamp((1 - mask) * 1.7, 0, 0.7));
    } else if (riverD < 150) {
      tmp.copy(cRiverBank);
      tmp.offsetHSL(0, 0, (n - 0.5) * 0.07);
    } else {
      // green valley / forested foothills
      tmp.copy(cGrass).lerp(cGrassDry, smoothstep(0.35, 0.75, n2));
      tmp.lerp(cForest, smoothstep(40, 280, y) * 0.86);
      tmp.offsetHSL((n - 0.5) * 0.02, (n2 - 0.5) * 0.1, (n - 0.5) * 0.075);

      // exposed rock on steep faces and high ground
      const rockAmount = clamp(slope * 2.2 + smoothstep(420, 850, y) * 0.55, 0, 1);
      tmp.lerp(cRock.clone().lerp(cRockDark, n), rockAmount * 0.82);

      // permanent high snow
      const permanentSnow = smoothstep(830, 1120, y) * (0.35 + 0.65 * clamp(ny, 0, 1));
      if (permanentSnow > 0.02) tmp.lerp(cSnow, permanentSnow * 0.94);
    }

    tmp.offsetHSL(0, 0, (rnd() - 0.5) * 0.012);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const detail = makeNoiseTexture(256, 238, 15);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.repeat.set(720, 720);

  const snowUniform = { value: 0 };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.97,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = snowUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uSnow;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float upFace = smoothstep(0.28, 0.78, normalize(vWNormal).y);
        float snowCover = uSnow * mix(0.32, 1.0, upFace);
        snowCover *= 0.88 + 0.12 * smoothstep(0.0, 500.0, vWPos.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.94, 0.97), clamp(snowCover, 0.0, 0.96));`
      );
  };

  material.customProgramCacheKey = () => 'terrain-snow-v1';

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  scene.add(mesh);

  // ── water ──
  const water = buildWater(scene);

  return { mesh, material, snowUniform, water };
}

/* ──────────────────────────────────────────────────────────────
   The Isère
   ────────────────────────────────────────────────────────────── */
function buildWater(scene) {
  const pts = catmullPoints2D(RIVER, 260);
  const points = pts.map(([x, z]) => new THREE.Vector3(x, WATER_LEVEL, z));
  const geometry = makeRibbon(points, 212, 0, 0.008);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#284c53') },
      uShallow: { value: new THREE.Color('#5c8b8c') },
      uSky: { value: new THREE.Color('#a8c8d4') },
      uSun: { value: new THREE.Color('#fff1cd') },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.62, 0.35).normalize() },
      uOvercast: { value: 0 },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWPos;
      varying vec2 vUv2;
      void main() {
        vUv2 = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uOvercast;
      varying vec3 vWPos;
      varying vec2 vUv2;
      #include <common>
      #include <fog_pars_fragment>

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWPos);
        float w1 = sin(vWPos.x * 0.085 + uTime * 0.55);
        float w2 = sin(vWPos.z * 0.13 - uTime * 0.42);
        float w3 = sin((vWPos.x + vWPos.z) * 0.028 + uTime * 0.18);
        vec3 n = normalize(vec3(w1 * 0.035 + w3 * 0.025, 1.0, w2 * 0.04));

        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, 0.28 + 0.34 * fres);
        col = mix(col, uSky, (0.18 + 0.45 * fres) * (1.0 - uOvercast * 0.35));

        vec3 refl = reflect(-uSunDir, n);
        float spec = pow(max(dot(refl, viewDir), 0.0), 90.0);
        col += uSun * spec * (1.35 - uOvercast * 1.1);

        // flowing surface streaks
        float streak = sin(vUv2.y * 340.0 + sin(vUv2.x * 9.0 + uTime * 0.4) * 2.4);
        streak = smoothstep(0.6, 1.0, streak) * 0.05;
        col += vec3(streak) * (0.5 + 0.5 * uOvercast);

        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });

  const water = new THREE.Mesh(geometry, material);
  water.name = 'isere';
  water.receiveShadow = true;
  scene.add(water);

  water.userData.update = (dt, camera) => {
    uniforms.uTime.value += dt;
    uniforms.uSunDir.value.set(-0.42, 0.58, 0.36).normalize();
  };

  return water;
}

/* ──────────────────────────────────────────────────────────────
   City ground (solid slab under the streets, above the terrain)
   ────────────────────────────────────────────────────────────── */
export function buildCityGround(scene) {
  const m = 60;
  const geo = new THREE.BoxGeometry(CITY.x2 - CITY.x1 + m * 2, 0.5, CITY.z2 - CITY.z1 + m * 2);
  const mat = new THREE.MeshStandardMaterial({
    color: '#77766c',
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((CITY.x1 + CITY.x2) / 2, -0.25, (CITY.z1 + CITY.z2) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, material: mat };
}
