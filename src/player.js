import * as THREE from 'three';
import { groundHeightAt, isUnderwater, terrainNormalAt, heightAt } from './terrain.js';
import { clamp, damp, dampAngle, lerp } from './utils.js';

function makeCharacter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: '#c69a7b', roughness: 0.72 });
  const jacket = new THREE.MeshStandardMaterial({ color: '#df5b3e', roughness: 0.6 });
  const jacketDark = new THREE.MeshStandardMaterial({ color: '#a8412f', roughness: 0.65 });
  const trousers = new THREE.MeshStandardMaterial({ color: '#2c3b47', roughness: 0.8 });
  const boots = new THREE.MeshStandardMaterial({ color: '#2a2f32', roughness: 0.85 });
  const beanie = new THREE.MeshStandardMaterial({ color: '#e4d4b5', roughness: 0.9 });
  const pack = new THREE.MeshStandardMaterial({ color: '#40594c', roughness: 0.75 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.28), jacket);
  torso.position.y = 1.18;
  torso.castShadow = true;
  body.add(torso);
  const torsoTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.25), jacketDark);
  torsoTop.position.y = 1.55;
  body.add(torsoTop);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), skin);
  head.position.y = 1.76;
  head.castShadow = true;
  body.add(head);
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    beanie
  );
  hat.position.y = 1.79;
  body.add(hat);
  const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), beanie);
  bobble.position.set(0, 1.94, 0);
  body.add(bobble);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.2), pack);
  backpack.position.set(0, 1.2, -0.24);
  backpack.castShadow = true;
  body.add(backpack);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8), beanie);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.48, -0.28);
  body.add(roll);

  const limbs = { arms: [], legs: [] };
  for (const s of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(s * 0.29, 1.46, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.58, 0.13), jacket);
    arm.position.y = -0.27;
    arm.castShadow = true;
    armPivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), skin);
    hand.position.y = -0.57;
    armPivot.add(hand);
    body.add(armPivot);
    limbs.arms.push(armPivot);

    const legPivot = new THREE.Group();
    legPivot.position.set(s * 0.13, 0.9, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.19), trousers);
    leg.position.y = -0.39;
    leg.castShadow = true;
    legPivot.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.32), boots);
    boot.position.set(0, -0.82, 0.06);
    legPivot.add(boot);
    body.add(legPivot);
    limbs.legs.push(legPivot);
  }

  // skis
  const skiGroup = new THREE.Group();
  const skiMat = new THREE.MeshStandardMaterial({ color: '#e14b34', roughness: 0.35, metalness: 0.15 });
  const skiTipMat = new THREE.MeshStandardMaterial({ color: '#f2e7cf', roughness: 0.5 });
  for (const s of [-1, 1]) {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.035, 1.72), skiMat);
    ski.position.set(s * 0.24, 0.045, 0.18);
    ski.castShadow = true;
    skiGroup.add(ski);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.035, 0.22), skiTipMat);
    tip.position.set(s * 0.24, 0.08, 1.08);
    tip.rotation.x = -0.28;
    skiGroup.add(tip);
    const binding = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.3), boots);
    binding.position.set(s * 0.24, 0.09, -0.06);
    skiGroup.add(binding);
  }
  skiGroup.visible = false;
  body.add(skiGroup);

  // poles
  const poles = new THREE.Group();
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4), new THREE.MeshStandardMaterial({ color: '#303a3f', metalness: 0.6, roughness: 0.4 }));
    pole.position.set(s * 0.38, 0.85, 0.32);
    pole.rotation.x = 0.2;
    pole.rotation.z = s * 0.1;
    poles.add(pole);
  }
  poles.visible = false;
  body.add(poles);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { root, body, limbs, skiGroup, poles, head };
}

export class Player {
  constructor(scene, x, z, heading = 0) {
    this.position = new THREE.Vector3(x, groundHeightAt(x, z), z);
    this.heading = heading;
    this.targetHeading = heading;
    this.velocity = new THREE.Vector3();
    this.vertical = 0;
    this.onGround = true;
    this.speed = 0;
    this.skiing = false;
    this.skiSpeed = 0;
    this.animTime = 0;
    this.height = 1.85;
    this.radius = 0.42;
    this.inAir = false;
    this.walkPhase = 0;

    const { root, body, limbs, skiGroup, poles, head } = makeCharacter();
    this.model = root;
    this.body = body;
    this.limbs = limbs;
    this.skiGroup = skiGroup;
    this.poles = poles;
    this.head = head;
    this.model.position.copy(this.position);
    this.model.rotation.y = heading;
    scene.add(this.model);
  }

  get position2D() {
    return { x: this.position.x, z: this.position.z };
  }

  setVisible(v) {
    this.model.visible = v;
  }

  setSkiing(on) {
    this.skiing = on;
    this.skiGroup.visible = on;
    this.poles.visible = on;
    if (on) {
      this.skiSpeed = Math.max(this.skiSpeed, 2.5);
      this.body.position.y = -0.08;
    } else {
      this.body.position.y = 0;
      this.skiSpeed = 0;
    }
  }

  teleport(x, z, heading = this.heading) {
    this.position.set(x, groundHeightAt(x, z), z);
    this.heading = this.targetHeading = heading;
    this.vertical = 0;
    this.speed = 0;
    this.skiSpeed = 0;
    this.model.position.copy(this.position);
    this.model.rotation.y = heading;
  }

  update(dt, input, cameraYaw, world, env = {}) {
    if (this.skiing) return this.updateSkiing(dt, input, world, env);

    const fwd = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const right = new THREE.Vector3(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    const move = new THREE.Vector3();
    move.addScaledVector(fwd, input.forward);
    move.addScaledVector(right, input.steer);
    const moving = move.lengthSq() > 0.001;
    if (moving) move.normalize();

    const run = input.boost;
    const baseSpeed = env.snow > 0.3 ? 4.0 : 4.8;
    const maxSpeed = run ? (env.snow > 0.3 ? 7.0 : 8.2) : baseSpeed;
    const desired = moving ? maxSpeed : 0;

    // local terrain slope penalty
    const normal = terrainNormalAt(this.position.x, this.position.z, 2);
    const slope = Math.acos(clamp(normal.y, -1, 1));
    let steepFactor = 1;
    if (slope > 0.32) steepFactor = lerp(1, 0.35, clamp((slope - 0.32) / 0.8, 0, 1));

    this.speed = damp(this.speed, desired, moving ? 8 : 11, dt);
    if (moving) {
      if (this.onGround) {
        const targetHeading = Math.atan2(move.x, move.z);
        this.heading = dampAngle(this.heading, targetHeading, 12, dt);
      }
      const step = this.speed * steepFactor * dt;
      let nx = this.position.x + move.x * step;
      let nz = this.position.z + move.z * step;

      if (isUnderwater(nx, nz)) {
        nx = this.position.x;
        nz = this.position.z;
        this.speed *= 0.2;
      }

      const push = world.resolveCircle(nx, nz, this.radius);
      nx += push.x;
      nz += push.z;
      if (push.hit) {
        this.speed *= 0.6;
      }

      // block very steep cliff faces
      const nextNormal = terrainNormalAt(nx, nz, 2);
      if (nextNormal.y > 0.48) {
        this.position.x = nx;
        this.position.z = nz;
      } else {
        this.speed *= 0.2;
      }
    }

    // jump
    if (input.jump && this.onGround) {
      this.vertical = 4.8;
      this.onGround = false;
      this.inAir = true;
    }
    if (!this.onGround) {
      this.vertical -= 17 * dt;
    }

    const ground = groundHeightAt(this.position.x, this.position.z);
    if (!this.onGround) {
      this.position.y += this.vertical * dt;
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.vertical = 0;
        this.onGround = true;
        this.inAir = false;
      }
    } else {
      this.position.y = ground;
    }

    // animations
    const actualSpeed = moving ? this.speed * steepFactor : 0;
    this.walkPhase += actualSpeed * dt * 2.6;
    const swing = Math.sin(this.walkPhase) * clamp(actualSpeed / 6, 0, 1) * 0.7;
    if (this.onGround) {
      this.limbs.legs[0].rotation.x = swing;
      this.limbs.legs[1].rotation.x = -swing;
      this.limbs.arms[0].rotation.x = -swing * 0.85;
      this.limbs.arms[1].rotation.x = swing * 0.85;
      this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.03 * clamp(actualSpeed / 6, 0, 1);
      this.body.rotation.x = clamp(actualSpeed / 10, 0, 0.12);
    } else {
      this.limbs.legs[0].rotation.x = -0.35;
      this.limbs.legs[1].rotation.x = 0.2;
      this.limbs.arms[0].rotation.x = -0.8;
      this.limbs.arms[1].rotation.x = 0.8;
    }

    this.model.position.copy(this.position);
    this.model.rotation.y = this.heading;
  }

  updateSkiing(dt, input, world, env) {
    const eps = 3;
    const hF = groundHeightAt(
      this.position.x + Math.sin(this.heading) * eps,
      this.position.z + Math.cos(this.heading) * eps
    );
    const hB = groundHeightAt(
      this.position.x - Math.sin(this.heading) * eps,
      this.position.z - Math.cos(this.heading) * eps
    );
    const hR = groundHeightAt(
      this.position.x - Math.cos(this.heading) * eps,
      this.position.z + Math.sin(this.heading) * eps
    );
    const hL = groundHeightAt(
      this.position.x + Math.cos(this.heading) * eps,
      this.position.z - Math.sin(this.heading) * eps
    );
    const gradX = (hR - hL) / (2 * eps);
    const gradZ = (hF - hB) / (2 * eps);
    const slope = Math.hypot(gradX, gradZ);
    const downX = -gradX;
    const downZ = -gradZ;
    const dh = Math.hypot(downX, downZ) || 1;
    const downDirX = downX / dh;
    const downDirZ = downZ / dh;

    // steering left/right
    const turn = -input.steer * 1.5 * dt * clamp(this.skiSpeed / 8, 0.25, 1.3);
    this.heading += turn;

    // gravity along the fall line, projected on travel direction
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const align = fx * downDirX + fz * downDirZ;
    const gravity = slope * 9.81 * 1.05;
    this.skiSpeed += gravity * align * dt;
    this.skiSpeed -= this.skiSpeed * 0.045 * dt;
    if (slope < 0.025) this.skiSpeed *= 1 - 1.9 * dt;
    if (input.forward > 0) this.skiSpeed += 2.4 * dt;
    if (input.brake) this.skiSpeed *= 1 - 3.5 * dt;
    this.skiSpeed = clamp(this.skiSpeed, 0, 42);

    // carve: point partly down the fall line when barely moving
    if (this.skiSpeed < 1.2 && slope > 0.06) {
      const fallHeading = Math.atan2(downDirX, downDirZ);
      this.heading = dampAngle(this.heading, fallHeading, 2, dt);
    }

    let nx = this.position.x + fx * this.skiSpeed * dt;
    let nz = this.position.z + fz * this.skiSpeed * dt;
    if (isUnderwater(nx, nz)) {
      nx = this.position.x;
      nz = this.position.z;
      this.skiSpeed = 0;
    }
    const push = world.resolveCircle(nx, nz, 0.55);
    nx += push.x;
    nz += push.z;
    if (push.hit) this.skiSpeed *= 0.3;
    nx = clamp(nx, -4340, 4340);
    nz = clamp(nz, -4340, 4340);
    this.position.x = nx;
    this.position.z = nz;
    this.position.y = groundHeightAt(nx, nz);

    // skiing pose
    this.model.position.copy(this.position);
    this.model.rotation.y = this.heading;
    const carve = clamp(this.skiSpeed / 24, 0, 1);
    this.body.rotation.z = damp(this.body.rotation.z, -this.steerDegree(input) * 0.18, 6, dt);
    this.body.rotation.x = damp(this.body.rotation.x, 0.1 + carve * 0.18, 5, dt);
    this.limbs.legs[0].rotation.x = 0.25;
    this.limbs.legs[1].rotation.x = 0.25;
    this.limbs.legs[0].rotation.z = 0.08;
    this.limbs.legs[1].rotation.z = -0.08;
    this.limbs.arms[0].rotation.x = -0.55;
    this.limbs.arms[1].rotation.x = -0.55;
    this.body.position.y = -0.08;
    // snow spray would go here
  }

  steerDegree(input) {
    return input.steer;
  }

  getAltitude() {
    return this.position.y;
  }
}
