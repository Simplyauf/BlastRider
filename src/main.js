import * as THREE from 'three';
import { createWorld, createFighter, heightAt, moveWithCollisions, blockedByRock } from './world.js';
import './style.css';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .1, 800);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
$('game').appendChild(renderer.domElement);
const lowGraphics = localStorage.getItem('blastwater-low-graphics') === '1';
if (lowGraphics) { renderer.shadowMap.enabled = false; $('graphics-button').textContent = 'GRAPHICS: LOW'; }
const world = createWorld(scene, lowGraphics);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const cameraCurrent = new THREE.Vector3(0, 8, 12);
const keys = new Set();
const botColors = ['#ee8062', '#a382d6', '#edc663', '#69a9d0', '#df83ad', '#8cc56d', '#d59a6a'];
const bombMaterials = {
  timer: new THREE.MeshStandardMaterial({ color: '#f4b755', emissive: '#bd651c', emissiveIntensity: .65, roughness: .38, metalness: .18 }),
  impact: new THREE.MeshStandardMaterial({ color: '#80e8db', emissive: '#36baaa', emissiveIntensity: .8, roughness: .3, metalness: .23 })
};
const bombGeometry = new THREE.IcosahedronGeometry(.42, 1);
const blastMat = new THREE.MeshBasicMaterial({ color: '#fff0b8', transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false });
const previewMat = new THREE.MeshBasicMaterial({ color: '#f8e7b9', transparent: true, opacity: .82, depthWrite: false });
const previewGeo = new THREE.SphereGeometry(.11, 8, 6);
const previewDots = Array.from({ length: 28 }, () => { const m = new THREE.Mesh(previewGeo, previewMat); m.visible = false; scene.add(m); return m; });
const landing = new THREE.Mesh(new THREE.RingGeometry(.58, .75, 24), new THREE.MeshBasicMaterial({ color: '#ffe1a7', side: THREE.DoubleSide, transparent: true, opacity: .8, depthWrite: false }));
landing.rotation.x = -Math.PI / 2; landing.visible = false; scene.add(landing);
const fx = [];
const bombs = [];
const chips = [];
const actors = [];
let player = null;
let state = 'menu';
let matchTime = 0;
let charge = 0;
let charging = false;
let selectedBomb = 'timer';
let yaw = .1, pitch = .17;
let announceTimeout = 0;
let radarCooldown = 0;
let radarReveal = 0;
let tideLevel = .15;
let tideStage = 0;
let shake = 0;
let lastBeep = 0;
let audioCtx = null;
let pointerActive = false;
let lastResult = null;
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
const isPortraitMobile = () => isTouchDevice && innerHeight > innerWidth;
const touchInput = { x: 0, y: 0, sprint: false, crouch: false, stickId: null, lookId: null, lookX: 0, lookY: 0 };
const gamepadInput = { x: 0, y: 0, sprint: false, crouch: false, connected: false, charging: false, previous: [] };
const visitCount = Number(localStorage.getItem('blastwater-visits') || 0) + 1;
if (location.protocol === 'https:' || location.protocol === 'http:') localStorage.setItem('blastwater-visits', String(visitCount));
if (visitCount <= 3) {
  $('source-link').classList.add('hidden');
  $('help-nudge').classList.remove('hidden');
  $('controls-button').classList.add('help-highlight');
} else $('help-nudge').classList.add('hidden');
const tutorialSteps = [
  { title: 'MOVE AROUND', copy: 'Use W A S D to move and the mouse to look. Shift makes you sprint.' },
  { title: 'AIM & THROW', copy: 'Hold left click to charge. Follow the dotted landing arc, then release to throw.' },
  { title: 'PULSE RADAR', copy: 'Press Space to reveal rivals. They will learn your location too.' },
  { title: 'RESTOCK & SURVIVE', copy: 'Run through a glowing crate for more bombs. Stay above the rising water.' }
];
let tutorialActive = false;
let tutorialStep = 0;
let tutorialCrates = 0;
let tutorialFinishTime = 0;
let tutorialStartX = 0, tutorialStartZ = 0;

function audio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, duration, kind = 'sine', gain = .08, slide = null) {
  try {
    const ctx = audio(), osc = ctx.createOscillator(), vol = ctx.createGain();
    osc.type = kind; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, ctx.currentTime + duration);
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
    osc.connect(vol); vol.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
  } catch { /* Audio is optional when the browser disallows it. */ }
}
function explosionSound(dist) {
  const g = Math.max(.014, .2 * (1 - dist / 75));
  tone(90, .32, 'sawtooth', g, 31);
  tone(190, .16, 'triangle', g * .5, 49);
}
function announce(message, duration = 2.6) {
  $('announcer').textContent = message;
  $('announcer').classList.remove('hidden');
  announceTimeout = duration;
}
function renderTutorialPrompt() {
  const card = $('tutorial-prompt');
  if (!tutorialActive || state === 'ended' || state === 'menu') { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  if (tutorialStep >= tutorialSteps.length) {
    $('tutorial-progress').textContent = 'FIELD GUIDE COMPLETE';
    $('tutorial-title').textContent = 'NOW SURVIVE.';
    $('tutorial-copy').textContent = 'Loot bombs, avoid the tide, and be the last fighter standing. Press H anytime for help.';
  } else {
    $('tutorial-progress').textContent = `FIELD GUIDE · ${tutorialStep + 1} / ${tutorialSteps.length}`;
    $('tutorial-title').textContent = tutorialSteps[tutorialStep].title;
    const mobileCopies = ['Use the left stick to move. Push it forward to lock sprint until you lift your thumb. Drag the right side to look.', 'Hold THROW to charge, then release. Follow the dotted landing arc.', 'Tap RADAR to reveal rivals. It exposes you too.', 'Walk through a glowing crate for more bombs. Avoid the blue water.'];
    const padCopies = ['Use the left stick to move and the right stick to look.', 'Hold RT to charge, then release. Follow the dotted arc.', 'Press X to reveal rivals. It exposes you too.', 'Walk through a glowing crate for more bombs. Avoid the blue water.'];
    $('tutorial-copy').textContent = gamepadInput.connected ? padCopies[tutorialStep] : isTouchDevice ? mobileCopies[tutorialStep] : tutorialSteps[tutorialStep].copy;
  }
  $('tutorial-dots').innerHTML = tutorialSteps.map((_, index) => `<span class="${index <= tutorialStep ? 'done' : ''}"></span>`).join('');
}
function advanceTutorial(expectedStep) {
  if (!tutorialActive || tutorialStep !== expectedStep) return;
  tutorialStep++;
  if (tutorialStep === 3 && tutorialCrates > 0) completeTutorial();
  else renderTutorialPrompt();
}
function completeTutorial() {
  if (!tutorialActive || tutorialStep >= tutorialSteps.length) return;
  tutorialStep = tutorialSteps.length;
  tutorialFinishTime = matchTime + 6;
  localStorage.setItem('blastwater-tutorial-complete', '1');
  renderTutorialPrompt();
}
function showHowToPlay(mode = 'menu') {
  const action = mode === 'pause' ? 'RESUME MATCH' : 'START MATCH';
  const mobile = isTouchDevice && !gamepadInput.connected;
  const pad = gamepadInput.connected;
  const moveCopy = mobile ? '<b>Left stick</b> moves. Push it forward to lock <b>sprint</b> until you lift your thumb. <b>Drag the right side</b> to look.' : pad ? '<b>Left stick</b> moves, <b>right stick</b> looks, and <b>LB</b> sprints.' : '<b>W A S D</b> moves. Use the <b>mouse</b> to look and <b>Shift</b> to sprint.';
  const throwCopy = mobile ? '<b>Hold THROW</b> to charge, then release. The dotted arc shows where the bomb lands. Tap <b>BOMB</b> to switch.' : pad ? '<b>Hold RT</b> to charge and release to throw. Press <b>Y</b> to change bombs.' : '<b>Hold left click</b> to charge. The dotted arc shows where it lands. <b>Release</b> to throw. Use <b>1 / 2</b> to swap bomb types.';
  const radarCopy = mobile ? 'Tap <b>RADAR</b> to reveal rivals. It gives away your position too.' : pad ? 'Press <b>X</b> to pulse radar. It reveals rivals but gives away your position.' : '<b>Space</b> pulses radar, revealing rivals but exposing you.';
  const footnote = mobile ? 'BEST IN LANDSCAPE · HOP AND CROUCH BUTTONS ARE ON SCREEN' : pad ? 'A HOPS · B CROUCHES · START PAUSES' : 'ESC PAUSES · H OPENS THIS GUIDE · F HOPS · C CROUCHES';
  $('modal-content').innerHTML = `<div class="eyebrow">FIELD GUIDE · LAST ONE ABOVE WATER WINS</div><h2>HOW TO PLAY.</h2><p class="guide-lead">Eliminate seven rivals with bombs. Collect supplies and stay on dry land as the tide rises.</p><div class="guide-grid"><div><span class="guide-number">01 / MOVE</span><strong>FIND YOUR FEET</strong><p>${moveCopy} Walk through glowing crates to pick up bombs.</p></div><div><span class="guide-number">02 / ATTACK</span><strong>THROW A BOMB</strong><p>${throwCopy}</p></div><div><span class="guide-number">03 / SURVIVE</span><strong>READ THE ISLAND</strong><p>${radarCopy} Avoid the <b>rising blue water</b>. Last fighter alive wins.</p></div></div><div class="guide-footnote">${footnote}</div><button id="tutorial-start" class="primary-button">${action} <span>↗</span></button>`;
  $('modal').classList.remove('hidden');
  $('modal').classList.add('tutorial-modal');
  $('tutorial-start').onclick = () => { $('modal').classList.add('hidden'); $('modal').classList.remove('tutorial-modal'); mode === 'pause' ? resume() : startMatch(); };
}
function feed(message) {
  const line = document.createElement('div');
  line.className = 'feed-item'; line.textContent = message;
  $('kill-feed').prepend(line);
  while ($('kill-feed').children.length > 4) $('kill-feed').lastChild.remove();
  setTimeout(() => line.remove(), 6000);
}
function makeActor(name, x, z, color, isPlayer = false, personality = 'aggressive') {
  const model = createFighter(color, isPlayer);
  const actor = { name, x, y: heightAt(x, z), z, yaw: 0, health: 100, stamina: 100, alive: true, kills: 0, chips: 0, thrown: 0,
    timer: isPlayer ? 2 : 3, impact: isPlayer ? 0 : 1, model, isPlayer, personality, velocityY: 0, hop: 0,
    cooldown: 1 + Math.random() * 2, pingCooldown: 3 + Math.random() * 6, lastKnown: null, memory: 0, strafe: Math.random() > .5 ? 1 : -1,
    moveAmount: 0, deadCause: '', glow: null };
  model.group.position.set(x, actor.y, z);
  scene.add(model.group);
  actors.push(actor);
  return actor;
}
function clearMatch() {
  for (const a of actors) scene.remove(a.model.group);
  actors.length = 0;
  for (const b of bombs) scene.remove(b.mesh);
  bombs.length = 0;
  for (const c of chips) scene.remove(c.mesh);
  chips.length = 0;
  for (const f of fx) scene.remove(f.mesh);
  fx.length = 0;
  world.crates.forEach(c => { c.available = true; c.respawn = 0; c.mesh.visible = true; });
  $('kill-feed').replaceChildren();
}
function startMatch() {
  clearMatch();
  state = 'playing';
  matchTime = 0; tideStage = 0; tideLevel = .15; radarCooldown = 0; radarReveal = 0; shake = 0; lastBeep = 0;
  yaw = .1; pitch = .17; charge = 0; charging = false; selectedBomb = 'timer';
  touchInput.x = 0; touchInput.y = 0; touchInput.sprint = false; touchInput.crouch = false; touchInput.stickId = null; touchInput.lookId = null; gamepadInput.charging = false;
  $('touch-knob').style.transform = ''; $('touch-crouch').classList.remove('active'); $('touch-stick').classList.remove('sprinting');
  player = makeActor('You', 0, 0, '#e6a34e', true);
  tutorialActive = localStorage.getItem('blastwater-tutorial-complete') !== '1';
  tutorialStep = 0; tutorialCrates = 0; tutorialFinishTime = 0;
  tutorialStartX = player.x; tutorialStartZ = player.z;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + .2;
    const r = 27 + (i % 3) * 3;
    const types = ['aggressive', 'sneaky', 'coward'];
    makeActor(`Rival ${i + 1}`, Math.cos(a) * r, Math.sin(a) * r, botColors[i], false, types[i % 3]);
  }
  $('menu').classList.add('hidden'); $('modal').classList.add('hidden'); $('modal').classList.remove('tutorial-modal'); $('end-screen').classList.add('hidden'); $('pause-screen').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('mobile-controls').classList.toggle('hidden', !isTouchDevice);
  $('crosshair').classList.add('visible');
  $('damage-flash').style.opacity = 0;
  updateHUD();
  renderTutorialPrompt();
  announce('LAST ONE ABOVE WATER WINS', 3.2);
  if (!isTouchDevice && !gamepadInput.connected) renderer.domElement.requestPointerLock?.();
  tone(390, .11, 'triangle', .09, 570); tone(530, .17, 'triangle', .06, 780);
}
function endMatch(victory, cause = '') {
  if (state !== 'playing') return;
  state = 'ended'; charging = false; hideAim();
  document.exitPointerLock?.();
  $('crosshair').classList.remove('visible'); $('hud').classList.add('hidden');
  $('mobile-controls').classList.add('hidden');
  $('tutorial-prompt').classList.add('hidden');
  $('end-screen').classList.remove('hidden');
  $('end-kicker').textContent = victory ? 'ISLAND CHAMPION' : 'MATCH OVER';
  $('end-title').textContent = victory ? 'THE ISLAND IS YOURS.' : 'THE TIDE CLAIMS ANOTHER.';
  $('end-subtitle').textContent = victory ? 'Every throw, every pulse, every second paid off.' : cause || 'Another round is one click away.';
  const stat = (n, v) => `<div><small>${n}</small><b>${v}</b></div>`;
  $('end-stats').innerHTML = stat('SURVIVED', `${Math.floor(matchTime / 60)}:${String(Math.floor(matchTime % 60)).padStart(2, '0')}`) + stat('KILLS', player.kills) + stat('BOMBS', player.thrown) + stat('CHIPS', player.chips);
  const score = Math.floor(matchTime) + player.kills * 80 + player.chips * 30 + (victory ? 400 : 0);
  lastResult = { survived: Math.floor(matchTime), kills: player.kills, chips: player.chips, victory };
  $('end-score').textContent = score.toLocaleString();
  $('leaderboard-name').value = localStorage.getItem('blastwater-name') || '';
  $('score-status').textContent = 'Enter a nickname to post your score globally.';
  $('submit-score').disabled = false;
  const best = Number(localStorage.getItem('blastwater-best') || 0);
  if (score > best) localStorage.setItem('blastwater-best', String(score));
  tone(victory ? 660 : 220, .45, 'triangle', .1, victory ? 1000 : 80);
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; charging = false; hideAim();
  touchInput.x = 0; touchInput.y = 0; touchInput.sprint = false; touchInput.stickId = null;
  $('touch-stick').classList.remove('sprinting'); $('touch-knob').style.transform = '';
  document.exitPointerLock?.();
  $('pause-screen').classList.remove('hidden');
  $('mobile-controls').classList.add('hidden');
  $('crosshair').classList.remove('visible');
}
function resume() {
  if (state !== 'paused') return;
  state = 'playing'; $('pause-screen').classList.add('hidden'); $('crosshair').classList.add('visible');
  $('mobile-controls').classList.toggle('hidden', !isTouchDevice);
  if (!isTouchDevice && !gamepadInput.connected) renderer.domElement.requestPointerLock?.();
}
function showMenu() {
  state = 'menu'; charging = false; hideAim(); document.exitPointerLock?.();
  $('menu').classList.remove('hidden'); $('pause-screen').classList.add('hidden'); $('end-screen').classList.add('hidden'); $('hud').classList.add('hidden'); $('crosshair').classList.remove('visible');
  $('mobile-controls').classList.add('hidden');
  $('tutorial-prompt').classList.add('hidden');
}

function forwardVector() { return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); }
function throwVelocity(chargeValue) {
  const forward = forwardVector();
  const speed = 11 + chargeValue * 13;
  return new THREE.Vector3(forward.x * speed, 7 + chargeValue * 4 - pitch * 11, forward.z * speed);
}
function spawnBomb(owner, type, position, velocity) {
  const mesh = new THREE.Group();
  const ball = new THREE.Mesh(bombGeometry, bombMaterials[type]);
  ball.castShadow = !lowGraphics;
  mesh.add(ball);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(.43, .055, 6, 16), new THREE.MeshBasicMaterial({ color: type === 'timer' ? '#ffe0a0' : '#bcfff4' }));
  belt.rotation.x = Math.PI / 2;
  mesh.add(belt);
  mesh.position.copy(position);
  scene.add(mesh);
  bombs.push({ owner, type, mesh, pos: position.clone(), vel: velocity.clone(), fuse: type === 'timer' ? 2.35 : 3.4, age: 0, beep: 0, settled: false });
  owner.thrown++;
  tone(type === 'timer' ? 350 : 530, .08, 'triangle', .05, 220);
}
function throwPlayer() {
  if (!player?.alive || state !== 'playing' || !charging) return;
  charging = false; hideAim();
  if (player[selectedBomb] <= 0) { announce('OUT OF BOMBS · FIND A CRATE', 1.5); return; }
  player[selectedBomb]--;
  const f = forwardVector();
  const spawn = new THREE.Vector3(player.x + f.x * .9, player.y + 1.62 + player.hop, player.z + f.z * .9);
  spawnBomb(player, selectedBomb, spawn, throwVelocity(charge));
  advanceTutorial(1);
  charge = 0; updateHUD();
}
function throwBot(bot, target) {
  const type = bot.impact > 0 && Math.random() < .3 ? 'impact' : 'timer';
  if (bot[type] <= 0) return;
  bot[type]--;
  const dx = target.x - bot.x + (Math.random() - .5) * (bot.personality === 'aggressive' ? 4 : 7);
  const dz = target.z - bot.z + (Math.random() - .5) * (bot.personality === 'aggressive' ? 4 : 7);
  const dist = Math.hypot(dx, dz);
  const t = Math.max(.75, Math.min(1.65, dist / 15));
  const velocity = new THREE.Vector3(dx / t, (target.y - bot.y + .5 * 20 * t * t) / t, dz / t);
  const direction = new THREE.Vector3(dx / dist, 0, dz / dist);
  const spawn = new THREE.Vector3(bot.x + direction.x, bot.y + 1.6, bot.z + direction.z);
  spawnBomb(bot, type, spawn, velocity);
  bot.cooldown = bot.personality === 'aggressive' ? 3 + Math.random() * 1.1 : 4.4 + Math.random() * 1.5;
}
function hideAim() { previewDots.forEach(d => d.visible = false); landing.visible = false; $('aim-hint').classList.add('hidden'); }
function updateAim() {
  if (!charging || state !== 'playing') { hideAim(); return; }
  const vel = throwVelocity(charge), f = forwardVector();
  const start = new THREE.Vector3(player.x + f.x * .9, player.y + 1.62 + player.hop, player.z + f.z * .9);
  let hit = false;
  for (let i = 0; i < previewDots.length; i++) {
    const t = (i + 1) * .073;
    const x = start.x + vel.x * t, z = start.z + vel.z * t, y = start.y + vel.y * t - 10 * t * t;
    const d = previewDots[i];
    if (hit || y <= heightAt(x, z) || Math.hypot(x, z) > 54) {
      d.visible = false;
      if (!hit) { landing.visible = true; landing.position.set(x, heightAt(x, z) + .08, z); hit = true; }
    } else { d.visible = true; d.position.set(x, y, z); d.scale.setScalar(1 + i * .018); }
  }
  $('aim-hint').classList.remove('hidden');
}

function explode(bomb) {
  const { x, y, z } = bomb.pos;
  const radius = bomb.type === 'impact' ? 5.5 : 7.5;
  const visual = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: '#fff5d0', transparent: true, opacity: .82, depthWrite: false }));
  visual.position.set(x, y, z); scene.add(visual); fx.push({ mesh: visual, age: 0, life: .32, kind: 'flash', radius });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 32), blastMat.clone());
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, Math.max(heightAt(x, z), tideLevel) + .15, z); scene.add(ring); fx.push({ mesh: ring, age: 0, life: .63, kind: 'ring', radius });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#202b29', transparent: true, opacity: .26, depthWrite: false, side: THREE.DoubleSide }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.set(x, heightAt(x, z) + .045, z); scorch.scale.setScalar(radius * .45); scene.add(scorch); fx.push({ mesh: scorch, age: 0, life: 15, kind: 'scorch', radius });
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(.15 + Math.random() * .18, 0), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffe4a1' : '#e3f5d1', transparent: true, opacity: 1 }));
    p.position.set(x, y, z); scene.add(p);
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
    fx.push({ mesh: p, age: 0, life: .8 + Math.random() * .3, kind: 'particle', vel: new THREE.Vector3(Math.cos(a) * sp, Math.random() * 8, Math.sin(a) * sp) });
  }
  const pd = Math.hypot(player.x - x, player.z - z);
  explosionSound(pd);
  shake = Math.max(shake, Math.max(0, 1 - pd / 35) * .55);
  for (const a of actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - x, a.z - z);
    if (d > radius) continue;
    if (blockedByRock(x, z, a.x, a.z, world.colliders)) continue;
    const damage = d < 1.85 ? 120 : Math.max(12, Math.round(94 * Math.pow(1 - d / radius, 1.18)));
    hurt(a, damage, bomb.owner, bomb.type === 'impact' ? 'impact blast' : 'timer blast');
    if (a.alive && d > .01) { a.x += (a.x - x) / d * Math.min(2, (radius - d) * .27); a.z += (a.z - z) / d * Math.min(2, (radius - d) * .27); a.y = heightAt(a.x, a.z); }
  }
}
function hurt(actor, amount, source, cause) {
  if (!actor.alive) return;
  actor.health = Math.max(0, actor.health - amount);
  if (actor.isPlayer) { $('damage-flash').style.opacity = Math.min(.8, amount / 65); setTimeout(() => { $('damage-flash').style.opacity = 0; }, 180); }
  if (actor.health <= 0) kill(actor, source, cause);
}
function kill(actor, source, cause) {
  actor.alive = false;
  actor.model.group.rotation.z = -Math.PI / 2;
  actor.model.group.position.y = actor.y + .5;
  actor.model.marker.visible = false;
  actor.deadCause = cause;
  if (source && source !== actor) source.kills++;
  if (!actor.isPlayer) {
    const chip = new THREE.Mesh(new THREE.OctahedronGeometry(.46, 0), new THREE.MeshStandardMaterial({ color: '#b5f4db', emissive: '#58bcac', emissiveIntensity: 1.4, metalness: .4, roughness: .2 }));
    chip.position.set(actor.x, actor.y + 1, actor.z);
    scene.add(chip); chips.push({ x: actor.x, z: actor.z, mesh: chip, age: 0 });
    if (source?.isPlayer) announce('ELIMINATION!', 1.4);
  }
  feed(`${source ? source.name : 'The tide'} eliminated ${actor.name}`);
  if (actor.isPlayer) endMatch(false, source ? `${source.name} caught you with a ${cause}.` : 'You stayed in the rising water too long.');
  else if (actors.filter(a => a.alive).length === 1 && player.alive) endMatch(true);
}
function updateBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.age += dt; b.fuse -= dt;
    b.vel.y -= 20 * dt;
    b.pos.addScaledVector(b.vel, dt);
    const ground = heightAt(b.pos.x, b.pos.z) + .42;
    const sea = tideLevel + .25;
    if (b.pos.y <= Math.max(ground, sea)) {
      b.pos.y = Math.max(ground, sea);
      if (b.type === 'impact' && b.age > .27) b.fuse = 0;
      if (Math.abs(b.vel.y) > 1.8) b.vel.y = -b.vel.y * (b.type === 'timer' ? .44 : .15);
      else { b.vel.y = 0; b.settled = true; }
      b.vel.x *= .86; b.vel.z *= .86;
    }
    for (const c of world.colliders) {
      const d = Math.hypot(b.pos.x - c.x, b.pos.z - c.z);
      if (d < c.r + .35 && b.pos.y < heightAt(c.x, c.z) + (c.type === 'rock' ? 2.1 : 2.8)) {
        if (b.type === 'impact' && b.age > .27) b.fuse = 0;
        const nx = (b.pos.x - c.x) / Math.max(.01, d), nz = (b.pos.z - c.z) / Math.max(.01, d);
        b.pos.x = c.x + nx * (c.r + .36); b.pos.z = c.z + nz * (c.r + .36);
        const dot = b.vel.x * nx + b.vel.z * nz;
        b.vel.x -= 1.5 * dot * nx; b.vel.z -= 1.5 * dot * nz;
      }
    }
    if (b.age > .22) {
      for (const actor of actors) {
        if (!actor.alive || actor === b.owner && b.age < .55) continue;
        if (Math.hypot(b.pos.x - actor.x, b.pos.z - actor.z) < .72 && b.pos.y > actor.y + .15 && b.pos.y < actor.y + 2.35) {
          b.fuse = 0;
          break;
        }
      }
    }
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.x += dt * 5; b.mesh.rotation.z += dt * 3;
    b.mesh.scale.setScalar(1 + Math.sin(b.age * (4 + b.age * 7)) * .08);
    if (b.type === 'timer' && b.fuse < 1.2 && b.fuse > 0 && b.age - b.beep > (b.fuse < .55 ? .16 : .35)) { b.beep = b.age; if (Math.hypot(player.x - b.pos.x, player.z - b.pos.z) < 28) tone(700 + 250 * (1 - b.fuse), .04, 'square', .02); }
    if (b.fuse <= 0 || Math.hypot(b.pos.x, b.pos.z) > 59) { explode(b); scene.remove(b.mesh); bombs.splice(i, 1); }
  }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.age += dt;
    const q = f.age / f.life;
    if (f.kind === 'flash') { f.mesh.scale.setScalar(.3 + q * f.radius * .7); f.mesh.material.opacity = .65 * (1 - q); }
    if (f.kind === 'ring') { f.mesh.scale.setScalar(.4 + q * f.radius); f.mesh.material.opacity = .8 * (1 - q); }
    if (f.kind === 'scorch') f.mesh.material.opacity = .25 * Math.min(1, (1 - q) * 4);
    if (f.kind === 'particle') { f.vel.y -= 18 * dt; f.mesh.position.addScaledVector(f.vel, dt); f.mesh.material.opacity = 1 - q; f.mesh.scale.setScalar(1 - q * .8); }
    if (f.age >= f.life) { scene.remove(f.mesh); f.mesh.material.dispose(); fx.splice(i, 1); }
  }
}
function updatePlayer(dt) {
  if (!player.alive) return;
  const f = forwardVector(), right = new THREE.Vector3(-f.z, 0, f.x);
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += f.x; mz += f.z; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += right.x; mz += right.z; }
  mx += f.x * -touchInput.y + right.x * touchInput.x;
  mz += f.z * -touchInput.y + right.z * touchInput.x;
  mx += f.x * -gamepadInput.y + right.x * gamepadInput.x;
  mz += f.z * -gamepadInput.y + right.z * gamepadInput.x;
  const mag = Math.min(1, Math.hypot(mx, mz)); if (mag) { const raw = Math.hypot(mx, mz); mx /= raw; mz /= raw; }
  const sprint = mag > 0 && (keys.has('ShiftLeft') || keys.has('ShiftRight') || touchInput.sprint || gamepadInput.sprint) && player.stamina > 2;
  const crouch = keys.has('ControlLeft') || keys.has('KeyC') || touchInput.crouch || gamepadInput.crouch;
  const speed = crouch ? 2.8 : sprint ? 9.3 : 5.6;
  if (sprint) player.stamina = Math.max(0, player.stamina - 21 * dt); else player.stamina = Math.min(100, player.stamina + 14 * dt);
  moveWithCollisions(player, mx * speed * mag * dt, mz * speed * mag * dt, world.colliders);
  if (tutorialStep === 0 && Math.hypot(player.x - tutorialStartX, player.z - tutorialStartZ) > 3) advanceTutorial(0);
  player.moveAmount = mag * (sprint ? 1.7 : 1);
  player.yaw = yaw;
  if (player.hop > 0 || player.velocityY > 0) {
    player.hop += player.velocityY * dt;
    player.velocityY -= 20 * dt;
    if (player.hop < 0) { player.hop = 0; player.velocityY = 0; }
  }
  if (charging) charge = Math.min(1, charge + dt / 1.3);
  updateAim();
  for (const c of world.crates) {
    if (c.available && Math.hypot(player.x - c.x, player.z - c.z) < 2.3) {
      c.available = false; c.respawn = matchTime + 26; c.mesh.visible = false;
      player.timer += 2; if (Math.random() < .75) player.impact += 1;
      tutorialCrates++;
      if (tutorialStep === 3) completeTutorial();
      announce('+ BOMBS RESTOCKED', 1.3); tone(690, .13, 'triangle', .06, 960);
    }
  }
  for (let i = chips.length - 1; i >= 0; i--) {
    const c = chips[i];
    if (Math.hypot(player.x - c.x, player.z - c.z) < 1.8) { player.chips++; scene.remove(c.mesh); chips.splice(i, 1); tone(820, .15, 'sine', .06, 1230); }
  }
}
function updateBots(dt) {
  for (const bot of actors) {
    if (bot.isPlayer || !bot.alive) continue;
    bot.cooldown -= dt; bot.pingCooldown -= dt; bot.memory -= dt;
    const enemies = actors.filter(a => a !== bot && a.alive);
    let nearest = null, distance = Infinity;
    for (const a of enemies) { const d = Math.hypot(a.x - bot.x, a.z - bot.z); if (d < distance) { nearest = a; distance = d; } }
    let goal = nearest;
    const nearBomb = bombs.find(b => b.owner !== bot && b.fuse < 1.35 && Math.hypot(bot.x - b.pos.x, bot.z - b.pos.z) < 8);
    const wet = bot.y < tideLevel + .4;
    const lowAmmo = bot.timer + bot.impact < 2;
    const crate = world.crates.filter(c => c.available).sort((a, b) => Math.hypot(a.x - bot.x, a.z - bot.z) - Math.hypot(b.x - bot.x, b.z - bot.z))[0];
    let vx = 0, vz = 0, speed = bot.personality === 'coward' ? 5.7 : 5.0;
    if (nearBomb) { vx = bot.x - nearBomb.pos.x; vz = bot.z - nearBomb.pos.z; speed = 8.5; }
    else if (wet) { vx = -bot.x; vz = -bot.z; speed = 8.5; }
    else if (lowAmmo && crate) { vx = crate.x - bot.x; vz = crate.z - bot.z; speed = 6; }
    else if (goal) {
      const canSee = distance < 29 && !blockedByRock(bot.x, bot.z, goal.x, goal.z, world.colliders);
      if (canSee || radarReveal > 0 || (goal.isPlayer && bot.memory > 0)) { bot.lastKnown = { x: goal.x, z: goal.z }; bot.memory = 3; }
      if (distance > 12) { vx = goal.x - bot.x; vz = goal.z - bot.z; }
      else if (distance < 7 || bot.personality === 'coward' && bot.health < 45) { vx = bot.x - goal.x; vz = bot.z - goal.z; }
      else { vx = -(goal.z - bot.z) * bot.strafe; vz = (goal.x - bot.x) * bot.strafe; }
      if (matchTime > 9 && canSee && distance < 24 && distance > 4 && bot.cooldown <= 0) throwBot(bot, goal);
      if (bot.pingCooldown <= 0 && distance > 20 && distance < 45 && Math.random() < .013) { bot.pingCooldown = 11 + Math.random() * 8; makeRadarRing(bot.x, bot.z, '#eeab79'); if (distance < 35) announce('ENEMY RADAR PULSE', 1.25); }
    }
    const mag = Math.hypot(vx, vz);
    if (mag > .001) { vx /= mag; vz /= mag; moveWithCollisions(bot, vx * speed * dt, vz * speed * dt, world.colliders); bot.yaw = Math.atan2(-vx, -vz); bot.moveAmount = 1; } else bot.moveAmount = 0;
    if (crate && crate.available && Math.hypot(bot.x - crate.x, bot.z - crate.z) < 2) { crate.available = false; crate.respawn = matchTime + 28; crate.mesh.visible = false; bot.timer += 2; bot.impact += 1; }
    if (bot.timer + bot.impact === 0 && bot.cooldown < -2) { bot.timer = 1; bot.cooldown = 1; }
  }
}
function makeRadarRing(x, z, color) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1.05, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, heightAt(x, z) + .25, z); scene.add(ring); fx.push({ mesh: ring, age: 0, life: 1.35, kind: 'ring', radius: 40 });
  tone(350, .45, 'sine', .045, 800);
}
function useRadar() {
  if (state !== 'playing' || !player.alive || radarCooldown > 0) return;
  radarCooldown = 8; radarReveal = 2;
  makeRadarRing(player.x, player.z, '#9bffe5');
  advanceTutorial(2);
  announce('PULSE OUT · YOU ARE EXPOSED', 1.4);
  for (const bot of actors) if (!bot.isPlayer && bot.alive && Math.hypot(bot.x - player.x, bot.z - player.z) < 48) { bot.lastKnown = { x: player.x, z: player.z }; bot.memory = 3; }
}
function updateActorsVisual(dt) {
  for (const a of actors) {
    const g = a.model.group;
    if (!a.alive) continue;
    g.position.set(a.x, a.y + a.hop, a.z);
    g.rotation.y = a.yaw;
    const phase = matchTime * 11 + a.x * .3;
    for (const part of a.model.limbs) {
      part.arm.rotation.x = Math.sin(phase) * .5 * a.moveAmount * part.side;
      part.leg.rotation.x = -Math.sin(phase) * .65 * a.moveAmount * part.side;
    }
    if (!a.isPlayer) {
      const revealed = radarReveal > 0;
      a.model.marker.material.opacity = revealed ? 1 : .45;
      a.model.marker.material.color.set(revealed ? '#fff8aa' : '#8bfff2');
      g.scale.setScalar(revealed ? 1.06 : 1);
    }
  }
  for (const c of chips) { c.age += dt; c.mesh.rotation.y += dt * 2.2; c.mesh.position.y = heightAt(c.x, c.z) + 1.1 + Math.sin(c.age * 3) * .2; }
}
function updateTide(dt) {
  const newStage = Math.min(4, Math.floor(matchTime / 60));
  if (newStage > tideStage) { tideStage = newStage; announce(`TIDE RISING · WAVE ${tideStage}`, 3); tone(190, .8, 'sawtooth', .05, 80); }
  const targets = [.15, 1.35, 2.55, 3.75, 5.05];
  tideLevel += (targets[tideStage] - tideLevel) * Math.min(1, dt * .38);
  world.update(matchTime, tideLevel);
  for (const a of actors) if (a.alive && a.y + .35 < tideLevel) hurt(a, 18 * dt, null, 'rising tide');
  for (const c of world.crates) if (!c.available && matchTime >= c.respawn) { c.available = true; c.mesh.visible = true; }
  if (matchTime > 300 && state === 'playing') {
    const living = actors.filter(a => a.alive);
    for (const a of living) hurt(a, 22 * dt, null, 'final tide');
  }
}
function updateCamera(dt) {
  if (!player) { camera.position.set(13, 23, 42); camera.lookAt(0, 0, 0); return; }
  const f = forwardVector();
  cameraTarget.set(player.x, player.y + 1.7 + player.hop, player.z);
  cameraDesired.set(player.x - f.x * 7.9 + f.z * 1.3, player.y + 4.2 + pitch * 6 + player.hop, player.z - f.z * 7.9 - f.x * 1.3);
  const dir = cameraDesired.clone().sub(cameraTarget);
  raycaster.set(cameraTarget, dir.clone().normalize());
  raycaster.far = dir.length();
  const hits = raycaster.intersectObjects(world.rockMeshes, false);
  if (hits.length && hits[0].distance < dir.length()) cameraDesired.copy(cameraTarget).addScaledVector(dir.normalize(), Math.max(1.4, hits[0].distance - .5));
  cameraCurrent.lerp(cameraDesired, Math.min(1, dt * 9));
  camera.position.copy(cameraCurrent);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 1.4); }
  const look = cameraTarget.clone().addScaledVector(f, 6);
  look.y -= pitch * 4.5;
  camera.lookAt(look);
}
function updateHUD() {
  if (!player) return;
  $('alive-count').textContent = actors.filter(a => a.alive).length;
  $('health-number').textContent = Math.ceil(player.health);
  $('stamina-number').textContent = Math.ceil(player.stamina);
  $('health-fill').style.width = `${player.health}%`;
  $('stamina-fill').style.width = `${player.stamina}%`;
  $('timer-count').textContent = player.timer;
  $('impact-count').textContent = player.impact;
  $('kills-count').textContent = player.kills;
  $('chips-count').textContent = player.chips;
  const seconds = Math.max(0, 60 - Math.floor(matchTime % 60));
  $('tide-timer').textContent = tideStage >= 4 ? 'FINAL' : `0:${String(seconds).padStart(2, '0')}`;
  $('radar-status').textContent = radarCooldown > 0 ? `${radarCooldown.toFixed(1)}S COOLDOWN` : 'SPACE · READY';
  $('radar-ring').style.opacity = radarCooldown > 0 ? .35 : 1;
  $('touch-bomb-type').textContent = `${selectedBomb.toUpperCase()} · ${player[selectedBomb]}`;
  document.querySelectorAll('.bomb-slot').forEach(el => el.classList.toggle('active', el.dataset.type === selectedBomb));
  const degrees = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
  const points = ['N','NE','E','SE','S','SW','W','NW','N','NE','E','SE','S','SW','W','NW','N'];
  $('compass-strip').textContent = points.join('   ');
  $('compass-strip').style.transform = `translateX(${-degrees * 2.16 + 115}px)`;
}
function pollGamepad(dt) {
  const pad = Array.from(navigator.getGamepads?.() || []).find(item => item?.connected);
  gamepadInput.connected = Boolean(pad);
  if (!pad) { gamepadInput.x = 0; gamepadInput.y = 0; gamepadInput.sprint = false; gamepadInput.crouch = false; gamepadInput.previous = []; return; }
  const deadzone = value => Math.abs(value || 0) > .17 ? value : 0;
  gamepadInput.x = deadzone(pad.axes[0]);
  gamepadInput.y = deadzone(pad.axes[1]);
  gamepadInput.sprint = Boolean(pad.buttons[4]?.pressed || pad.buttons[10]?.pressed);
  gamepadInput.crouch = Boolean(pad.buttons[1]?.pressed);
  const pressed = pad.buttons.map(button => button.pressed || button.value > .45);
  const newPress = index => pressed[index] && !gamepadInput.previous[index];
  if (state === 'playing' && !isPortraitMobile()) {
    yaw -= deadzone(pad.axes[2]) * dt * 2.5;
    pitch = Math.max(-.35, Math.min(.58, pitch + deadzone(pad.axes[3]) * dt * 1.8));
    if (newPress(0) && player?.hop <= 0) player.velocityY = 6.7;
    if (newPress(2)) useRadar();
    if (newPress(3)) selectBomb(selectedBomb === 'timer' ? 'impact' : 'timer');
    if (newPress(9)) pause();
    const trigger = Boolean(pressed[7]);
    if (trigger && !gamepadInput.charging && player?.[selectedBomb] > 0) { charging = true; charge = .08; gamepadInput.charging = true; }
    if (!trigger && gamepadInput.charging) { gamepadInput.charging = false; throwPlayer(); }
  } else {
    gamepadInput.charging = false;
    if (newPress(0) || newPress(9)) {
      if (!$('modal').classList.contains('hidden') && $('tutorial-start')) $('tutorial-start').click();
      else if (state === 'menu') $('play-button').click();
      else if (state === 'paused') resume();
      else if (state === 'ended') startMatch();
    }
  }
  gamepadInput.previous = pressed;
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(.04, clock.getDelta());
  pollGamepad(dt);
  if (state === 'playing' && !isPortraitMobile()) {
    matchTime += dt;
    if (announceTimeout > 0) { announceTimeout -= dt; if (announceTimeout <= 0) $('announcer').classList.add('hidden'); }
    radarCooldown = Math.max(0, radarCooldown - dt); radarReveal = Math.max(0, radarReveal - dt);
    updatePlayer(dt);
    updateBots(dt);
    updateBombs(dt);
    updateTide(dt);
    updateActorsVisual(dt);
    updateHUD();
    if (tutorialActive && tutorialStep >= tutorialSteps.length && matchTime >= tutorialFinishTime) { tutorialActive = false; renderTutorialPrompt(); }
  } else if (state === 'menu') { world.update(performance.now() / 1000, .15); }
  if (state !== 'paused') updateFx(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

function selectBomb(type) { selectedBomb = type; tone(type === 'timer' ? 450 : 650, .055, 'sine', .025); updateHUD(); }
async function showLeaderboard() {
  $('modal-content').innerHTML = '<div class="eyebrow">GLOBAL RANKINGS</div><h2>TOP TEN.</h2><p class="guide-lead">Highest point totals across all BLASTWATER players.</p><div id="leaderboard-list" class="leaderboard-table">Loading scores…</div><p class="leaderboard-note">Points = seconds survived + 80 per kill + 30 per chip + 400 for victory. Each device keeps its best posted score.</p>';
  $('modal').classList.remove('tutorial-modal', 'hidden');
  try {
    const response = await fetch('/api/leaderboard', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load scores');
    const data = await response.json();
    const list = $('leaderboard-list');
    if (!list) return;
    list.replaceChildren();
    if (!data.entries?.length) { list.textContent = 'No scores yet. Be the first to post one.'; return; }
    for (const [index, entry] of data.entries.entries()) {
      const row = document.createElement('div'); row.className = 'leaderboard-row';
      for (const [className, value] of [['place', `#${index + 1}`], ['name', entry.name], ['points', Number(entry.score).toLocaleString()], ['kills', `${entry.kills} K`]]) {
        const cell = document.createElement('span'); cell.className = className; cell.textContent = value; row.appendChild(cell);
      }
      list.appendChild(row);
    }
  } catch { const list = $('leaderboard-list'); if (list) list.textContent = 'Leaderboard unavailable. Try again in a moment.'; }
}
async function submitScore() {
  if (!lastResult) return;
  const name = $('leaderboard-name').value.trim();
  if (!/^[A-Za-z0-9 _-]{2,16}$/.test(name)) { $('score-status').textContent = 'Use 2–16 letters, numbers, spaces, _ or -.'; return; }
  let playerId = localStorage.getItem('blastwater-player-id');
  if (!playerId) { playerId = crypto.randomUUID(); localStorage.setItem('blastwater-player-id', playerId); }
  $('submit-score').disabled = true;
  $('score-status').textContent = 'Posting score…';
  try {
    const response = await fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, name, ...lastResult }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not post score');
    localStorage.setItem('blastwater-name', name);
    $('score-status').textContent = `Posted! Global rank #${data.rank}. Your best score is ${Number(data.score).toLocaleString()} points.`;
  } catch (error) { $('score-status').textContent = error.message || 'Could not post score. Try again.'; $('submit-score').disabled = false; }
}
document.addEventListener('keydown', e => {
  keys.add(e.code);
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape') { if (state === 'playing') pause(); else if (state === 'paused') resume(); }
  if (state !== 'playing') return;
  if (e.code === 'KeyH') { pause(); showHowToPlay('pause'); return; }
  if (e.code === 'Digit1' || e.code === 'KeyQ') selectBomb('timer');
  if (e.code === 'Digit2' || e.code === 'KeyE') selectBomb('impact');
  if (e.code === 'Space') useRadar();
  if (e.code === 'KeyF' && player.hop <= 0) player.velocityY = 6.7;
});
document.addEventListener('keyup', e => keys.delete(e.code));
document.addEventListener('mousemove', e => {
  if (state !== 'playing' || document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * .0022;
  pitch = Math.max(-.35, Math.min(.58, pitch + e.movementY * .0018));
});
renderer.domElement.addEventListener('mousedown', e => {
  if (isTouchDevice) return;
  if (state !== 'playing' || e.button !== 0) return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock?.(); return; }
  if (player[selectedBomb] > 0) { charging = true; charge = .08; }
  else announce('OUT OF BOMBS · FIND A CRATE', 1.5);
});
document.addEventListener('mouseup', e => { if (!isTouchDevice && e.button === 0) throwPlayer(); });
document.addEventListener('wheel', e => { if (state === 'playing') { e.preventDefault(); selectBomb(selectedBomb === 'timer' ? 'impact' : 'timer'); } }, { passive: false });
document.addEventListener('pointerlockchange', () => { pointerActive = document.pointerLockElement === renderer.domElement; if (!pointerActive && !isTouchDevice && !gamepadInput.connected && state === 'playing') pause(); });
window.addEventListener('blur', () => { keys.clear(); if (state === 'playing') pause(); });
function resizeGame() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  if (isPortraitMobile()) {
    touchInput.x = 0; touchInput.y = 0; touchInput.sprint = false;
    $('touch-stick').classList.remove('sprinting');
    charging = false; hideAim();
  }
}
window.addEventListener('resize', resizeGame);
window.visualViewport?.addEventListener('resize', resizeGame);

function setupTouchControls() {
  if (!isTouchDevice) return;
  renderer.domElement.style.touchAction = 'none';
  const stick = $('touch-stick'), knob = $('touch-knob');
  const moveStick = event => {
    const rect = stick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.max(1, Math.hypot(dx, dy));
    const reach = Math.min(1, length / 42);
    touchInput.x = dx / length * reach; touchInput.y = dy / length * reach;
    knob.style.transform = `translate(${touchInput.x * 42}px, ${touchInput.y * 42}px)`;
    if (!touchInput.sprint && dy < -49 && Math.abs(dx) < 36) {
      touchInput.sprint = true;
      stick.classList.add('sprinting');
    }
  };
  stick.addEventListener('pointerdown', event => { event.preventDefault(); touchInput.stickId = event.pointerId; stick.setPointerCapture(event.pointerId); moveStick(event); });
  stick.addEventListener('pointermove', event => { if (event.pointerId === touchInput.stickId) moveStick(event); });
  const resetStick = event => { if (event.pointerId !== touchInput.stickId) return; touchInput.stickId = null; touchInput.x = 0; touchInput.y = 0; touchInput.sprint = false; stick.classList.remove('sprinting'); knob.style.transform = ''; };
  stick.addEventListener('pointerup', resetStick); stick.addEventListener('pointercancel', resetStick);
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || state !== 'playing' || event.clientX < innerWidth * .38 || touchInput.lookId !== null) return;
    event.preventDefault(); touchInput.lookId = event.pointerId; touchInput.lookX = event.clientX; touchInput.lookY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (event.pointerId !== touchInput.lookId || state !== 'playing') return;
    yaw -= (event.clientX - touchInput.lookX) * .006;
    pitch = Math.max(-.35, Math.min(.58, pitch + (event.clientY - touchInput.lookY) * .005));
    touchInput.lookX = event.clientX; touchInput.lookY = event.clientY;
  });
  const resetLook = event => { if (event.pointerId === touchInput.lookId) touchInput.lookId = null; };
  renderer.domElement.addEventListener('pointerup', resetLook); renderer.domElement.addEventListener('pointercancel', resetLook);
  const press = (id, action) => $(id).addEventListener('pointerdown', event => { event.preventDefault(); if (state === 'playing') action(event); });
  press('touch-radar', useRadar);
  press('touch-bomb', () => selectBomb(selectedBomb === 'timer' ? 'impact' : 'timer'));
  press('touch-hop', () => { if (player?.hop <= 0) player.velocityY = 6.7; });
  press('touch-crouch', () => { touchInput.crouch = !touchInput.crouch; $('touch-crouch').classList.toggle('active', touchInput.crouch); });
  const throwButton = $('touch-throw');
  throwButton.addEventListener('pointerdown', event => { event.preventDefault(); if (state !== 'playing') return; throwButton.setPointerCapture(event.pointerId); if (player?.[selectedBomb] > 0) { charging = true; charge = .08; } else announce('OUT OF BOMBS · FIND A CRATE', 1.5); });
  throwButton.addEventListener('pointerup', event => { event.preventDefault(); throwPlayer(); });
  throwButton.addEventListener('pointercancel', () => { charging = false; hideAim(); });
}
setupTouchControls();
document.addEventListener('selectstart', event => { if (!event.target.closest('input')) event.preventDefault(); });
document.addEventListener('contextmenu', event => { if (!event.target.closest('input')) event.preventDefault(); });
document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });

$('play-button').onclick = () => localStorage.getItem('blastwater-tutorial-complete') === '1' ? startMatch() : showHowToPlay('start');
$('restart-button').onclick = startMatch;
$('restart-pause').onclick = startMatch;
$('resume-button').onclick = resume;
$('pause-button').onclick = pause;
$('hud-help').onclick = () => { pause(); showHowToPlay('pause'); };
$('pause-help').onclick = () => showHowToPlay('pause');
$('back-menu').onclick = showMenu;
$('end-menu').onclick = showMenu;
$('controls-button').onclick = () => showHowToPlay('menu');
$('leaderboard-button').onclick = showLeaderboard;
$('end-leaderboard').onclick = showLeaderboard;
$('submit-score').onclick = submitScore;
$('multiplayer-button').onclick = () => { $('modal-content').innerHTML = '<div class="eyebrow">FUTURE MODE</div><h2>MULTIPLAYER.</h2><p>Coming soon. For now, drop into the solo island and fight seven rivals.</p>'; $('modal').classList.remove('tutorial-modal', 'hidden'); };
$('credits-button').onclick = () => { $('modal-content').innerHTML = `<div class="eyebrow">MADE FOR THE GAMES ROUND</div><h2>CREDITS.</h2><p>BLASTWATER is an original browser game created for the Twigpine Project Treetop games round.</p><p>Art: procedural geometry and original code. Audio: synthesized in the browser. No third party art or audio assets are used.</p><p>Engine: Three.js. Build tool: Vite.</p>`; $('modal').classList.remove('tutorial-modal'); $('modal').classList.remove('hidden'); };
$('modal-close').onclick = () => { $('modal').classList.add('hidden'); $('modal').classList.remove('tutorial-modal'); };
$('modal').onclick = e => { if (e.target === $('modal')) { $('modal').classList.add('hidden'); $('modal').classList.remove('tutorial-modal'); } };
$('tutorial-dismiss').onclick = () => { tutorialActive = false; renderTutorialPrompt(); };
$('graphics-button').onclick = () => { const low = localStorage.getItem('blastwater-low-graphics') !== '1'; localStorage.setItem('blastwater-low-graphics', low ? '1' : '0'); location.reload(); };
document.querySelectorAll('.bomb-slot').forEach(el => el.onclick = () => selectBomb(el.dataset.type));
world.update(0, .15);
loop();
