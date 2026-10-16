import * as THREE from 'three';

export const ISLAND_RADIUS = 55;
const terrainSize = 116;
const up = new THREE.Vector3(0, 1, 0);
const clay = new THREE.Color('#d4b783');
const grass = new THREE.Color('#5d9666');
const deepGrass = new THREE.Color('#356c52');
const stone = new THREE.Color('#778a78');

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const center = Math.max(0, 1 - r / ISLAND_RADIUS);
  const rolling = Math.sin(x * .115) * Math.cos(z * .09) * .53 + Math.sin(x * .28 + z * .18) * .17;
  return -1.1 + 6.5 * Math.pow(center, 1.15) + rolling * Math.min(1, center * 3.3);
}

export function createWorld(scene, lowGraphics = false) {
  scene.background = new THREE.Color('#9fc6bb');
  scene.fog = new THREE.FogExp2('#9fc6bb', .0085);
  const hemi = new THREE.HemisphereLight('#fff4d8', '#477a78', 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe4ac', 2.9);
  sun.position.set(-35, 64, -48);
  sun.castShadow = !lowGraphics;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75;
  sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75;
  sun.shadow.camera.bottom = -75;
  sun.shadow.bias = -.00025;
  scene.add(sun);
  scene.add(sun.target);

  const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, 118, 118);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = [];
  const mix = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const r = Math.hypot(x, z);
    if (h < 1.1 || r > 48) mix.copy(clay);
    else if (h > 4.15 && Math.sin(x * .3 + z * .2) > .65) mix.copy(stone);
    else mix.copy(grass).lerp(deepGrass, Math.max(0, Math.min(1, (h - 2) / 6)));
    const variation = .9 + .095 * Math.sin(x * .92 + z * 1.21);
    colors.push(mix.r * variation, mix.g * variation, mix.b * variation);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, flatShading: true, side: THREE.DoubleSide }));
  ground.receiveShadow = true;
  scene.add(ground);

  const waterUniforms = { uTime: { value: 0 }, uLevel: { value: .15 } };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main(){vUv=uv;vec3 p=position;vWorld=(modelMatrix*vec4(p,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float uTime;varying vec2 vUv;varying vec3 vWorld;void main(){float w=sin(vWorld.x*.23+uTime*1.7)*sin(vWorld.z*.17-uTime*1.2);float w2=sin(vWorld.x*.68-vWorld.z*.43+uTime*2.2);float shimmer=pow(max(0.,w*.5+w2*.5),7.);vec3 c=mix(vec3(.075,.39,.46),vec3(.18,.58,.61),.5+.5*w);c+=vec3(.4,.55,.48)*shimmer*.4;gl_FragColor=vec4(c,.9);}`
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = .15;
  water.renderOrder = 2;
  scene.add(water);

  const colliders = [];
  const rockMeshes = [];
  const props = new THREE.Group();
  scene.add(props);
  let seed = 581291;
  const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const trunkGeo = new THREE.CylinderGeometry(.35, .52, 3.2, 6);
  const leafGeo = new THREE.ConeGeometry(2.2, 5, 6);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const barkMat = new THREE.MeshStandardMaterial({ color: '#71563f', roughness: 1, flatShading: true });
  const leafMats = ['#2e745b', '#3b8761', '#418d64'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  const rockMat = new THREE.MeshStandardMaterial({ color: '#72857d', roughness: 1, flatShading: true });
  for (let i = 0; i < 98; i++) {
    const r = 10 + Math.sqrt(rand()) * 38, a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
    const y = heightAt(x, z);
    if (i % 4 === 0) {
      const scale = .95 + rand() * 1.8;
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, y + scale * .72, z);
      rock.scale.set(scale * 1.3, scale * .9, scale);
      rock.rotation.set(rand() * .5, rand() * 6.28, rand() * .5);
      rock.castShadow = !lowGraphics;
      rock.receiveShadow = true;
      props.add(rock);
      colliders.push({ x, z, r: scale * .95, type: 'rock' });
      rockMeshes.push(rock);
    } else {
      const s = .75 + rand() * .7;
      const trunk = new THREE.Mesh(trunkGeo, barkMat);
      trunk.position.set(x, y + 1.55 * s, z);
      trunk.scale.setScalar(s);
      trunk.castShadow = !lowGraphics;
      props.add(trunk);
      for (let j = 0; j < 2; j++) {
        const leaf = new THREE.Mesh(leafGeo, leafMats[Math.floor(rand() * leafMats.length)]);
        leaf.position.set(x, y + (4.25 + j * 1.65) * s, z);
        leaf.scale.setScalar(s * (j ? .75 : 1));
        leaf.castShadow = !lowGraphics;
        props.add(leaf);
      }
      colliders.push({ x, z, r: .55 * s, type: 'tree' });
    }
  }

  const crateGeo = new THREE.BoxGeometry(1.65, 1.65, 1.65);
  const crateMat = new THREE.MeshStandardMaterial({ color: '#ce9c55', roughness: .85, metalness: .12 });
  const strapMat = new THREE.MeshStandardMaterial({ color: '#274c4b', roughness: .7, metalness: .25 });
  const cratePositions = [[-30,-14],[23,-26],[-13,27],[27,19],[5,-34],[-34,8],[7,22],[-21,-30],[35,1],[-3,5]];
  const crates = cratePositions.map(([x, z]) => {
    const y = heightAt(x, z);
    const group = new THREE.Group();
    group.position.set(x, y + .82, z);
    const box = new THREE.Mesh(crateGeo, crateMat);
    box.castShadow = !lowGraphics;
    group.add(box);
    const strap1 = new THREE.Mesh(new THREE.BoxGeometry(1.73, .22, 1.73), strapMat);
    const strap2 = new THREE.Mesh(new THREE.BoxGeometry(.22, 1.73, 1.73), strapMat);
    group.add(strap1, strap2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(.85, .06, .85), new THREE.MeshBasicMaterial({ color: '#8cf1d4' }));
    top.position.y = .86;
    group.add(top);
    scene.add(group);
    return { x, z, y, mesh: group, available: true, respawn: 0 };
  });

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffe0a1', fog: false }));
  sunDisc.position.set(-145, 90, -210);
  scene.add(sunDisc);

  return { water, waterUniforms, colliders, rockMeshes, crates, sun, update(t, level) { waterUniforms.uTime.value = t; waterUniforms.uLevel.value = level; water.position.y = level; crates.forEach((c, i) => { if (c.available) c.mesh.position.y = c.y + .82 + Math.sin(t * 2 + i) * .07; }); } };
}

export function createFighter(color, isPlayer = false) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: .8, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1c3438', roughness: .9, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: isPlayer ? '#f2c694' : '#e9c9a1', roughness: .9 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(.42, .5, 1.05, 7), bodyMat);
  torso.position.y = 1.28;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 1), skinMat);
  head.position.y = 2.07;
  head.castShadow = true;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.38, 9, 6, 0, Math.PI * 2, 0, Math.PI * .52), darkMat);
  helmet.position.y = 2.13;
  group.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.54, .12, .11), new THREE.MeshBasicMaterial({ color: isPlayer ? '#ffbf61' : '#9ae8df' }));
  visor.position.set(0, 2.07, -.31);
  group.add(visor);
  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.15, .17, .88, 6), bodyMat);
    arm.position.set(side * .62, 1.3, 0);
    arm.castShadow = true;
    group.add(arm);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.18, .2, .86, 6), darkMat);
    leg.position.set(side * .24, .47, 0);
    leg.castShadow = true;
    group.add(leg);
    limbs.push({ arm, leg, side });
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(.59, .73, 24), new THREE.MeshBasicMaterial({ color: isPlayer ? '#ffd68d' : '#8bfff2', side: THREE.DoubleSide, transparent: true, opacity: .7 }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = .05;
  group.add(marker);
  return { group, limbs, marker };
}

export function moveWithCollisions(entity, dx, dz, colliders) {
  let x = entity.x + dx, z = entity.z + dz;
  const distance = Math.hypot(x, z);
  if (distance > 53) { x *= 53 / distance; z *= 53 / distance; }
  for (const c of colliders) {
    const vx = x - c.x, vz = z - c.z;
    const min = c.r + .47;
    const d = Math.hypot(vx, vz);
    if (d < min && d > .0001) { x = c.x + vx / d * min; z = c.z + vz / d * min; }
  }
  entity.x = x; entity.z = z;
  entity.y = heightAt(x, z);
}

export function blockedByRock(ax, az, bx, bz, colliders) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  for (const c of colliders) {
    if (c.type !== 'rock') continue;
    const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / Math.max(.001, len2)));
    const px = ax + dx * t, pz = az + dz * t;
    if (Math.hypot(px - c.x, pz - c.z) < c.r * .9) return true;
  }
  return false;
}
