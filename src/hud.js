import {
  ROAD_X,
  ROAD_Z,
  roadWidthX,
  roadWidthZ,
  CITY,
  RIVER,
  TRAM_LINES,
  BRIDGES,
  LANDMARKS,
  TRAILS,
  PISTES,
  AERIAL_LIFTS,
  MISSIONS,
} from './data.js';
import { heightAt } from './terrain.js';

const $ = (id) => document.getElementById(id);

function formatEta(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s <= 8) return 'NOW';
  if (s < 3600) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${Math.ceil(s / 3600)} H`;
}

export class HUD {
  constructor({ onWeather, onHelp, onMap } = {}) {
    this.onWeather = onWeather;
    this.onHelp = onHelp;
    this.onMap = onMap;
    this.root = $('hud');
    this.mapCanvas = $('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.bigMapCanvas = $('cityMap');
    this.bigMapCtx = this.bigMapCanvas.getContext('2d');
    this.mapTimer = 0;
    this.bigMapTimer = 0;
    this.mapInterval = 0.09;
    this.district = '';
    this.lastPrompt = '';
    this.lastStation = '';
    this.lastOnboard = '';
    this.lastTelemetry = '';
    this.missionState = new Map();
    this.clock = '16:40';
    this.helpOpen = false;
    this.mapOpen = false;
    this.lastState = null;
    this.lastWorld = null;
    this.toasts = [];
    this.maxToasts = 4;
    this.bigTerrain = null;

    this.initMissions();
    this.bindUI();
  }

  /**
   * Cached relief plate for the full map. Sampling the actual terrain function
   * keeps the Chartreuse, Vercors and Belledonne silhouettes honest and lets
   * the plan breathe well beyond the 9 km playable basin.
   */
  makeTerrainPlate(ext) {
    const res = 480;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d');
    const step = (ext * 2) / res;
    const h = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      const z = -ext + (j + 0.5) * step;
      for (let i = 0; i < res; i++) {
        const x = -ext + (i + 0.5) * step;
        h[j * res + i] = heightAt(x, z);
      }
    }

    const img = ctx.createImageData(res, res);
    const data = img.data;
    const lerp = (a, b, t) => a + (b - a) * t;
    const ramp = (e) => {
      if (e < 20) return [37, 52, 43];
      if (e < 120) return [43, 62, 47].map((v, k) => lerp(v, [53, 73, 52][k], (e - 20) / 100));
      if (e < 360) return [53, 73, 52].map((v, k) => lerp(v, [76, 80, 58][k], (e - 120) / 240));
      if (e < 650) return [76, 80, 58].map((v, k) => lerp(v, [105, 98, 80][k], (e - 360) / 290));
      if (e < 1000) return [105, 98, 80].map((v, k) => lerp(v, [133, 126, 112][k], (e - 650) / 350));
      return [133, 126, 112].map((v, k) => lerp(v, [179, 185, 181][k], Math.min(1, (e - 1000) / 650)));
    };

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const idx = j * res + i;
        const e = h[idx];
        const left = h[j * res + Math.max(0, i - 1)];
        const right = h[j * res + Math.min(res - 1, i + 1)];
        const up = h[Math.max(0, j - 1) * res + i];
        const down = h[Math.min(res - 1, j + 1) * res + i];
        const gx = (right - left) / (2 * step);
        const gz = (down - up) / (2 * step);
        const light = Math.max(0.67, Math.min(1.1, 0.81 - gx * 8 - gz * 6));
        let rgb = ramp(e);
        if (e > 1500) {
          const snow = Math.min(0.62, (e - 1500) / 900);
          rgb = rgb.map((v, k) => lerp(v, [212, 219, 218][k], snow));
        }
        const o = idx * 4;
        data[o] = Math.min(255, rgb[0] * light);
        data[o + 1] = Math.min(255, rgb[1] * light);
        data[o + 2] = Math.min(255, rgb[2] * light);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { ext, canvas };
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  bindUI() {
    const buttons = this.root.querySelectorAll('[data-weather]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.onWeather?.(btn.dataset.weather);
      });
    });
    $('helpBtn').addEventListener('click', () => this.openHelp());
    $('helpClose').addEventListener('click', () => this.closeHelp());
    $('mapOpen')?.addEventListener('click', () => this.openMap());
    $('bigMapClose')?.addEventListener('click', () => this.closeMap());
    this.mapCanvas.parentElement?.addEventListener('click', () => this.openMap());
    const toggle = $('missionsToggle');
    toggle.addEventListener('click', () => {
      const panel = $('missions');
      panel.classList.toggle('collapsed');
      toggle.textContent = panel.classList.contains('collapsed') ? '+' : '–';
    });
  }

  initMissions() {
    const list = $('missionList');
    list.innerHTML = '';
    for (const m of MISSIONS) {
      const el = document.createElement('div');
      el.className = 'mission';
      el.dataset.id = m.id;
      el.innerHTML = `<span class="check"></span><span>${m.label}</span><span class="m-tag">${m.tag}</span>`;
      list.appendChild(el);
      this.missionState.set(m.id, false);
    }
  }

  setMissionDone(id, silent = false) {
    if (this.missionState.get(id)) return;
    this.missionState.set(id, true);
    const el = this.root.querySelector(`.mission[data-id="${id}"]`);
    if (el) el.classList.add('done');
    if (!silent) {
      const m = MISSIONS.find((x) => x.id === id);
      if (m) this.toast(`CHECKLIST — ${m.label}`, 'DONE');
    }
    if ([...this.missionState.values()].every(Boolean)) {
      this.toast('CITY CHECKLIST COMPLETE — the whole basin is yours.', 'GRENOBLE');
    }
  }

  isMissionDone(id) {
    return !!this.missionState.get(id);
  }

  setWeather(info, mode) {
    $('weatherName').textContent = info.label;
    $('weatherTemp').textContent = info.temp;
    $('weatherWind').textContent = info.wind;
    $('weatherClock').textContent = this.clock;
    this.root.querySelectorAll('[data-weather]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.weather === mode);
    });
  }

  setDistrict(name) {
    if (this.district === name) return;
    this.district = name;
    $('districtName').textContent = name;
    const banner = $('locationText');
    banner.textContent = name;
  }

  setCoordinates(lat, lon, altitude) {
    $('coords').textContent = `${lat.toFixed(3)} · ${lon.toFixed(3)}`;
    $('altitude').textContent = `ALT ${Math.round(altitude)} M`;
  }

  setPrompt(text, key = 'E') {
    if (!text) {
      if (this.lastPrompt !== '') {
        $('prompt').classList.add('hidden');
        this.lastPrompt = '';
      }
      return;
    }
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    $('promptKey').textContent = key;
    $('promptText').textContent = text;
    $('prompt').classList.remove('hidden');
  }

  setStation(station) {
    const board = $('stationBoard');
    if (!board) return;
    if (!station) {
      if (this.lastStation !== '') {
        board.classList.add('hidden');
        this.lastStation = '';
      }
      return;
    }

    const signature = [
      station.stop,
      station.line,
      ...station.directions.flatMap((d) => [d.dir, ...d.trams.map((t) => Math.ceil(t.eta))]),
    ].join('|');
    if (signature === this.lastStation) return;
    this.lastStation = signature;

    board.classList.remove('hidden');
    $('stationName').textContent = station.stop.toUpperCase();
    const badge = $('stationBadge');
    badge.textContent = station.line;
    badge.style.background = station.color;
    badge.style.borderColor = station.color;

    const host = $('stationRows');
    host.replaceChildren();
    for (const direction of station.directions) {
      const row = document.createElement('div');
      row.className = 'station-row';

      const rule = document.createElement('i');
      rule.className = 'station-rule';
      rule.style.background = station.color;

      const dest = document.createElement('div');
      dest.className = 'station-dest';
      const terminus = document.createElement('strong');
      terminus.textContent = (direction.destination || station.stop).toUpperCase();
      const detail = document.createElement('small');
      detail.textContent = `TRAM ${station.line} · QUAI ${direction.dir > 0 ? 'A' : 'B'}`;
      dest.append(terminus, detail);

      const time = document.createElement('div');
      time.className = 'station-time';
      const eta = document.createElement('strong');
      eta.textContent = formatEta(direction.trams[0]?.eta ?? Infinity);
      time.appendChild(eta);
      if (direction.trams[1]) {
        const following = document.createElement('small');
        following.textContent = `then ${formatEta(direction.trams[1].eta)}`;
        time.appendChild(following);
      }

      row.append(rule, dest, time);
      host.appendChild(row);
    }

    if (!host.children.length) {
      const empty = document.createElement('div');
      empty.className = 'station-empty';
      empty.textContent = 'NO LIVE TRAM — CHECK THE TIMETABLE';
      host.appendChild(empty);
    }

    const headway = station.schedule?.headway;
    $('stationService').textContent = headway
      ? `EVERY ${Number(headway.toFixed(1))} MIN · LIVE`
      : 'TAG · LIVE';
    $('stationDistance').textContent = `${Math.round(station.distance)} M`;
  }

  setOnboard(onboard) {
    const board = $('onboardBoard');
    if (!board) return;
    if (!onboard) {
      if (this.lastOnboard !== '') {
        board.classList.add('hidden');
        this.lastOnboard = '';
      }
      return;
    }

    const next = onboard.next;
    const signature = [
      onboard.line,
      next.name,
      Math.ceil(next.eta),
      next.terminus,
      onboard.upcoming.join('|'),
      Math.round(onboard.speedKmh),
    ].join('|');
    if (signature === this.lastOnboard) return;
    this.lastOnboard = signature;

    board.classList.remove('hidden');
    board.style.borderRightColor = onboard.color;
    const badge = $('onboardBadge');
    badge.textContent = onboard.line;
    badge.style.background = onboard.color;
    badge.style.borderColor = onboard.color;

    $('onboardLine').textContent = `${onboard.lineName.toUpperCase()} · ${onboard.destination.toUpperCase()}`;
    $('onboardKicker').textContent = next.terminus ? 'TERMINUS' : 'PROCHAIN ARRÊT';
    $('onboardNextStop').textContent = next.name.toUpperCase();
    $('onboardEta').textContent = next.terminus ? '—' : formatEta(next.eta);

    const following = onboard.upcoming.slice(1, 4);
    $('onboardFollowing').textContent = following.length
      ? `PUIS · ${following.join(' · ').toUpperCase()}`
      : next.terminus
        ? 'FIN DE LIGNE'
        : 'DERNIER ARRÊT AVANT TERMINUS';

    const remaining = Math.max(0, onboard.remainingStops);
    $('onboardRemaining').textContent = remaining
      ? `${remaining} STOPS TO ${onboard.destination.toUpperCase()}`
      : `TERMINUS · ${onboard.destination.toUpperCase()}`;
    $('onboardSpeed').textContent = `${Math.round(onboard.speedKmh)} KM/H`;
  }

  setSpeed(mode, meta, kmh, gear, fraction, hint) {
    $('modeLabel').textContent = mode;
    $('modeMeta').textContent = meta;
    const rounded = Math.round(kmh);
    if ($('speedValue').textContent !== String(rounded)) {
      $('speedValue').textContent = rounded;
    }
    $('gearLabel').textContent = gear;
    $('speedFill').style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    if ($('speedHint').textContent !== hint) $('speedHint').textContent = hint;
  }

  setTelemetry(data) {
    if (!data) {
      if (this.lastTelemetry !== '') {
        $('telemetry').classList.add('hidden');
        this.lastTelemetry = '';
      }
      return;
    }
    const sig = `${data.label}|${data.name}|${data.state}|${Math.round(data.progress * 100)}|${Math.round(data.elevation)}|${Math.round(data.remaining)}`;
    if (sig === this.lastTelemetry) return;
    this.lastTelemetry = sig;
    $('telemetry').classList.remove('hidden');
    $('teleLabel').textContent = data.label;
    $('teleElev').textContent = `ALT ${Math.round(data.elevation)} M`;
    $('teleName').textContent = data.name;
    $('teleFill').style.width = `${Math.min(100, Math.max(0, data.progress * 100))}%`;
    $('teleDistance').textContent = data.remainingText;
    $('teleState').textContent = data.state;
  }

  formatPoints(value) {
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  setRewards(rewards) {
    if (!rewards) return;
    const points = this.formatPoints(rewards.points);
    $('rewardPoints').textContent = points;
    $('rewardRank').textContent = rewards.rank;
    $('rewardDistance').textContent = `${(rewards.distance / 1000).toFixed(2)} KM`;
    $('rewardFill').style.width = `${Math.min(100, Math.max(0, rewards.progress * 100))}%`;
    if (rewards.next) {
      $('rewardNext').textContent = `NEXT ${this.formatPoints(rewards.next.at)} M`;
      $('rewardBonus').textContent = `+${this.formatPoints(rewards.next.bonus)} PTS`;
    } else {
      $('rewardNext').textContent = 'ALL MILESTONES CLEARED';
      $('rewardBonus').textContent = 'ALPES LEGEND';
    }
    const bigPoints = $('bigMapPoints');
    if (bigPoints) {
      bigPoints.textContent = points;
      $('bigMapReward').textContent = `${(rewards.distance / 1000).toFixed(2)} KM · ${rewards.rank}`;
    }
  }

  toast(text, title = '') {
    const host = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    if (title) {
      const b = document.createElement('b');
      b.textContent = `${title} `;
      el.appendChild(b);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 380);
    }, 5200);
    while (host.children.length > this.maxToasts) host.removeChild(host.firstChild);
  }

  openHelp() {
    if (this.mapOpen) this.closeMap();
    this.helpOpen = true;
    $('help').classList.remove('hidden');
    this.onHelp?.(true);
  }

  closeHelp() {
    this.helpOpen = false;
    $('help').classList.add('hidden');
    this.onHelp?.(false);
  }

  toggleHelp() {
    if (this.helpOpen) this.closeHelp();
    else this.openHelp();
  }

  openMap() {
    if (this.mapOpen) return;
    if (this.helpOpen) this.closeHelp();
    this.mapOpen = true;
    $('bigMap').classList.remove('hidden');
    $('help').classList.add('hidden');
    if (this.lastState) this.updateBigMapInfo(this.lastState, this.lastWorld);
    this.drawBigMap(this.lastState, this.lastWorld);
    this.onMap?.(true);
  }

  closeMap() {
    if (!this.mapOpen) return;
    this.mapOpen = false;
    $('bigMap').classList.add('hidden');
    this.onMap?.(false);
  }

  toggleMap() {
    if (this.mapOpen) this.closeMap();
    else this.openMap();
  }

  updateBigMapInfo(state, world) {
    $('bigMapPlace').textContent = state.district || 'GRENOBLE';
    $('bigMapCoords').textContent = `${state.lat.toFixed(5)} N · ${state.lon.toFixed(5)} E`;
    $('bigMapElevation').textContent = `ALT ${Math.round(state.altitude)} M`;
    $('bigMapMode').textContent = `${state.modeLabel} · ${Math.round(state.speedKmh)} KM/H`;
    if (world?.traffic) {
      $('bigMapTraffic').textContent = `TRAFFIC · ${world.traffic.vehicles.length} LIVE · ${world.vehicles.length} DRIVABLE`;
    }
    let nearest = null;
    const spots = [
      ...LANDMARKS.map((lm) => ({ name: lm.name, x: lm.x, z: lm.z })),
      ...TRAM_LINES.flatMap((line) =>
        line.stops.map((stop) => ({ name: `${stop.name} · TRAM ${line.id}`, x: stop.x, z: stop.z }))
      ),
    ];
    for (const spot of spots) {
      const d = Math.hypot(spot.x - state.x, spot.z - state.z);
      if (!nearest || d < nearest.distance) nearest = { ...spot, distance: d };
    }
    $('bigMapNear').textContent = nearest
      ? `${nearest.name.toUpperCase()} · ${Math.round(nearest.distance)} M`
      : 'ISÈRE VALLEY';
  }

  setLockHint(visible) {
    $('lockHint').classList.toggle('hidden', !visible);
  }

  update(dt, state, world) {
    this.lastState = state;
    this.lastWorld = world;
    this.setDistrict(state.district);
    if (state.clock && state.clock !== this.clock) {
      this.clock = state.clock;
      $('weatherClock').textContent = this.clock;
    }
    this.setCoordinates(state.lat, state.lon, state.altitude);
    this.setPrompt(state.prompt?.text ?? null, state.prompt?.key ?? 'E');
    this.setStation(state.station);
    this.setOnboard(state.onboard);
    this.setSpeed(
      state.modeLabel,
      state.modeMeta,
      state.speedKmh,
      state.gear,
      state.speedFraction,
      state.speedHint
    );
    this.setTelemetry(state.telemetry);
    this.setRewards(state.rewards);

    this.mapTimer += dt;
    if (this.mapTimer >= this.mapInterval) {
      this.mapTimer = 0;
      this.drawMinimap(state, world);
    }

    if (this.mapOpen) {
      this.bigMapTimer += dt;
      if (this.bigMapTimer >= 0.16) {
        this.bigMapTimer = 0;
        this.updateBigMapInfo(state, world);
        this.drawBigMap(state, world);
      }
    }
  }

  drawBigMap(state, world) {
    const ctx = this.bigMapCtx;
    const W = this.bigMapCanvas.width;
    const H = this.bigMapCanvas.height;
    const M = 30;
    const EXT = 5200;
    const scale = (W - M * 2) / (EXT * 2);
    const mx = (x) => W / 2 + x * scale;
    const my = (z) => H / 2 + z * scale;

    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12231b');
    bg.addColorStop(0.48, '#14271f');
    bg.addColorStop(1, '#0f2019');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!this.bigTerrain || this.bigTerrain.ext !== EXT) {
      this.bigTerrain = this.makeTerrainPlate(EXT);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bigTerrain.canvas, 0, 0, W, H);
    ctx.restore();

    // a soft alpine haze keeps the relief from overpowering the network
    ctx.fillStyle = 'rgba(13, 35, 31, 0.16)';
    ctx.fillRect(0, 0, W, H);

    // 1 km graticule
    ctx.strokeStyle = 'rgba(206, 224, 222, 0.05)';
    ctx.lineWidth = 1;
    for (let n = -5000; n <= 5000; n += 1000) {
      ctx.beginPath();
      ctx.moveTo(mx(n), 0);
      ctx.lineTo(mx(n), H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, my(n));
      ctx.lineTo(W, my(n));
      ctx.stroke();
    }

    // city plate and parks
    ctx.fillStyle = 'rgba(151, 143, 125, 0.34)';
    ctx.fillRect(mx(CITY.x1), my(CITY.z1), (CITY.x2 - CITY.x1) * scale, (CITY.z2 - CITY.z1) * scale);
    ctx.strokeStyle = 'rgba(235, 228, 209, 0.17)';
    ctx.strokeRect(mx(CITY.x1), my(CITY.z1), (CITY.x2 - CITY.x1) * scale, (CITY.z2 - CITY.z1) * scale);
    ctx.fillStyle = 'rgba(91, 132, 79, 0.55)';
    for (const park of [
      [390, -130, 230, 230],
      [910, 910, 220, 220],
      [-1170, 1430, 240, 230],
      [1170, 1950, 220, 220],
    ]) {
      ctx.beginPath();
      ctx.roundRect(mx(park[0] - park[2] / 2), my(park[1] - park[3] / 2), park[2] * scale, park[3] * scale, 4);
      ctx.fill();
    }

    // city street grid
    ctx.lineCap = 'butt';
    for (const x of ROAD_X) {
      ctx.strokeStyle = 'rgba(239, 231, 211, 0.38)';
      ctx.lineWidth = roadWidthX(x) > 25 ? 4 : 2.8;
      ctx.beginPath();
      ctx.moveTo(mx(x), my(CITY.z1));
      ctx.lineTo(mx(x), my(CITY.z2));
      ctx.stroke();
    }
    for (const z of ROAD_Z) {
      ctx.strokeStyle = 'rgba(239, 231, 211, 0.38)';
      ctx.lineWidth = roadWidthZ(z) > 25 ? 4 : 2.8;
      ctx.beginPath();
      ctx.moveTo(mx(CITY.x1), my(z));
      ctx.lineTo(mx(CITY.x2), my(z));
      ctx.stroke();
    }

    // river
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(13, 34, 40, 0.84)';
    ctx.lineWidth = Math.max(8, 200 * scale);
    ctx.beginPath();
    RIVER.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(mx(x), my(z));
      else ctx.lineTo(mx(x), my(z));
    });
    ctx.stroke();
    ctx.strokeStyle = '#2f6372';
    ctx.lineWidth = Math.max(4, 145 * scale);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(157, 218, 225, 0.22)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(mx(-1500), my(-930));
    ctx.rotate(-0.08);
    ctx.textAlign = 'center';
    ctx.font = 'italic 600 21px "Barlow Condensed", sans-serif';
    ctx.fillStyle = 'rgba(179, 226, 232, 0.8)';
    ctx.shadowColor = 'rgba(4, 17, 22, 0.8)';
    ctx.shadowBlur = 4;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText("L'ISÈRE", 0, 0);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();

    // trails and ski pistes
    ctx.save();
    ctx.setLineDash([8, 7]);
    for (const trail of TRAILS) {
      ctx.strokeStyle = trail.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      trail.points.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x), my(z));
        else ctx.lineTo(mx(x), my(z));
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const piste of PISTES) {
      ctx.strokeStyle = piste.color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      piste.points.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x), my(z));
        else ctx.lineTo(mx(x), my(z));
      });
      ctx.stroke();
    }
    ctx.restore();

    // tram lines
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of TRAM_LINES) {
      const ox = line.offset?.[0] ?? 0;
      const oz = line.offset?.[1] ?? 0;
      ctx.strokeStyle = 'rgba(7, 17, 22, 0.72)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      line.route.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x + ox), my(z + oz));
        else ctx.lineTo(mx(x + ox), my(z + oz));
      });
      ctx.stroke();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 4.2;
      ctx.stroke();
    }
    ctx.restore();

    // live traffic
    if (world?.traffic) {
      for (const vehicle of world.traffic.vehicles) {
        ctx.save();
        ctx.translate(mx(vehicle.position.x), my(vehicle.position.z));
        ctx.rotate(Math.PI - vehicle.heading);
        ctx.fillStyle = 'rgba(238, 221, 180, 0.72)';
        ctx.fillRect(-1.5, -3.2, 3, 6.4);
        ctx.restore();
      }
    }

    // aerial lift alignments
    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(146, 237, 240, 0.65)';
    ctx.lineWidth = 2;
    for (const lift of AERIAL_LIFTS) {
      ctx.beginPath();
      ctx.moveTo(mx(lift.lower.x), my(lift.lower.z));
      ctx.lineTo(mx(lift.upper.x), my(lift.upper.z));
      ctx.stroke();
    }
    ctx.restore();

    // bridges
    ctx.strokeStyle = 'rgba(236, 224, 201, 0.75)';
    ctx.lineWidth = 4;
    for (const bridge of BRIDGES) {
      const zc = (bridge.z1 + bridge.z2) / 2;
      ctx.beginPath();
      ctx.moveTo(mx(bridge.x - 70), my(zc));
      ctx.lineTo(mx(bridge.x + 70), my(zc));
      ctx.stroke();
    }

    // landmark pins and labels
    const labelOffsets = {
      grenette: [10, -34],
      jardin: [10, -8],
      cathedrale: [10, 4],
      gare: [10, 4],
      perret: [10, -6],
      musee: [10, 4],
      stade: [10, 4],
      bastille: [10, 4],
      telepherique: [10, 4],
      gondola: [10, 4],
      chamrousse: [10, 4],
      rachais: [10, 4],
      vercors: [10, 4],
      universite: [10, 4],
    };
    ctx.textBaseline = 'middle';
    ctx.font = '600 17px "Barlow Condensed", sans-serif';
    const minorLabels = new Set(['cathedrale', 'jardin', 'perret']);
    const placed = [];
    for (const lm of LANDMARKS) {
      const x = mx(lm.x);
      const y = my(lm.z);
      if (x < 4 || x > W - 4 || y < 4 || y > H - 4) continue;
      let fill = '#f4e9d3';
      ctx.fillStyle = fill;
      if (lm.kind === 'peak') {
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 8, y + 5);
        ctx.lineTo(x - 8, y + 5);
        ctx.closePath();
        ctx.fill();
      } else if (lm.kind === 'fort') {
        ctx.fillStyle = '#ffb257';
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.strokeStyle = 'rgba(255,178,87,0.5)';
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
      } else if (lm.kind === 'lift' || lm.kind === 'ski') {
        ctx.fillStyle = '#84e9ed';
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(132,233,237,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(244, 238, 222, 0.9)';
        ctx.fillRect(x - 3.2, y - 3.2, 6.4, 6.4);
      }
      if (minorLabels.has(lm.id)) continue;
      const [ox, oy] = labelOffsets[lm.id] || [12, 4];
      const alignRight = x > W - 240;
      const label = lm.name.toUpperCase();
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.fillStyle = 'rgba(9, 20, 24, 0.78)';
      const tw = ctx.measureText(label).width;
      const lx = x + (alignRight ? -ox : ox);
      const bx = lx - (alignRight ? tw + 7 : 5);
      ctx.fillRect(bx, y + oy - 10, tw + 12, 20);
      placed.push({ x: bx, y: y + oy - 10, w: tw + 12, h: 20 });
      ctx.fillStyle = lm.kind === 'peak' ? 'rgba(224, 238, 235, 0.8)' : 'rgba(245, 237, 219, 0.95)';
      ctx.fillText(label, lx, y + oy);
    }

    // station dots and cartographic labels
    const stations = new Map();
    for (const line of TRAM_LINES) {
      for (const stop of line.stops) {
        let station = stations.get(stop.name);
        if (!station) {
          station = { name: stop.name, x: stop.x, z: stop.z, lines: [], color: line.color };
          stations.set(stop.name, station);
        }
        if (!station.lines.includes(line.id)) station.lines.push(line.id);
      }
    }
    const termini = new Set();
    for (const line of TRAM_LINES) {
      termini.add(line.stops[0].name);
      termini.add(line.stops[line.stops.length - 1].name);
    }
    const stationList = [...stations.values()];
    const priority = (s) => (s.lines.length > 1 ? 0 : termini.has(s.name) ? 1 : 2);

    ctx.save();
    for (const station of stationList) {
      const x = mx(station.x);
      const y = my(station.z);
      if (x < M - 6 || x > W - M + 6 || y < M - 6 || y > H - M + 6) continue;
      const interchange = station.lines.length > 1;
      ctx.beginPath();
      ctx.arc(x, y, interchange ? 4.8 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = interchange ? '#f8f2e4' : station.color;
      ctx.fill();
      ctx.lineWidth = interchange ? 2 : 1.2;
      ctx.strokeStyle = interchange ? 'rgba(8, 18, 22, 0.9)' : 'rgba(248, 242, 228, 0.85)';
      ctx.stroke();
    }

    const overlaps = (box) =>
      placed.some(
        (other) =>
          box.x < other.x + other.w + 5 &&
          box.x + box.w + 5 > other.x &&
          box.y < other.y + other.h + 4 &&
          box.y + box.h + 4 > other.y
      );
    const candidates = [
      { dx: 8, dy: -10, align: 'left' },
      { dx: -8, dy: -10, align: 'right' },
      { dx: 8, dy: 12, align: 'left' },
      { dx: -8, dy: 12, align: 'right' },
      { dx: 0, dy: -17, align: 'center' },
      { dx: 0, dy: 19, align: 'center' },
    ];
    const ordered = stationList
      .map((station, index) => ({ station, index }))
      .sort((a, b) => priority(a.station) - priority(b.station) || a.index - b.index);

    for (const { station } of ordered) {
      const x = mx(station.x);
      const y = my(station.z);
      if (x < M || x > W - M || y < M || y > H - M) continue;
      const interchange = station.lines.length > 1;
      ctx.font = interchange
        ? '700 15px "Barlow Condensed", sans-serif'
        : '600 14px "Barlow Condensed", sans-serif';
      const label = station.name.toUpperCase();
      const tw = ctx.measureText(label).width;
      let choice = null;
      for (const candidate of candidates) {
        const left =
          candidate.align === 'center'
            ? x + candidate.dx - tw / 2
            : candidate.align === 'right'
              ? x + candidate.dx - tw
              : x + candidate.dx;
        const box = { x: left - 3, y: y + candidate.dy - 9, w: tw + 6, h: 18 };
        if (box.x < M || box.x + box.w > W - M || box.y < M || box.y + box.h > H - M) continue;
        if (overlaps(box)) continue;
        choice = { ...candidate, left, box };
        break;
      }
      if (!choice) continue;
      placed.push(choice.box);
      ctx.textAlign = choice.align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(6, 15, 19, 0.9)';
      ctx.strokeText(label, choice.left, y + choice.dy + 1);
      ctx.fillStyle = interchange ? '#fff4dc' : 'rgba(240, 234, 219, 0.9)';
      ctx.fillText(label, choice.left, y + choice.dy + 1);
    }
    ctx.restore();

    // massif names, held back so the city stays legible
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(223, 235, 226, 0.28)';
    ctx.font = '600 38px "Barlow Condensed", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '13px';
    ctx.fillText('CHARTREUSE', mx(350), my(-4260));
    ctx.fillText('VERCORS', mx(-900), my(4380));
    ctx.save();
    ctx.translate(mx(4520), my(700));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BELLEDONNE', 0, 0);
    ctx.restore();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = 'rgba(243, 236, 219, 0.16)';
    ctx.font = '600 30px "Barlow Condensed", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '16px';
    ctx.fillText('GRENOBLE', mx(0), my(820));
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();

    // player position and exact heading
    if (state) {
      const px = mx(state.x);
      const py = my(state.z);
      const phase = (performance.now() % 2400) / 2400;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 112, 67, ${0.5 * (1 - phase)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 18 + phase * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 112, 67, 0.18)';
      ctx.beginPath();
      ctx.arc(px, py, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 246, 228, 0.82)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - state.heading);
      ctx.fillStyle = '#ff7043';
      ctx.strokeStyle = '#fff3e0';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -23);
      ctx.lineTo(14, 15);
      ctx.lineTo(0, 8);
      ctx.lineTo(-14, 15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // a small label that always hugs the marker
      ctx.save();
      ctx.font = '700 15px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tagW = 58;
      const tagX = px + (px > W - 150 ? -62 : 62);
      const tagY = py;
      ctx.strokeStyle = 'rgba(255, 196, 107, 0.62)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + (tagX > px ? 18 : -18), py);
      ctx.lineTo(tagX + (tagX > px ? -tagW / 2 : tagW / 2), py);
      ctx.stroke();
      ctx.fillStyle = 'rgba(7, 17, 22, 0.9)';
      ctx.fillRect(tagX - tagW / 2, tagY - 11, tagW, 22);
      ctx.strokeStyle = 'rgba(255, 196, 107, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(tagX - tagW / 2, tagY - 11, tagW, 22);
      ctx.fillStyle = '#ffb257';
      ctx.fillText('YOU', tagX, tagY + 1);
      ctx.restore();
    }

    // map frame
    ctx.strokeStyle = 'rgba(227, 239, 239, 0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  drawMinimap(state, world) {
    const ctx = this.mapCtx;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const viewRadius = 900;
    const scale = W / (viewRadius * 2);
    const px = state.x;
    const pz = state.z;
    const mx = (x) => cx + (x - px) * scale;
    const my = (z) => cy + (z - pz) * scale;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(cx, cy, W / 2, 0, Math.PI * 2);
    ctx.clip();

    // ground
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#182b22');
    grad.addColorStop(1, '#13241e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // elevation rings
    ctx.strokeStyle = 'rgba(160, 200, 170, 0.08)';
    ctx.lineWidth = 1;
    for (let r = 120; r < viewRadius; r += 220) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // city plate
    if (Math.abs(px - (CITY.x1 + CITY.x2) / 2) < viewRadius + 3000 && Math.abs(pz - (CITY.z1 + CITY.z2) / 2) < viewRadius + 3000) {
      ctx.fillStyle = 'rgba(148, 142, 126, 0.22)';
      ctx.fillRect(mx(CITY.x1), my(CITY.z1), (CITY.x2 - CITY.x1) * scale, (CITY.z2 - CITY.z1) * scale);
    }

    // river
    ctx.strokeStyle = '#2b5d6e';
    ctx.lineWidth = Math.max(6, 212 * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    RIVER.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(mx(x), my(z));
      else ctx.lineTo(mx(x), my(z));
    });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(124, 196, 209, 0.22)';
    ctx.lineWidth = Math.max(1, 3 * scale * 4);
    ctx.stroke();

    // city roads
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(212, 205, 188, 0.4)';
    for (const x of ROAD_X) {
      ctx.lineWidth = Math.max(1.4, roadWidthX(x) * scale * 0.55);
      ctx.beginPath();
      ctx.moveTo(mx(x), my(CITY.z1));
      ctx.lineTo(mx(x), my(CITY.z2));
      ctx.stroke();
    }
    for (const z of ROAD_Z) {
      ctx.lineWidth = Math.max(1.4, roadWidthZ(z) * scale * 0.55);
      ctx.beginPath();
      ctx.moveTo(mx(CITY.x1), my(z));
      ctx.lineTo(mx(CITY.x2), my(z));
      ctx.stroke();
    }

    // parks
    ctx.fillStyle = 'rgba(104, 145, 88, 0.45)';
    for (const park of [
      [390, -130, 230, 230],
      [910, 910, 220, 220],
      [-1170, 1430, 240, 230],
      [1170, 1950, 220, 220],
    ]) {
      ctx.beginPath();
      ctx.roundRect(mx(park[0] - park[2] / 2), my(park[1] - park[3] / 2), park[2] * scale, park[3] * scale, 6);
      ctx.fill();
    }

    // trails & pistes
    ctx.setLineDash([5, 5]);
    for (const trail of TRAILS) {
      ctx.strokeStyle = trail.color;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      trail.points.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x), my(z));
        else ctx.lineTo(mx(x), my(z));
      });
      ctx.stroke();
    }
    for (const piste of PISTES) {
      ctx.strokeStyle = piste.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 5;
      ctx.beginPath();
      piste.points.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x), my(z));
        else ctx.lineTo(mx(x), my(z));
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // tram lines
    for (const line of TRAM_LINES) {
      const ox = line.offset?.[0] ?? 0;
      const oz = line.offset?.[1] ?? 0;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      line.route.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(mx(x + ox), my(z + oz));
        else ctx.lineTo(mx(x + ox), my(z + oz));
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // aerial cables
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(222, 236, 238, 0.45)';
    ctx.lineWidth = 1.2;
    for (const lift of AERIAL_LIFTS) {
      ctx.beginPath();
      ctx.moveTo(mx(lift.lower.x), my(lift.lower.z));
      ctx.lineTo(mx(lift.upper.x), my(lift.upper.z));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // landmarks
    for (const lm of LANDMARKS) {
      const x = mx(lm.x);
      const z = my(lm.z);
      if (x < -20 || x > W + 20 || z < -20 || z > H + 20) continue;
      if (lm.kind === 'peak') {
        ctx.fillStyle = '#e7eef1';
        ctx.beginPath();
        ctx.moveTo(x, z - 7);
        ctx.lineTo(x + 6, z + 4);
        ctx.lineTo(x - 6, z + 4);
        ctx.closePath();
        ctx.fill();
      } else if (lm.kind === 'fort') {
        ctx.fillStyle = '#ffb257';
        ctx.fillRect(x - 3.5, z - 3.5, 7, 7);
        ctx.strokeStyle = 'rgba(255,178,87,0.5)';
        ctx.beginPath();
        ctx.arc(x, z, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (lm.kind === 'lift' || lm.kind === 'ski') {
        ctx.fillStyle = '#84e9ed';
        ctx.beginPath();
        ctx.arc(x, z, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(132,233,237,0.35)';
        ctx.beginPath();
        ctx.arc(x, z, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(244, 238, 222, 0.8)';
        ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
      }
    }

    // parked / drivable vehicles
    if (world?.vehicles) {
      for (const v of world.vehicles) {
        if (v.driver) continue;
        const d = Math.hypot(v.position.x - px, v.position.z - pz);
        if (d > viewRadius) continue;
        ctx.fillStyle = 'rgba(132, 233, 237, 0.75)';
        ctx.beginPath();
        ctx.arc(mx(v.position.x), my(v.position.z), 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // live traffic
    if (world?.traffic) {
      for (const vehicle of world.traffic.vehicles) {
        const d = Math.hypot(vehicle.position.x - px, vehicle.position.z - pz);
        if (d > viewRadius) continue;
        const length = vehicle.type === 'bus' ? 7 : vehicle.type === 'truck' ? 5 : 4;
        ctx.save();
        ctx.translate(mx(vehicle.position.x), my(vehicle.position.z));
        ctx.rotate(Math.PI - vehicle.heading);
        ctx.fillStyle = 'rgba(238, 221, 180, 0.82)';
        ctx.fillRect(-2, -length / 2, 4, length);
        ctx.restore();
      }
    }

    // trams
    if (world?.trams) {
      for (const tram of world.trams) {
        const d = Math.hypot(tram.position.x - px, tram.position.z - pz);
        if (d > viewRadius) continue;
        ctx.fillStyle = tram.line.color;
        ctx.fillRect(mx(tram.position.x) - 3, my(tram.position.z) - 4, 6, 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx(tram.position.x) - 3, my(tram.position.z) - 4, 6, 8);
      }
    }

    // player arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI - state.heading);
    ctx.fillStyle = '#ff7043';
    ctx.strokeStyle = '#fff3e0';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4.2);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // outer ring
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
