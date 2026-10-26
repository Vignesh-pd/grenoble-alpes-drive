import * as THREE from 'three';
import { clamp, damp, lerp, canvasTexture } from './utils.js';

const PRESETS = {
  sunny: {
    key: 'sunny',
    label: 'SUNNY',
    temp: 21,
    wind: 'BREEZE · 8 KM/H',
    skyTop: '#2f6fb9',
    skyHorizon: '#dbe7ea',
    skyGlow: '#ffdda6',
    fog: '#c9dbe3',
    fogDensity: 0.000105,
    sunColor: '#fff0d2',
    sunIntensity: 2.5,
    hemiSky: '#bcd9ff',
    hemiGround: '#77715c',
    hemiIntensity: 0.78,
    cloudCover: 0.23,
    cloudColor: '#f6f5f1',
    exposure: 1.03,
    sunDir: new THREE.Vector3(-0.48, 0.59, 0.32).normalize(),
    snow: 0,
    rain: 0,
  },
  rain: {
    key: 'rain',
    label: 'RAIN',
    temp: 11,
    wind: 'SW · 26 KM/H',
    skyTop: '#273441',
    skyHorizon: '#7e8e97',
    skyGlow: '#b7c3c7',
    fog: '#8d9ba3',
    fogDensity: 0.00044,
    sunColor: '#aabcc8',
    sunIntensity: 0.62,
    hemiSky: '#8ea6b8',
    hemiGround: '#4c4f49',
    hemiIntensity: 0.64,
    cloudCover: 0.88,
    cloudColor: '#8c9aa1',
    exposure: 0.88,
    sunDir: new THREE.Vector3(-0.3, 0.7, -0.25).normalize(),
    snow: 0,
    rain: 1,
  },
  snow: {
    key: 'snow',
    label: 'SNOW',
    temp: -3,
    wind: 'N · 14 KM/H',
    skyTop: '#566576',
    skyHorizon: '#c7d1d8',
    skyGlow: '#e8eef2',
    fog: '#c8d2d9',
    fogDensity: 0.0004,
    sunColor: '#e9f0f8',
    sunIntensity: 1.0,
    hemiSky: '#d3dfea',
    hemiGround: '#8a8e88',
    hemiIntensity: 0.84,
    cloudCover: 0.78,
    cloudColor: '#cfd7dc',
    exposure: 0.98,
    sunDir: new THREE.Vector3(-0.2, 0.78, 0.35).normalize(),
    snow: 1,
    rain: 0,
  },
};

/* ──────────────────────────────────────────────────────────────
   Sky shader
   ────────────────────────────────────────────────────────────── */
function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color(PRESETS.sunny.skyTop) },
    uHorizon: { value: new THREE.Color(PRESETS.sunny.skyHorizon) },
    uGlow: { value: new THREE.Color(PRESETS.sunny.skyGlow) },
    uCloud: { value: new THREE.Color(PRESETS.sunny.cloudColor) },
    uSun: { value: new THREE.Color(PRESETS.sunny.sunColor) },
    uSunDir: { value: PRESETS.sunny.sunDir.clone() },
    uCloudCover: { value: PRESETS.sunny.cloudCover },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uCloud;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uCloudCover;
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = p * 2.03 + vec2(17.1, 9.2);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, -0.1, 1.0);
        float grad = pow(max(h, 0.0), 0.62);
        vec3 col = mix(uHorizon, uTop, grad);

        // warm band near the horizon
        float horizonBand = pow(1.0 - max(h, 0.0), 5.0);
        col = mix(col, uGlow, horizonBand * 0.25);

        // sun disc and glow
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uSun * pow(sunDot, 1500.0) * 4.0;
        col += uSun * pow(sunDot, 12.0) * 0.16;
        col += uGlow * pow(sunDot, 4.0) * 0.08;

        // clouds projected on a virtual plane
        if (dir.y > 0.015) {
          vec2 cuv = dir.xz / (dir.y + 0.14) * 0.9;
          cuv += vec2(uTime * 0.006, uTime * 0.0025);
          float f = fbm(cuv * 0.75 + vec2(4.2, 1.7));
          float f2 = fbm(cuv * 1.8 - vec2(8.1, 2.3));
          float mask = smoothstep(0.52, 0.78, f * 0.7 + f2 * 0.36);
          float cover = uCloudCover;
          float clouds = mask * cover * smoothstep(0.02, 0.22, dir.y);
          vec3 cloudShade = mix(uCloud * 0.76, uCloud * 1.06, smoothstep(0.4, 0.85, f2));
          col = mix(col, cloudShade, clouds * 0.9);

          // high cirrus
          float cirrus = smoothstep(0.64, 0.82, fbm(cuv * vec2(2.5, 0.7) + 9.0)) * cover * 0.16;
          col = mix(col, uCloud, cirrus);
        }

        // tone + subtle vignette
        col = pow(col, vec3(0.93));
        float vignette = smoothstep(0.0, 1.25, length(dir.xz));
        col *= 0.94 + 0.06 * (1.0 - vignette);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(12500, 40, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

/* ──────────────────────────────────────────────────────────────
   Particles
   ────────────────────────────────────────────────────────────── */
function createSnowfall() {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push({
      x: (Math.random() * 2 - 1) * 130,
      y: Math.random() * 120,
      z: (Math.random() * 2 - 1) * 130,
      speed: 1.3 + Math.random() * 2.4,
      sway: Math.random() * Math.PI * 2,
      size: 0.35 + Math.random() * 0.5,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tex = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(244,250,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const mat = new THREE.PointsMaterial({
    size: 0.8,
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    color: '#ffffff',
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, offsets, positions, geo, mat, time: 0 };
}

function createRain() {
  const count = 1500;
  const positions = new Float32Array(count * 6);
  const drops = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      x: (Math.random() * 2 - 1) * 150,
      y: Math.random() * 120,
      z: (Math.random() * 2 - 1) * 150,
      speed: 42 + Math.random() * 32,
      len: 1.4 + Math.random() * 1.8,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: '#b8d1de',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, drops, positions, geo, mat };
}

/* ──────────────────────────────────────────────────────────────
   Weather system
   ────────────────────────────────────────────────────────────── */
export class WeatherSystem {
  constructor(scene, renderer, terrain, alpine, city) {
    this.scene = scene;
    this.renderer = renderer;
    this.terrain = terrain;
    this.alpine = alpine;
    this.city = city;
    this.mode = 'sunny';
    this.time = 0;
    this.snowAmount = 0;
    this.rainAmount = 0;
    this.transition = 0;
    this.current = { ...PRESETS.sunny };
    this.target = { ...PRESETS.sunny };
    this.targetName = 'sunny';

    const sky = createSky();
    this.sky = sky;
    scene.add(sky.mesh);

    this.fogColor = new THREE.Color(PRESETS.sunny.fog);
    this.fogDensity = PRESETS.sunny.fogDensity;
    scene.fog = new THREE.FogExp2(this.fogColor.clone(), this.fogDensity);

    this.hemi = new THREE.HemisphereLight(
      PRESETS.sunny.hemiSky,
      PRESETS.sunny.hemiGround,
      PRESETS.sunny.hemiIntensity
    );
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(PRESETS.sunny.sunColor, PRESETS.sunny.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 120;
    this.sun.shadow.camera.far = 5200;
    this.sun.shadow.camera.left = -720;
    this.sun.shadow.camera.right = 720;
    this.sun.shadow.camera.top = 720;
    this.sun.shadow.camera.bottom = -720;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 1.4;
    scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.ambient = new THREE.AmbientLight('#9fb1bb', 0.22);
    scene.add(this.ambient);

    this.snowfall = createSnowfall();
    scene.add(this.snowfall.points);
    this.rain = createRain();
    scene.add(this.rain.lines);

    this.setMode('sunny', true);
  }

  setMode(mode, instant = false) {
    if (!PRESETS[mode]) return;
    this.targetName = mode;
    this.target = { ...PRESETS[mode] };
    this.transition = instant ? 1 : 0;
    if (instant) {
      this.current = { ...PRESETS[mode] };
      this.applyColors(1);
    }
  }

  get isSnowing() {
    return this.snowAmount > 0.5;
  }

  get info() {
    return PRESETS[this.targetName];
  }

  applyColors(t) {
    const cur = this.current;
    cur.skyTop = lerpColor(cur.skyTop, this.target.skyTop, t);
    // store as strings is awkward — use Color objects internally instead
  }

  update(dt, camera, playerPos, focus) {
    this.time += dt;
    const smooth = 1 - Math.exp(-1.9 * dt);
    const target = this.target;

    // colours
    const c = this.current;
    const setColorLerp = (key, targetHex, speed = smooth) => {
      c[key] = new THREE.Color(c[key]);
      c[key].lerp(new THREE.Color(targetHex), speed);
    };
    for (const key of ['skyTop', 'skyHorizon', 'skyGlow', 'fog', 'sunColor', 'hemiSky', 'hemiGround', 'cloudColor']) {
      if (typeof c[key] === 'string') c[key] = new THREE.Color(c[key]);
      c[key].lerp(new THREE.Color(target[key]), smooth * 0.9);
    }

    const u = this.sky.uniforms;
    u.uTop.value.copy(c.skyTop);
    u.uHorizon.value.copy(c.skyHorizon);
    u.uGlow.value.copy(c.skyGlow);
    u.uCloud.value.copy(c.cloudColor);
    u.uSun.value.copy(c.sunColor);
    u.uSunDir.value.copy(target.sunDir);
    u.uCloudCover.value = damp(u.uCloudCover.value, target.cloudCover, 1.4, dt);
    u.uTime.value = this.time;

    this.sun.color.copy(c.sunColor);
    this.sun.intensity = damp(this.sun.intensity, target.sunIntensity, 1.5, dt);
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = damp(this.hemi.intensity, target.hemiIntensity, 1.4, dt);
    this.ambient.intensity = damp(this.ambient.intensity, target.key === 'sunny' ? 0.2 : 0.32, 1.2, dt);
    this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, target.exposure, 1.2, dt);

    if (!this.scene.fog.color.equals(c.fog)) this.scene.fog.color.copy(c.fog);
    this.scene.fog.density = damp(this.scene.fog.density, target.fogDensity, 1.1, dt);

    // sky follows the camera
    this.sky.mesh.position.copy(camera.position);

    // sunlight follows the player
    const fx = focus?.x ?? playerPos.x;
    const fz = focus?.z ?? playerPos.z;
    this.sunTarget.position.set(fx, 0, fz);
    this.sun.position.set(
      fx + target.sunDir.x * 2600,
      3000 * target.sunDir.y + 300,
      fz + target.sunDir.z * 2600
    );

    // snow accumulation
    this.snowAmount = damp(this.snowAmount, target.snow, target.snow > this.snowAmount ? 0.55 : 0.22, dt);
    this.rainAmount = damp(this.rainAmount, target.rain, 2.0, dt);
    this.terrain.snowUniform.value = this.snowAmount;
    this.alpine.setSnow(this.snowAmount);

    // city surface gets dusted
    for (const item of this.city.snowMaterials || []) {
      const col = item.base.clone().lerp(item.snow, this.snowAmount * 0.85);
      item.mat.color.copy(col);
    }

    // snow particles
    const snow = this.snowfall;
    snow.mat.opacity = this.snowAmount * 0.92;
    snow.points.visible = this.snowAmount > 0.015;
    if (snow.points.visible) {
      snow.time += dt;
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      for (let i = 0; i < snow.offsets.length; i++) {
        const d = snow.offsets[i];
        d.y -= d.speed * dt;
        if (d.y < -10) d.y += 130;
        const swayX = Math.sin(snow.time * 0.6 + d.sway) * 1.6;
        const swayZ = Math.cos(snow.time * 0.45 + d.sway) * 1.1;
        snow.positions[i * 3] = cx + d.x + swayX;
        snow.positions[i * 3 + 1] = cy + d.y - 30;
        snow.positions[i * 3 + 2] = cz + d.z + swayZ;
      }
      snow.geo.attributes.position.needsUpdate = true;
    }

    // rain particles
    this.rain.mat.opacity = this.rainAmount * 0.44;
    this.rain.lines.visible = this.rainAmount > 0.02;
    if (this.rain.lines.visible) {
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const windX = 4.5;
      const windZ = 1.8;
      for (let i = 0; i < this.rain.drops.length; i++) {
        const d = this.rain.drops[i];
        d.y -= d.speed * dt;
        if (d.y < -10) {
          d.y += 130;
          d.x = (Math.random() * 2 - 1) * 150;
          d.z = (Math.random() * 2 - 1) * 150;
        }
        const i6 = i * 6;
        const x = cx + d.x;
        const y = cy + d.y - 30;
        const z = cz + d.z;
        this.rain.positions[i6] = x;
        this.rain.positions[i6 + 1] = y;
        this.rain.positions[i6 + 2] = z;
        this.rain.positions[i6 + 3] = x + windX;
        this.rain.positions[i6 + 4] = y - d.len * 2.2;
        this.rain.positions[i6 + 5] = z + windZ;
      }
      this.rain.geo.attributes.position.needsUpdate = true;
    }
  }
}

function lerpColor(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}
