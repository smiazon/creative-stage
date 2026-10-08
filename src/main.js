import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildFloor, buildHoop, buildCourtsideSeats,
  buildLedBoards, buildCeiling, buildBall, buildLightShafts,
  buildFloorSeats,
  fresnelize,
} from './arena.js';
import { buildBowl, buildRink, buildEventFloor, bowlOffsetAt, bowlSurfacesAt, bowlNormalZ2, BOWL_OUTER_OFF, BOWL_A, BOWL_B, BOWL_R, SURFACE_Y, sectionAt, spanBaseU, basePointAt } from './bowl.js';
import { VENUE, VENUES, IS_STADIUM, IS_CRICKET, IS_FESTIVAL, SPEC, PITCH, reloadIntoVenue } from './venue.js';
import { buildCricketField, buildFestivalField, buildFestivalGrounds } from './grounds.js';
import { buildPitch, buildStadiumSky, buildStageRoof, buildEndBoards } from './stadium.js';
import { buildStage, buildConcertSeating, normalizeStageCfg, MAIN_H, CAT_H, B_CENTER_X, DOWNSTAGE_X, CSTAGE_POS, cstageLocal, CSTAGE_MASK_PAD, CURTAIN_CUT, CENTRE_R, deriveStage, stageSurfaceY, FOH_CX, middleRadius, stageBlocks } from './stage.js';
import { SPHERE_LOOKS } from './spherelooks.js';
import { makeLookPass, LOOKS } from './looks.js';
import { buildCrowd, CrowdFX } from './crowd.js';
import { initDirector } from './director.js';
import { initPads, VIBES, MOTIONS } from './pads.js';
import { initMenu } from './menu.js';
import { initBuilder } from './builder.js';
import { initLiveCam } from './livecam.js';
import { initCamPipeline } from './camfx.js';
import { initHandsPanel } from './hands.js';
import { initFeeds } from './feeds.js';
import { makeMovable } from './windows.js';
import { buildRig, RIG } from './rig.js';
import { RigFX, BStageFX } from './rigfx.js';
import { makeBackboardDecal, makeScoreboard, makeRibbon, billboardInstanced } from './textures.js';
import { OrbFX, FasciaFX } from './orbfx.js';
import { initPyro } from './pyrofx.js';
import { initFireworks } from './fireworks.js';
import { initProps } from './props.js';
import { initBalloons } from './balloonfx.js';
import { initArenaFX } from './arenafx.js';
import { initAudioFX, renderPA, setPaMakeup } from './audiofx.js';
import { LIFTS } from './stage.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { initCrowdAudio } from './crowdaudio.js';
import { buildHockeyProps } from './hockeyprops.js';
import { initSmoke } from './smokefx.js';
import { buildFOH, initFlag } from './setdressing.js';
import { initVideoPresets } from './videopresets.js';
import { initConsole } from './console.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { initVRPhone } from './vrphone.js';
import { buildStageMark, MARK_RADIUS } from './stagemark.js';
import { initShowEngine } from './showengine.js';
import { initShowDesigner } from './showdesigner.js';
import { initShowPanel } from './showpanel.js';
import { initIRHeads } from './irheads.js';
import { initHistory } from './history.js';
import { initTips } from './tips.js';
import { writeShowFile, readShowFile, keepPendingShow, takePendingShow } from './showfile.js';
import { Mp4Mux } from './mp4mux.js';
import { songBeats, reelCuts, reelTurn } from './beats.js';
import { buildJumbotron } from './jumbotron.js';

// the loading screen (index.html): every file of the app has arrived; now it builds
window.__boot?.step(0.42, 'Building the venue');

// --- renderer ---------------------------------------------------------------
const DEBUG = new URLSearchParams(location.search).has('debug');
// the phone and tablet showcase (index.html sets it; mobile.js has its controls)
const MOBILE = !!window.PIXMOB_MOBILE;
// ?vr — phone-in-a-headset mode: stereo split + sensor head tracking, driven
// from a laptop over the show relay. It has to be decided HERE, before the
// context exists, because MSAA cannot be turned off later and it is the single
// most expensive setting on a phone GPU.
const VR = new URLSearchParams(location.search).has('vr');
const renderer = new THREE.WebGLRenderer({
  antialias: !VR, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG,
});
renderer.setSize(window.innerWidth, window.innerHeight);
// A phone's devicePixelRatio is 3: capping at 1 renders a THIRD of native
// linear resolution and reads as heavy pixelation. 1.8 is about half native —
// sharp enough to look real — and the adaptive controller below claws it back
// when frames get expensive, so this is a ceiling, not a commitment. On a
// laptop the ceiling is 1: past that every step costs a third more pixels
// through the scene and the bloom chain for a sharpness nobody notices on a
// sales call, and it was the difference between 55 and 80 fps in concert mode.
const MAX_PR = Math.min(window.devicePixelRatio, VR ? 1.8 : MOBILE ? 1.3 : 1.0);   // a phone: sharp enough, and it keeps up
renderer.setPixelRatio(MAX_PR);
// WebXR: headset look-around from wherever you were standing. In-session
// rendering bypasses the composer (bloom does not run under XR framebuffers).
renderer.xr.enabled = true;
if (navigator.xr) {
  // tucked into the bottom-left corner at 30% opacity — present for headset
  // owners, invisible furniture for everyone else
  const vrBtn = VRButton.createButton(renderer);
  vrBtn.id = 'vrBtn';   // CSS keeps it to the start screen — see #vrBtn below
  vrBtn.style.cssText += ';z-index:60;left:10px;right:auto;bottom:10px;width:auto;padding:5px 10px;font-size:10px;opacity:0.3;transition:opacity 0.2s;';
  vrBtn.addEventListener('mouseenter', () => { vrBtn.style.opacity = '1'; });
  vrBtn.addEventListener('mouseleave', () => { vrBtn.style.opacity = '0.3'; });
  // only where a headset can actually be used: never a "VR NOT SUPPORTED" button
  navigator.xr.isSessionSupported?.('immersive-vr').then((ok) => { if (ok) document.body.appendChild(vrBtn); }).catch(() => {});
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // static scene — bake on demand
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030308);
scene.fog = new THREE.FogExp2(0x04040a, 0.0095 * SPEC.fogScale);   // the stadium is 3x the arena across
// The fog is for being down in the room: from up in the air (a drone shot, or
// flying) the far stands sank into it, half gone at 300 m. It thins with the
// camera's height, to a sixth by twice the stands' height (see animate).
let fogBase = scene.fog.density;

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, SPEC.cameraFar);
camera.position.set(-11.5, 1.60, 8.6);
camera.lookAt(4, 3.2, -1.5);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;

// --- lighting ----------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0x3a4256, 0x0a0806, 0.34);
scene.add(hemi);

const houseLights = [];
const lightPositions = [];
function rig(x, z, intensity, castShadow, targetX = 0, targetZ = 0) {
  const spot = new THREE.SpotLight(0xfff1dc, intensity, 0, SPEC.spotAngle ?? Math.PI / 4.7, 0.55, 2);
  spot.position.set(x, SPEC.lightY, z);
  spot.target.position.set(targetX, 0, targetZ);
  scene.add(spot, spot.target);
  if (castShadow) {
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 5;
    spot.shadow.camera.far = SPEC.shadowFar;
  }
  spot.userData.baseIntensity = intensity;
  houseLights.push(spot);
  lightPositions.push(new THREE.Vector3(x, SPEC.lightY, z));
  return spot;
}
// the house rig comes from the venue spec: catwalk lamps over the rink, or
// floodlights along the stadium's roof edge (intensities scale with the
// square of the throw, so the pitch is lit like the ice is)
for (const a of SPEC.houseLights) rig(...a);
// wide rink coverage, only lit in hockey mode (ends of the ice)
const endRigs = SPEC.endRigs.map((a) => rig(...a));

// dim warm washes so the bowl seats read in the dark
const bowlWashes = [];
function wash(zone, x, z, tx, tz, intensity) {
  const w = new THREE.SpotLight(0x8a7a5a, intensity, 0, Math.PI / 3.1, 0.9, 2);
  w.position.set(x, SPEC.washY, z);
  w.target.position.set(tx, SPEC.washTargetY, tz);
  w.userData.baseIntensity = intensity;
  w.userData.zone = zone;
  scene.add(w, w.target);
  bowlWashes.push(w);
}
for (const a of SPEC.washes) wash(...a);

// concert mode: colored show lights (hidden in sport modes)
const showLights = [];
const showCols = [0xff2fb4, 0x2f7bff, 0x8a2fff, 0xff8a1e];
showCols.forEach((c, i) => {
  const s = new THREE.SpotLight(c, SPEC.showIntensity, 0, Math.PI / 6.5, 0.6, 2);
  const ang = (i / showCols.length) * Math.PI * 2 + 0.4;
  s.position.set(Math.cos(ang) * 10 * SPEC.showScale, SPEC.showY, Math.sin(ang) * 6 * SPEC.showScale);
  s.target.position.set(Math.cos(ang + 2.1) * 7 * SPEC.showScale, 0, Math.sin(ang + 2.1) * 4 * SPEC.showScale);
  s.visible = false;
  scene.add(s, s.target);
  showLights.push(s);
});

// stage key lights are appended to showLights after the stage is built
function stageSpot(color, x, y, z, tx, ty, tz, intensity, angle) {
  const s = new THREE.SpotLight(color, intensity, 0, angle, 0.5, 2);
  s.position.set(x, y, z);
  s.target.position.set(tx, ty, tz);
  s.visible = false;
  scene.add(s, s.target);
  showLights.push(s);
  return s;
}

// --- build the world ----------------------------------------------------------
const maxAniso = renderer.capabilities.getMaxAnisotropy();
if (!IS_STADIUM) buildEventFloor(scene, maxAniso, fresnelize);   // the stadium's floor is its turf
const { mirror, court } = buildFloor(scene, maxAniso, !IS_STADIUM);
if (IS_STADIUM) {
  mirror.visible = false;   // grass does not reflect; save the extra scene pass
  // basketball in the stadium: the court goes down on the decking that covers
  // the pitch, so it has to sit above it, and with no mirror underneath its
  // Fresnel see-through would only show the decking
  court.position.y = SURFACE_Y;
  court.material.transparent = false;
}
const decal = makeBackboardDecal();
const hoopA = buildHoop(scene, 1, decal);
const hoopB = buildHoop(scene, -1, decal);
const courtside = buildCourtsideSeats(scene);
const floorSeats = buildFloorSeats(scene);
const led = buildLedBoards(scene, makeRibbon());
const ball = buildBall(scene);
const rink = buildRink(scene, maxAniso, fresnelize);
let stage = buildStage(scene);
let concertSeats = buildConcertSeating(scene);
// A rig plan saved from CREATE YOUR RIG replaces the default truss/fixture/FX
// layout at boot; the menu's rig tab sets/clears it and reloads.
let rigPlan = null;
try { rigPlan = JSON.parse(localStorage.getItem('arena-active-rigplan') || 'null'); } catch (_) { /* corrupt */ }
const showRig = buildRig(scene, document.getElementById('video'), rigPlan);
showRig.idleTex.wrapS = THREE.RepeatWrapping;   // the sphere stage's halo tiles it four times round
showRig.idleTex.needsUpdate = true;
// A plan remembers the room it was drawn against; boot into that room so the
// stage under the rig is the one the user designed for.
const planVenue = rigPlan && rigPlan.venue ? rigPlan.venue : null;
// The festival field has no stands: its bowl is built out of sight (venue.js
// says why) into a group that is never shown, crowd and all.
const bowlHome = SPEC.bowl.hidden ? new THREE.Group() : scene;
if (SPEC.bowl.hidden) { bowlHome.visible = false; scene.add(bowlHome); }
const bowl = buildBowl(bowlHome);
// stadium only: the pitch (grass, lines, goals, concert cover) and the
// ground-support roof the show hangs from — the house roof is open above
const pitch = !IS_STADIUM ? null
  : IS_CRICKET ? buildCricketField(scene, maxAniso)
    : IS_FESTIVAL ? buildFestivalField(scene, maxAniso)
      : buildPitch(scene, maxAniso);
// the festival's fence, trees, stalls, delay towers and big wheel
const grounds = IS_FESTIVAL ? buildFestivalGrounds(scene) : null;
const stageRoof = IS_STADIUM ? buildStageRoof(scene) : null;
// video boards above both end stands, fed by the same content as the video wall
const endBoards = IS_STADIUM && !IS_FESTIVAL ? buildEndBoards(scene, showRig.wallMat) : null;
{ const sc = document.getElementById('seatColor'); if (sc) sc.value = SPEC.seatHex; }
// key light on the main deck, plus a tight special on the B-stage — these
// ride along when the rig follows the stage into curtained rooms
const stageKeys = [
  { light: stageSpot(0xffe6c4, -24, 20, 0, -26, MAIN_H, 0, 1700, Math.PI / 5.5), baseX: -24, baseTX: -26 },
  { light: stageSpot(0xffffff, B_CENTER_X, 21, 0, B_CENTER_X, CAT_H, 0, 1100, Math.PI / 12), baseX: B_CENTER_X, baseTX: B_CENTER_X },
];

// show-fx package: pyro/flames/poppers/streamers live in rig-local coords and
// ride the rig transform; props hang from the house steel in world space
const pyroFX = initPyro(showRig.group, showRig.fxPoints);
// OUTDOOR pyro: real-scale fireworks from racks ringed round the outside of
// the stadium. Under a roof there is nowhere for them to go, so the arena
// gets an inert stand-in and its buttons are hidden below.
const fireworksFX = IS_STADIUM ? initFireworks(scene, { renderer }) : {
  state: { show: false, preset: 'mixed', sound: true, volume: 0.6 }, sites: [], presets: [],
  fire() {}, fireFinale() {}, fireShell() {}, setPreset() {}, setShow() {}, setSound() {}, setVolume() {}, tick() {},
};
const propsFX = initProps(scene);
const balloonFX = initBalloons(scene);
const liftTargets = { a: 0, b: 0 };
const arenaFX = initArenaFX(scene);
const audioFX = initAudioFX(camera);
audioFX.attachElement(document.getElementById('video'));
const crowdSFX = initCrowdAudio();
const smokeFX = initSmoke(showRig.group, scene);
const hockeyProps = buildHockeyProps(scene);
const foh = buildFOH(scene);
foh.setPosition(FOH_CX - 1.7, 0);   // desks against the pen's stage-side barrier
const flagFX = initFlag(scene);
const vPresets = initVideoPresets();
vPresets.texture.wrapS = THREE.RepeatWrapping;

const scoreboard = makeScoreboard();
const jumboMesh = buildJumbotron(scene, scoreboard.texture);   // the halo board (jumbotron.js)
const ceiling = IS_STADIUM ? buildStadiumSky(scene, lightPositions) : buildCeiling(scene, lightPositions);
if (!IS_STADIUM) {
  ceiling.group.position.y += 0.7;   // sits just over the house steel at 38.5
  ceiling.group.scale.set(1.06, 1, 1.06);   // and reaches past the bowl's outer wall
}
// the stadium aims its own shafts from the pylons; the arena's hang straight down
const shafts = IS_STADIUM ? ceiling.shafts : buildLightShafts(scene, lightPositions.slice(0, 5));

// --- show-effect engines ---------------------------------------------------------
const orbFX = new OrbFX([
  { mesh: bowl.orbs, pos: bowl.orbPos },
  { mesh: courtside.orbs, pos: courtside.orbPos },
  { mesh: floorSeats.orbs, pos: floorSeats.orbPos },
  { mesh: concertSeats.orbs, pos: concertSeats.orbPos },
]);
orbFX.video = document.getElementById('video');
orbFX.videoCanvas = document.createElement('canvas');
orbFX.videoCanvas.width = 128;
orbFX.videoCanvas.height = 128;
orbFX.videoCtx = orbFX.videoCanvas.getContext('2d', { willReadFrequently: true });

function generateVideoMap(orbFX, birdCam) {
  const vec = new THREE.Vector3();
  for (const g of orbFX.groups) {
    g.videoMap = new Float32Array(g.n * 2);
    for (let i = 0; i < g.n; i++) {
      vec.fromArray(g.pos, i * 3);
      vec.project(birdCam);
      g.videoMap[i * 2] = (vec.x + 1) / 2 + (Math.random() - 0.5) * 0.001;
      g.videoMap[i * 2 + 1] = (vec.y + 1) / 2 + (Math.random() - 0.5) * 0.001;
    }
  }
}

// showLights holds the 4 colour washes first, then the 2 stage keys appended
// by stageSpot() — split them so each gets the right treatment.
const rigFX = new RigFX(scene, showRig, {
  showLights: showLights.slice(0, 4),
  stageSpots: showLights.slice(4),
});
rigFX.setViewport(camera, window.innerHeight);
const bstageFX = new BStageFX(stage);
const fasciaFX = new FasciaFX(bowl.fascias);
// each room boots its ribbons into its own identity (the arena's blue belt);
// the console's Ads / Video / Chase modes still take over on a click
if (SPEC.bowl.fascia?.mode) {
  const FD = SPEC.bowl.fascia;
  if (FD.colorA != null) {
    fasciaFX.colorA.setHex(FD.colorA);
    const fa = document.getElementById('fasciaA');
    if (fa) fa.value = '#' + fasciaFX.colorA.getHexString();
  }
  fasciaFX.set({ mode: FD.mode });
  document.querySelectorAll('[data-fascia]').forEach((b) => b.classList.toggle('active', b.dataset.fascia === FD.mode));
}

// 2D crowd, one sprite per seat. Each block is parented to the group that owns
// its seats, so it appears and disappears with the venue mode for free. The
// drop is how far the orb sits above that block's floor.
const crowd = buildCrowd(scene, [
  { pos: bowl.orbPos,         drop: 0.75, parent: bowlHome, wave: true },
  { pos: courtside.orbPos,    drop: 0.82, parent: courtside.group },
  { pos: floorSeats.orbPos,   drop: 0.82, parent: floorSeats.group },
  { pos: concertSeats.orbPos, drop: 0.82, parent: concertSeats.group },
]);
const crowdFX = new CrowdFX(crowd);
// layer 3 keeps them out of both bird views, where edge-on billboards would
// render as meaningless slivers
for (const m of crowd.meshes) m.layers.set(3);
orbFX.setSize(0.5);
const lightCfg = { master: 1, warmth: 0.55, washN: 1, washS: 1, washE: 1, washW: 1 };
const warmCol = new THREE.Color(0xffe0b0), coolCol = new THREE.Color(0xdfe9ff);

// keep the volumetric shafts (shader misbehaves under the oblique
// projection) and the ~38k instanced seat boxes (pure cost, no visible
// contribution) out of the mirror pass
// The laser blades and shafts build their ribbons in view space; under the
// Reflector's oblique projection that math NaNs, the NaN lands in the mirror
// texture, and bloom smears it into a fully black frame — so the whole rig FX
// group stays OUT of the mirror pass, along with the instanced seat/crowd
// boxes (pure cost, nothing visible).
const mirrorSkip = [shafts, ...bowl.heavyMeshes, showRig.group, floorSeats.group, concertSeats.group];
mirrorSkip.push(rigFX.group, ceiling.group, ceiling.banners, ...crowd.meshes);
const mirrorRender = mirror.onBeforeRender;
let mirrorTick = 0;
mirror.onBeforeRender = function (r, s, c, ...rest) {
  // 30 Hz is indistinguishable for a floor reflection and halves a full
  // extra scene render; between updates the last texture is reused as-is.
  if ((mirrorTick++ & 1) !== 0) return;
  const prev = mirrorSkip.map((o) => o.visible);
  for (const o of mirrorSkip) o.visible = false;
  mirrorRender.call(this, r, s, c, ...rest);
  mirrorSkip.forEach((o, i) => { o.visible = prev[i]; });
};

// --- game modes & lighting presets ------------------------------------------------
let shadowBakes = 4;
let currentMode = 'creative';   // bare venue: no court, rink, stage or rig
let wantShot = false;
document.getElementById('snapBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  wantShot = true;
});
let basketballFloorOn = true;
function setBasketballFloor(on) { basketballFloorOn = on; applyState(false); }
let stageCfg = normalizeStageCfg({});
let coversOn = true;   // legacy default: end-stage behind tarps, medium
let curtainOn = false; // room-size drape, concert-only
let lighting = 'game'; // 'game' = dark bowl, show on the floor · 'house' = all lights on · 'blackout' = everything off
let baseBloom = 0.38, hazeBloomK = 1;   // bloom = the room's base × how much haze is in the air
const basketballStuff = [court, hoopA, hoopB, courtside.group, floorSeats.group, led.group, ball];

// the roof's own glow: its deck and steel carry a faint emissive so they read
// from the floor. Show lighting dims it, a blackout takes it away.
const ceilingGlows = [];
function applyState(rebake = true) {
  const mode = currentMode;
  const bball = mode === 'basketball', hockey = mode === 'hockey', concert = mode === 'concert';
  // ('football' is the stadium's sport mode: open grass, goals in, no stage)
  const house = lighting === 'house';
  const dark = lighting === 'blackout';   // house down, suites dark, rings off
  for (const o of basketballStuff) o.visible = bball;
  if (bball) floorSeats.group.visible = basketballFloorOn;
  rink.visible = hockey;
  stage.group.visible = concert;
  showRig.group.visible = concert;   // the touring package only loads in for shows
  rigFX.group.visible = concert;
  bowl.covers.visible = coversOn && mode !== 'creative'; // configured tarps
  bowl.curtain.visible = curtainOn && concert;            // room-size drape
  concertSeats.group.visible = concert;
  if (pitch) pitch.setSurface(mode);        // turf, goals or decking for this mode
  if (stageRoof) stageRoof.visible = concert && stageCfg.position !== 'middle';   // the end stage's roof, not the sphere's
  rigLightsOn = null;   // re-decided below for this mode and room (syncRigLights)

  // rig color follows the console warmth slider (0 = cold, 1 = warm)
  const rigColor = coolCol.clone().lerp(warmCol, lightCfg.warmth);
  for (const l of houseLights) {
    const isEndRig = endRigs.includes(l);
    if (dark) {
      l.visible = false;
    } else if (house) {
      // house lights: every rig on, evenly — pregame / lights-up look
      // (boosted: the old values read dim and flat)
      l.visible = true;
      l.intensity = l.userData.baseIntensity * (hockey ? 0.4 : 0.68) * lightCfg.master;
    } else {
      // show lighting: only the rigs each mode needs (every visible
      // spotlight costs shading time on every pixel)
      l.visible = hockey ? l !== houseLights[4] : concert ? l === houseLights[4] : !isEndRig;
      // show lighting is a dark room: the wristbands and the screens carry it
      l.intensity = l.userData.baseIntensity * (concert ? 0.22 : hockey ? 0.3 : 0.55) * lightCfg.master;
    }
    l.color.copy(rigColor);
  }
  for (const w of bowlWashes) {
    const zoneLevel = lightCfg['wash' + w.userData.zone];
    w.intensity = w.userData.baseIntensity * (house ? 4.4 : concert ? 0.3 : 0.5) * zoneLevel;
    w.visible = !dark && zoneLevel > 0.01;
    w.color.setHex(house ? 0xcfc9bc : 0x8a7a5a);
  }
  // ambient world response: with the house up, the room itself brightens
  hemi.intensity = dark ? 0.004 : house ? 2.4 : 0.14;
  // what the room's own lights stand at before a trigger's fade line dims them
  for (const l of houseLights) l.userData.applied = l.intensity;
  for (const w of bowlWashes) w.userData.applied = w.intensity;
  hemi.userData.applied = hemi.intensity;
  applyLightsFade();
  hemi.color.setHex(dark ? 0x0a0c14 : house ? 0x9aa2b2 : 0x3a4256);
  hemi.groundColor.setHex(dark ? 0x000000 : house ? 0x554c40 : 0x0a0806);
  scene.environmentIntensity = dark ? 0 : house ? 0.75 : 0.05;
  scene.background.setHex(dark ? 0x000000 : house ? 0x22252d : 0x030308);
  fogBase = (dark ? 0.014 : house ? 0.004 : 0.0095) * SPEC.fogScale;
  scene.fog.density = fogBase;
  ceiling.setLighting?.(dark ? 'dark' : house ? 'house' : 'show');   // the stadium sky follows the room
  baseBloom = dark ? 0.5 : house ? 0.22 : 0.38;   // the few live sources read harder in the dark
  bloom.strength = baseBloom * hazeBloomK * bloomGain;
  shafts.visible = !concert && !house && !dark; // no visible beams once the room is lit

  // blackout also kills the self-lit surfaces: suite windows, fascia rings,
  // the jumbotron. They are unlit materials, so dimming the lights misses them.
  bowl.suites.material.color.setScalar(dark ? 0 : 1);
  for (const m of bowl.signs || []) m.color.setScalar(dark ? 0 : 1);   // the section numbers
  // the suites' own lights follow their switch on the console, and go off in a blackout
  bowl.setSuiteLights(!dark && document.getElementById('suiteLightsBtn')?.classList.contains('active') !== false);
  // the courtside boards (basketball) are screens too
  led.group.traverse((o) => {
    const m = o.material;
    if (!m || !m.color) return;
    m.userData.lit ??= m.color.clone();
    if (dark) m.color.setScalar(0); else m.color.copy(m.userData.lit).multiplyScalar(screenGlow * grandK);
  });
  // unlit sprites: the room's light level is applied by hand. Show lighting
  // means the bowl is dark — the crowd should read as silhouettes.
  crowdFX.set({ ambient: dark ? 0.01 : house ? 1.0 : 0.05 });
  for (const l of ceiling.lampLenses) l.material.color.setHex(0xfff4dd).multiplyScalar(dark ? 0 : 4);
  for (const b of ceiling.banners.children) b.material.emissiveIntensity = dark ? 0 : 0.22;
  if (!ceilingGlows.length && !IS_STADIUM) {   // the stadium's sky looks after itself (setLighting above)
    ceiling.group.traverse((o) => {
      const m = o.material;
      if (m && m.emissive && m.emissiveIntensity > 0 && !ceilingGlows.some((g) => g.mat === m)) ceilingGlows.push({ mat: m, base: m.emissiveIntensity });
    });
  }
  for (const g of ceilingGlows) g.mat.emissiveIntensity = g.base * (dark ? 0 : house ? 1 : 0.35);
  if (dark) {
    if (fasciaFX.mode !== 'off') { fasciaFX._restore = fasciaFX.mode; fasciaFX.set({ mode: 'off' }); }
    jumboMesh.setScreens?.(false);   // the board stays up, its screens go black
  } else {
    if (fasciaFX.mode === 'off' && fasciaFX._restore) {
      fasciaFX.set({ mode: fasciaFX._restore }); fasciaFX._restore = null;
    }
    jumboMesh.setScreens?.(true);
  }

  document.querySelectorAll('[data-light]').forEach((b) => {
    b.classList.toggle('active', b.dataset.light === lighting);
  });
  const lb = document.getElementById('lightsBtn');
  if (lb) lb.classList.toggle('active', house);
  syncRigLights();
  if (rebake) shadowBakes = 4;
}
// The rig's real lights (the four colour washes, the two stage keys and the
// tracker pool) only light anything while a lighting cue is up. Idle, the rig
// sits in blackout and they shine at nothing, yet every visible spotlight is
// shaded on every lit pixel in the building: concert mode ran at 75 fps with
// its 13 lights and 108 with two fewer. So they exist only while the rig is
// lit. Switching rebuilds the lit shaders once, which is why this runs on a
// change of cue, never per frame.
let rigLightsOn = null, rigTrackers = 2;
function syncRigLights() {
  const want = currentMode === 'concert' && lighting === 'game' && (rigFX.look !== 'blackout' || !!rigFX.uv);
  if (want === rigLightsOn) return;
  rigLightsOn = want;
  for (const l of showLights) l.visible = want;
  if (!want && rigFX.trackerCount) rigTrackers = rigFX.trackerCount;
  rigFX.setTrackerCount(want ? rigTrackers : 0);
}
function setMode(mode) {
  currentMode = mode;
  applyState();
  bowlCull();
  hockeyProps.group.visible = mode === 'hockey';
  foh.group.visible = mode === 'concert' && !['theatre', 'hemicycle'].includes(stageCfg.curtains);
  if (liveCam?.live) requestRemap();   // seat blocks came or went: re-fit the picture
  applyVideoRoute();   // floor projection follows the surface for this mode
}
function setLighting(l) { lighting = l; applyState(); }
document.getElementById('lightsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  setLighting(lighting === 'house' ? 'game' : 'house');
});
document.querySelectorAll('[data-light]').forEach((b) => {
  b.addEventListener('click', (e) => { e.stopPropagation(); setLighting(b.dataset.light); });
});
// initial applyState() runs after the composer exists (it touches bloom)

// --- post-processing -----------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// --- ARENA HAZE: the air itself ---------------------------------------------
// A screen-space pass over the scene's depth. Everything far away sinks into a
// veil the colour of the show's light, emissive sources push through it and
// bloom harder, and the beam integrator's density rides the same knob. Scene
// fog alone could not do this: it only darkens, and the crowd, orbs and beams
// are custom shaders that never heard of it.
for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
  rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
  rt.depthTexture.format = THREE.DepthFormat;
  rt.depthTexture.type = THREE.UnsignedIntType;
}
{ // the composer resizes its targets on every pixel-ratio change; the depth textures follow
  const cs = composer.setSize.bind(composer);
  composer.setSize = (w, h) => {
    cs(w, h);
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      const dt = rt.depthTexture;
      if (dt && (dt.image.width !== rt.width || dt.image.height !== rt.height)) {
        dt.image.width = rt.width; dt.image.height = rt.height; dt.needsUpdate = true;
      }
    }
  };
}
class HazePass extends ShaderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;   // the RenderPass just drew into readBuffer
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
const hazePass = new HazePass(new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uDensity: { value: 0 }, uNear: { value: camera.near }, uFar: { value: camera.far },
    uTime: { value: 0 }, uCol: { value: new THREE.Color(0.012, 0.012, 0.015) },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float uDensity; uniform float uNear; uniform float uFar; uniform float uTime;
    uniform vec3 uCol;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float z = texture2D(tDepth, vUv).x;
      float dist = min(-perspectiveDepthToViewZ(z, uNear, uFar), uFar);
      // the air drifts a little, so the veil is never a flat gradient
      float n = 0.88 + 0.12 * sin(vUv.x * 6.3 + uTime * 0.11) * sin(vUv.y * 4.7 - uTime * 0.07 + 1.3);
      float f = 1.0 - exp(-uDensity * n * dist);
      // lit surfaces lose contrast into the haze; emissive sources push through it
      float lum = max(c.r, max(c.g, c.b));
      float ext = f * mix(0.7, 0.15, clamp(lum * 0.6, 0.0, 1.0));
      gl_FragColor = vec4(c.rgb * (1.0 - ext) + uCol * f, c.a);
    }`,
  depthTest: false, depthWrite: false,
}));
hazePass.enabled = false;
composer.addPass(hazePass);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.38, 0.7, 1.25
);
// bloom gates on luminance by default, which lets green/yellow/white glow
// while pure red or blue never reach the threshold — gate on the brightest
// channel instead so every hue blooms equally. Also scrub NaN/inf here: a
// single poisoned pixel from any additive shader would otherwise smear
// through the blur mips into a fully black frame. The (x >= lo && x <= hi)
// form is deliberate — every comparison with NaN is false, so bad values
// fall through to 0 instead of surviving a clamp/max (undefined for NaN).
bloom.materialHighPassFilter.fragmentShader =
  bloom.materialHighPassFilter.fragmentShader.replace(
    'float v = luminance( texel.xyz );',
    `texel.r = (texel.r >= 0.0 && texel.r <= 256.0) ? texel.r : 0.0;
     texel.g = (texel.g >= 0.0 && texel.g <= 256.0) ? texel.g : 0.0;
     texel.b = (texel.b >= 0.0 && texel.b <= 256.0) ? texel.b : 0.0;
     float v = max( texel.r, max( texel.g, texel.b ) );`
  );
bloom.materialHighPassFilter.needsUpdate = true;
composer.addPass(bloom);
composer.addPass(new OutputPass());
// camera looks (looks.js): a stylising pass after tone mapping, off by default
const lookPass = makeLookPass();
lookPass.enabled = false;
composer.addPass(lookPass);

// --- the haze knob ----------------------------------------------------------
// One slider in Settings: how much smoke the room is running. It sets the veil
// (the pass above), how hard lights bloom through it, and how thick the beams
// and lasers read — every look's own haze sits on top. Remembered per browser.
// Off by default: the veil is a full-screen pass over the depth buffer, about
// a quarter of the GPU's frame, and a dark room sells the wristbands better.
const HAZE_KEY = 'arena-haze-v3';
let arenaHaze = 0;
// The two glow knobs (the SHOW panel's Room section). Screens glow by being
// drawn brighter than white, which the bloom pass then spreads into a halo:
// "screen glow" scales how bright the halo board, the video walls and the
// ribbon and courtside boards are drawn (below about 70% they sit under the
// bloom gate and read as lit panels with no halo), and "bloom" scales the
// halo itself, on everything, the wristbands too.
let screenGlow = 1, bloomGain = 1;
let grandK = 1;   // the trigger's fade line on the screens, as linear light (see the fade line below)
let lightsK = 1;  // and on the room's own lights
const hazeRange = document.getElementById('hazeRange'), hazeVal = document.getElementById('hazeVal');
const _hazeTint = new THREE.Color();
function setArenaHaze(h, persist = true) {
  h = Math.max(0, Math.min(2, +h || 0));   // up to 200%
  arenaHaze = h;
  hazePass.enabled = h > 0.001;
  hazePass.uniforms.uDensity.value = 0.012 * h;              // per metre; 60 m into a full room is half veiled
  rigFX.roomHaze = 0.5 + 1.5 * h;                              // beams + lasers: thin room → soup
  hazeBloomK = 1 + 0.6 * h;
  bloom.strength = baseBloom * hazeBloomK * bloomGain;
  bloom.radius = 0.7 + 0.2 * h;
  if (hazeRange && +hazeRange.value !== h) hazeRange.value = String(h);
  if (hazeVal) hazeVal.textContent = `${Math.round(h * 100)}%`;
  if (persist) { try { localStorage.setItem(HAZE_KEY, String(h)); } catch (_) { /* private mode */ } }
}
function hazeTick() {
  const u = hazePass.uniforms;
  u.uTime.value = performance.now() * 0.001;
  u.uNear.value = camera.near; u.uFar.value = camera.far;
  // the veil is lit by the show: a neutral floor plus a wash of the rig's colours
  _hazeTint.copy(rigFX.colorA).lerp(rigFX.colorB, 0.5);
  const m = Math.max(0, Math.min(1, rigFX.master));
  u.uCol.value.setRGB(0.010 + 0.040 * _hazeTint.r * m, 0.010 + 0.040 * _hazeTint.g * m, 0.013 + 0.040 * _hazeTint.b * m);
}
{
  // every visit starts in a full room of haze (100%); the slider changes it from there
  setArenaHaze(1, false);
  hazeRange?.addEventListener('input', (e) => { e.stopPropagation(); setArenaHaze(e.target.value); });
  hazeRange?.addEventListener('click', (e) => e.stopPropagation());
  hazeRange?.addEventListener('pointerdown', (e) => e.stopPropagation());
}
window.setArenaHaze = setArenaHaze;
// Settings → Field of view: how wide the lens is, kept between visits (a camera
// look with its own lens still uses that)
const FOV_KEY = 'ht-fov';
let userFov = 72;
try { const f = parseFloat(localStorage.getItem(FOV_KEY)); if (f >= 30 && f <= 120) userFov = f; } catch (_) { /* blocked */ }
// a look's own lens, widened or narrowed the way the slider is (72° leaves it as made)
const lookFov = (L) => Math.max(20, Math.min(130, ((L?.fov || 72) * userFov) / 72));
const fovRange = document.getElementById('fovRange'), fovVal = document.getElementById('fovVal');
function setUserFov(f) {
  userFov = Math.max(30, Math.min(120, Math.round(+f || 72)));
  if (fovRange && +fovRange.value !== userFov) fovRange.value = String(userFov);
  if (fovVal) fovVal.textContent = `${userFov}°`;
  if (!tour) { camera.fov = lookFov(LOOKS[lookIdx]); camera.updateProjectionMatrix(); rigFX.setViewport(camera, window.innerHeight); }
  try { localStorage.setItem(FOV_KEY, String(userFov)); } catch (_) { /* private mode */ }
}
fovRange?.addEventListener('input', (e) => { e.stopPropagation(); setUserFov(e.target.value); });
fovRange?.addEventListener('click', (e) => e.stopPropagation());
fovRange?.addEventListener('pointerdown', (e) => e.stopPropagation());
let lookIdx = 0;
const lookHud = document.getElementById('lookHud');
function setLook(i) {
  lookIdx = ((i % LOOKS.length) + LOOKS.length) % LOOKS.length;
  const L = LOOKS[lookIdx];
  lookPass.enabled = L.mode !== 0;
  lookPass.uniforms.uMode.value = L.mode;
  lookPass.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
  camera.fov = lookFov(L);
  camera.updateProjectionMatrix();
  rigFX.setViewport(camera, window.innerHeight);
  if (lookHud) { lookHud.className = L.hud ? 'hud-' + L.hud : 'hidden'; }
  const k = document.querySelector('#lookBtn kbd'); if (k) k.textContent = L.name;
  const sel = document.getElementById('lookSel');
  if (sel && sel.value !== L.key) sel.value = L.key;
}
document.getElementById('lookBtn')?.addEventListener('click', (e) => { e.stopPropagation(); setLook(lookIdx + 1); });
// Twenty-five looks is too many to cycle through and too many to lay out as
// chips — as a wrapping grid they filled the settings menu and read as clutter.
// One dropdown; #lookBtn still cycles for quick A/B.
{
  const sel = document.getElementById('lookSel');
  if (sel) {
    LOOKS.forEach((L) => {
      const o = document.createElement('option');
      o.value = L.key; o.textContent = L.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const i = LOOKS.findIndex((L) => L.key === sel.value);
      if (i >= 0) setLook(i);
    });
    sel.addEventListener('click', (e) => e.stopPropagation());
  }
}
// camcorder timecode and the security camera's date stamp
setInterval(() => {
  const cls = lookHud?.className || '';
  if (cls !== 'hud-rec' && cls !== 'hud-sec') return;
  const d = new Date();
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
  const el = document.getElementById('lookTime'); if (el && cls === 'hud-rec') el.textContent = hms;
  const el2 = document.getElementById('secTime');
  if (el2 && cls === 'hud-sec') el2.textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hms}`;
}, 500);
applyState();

// --- controls & movement ---------------------------------------------------------
const controls = new PointerLockControls(camera, renderer.domElement);
// iOS Safari has no Pointer Lock API, and PointerLockControls.lock() calls
// requestPointerLock unguarded — a bare TypeError out of every entry path
// (menu, resume button, canvas tap, Escape). Neutralise it once here instead
// of guarding all six call sites; on a phone the head drives the camera.
if (typeof renderer.domElement.requestPointerLock !== 'function') {
  controls.lock = () => {};
  controls.unlock = () => {};
}
// --- bird's-eye monitor -------------------------------------------------------
// Layers: 0 = world · 2 = orbs (extra bit) · 3 = overhead-only (hidden in 2D view)
camera.layers.enable(3);
for (const o of [ceiling.group, ceiling.banners, jumboMesh, shafts, mirror]) {
  o.traverse((c) => c.layers.set(3));
}
// Every orb mesh, in one place. The orbs-only view, the PNG export and the
// layer-2 assignment all read this list — previously two of the four blocks
// were missing from each, so the floor crowds vanished from the 2D map.
const orbMeshes = [bowl.orbs, courtside.orbs, floorSeats.orbs, concertSeats.orbs];
for (const o of orbMeshes) o.layers.enable(2);
// truss + motor grid read as overhead clutter from above: exclude from bird view
showRig.group.children[0].traverse((c) => c.layers.set(3));

const birdCam = new THREE.OrthographicCamera(-SPEC.bird.hw, SPEC.bird.hw, SPEC.bird.hh, -SPEC.bird.hh, 1, SPEC.bird.far);
birdCam.position.set(0, SPEC.bird.y, 0);
birdCam.up.set(0, 0, -1);
birdCam.lookAt(0, 0, 0);
birdCam.updateMatrixWorld(true);

generateVideoMap(orbFX, birdCam);

let birdMode = 'off'; // 'off' | 'arena' | 'orbs'
const birdPanel = document.getElementById('birdPanel');
const birdViewEl = document.getElementById('birdView');
const birdBlack = new THREE.Color(0x000000);
function setBirdMode(mode) {
  birdMode = mode;
  birdPanel.classList.toggle('hidden', mode === 'off');
  document.querySelectorAll('[data-bird]').forEach((b) => {
    b.classList.toggle('active', b.dataset.bird === mode);
  });
}
document.querySelectorAll('[data-bird]').forEach((b) => {
  b.addEventListener('click', (e) => { e.stopPropagation(); setBirdMode(b.dataset.bird); });
});
document.getElementById('birdBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  setBirdMode(birdMode === 'off' ? 'arena' : 'off');
});
document.getElementById('birdPng').addEventListener('click', (e) => {
  e.stopPropagation();
  exportBirdPNG({ width: 2048, orbsOnly: birdMode !== 'arena' });
});
document.getElementById('birdClose').addEventListener('click', (e) => {
  e.stopPropagation();
  setBirdMode('off');
});

// ---------------------------------------------------------------------------
// Export the plan view as a PNG. Rendered offscreen at high resolution rather
// than grabbing the small on-screen panel, so the result is usable as a
// pixel-map template. Returns a data URL; `download` also saves the file.
// ---------------------------------------------------------------------------
function exportBirdPNG({ width = 2048, orbsOnly = true, download = true } = {}) {
  const spanX = birdCam.right - birdCam.left;      // 158 m
  const spanZ = birdCam.top - birdCam.bottom;      // 122 m
  const height = Math.round(width * (spanZ / spanX));

  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    // without this the target receives LINEAR values and the PNG comes out dark
    colorSpace: THREE.SRGBColorSpace,
  });

  // save everything we are about to touch
  const prevTarget = renderer.getRenderTarget();
  const prevBg = scene.background;
  const prevFog = scene.fog;
  const prevExposure = renderer.toneMappingExposure;
  const prevMask = birdCam.layers.mask;

  scene.fog = null;
  if (orbsOnly) {
    scene.background = birdBlack;
    birdCam.layers.set(2);                 // orbs only
  } else {
    birdCam.layers.mask = 1;               // world minus overhead rig
    renderer.toneMappingExposure = 0.72;
  }
  // at 2048 px across 158 m an orb is ~2.4 px; a modest inflate makes each one
  // a clean, countable dot without merging neighbours
  const k = orbsOnly ? 2.2 : 1.8;
  for (const o of orbMeshes) o.geometry.scale(k, k, k);

  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, birdCam);

  const buf = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, buf);

  // restore before doing any canvas work
  const ik = 1 / k;
  for (const o of orbMeshes) o.geometry.scale(ik, ik, ik);
  renderer.setRenderTarget(prevTarget);
  scene.background = prevBg;
  scene.fog = prevFog;
  renderer.toneMappingExposure = prevExposure;
  birdCam.layers.mask = prevMask;
  rt.dispose();

  // GL reads bottom-up; flip into a 2D canvas row by row
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    img.data.set(buf.subarray(src, src + rowBytes), y * rowBytes);
  }
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;  // opaque
  ctx.putImageData(img, 0, 0);

  const url = cv.toDataURL('image/png');
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = orbsOnly ? `orb-map-${width}x${height}.png` : `arena-plan-${width}x${height}.png`;
    a.click();
  }
  return { url, width, height };
}

function renderBirdView() {
  const rect = birdViewEl.getBoundingClientRect();
  if (rect.width < 4) return;
  const vx = rect.left, vy = window.innerHeight - rect.bottom;
  renderer.setScissorTest(true);
  renderer.setViewport(vx, vy, rect.width, rect.height);
  renderer.setScissor(vx, vy, rect.width, rect.height);
  const bg = scene.background;
  const fog = scene.fog;
  const exposure = renderer.toneMappingExposure;
  scene.fog = null; // distance fog makes no sense from 120m up
  if (birdMode === 'orbs') {
    scene.background = birdBlack;
    birdCam.layers.set(2);      // orbs only
  } else {
    birdCam.layers.mask = 1;    // world without layer-3 overhead
    renderer.toneMappingExposure = 0.72; // stacked speculars blow out from straight above
  }
  // orbs are sub-pixel at map scale — inflate them just for this pass
  const k = birdMode === 'orbs' ? 3.6 : 2.4;
  for (const o of orbMeshes) o.geometry.scale(k, k, k);
  renderer.render(scene, birdCam);
  const ik = 1 / k;
  for (const o of orbMeshes) o.geometry.scale(ik, ik, ik);
  scene.background = bg;
  scene.fog = fog;
  renderer.toneMappingExposure = exposure;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

// One <video> element feeds two consumers: a GPU VideoTexture for the LED
// wall, and the existing 128x128 canvas sampling that drives the crowd orbs.
// Loading a single file therefore lights the wall and the wristbands together.
// The LED wall ships with tour visuals loaded, so the room is never showing a
// dead screen. Browsers only reliably start playback for a MUTED element, and
// some still hold it until the first gesture — so try immediately and retry
// once on the first click.
{
  const v = orbFX.video;
  v.muted = true; v.loop = true; v.playsInline = true;
  const kick = () => v.play().catch(() => {});
  kick();
  window.addEventListener('pointerdown', kick, { once: true });
}
const wallVideoTex = new THREE.VideoTexture(orbFX.video);
wallVideoTex.colorSpace = THREE.SRGBColorSpace;
wallVideoTex.wrapS = THREE.RepeatWrapping;
// the rings need their own instance: they tile and scroll, the wall does not
const fasciaVideoTex = new THREE.VideoTexture(orbFX.video);
fasciaVideoTex.colorSpace = THREE.SRGBColorSpace;
fasciaVideoTex.wrapS = THREE.RepeatWrapping;
fasciaVideoTex.repeat.set(bowl.fascias[0].tiles || 5, 1);
// projection overlays sit a hair above the playing surfaces
function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = w / 2, z = h / 2;
  s.moveTo(-x + r, -z);
  s.lineTo(x - r, -z); s.absarc(x - r, -z + r, r, -Math.PI / 2, 0);
  s.lineTo(x, z - r); s.absarc(x - r, z - r, r, 0, Math.PI / 2);
  s.lineTo(-x + r, z); s.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-x, -z + r); s.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
const projMat = () => {
  const mt = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.88 });
  mt.color.setScalar(1.45);   // reads as projected light on the surface
  return mt;
};
const projIceGeo = new THREE.ShapeGeometry(roundedShape(60.96, 25.91, 8.53));  // regulation NHL sheet
{ // UVs to the bounding box so the video fills the sheet
  projIceGeo.computeBoundingBox();
  const bb = projIceGeo.boundingBox, p = projIceGeo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x);
    uv[i * 2 + 1] = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
  }
  projIceGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const projIce = new THREE.Mesh(projIceGeo, projMat());
projIce.rotation.x = -Math.PI / 2;
projIce.position.y = IS_STADIUM ? SURFACE_Y + 0.025 : 0.035;   // the stadium's ice and court sit raised
const projCourt = new THREE.Mesh(new THREE.PlaneGeometry(28.65, 15.24), projMat());  // regulation NBA court
projCourt.rotation.x = -Math.PI / 2;
projCourt.position.y = IS_STADIUM ? SURFACE_Y + 0.035 : 0.045;
const projPitch = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.L, PITCH.W), projMat());  // the stadium's pitch (or its concert decking)
projPitch.rotation.x = -Math.PI / 2;
projPitch.position.y = 0.05;
for (const pj of [projIce, projCourt, projPitch]) {
  pj.visible = false;
  pj.userData.noAim = true;
  scene.add(pj);
}

let videoRoute = 'both';   // 'both' | 'screens' | 'orbs' — console VIDEO ROUTE
let liveCam = null;        // the live camera (livecam.js), set up below
let camPipe = null;        // its pipeline (camfx.js): picture, hands, shapes, output
let onMark = false;        // standing on the camera's X on stage (see updateMark)
let exporting = false;     // a video export is recording: sizes and the camera are the export's
let offline = false;       // and it is the offline render: the room runs on the render's own clock
let tour = null;           // the export's camera tour while it plays (see recordShowVideo)
// camera aims that lay the picture over the seating sections, 100s to 400s,
// and leave the floor dark (see mapToSections)
const SECTION_AIMS = new Set(['stage', 'front', 'farend', 'sides', 'round']);
let videoPreset = 'off';   // built-in animated visuals (videopresets.js)
let projFloorOn = false;   // map the live content onto the rink / court
let screensOff = false;    // Settings → Room → Video screens off: every screen goes black
const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blackTex.needsUpdate = true;
let jumboUp = false;       // scoreboard winched up into its ceiling dock
const JUMBO_HANG = SPEC.jumbo.hang;   // default show height (arena: above the old 14.6 hang)
jumboMesh.position.y = JUMBO_HANG;
jumboMesh.position.x = SPEC.jumbo.x;  // the stadium's screen hangs from the roof edge over the east end
// --- visuals follow the DIRECTOR transport ---------------------------------
// Hit play on the timeline and the film rolls on every screen the route has
// selected; pause freezes it; scrubbing repositions it, so the same moment in
// the song always shows the same frame. Polled from animate() rather than
// hooked to the transport buttons, so every path that moves the playhead —
// play, pause, record-arm, waveform scrub, stamp preview, end of track —
// stays in step with no extra wiring.
let videoSyncOn = true;
function setVideoSync(on) {
  videoSyncOn = !!on;
  document.getElementById('dirVidSync')?.classList.toggle('on', videoSyncOn);
}
function syncVideoToTransport() {
  if (!videoSyncOn || offline) return;   // an offline render moves the film itself, frame by frame
  const eng = directorUI.engine;
  const vid = orbFX.video;
  // no track loaded: leave the visuals on their own autoplay loop
  if (!vid || !eng || !eng.buffer) return;
  if (eng.playing && vid.paused) vid.play().catch(() => {});
  else if (!eng.playing && !vid.paused) vid.pause();
  const dur = vid.duration;
  if (!dur || !Number.isFinite(dur)) return;
  const want = eng.time() % dur;          // a short clip loops under a long set
  let drift = Math.abs(vid.currentTime - want);
  drift = Math.min(drift, dur - drift);   // the clip wraps: don't chase the seam
  // Rolling gets a loose tolerance — assigning currentTime mid-playback stalls
  // the decoder, so only a real scrub should move it. Paused tracks tightly.
  if (drift > (eng.playing ? 0.5 : 0.1)) {
    vid.currentTime = want;
    // a paused element pushes no new frames, so the screens would keep
    // showing the pre-scrub image until playback resumed
    if (vid.paused) { wallVideoTex.needsUpdate = true; fasciaVideoTex.needsUpdate = true; }
  }
}

// What the screens show: the live camera when it runs and is sent to the
// screens, else the generated visuals, else the file video.
function screenFeed() {
  if (liveCam?.live && liveCam.screens) return { tex: camTex, fascia: camFasciaTex, live: true };
  if (videoPreset !== 'off') return { tex: vPresets.texture, fascia: vPresets.texture, live: true };
  return { tex: wallVideoTex, fascia: fasciaVideoTex, live: !!(orbFX.video && orbFX.video.readyState >= 2) };
}
function applyVideoRoute() {
  const presetOn = videoPreset !== 'off';
  const feed = screenFeed();
  const live = feed.live;
  const tex = feed.tex;
  const screensOn = live && videoRoute !== 'orbs' && !screensOff;
  showRig.wallMat.map = screensOff ? blackTex : screensOn ? tex : showRig.idleTex;
  showRig.wallMat.needsUpdate = true;
  bstageFX.contentMap = screensOff ? blackTex : screensOn ? tex : stage.bIdleTex;
  fasciaFX.videoTex = screensOn ? feed.fascia : null;
  if (fasciaFX.mode === 'video') fasciaFX.set({});
  // orbs sample the camera pipeline's output, else the generated visuals, else the file video
  orbFX.altSource = liveCam?.live && camPipe ? camPipe.canvases.output
    : presetOn && videoPreset !== 'show' && videoRoute !== 'screens' ? vPresets.canvas : null;
  orbFX.videoEnabled = videoRoute !== 'screens';
  orbFX.set({});   // dirty so orb colours react this frame
  // floor projection: rink in hockey, court in basketball
  const projOn = projFloorOn && live && videoRoute !== 'orbs';
  projIce.material.map = tex;
  projCourt.material.map = tex;
  projIce.material.needsUpdate = projCourt.material.needsUpdate = true;
  projIce.visible = projOn && currentMode === 'hockey';
  projCourt.visible = projOn && currentMode === 'basketball';
  projPitch.material.map = tex; projPitch.material.needsUpdate = true;
  if (stage.sphereMat && sphereLook === 'video') applySphereLook('video');   // the globe follows the route too
  projPitch.visible = projOn && IS_STADIUM && (currentMode === 'football' || currentMode === 'concert');
}
orbFX.video.addEventListener('playing', applyVideoRoute);
orbFX.video.addEventListener('emptied', applyVideoRoute);
document.querySelectorAll('[data-vroute]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    videoRoute = b.dataset.vroute;
    document.querySelectorAll('[data-vroute]').forEach((x) => x.classList.toggle('active', x === b));
    applyVideoRoute();
  });
});

// the screens' own video, kept so a saved show carries it (null: the bundled visuals)
let screenVideoFile = null;
function loadScreenVideo(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (orbFX.video.dataset.blob) URL.revokeObjectURL(orbFX.video.src);
  orbFX.video.dataset.blob = '1';        // replaces the bundled tour visuals
  orbFX.video.src = url;
  orbFX.video.muted = true;
  orbFX.video.loop = true;
  screenVideoFile = file;
  orbFX.video.play().catch(e => console.error("Video play failed", e));
  if (videoPreset === 'show') document.querySelector('[data-vpreset="off"]')?.click();
}
document.getElementById('video-input').addEventListener('change', (e) => loadScreenVideo(e.target.files[0]));

document.querySelectorAll('[data-video]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const video = orbFX.video;
    if (!video) return;
    // driving the film by hand means taking it off the timeline — otherwise
    // the sync loop would re-pause it on the next frame and the button would
    // look broken
    setVideoSync(false);
    const action = b.dataset.video;
    if (action === 'play') video.play().catch(e => console.error("Video play failed", e));
    else if (action === 'pause') video.pause();
    else if (action === 'restart') {
      video.currentTime = 0;
      video.play().catch(e => console.error("Video play failed", e));
    }
  });
});

// --- live camera ----------------------------------------------------------------
// A webcam, or any camera the browser can see, as a live source (livecam.js).
// Every frame goes through the camera pipeline (camfx.js): the adjusted
// picture, hand tracking, the shapes, and the output, which is what the crowd
// actually shows. While the camera runs, that output outranks the file video
// and the generated visuals: it takes the wristbands (orb mode 'video',
// through the chosen aim) and, when asked, the screens. Stopping it hands
// both back.
let camView = null;          // the view the picture is aimed from ('My view')
let camLit = 0;              // wristbands the current mapping lights
let orbModeBeforeCam = null; // what the wristbands were doing before the camera
let camWasLive = false;
let camAimKey = '', camSpreadKey = 0, camRouteKey = '';   // what the last remap and re-route were for
liveCam = initLiveCam({
  controls,
  onChange: applyLiveCam,
  status: () => ({ lit: camLit, onOrbs: orbFX.mode === 'video' && videoRoute !== 'screens', onMark }),
  showOnOrbs: putCamOnOrbs,
  viewFromStage,
  goToMark: () => goToMark(),
  onPickup: () => updateMark(0, true),
});
camPipe = initCamPipeline({ video: liveCam.video, onFrame: onCamFrame });
liveCam.attachPipeline(camPipe);
// the screens get the pipeline's output too; uploaded only when a frame is new
// and the screens are actually showing it
const camTex = new THREE.CanvasTexture(camPipe.canvases.output);
camTex.colorSpace = THREE.SRGBColorSpace;
const camFasciaTex = new THREE.CanvasTexture(camPipe.canvases.output);
camFasciaTex.colorSpace = THREE.SRGBColorSpace;
camFasciaTex.wrapS = THREE.RepeatWrapping;
camFasciaTex.repeat.set(bowl.fascias[0].tiles || 5, 1);   // the ribbons tile it like the show video
function onCamFrame() {
  if (liveCam.live && liveCam.screens) { camTex.needsUpdate = true; camFasciaTex.needsUpdate = true; }
}
// The wristbands read the camera picture in a worker (pixelworker.js). A 2D
// canvas read (getImageData) on the main thread waits until the graphics
// card has finished everything queued, the camera picture and the hand
// shapes; with hand tracking on, that stalled whole frames of the room. Here
// the main thread only takes a snapshot and hands it over; the worker does
// the waiting and the reading, and the colours land a frame or so later.
// Same crop, mirror and size as OrbFX's own read.
const pixelWorker = new Worker(new URL('./pixelworker.js', import.meta.url));
let pixelWait = null, pixelId = 0;
pixelWorker.onmessage = (e) => {
  const w = pixelWait;
  if (!w || e.data.id !== w.id) return;
  pixelWait = null;
  if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data);
};
camPipe.canvases.output._asyncOK = true;
orbFX.asyncRead = async (src) => {
  const w = orbFX.videoCanvas.width, h = orbFX.videoCanvas.height;
  const sw = src.width, sh = src.height;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  const a = orbFX.sourceAspect;
  if (a && sw && sh) {
    if (sw / sh > a) { cw = sh * a; sx = (sw - cw) / 2; } else { ch = sw / a; sy = (sh - ch) / 2; }
  }
  const bitmap = await createImageBitmap(src);   // a snapshot: the canvas moves on
  return new Promise((resolve, reject) => {
    pixelWait = { id: ++pixelId, resolve, reject };
    pixelWorker.postMessage({ id: pixelId, bitmap, w, h, sx, sy, sw: cw, sh: ch, mirror: !!orbFX.sourceMirror }, [bitmap]);
  });
};

// go through the console's own buttons, so its panel never lies about the orbs
const clickFirst = (...sels) => { for (const q of sels) { const b = document.querySelector(q); if (b) { b.click(); return; } } };
function putCamOnOrbs() {
  if (videoRoute === 'screens') clickFirst('[data-vroute="both"]');
  if (orbFX.mode !== 'video') clickFirst('[data-orb="video"]');
}

function applyLiveCam({ reaim = false } = {}) {
  const cam = liveCam;
  if (cam.live && !camWasLive) {
    // the camera takes the wristbands: remember what they were doing
    orbModeBeforeCam = orbFX.mode === 'video' ? null : orbFX.mode;
    orbFX.setSampleSize(256);   // a face needs finer sampling than show video
    camPipe.start();
    putCamOnOrbs();
  } else if (!cam.live && camWasLive) {
    camPipe.stop();
    orbFX.setSampleSize(128);
    camView = null;
    // hand the wristbands back, unless a cue already moved them on
    if (orbModeBeforeCam && orbFX.mode === 'video') {
      clickFirst(`[data-orb="${orbModeBeforeCam}"]`, `[data-ofx="${orbModeBeforeCam}"]`);
    }
    orbModeBeforeCam = null;
  }
  camWasLive = cam.live;
  if (cam.live && reaim) camView = snapshotView();
  // the pipeline already mirrored the picture, so nothing flips it again here
  camPipe.cfg.mirror = cam.mirror;
  orbFX.set({
    sourceMirror: false,
    sourceContrast: cam.live ? cam.contrast : 1,
    sourceGain: cam.live ? cam.glow : 1,
  });
  // Re-mapping every seat and re-routing the screens is real work (the stadium
  // has 76k seats), so Glow and Contrast never trigger it. A new aim remaps at
  // once; a dragged Spread slider remaps at most once a frame.
  const aimKey = cam.live ? cam.aim : 'off';
  const spreadKey = cam.live && cam.aim === 'stage' ? cam.spread : 0;
  if (reaim || aimKey !== camAimKey) { camAimKey = aimKey; camSpreadKey = spreadKey; remapVideo(); }
  else if (spreadKey !== camSpreadKey) { camSpreadKey = spreadKey; requestRemap(); }
  const routeKey = `${cam.live}:${cam.screens}`;
  if (routeKey !== camRouteKey) { camRouteKey = routeKey; applyVideoRoute(); }
}

// the camera exactly as it stands now: position, direction, lens and shape
function snapshotView() {
  const c = camera.clone();
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}
const shownInScene = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

// Which pixel every wristband takes. Top-down is the classic pixel map over
// the plan of the venue (the file video and the generated visuals always use
// it). 'My view' is the live camera's: see mapFromView.
function remapVideo() {
  const aim = liveCam?.live ? liveCam.aim : 'plan';
  if (aim === 'view') {
    if (!camView) camView = snapshotView();
    camLit = mapFromView(camView);
  } else if (SECTION_AIMS.has(aim)) {
    camLit = mapToSections(aim, liveCam.spread);
    orbFX.set({ sourceAspect: null });   // the whole frame, warped onto the stands
  } else {
    generateVideoMap(orbFX, birdCam);
    // the camera image is cropped to the plan's shape, never squashed into it
    orbFX.set({ sourceAspect: liveCam?.live ? SPEC.bird.hw / SPEC.bird.hh : null });
    camLit = orbFX.groups.reduce((n, g) => n + (shownInScene(g.mesh) ? g.n : 0), 0);
  }
  orbFX.set({});
}

// Aim the video from a viewpoint: every seat is projected through that camera,
// and the picture is stretched over the box the visible crowd fills from
// there, so the wristbands read as one flat image from that spot. Seats out of
// view stay dark (-1). Blocks that are hidden right now (the concert floor in
// hockey) are still mapped, but do not shape the box.
function mapFromView(cam) {
  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const ndc = orbFX.groups.map((g) => {
    const shown = shownInScene(g.mesh);
    const a = new Float32Array(g.n * 2).fill(NaN);
    for (let i = 0; i < g.n; i++) {
      v.fromArray(g.pos, i * 3).project(cam);
      if (v.z <= -1 || v.z >= 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      a[i * 2] = v.x;
      a[i * 2 + 1] = v.y;
      if (shown) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      }
    }
    return a;
  });
  const w = maxX - minX, h = maxY - minY;
  const ok = w > 1e-3 && h > 1e-3;
  let lit = 0;
  orbFX.groups.forEach((g, gi) => {
    const a = ndc[gi];
    const map = new Float32Array(g.n * 2);
    const shown = shownInScene(g.mesh);
    for (let i = 0; i < g.n; i++) {
      const x = a[i * 2];
      if (!ok || Number.isNaN(x)) { map[i * 2] = -1; map[i * 2 + 1] = -1; continue; }
      map[i * 2] = (x - minX) / w;
      map[i * 2 + 1] = (a[i * 2 + 1] - minY) / h;
      if (shown) lit++;
    }
    g.videoMap = map;
  });
  // crop the frame to the box's on-screen shape
  orbFX.set({ sourceAspect: ok ? (w / h) * cam.aspect : cam.aspect });
  return lit;
}

// several things can ask for a remap in one frame (a builder click culls
// seats, then switches mode); do the work once, on the next frame
let remapQueued = false;
function requestRemap() {
  if (remapQueued) return;
  remapQueued = true;
  requestAnimationFrame(() => { remapQueued = false; remapVideo(); });
}

// The performer's mark: downstage centre of a far stage, where the Downstage
// camera preset stands, or the middle of the floor for a stage in the round.
// Sport and empty floors use the spot the default stage would take.
function stagePoint() {
  if (stageCfg.position === 'middle') return { x: 0, z: 0 };
  return { x: deriveStage(stageCfg).frontX - 1.5, z: 0 };
}

// Which side of the bowl a seat is on: the way the rounded rectangle faces at
// that point. On the straights that is exact; the corners split diagonally.
// North is -z, the top of the bird view; the default stage stands at the west.
const SIDE = { N: 0, E: 1, S: 2, W: 3 };
const CORE_A = BOWL_A - BOWL_R, CORE_B = BOWL_B - BOWL_R;
function sideOf(x, z) {
  const dx = x - Math.max(-CORE_A, Math.min(CORE_A, x));
  const dz = z - Math.max(-CORE_B, Math.min(CORE_B, z));
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? SIDE.E : SIDE.W;
  return dz >= 0 ? SIDE.S : SIDE.N;
}

// Every bowl seat's section, as tier * 1000 + span. The bowl never changes, so
// this is worked out once, the first time an aim needs it.
let seatSectionCache = null;
function seatSections() {
  const g = orbFX.groups[0];
  if (seatSectionCache && seatSectionCache.length === g.n) return seatSectionCache;
  const out = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const sec = sectionAt(g.pos[i * 3], g.pos[i * 3 + 2]);
    out[i] = sec ? sec.tier * 1000 + sec.span : -1;
  }
  return (seatSectionCache = out);
}
// The sections out front: whole sections only, so the edge of the picture
// lands on an aisle. A section counts when its middle is at least 1.5 m in
// front of the deck's front edge; the ones alongside the deck, the corners
// behind it and the end behind it are out. A stage in the round has nothing
// behind it, so every section counts. Rebuilt when the stage changes.
let frontCache = { key: '', set: null };
function frontSections() {
  const key = JSON.stringify(stageCfg);
  if (frontCache.key === key) return frontCache.set;
  const set = new Set();
  const round = stageCfg.position === 'middle';
  const cut = deriveStage(stageCfg).frontX + 1.5;
  SPEC.bowl.tiers.forEach((t, ti) => {
    const n = t.sections || SPEC.bowl.aisles;
    for (let j = 0; j < n; j++) {
      const [a, b] = spanBaseU(n, j);
      if (round || basePointAt((a + b) / 2).x >= cut) set.add(ti * 1000 + j);
    }
  });
  frontCache = { key, set };
  return set;
}

// Lay the picture over the seating sections. Across: where the seat sits
// round the bowl, measured one of five ways (below). Up: fitted to the stands,
// so the bottom of the picture is on the front row of the 100s and the top on
// the back row of the 400s wherever you look (fitHeights). The floor blocks
// stay dark, and so do seats under a tarp or behind the curtain, so the
// picture fits whatever part of the house is actually open.
function mapToSections(aim, spreadDeg = 240) {
  for (let gi = 1; gi < orbFX.groups.length; gi++) {
    const fg = orbFX.groups[gi];
    fg.videoMap = new Float32Array(fg.n * 2).fill(-1);
  }
  const g = orbFX.groups[0];                      // the seating bowl
  const n = g.n, pos = g.pos;
  const im = g.mesh.instanceMatrix.array;         // bowlCull zero-scales hidden seats
  const P = stagePoint();
  const half = THREE.MathUtils.degToRad(spreadDeg) / 2;
  const across = new Float32Array(n).fill(NaN);   // NaN = not part of this aim
  const seg = new Uint8Array(n);                  // which copy of the picture a seat shows
  const secOf = aim === 'front' ? seatSections() : null;
  const front = aim === 'front' ? frontSections() : null;
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    if (im[o] === 0 && im[o + 5] === 0 && im[o + 10] === 0) continue;
    const x = pos[i * 3], z = pos[i * 3 + 2];
    if (aim === 'stage') {
      // the angle from the performer's mark: 0 straight out, + to their right
      const th = Math.atan2(z - P.z, x - P.x);
      if (Math.abs(th) <= half) across[i] = (th + half) / (2 * half);
    } else if (aim === 'round') {
      // round the middle of the floor: centred on the far end, seam behind the stage
      across[i] = (Math.atan2(z, x) + Math.PI) / (2 * Math.PI);
    } else if (aim === 'farend') {
      if (sideOf(x, z) === SIDE.E) across[i] = Math.atan2(z - P.z, x - P.x);
    } else if (aim === 'front') {
      // every section out front, measured as the angle from the performer's mark
      if (front.has(secOf[i])) across[i] = Math.atan2(z - P.z, x - P.x);
    } else {
      // each side: left to right as you face that side from the floor
      const sd = sideOf(x, z);
      seg[i] = sd;
      across[i] = sd === SIDE.N ? x : sd === SIDE.S ? -x : sd === SIDE.E ? z : -z;
    }
  }
  // out front, the far end and each side span the full width of their own stands
  if (aim === 'front' || aim === 'farend' || aim === 'sides') {
    const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const a = across[i];
      if (a !== a) continue;
      if (a < lo[seg[i]]) lo[seg[i]] = a;
      if (a > hi[seg[i]]) hi[seg[i]] = a;
    }
    for (let i = 0; i < n; i++) {
      const a = across[i];
      if (a !== a) continue;
      const sd = seg[i];
      across[i] = hi[sd] > lo[sd] ? (a - lo[sd]) / (hi[sd] - lo[sd]) : 0.5;
    }
  }
  const up = fitHeights(across, seg, pos, aim === 'sides' ? 4 : 1);
  const map = new Float32Array(n * 2);
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const a = across[i];
    if (a === a) { map[i * 2] = a; map[i * 2 + 1] = up[i]; lit++; }
    else { map[i * 2] = -1; map[i * 2 + 1] = -1; }
  }
  g.videoMap = map;
  return shownInScene(g.mesh) ? lit : 0;
}

// Each seat's rank by height among its neighbours across the picture: 0 on
// the front row of the 100s, 1 on the back row of the 400s. Ranking instead of
// measuring does two things. The picture's full height lands on every stretch
// of stand, even where the stadium's upper deck swoops down behind the goals.
// And the suite levels, metres of height with no seats in them, take no share
// of the picture, so nothing is lost in the gaps between tiers.
function fitHeights(across, seg, pos, nSeg) {
  const B = 96, W = 2;                            // bins per copy, neighbours either side
  const n = across.length;
  const out = new Float32Array(n);
  const bins = Array.from({ length: nSeg * B }, () => []);
  for (let i = 0; i < n; i++) {
    const a = across[i];
    if (a !== a) continue;
    bins[seg[i] * B + Math.min(B - 1, Math.max(0, (a * B) | 0))].push(i);
  }
  for (let sd = 0; sd < nSeg; sd++) {
    for (let b = 0; b < B; b++) {
      const own = bins[sd * B + b];
      if (!own.length) continue;
      const k0 = Math.max(0, b - W), k1 = Math.min(B - 1, b + W);
      let count = 0;
      for (let k = k0; k <= k1; k++) count += bins[sd * B + k].length;
      const ys = new Float32Array(count);
      let c = 0;
      for (let k = k0; k <= k1; k++) for (const i of bins[sd * B + k]) ys[c++] = pos[i * 3 + 1];
      ys.sort();
      const top = Math.max(1, count - 1);
      for (const i of own) {
        const y = Math.fround(pos[i * 3 + 1]);
        let lo = 0, hi = count;                   // first height >= y
        while (lo < hi) { const m = (lo + hi) >> 1; if (ys[m] < y) lo = m + 1; else hi = m; }
        let lo2 = lo, hi2 = count;                // first height > y
        while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (ys[m] <= y) lo2 = m + 1; else hi2 = m; }
        out[i] = Math.min(1, ((lo + lo2 - 1) / 2) / top);   // middle of this row's share
      }
    }
  }
  return out;
}

// Stand on the performer's mark, facing the house, to see a stage aim the way
// it was built to be seen. On a deck the view holds its height, like the
// Downstage preset; on a bare floor you simply stand there.
function viewFromStage() {
  const P = stagePoint();
  const top = groundHeightAt(P.x, P.z, 60);
  if (!isFinite(top)) { spawnAtStage(); return; }   // inside something solid (the globe)
  camera.position.set(P.x, top + EYE, P.z);
  camera.lookAt(P.x + 40, top + EYE + 7, P.z);
  flying = top > 0.3; velY = 0; grounded = !flying; bobPhase = 0;
  angleHud.classList.remove('show');
}

// --- hands and feeds -------------------------------------------------------------
// HANDS: tracking and the shapes it draws (hands.js). FEEDS: every picture in
// the system on one wall, each one able to pop out into its own window.
const handsUI = initHandsPanel({ pipe: camPipe, camera: liveCam, controls, goToMark: () => goToMark() });
const showVideoSource = () => (videoPreset !== 'off' ? vPresets.canvas
  : orbFX.video && orbFX.video.readyState >= 2 ? orbFX.video : null);
const fromPipe = { stamp: () => camPipe.frame, box: () => camPipe.cfg.box };
// the camera's feeds show nothing while it has nobody to pick up (off the X)
const camSees = () => liveCam.live && camPipe.cfg.pickup;
const camIdle = () => (!liveCam.live ? 'Camera off' : 'Off the X · the camera sees nobody');
const feedsUI = initFeeds({
  feeds: [
    // the camera's pictures show the output box in green; the output is what is inside it
    { id: 'camera', name: 'Camera', source: () => (camSees() ? camPipe.canvases.camera : null), idle: camIdle, ...fromPipe },
    { id: 'tracking', name: 'Hand tracking', source: () => (camSees() ? camPipe.canvases.tracking : null), idle: camIdle, ...fromPipe, want: () => camPipe.want('tracking') },
    { id: 'shapes', name: 'Shapes', source: () => (camSees() && camPipe.tracker.enabled ? camPipe.canvases.shapes : null), idle: () => (camSees() ? 'Hand tracking off' : camIdle()), ...fromPipe },
    { id: 'output', name: 'To the wristbands', source: () => (camSees() ? camPipe.canvases.output : null), idle: camIdle, stamp: fromPipe.stamp },
    { id: 'show', name: 'Show video', source: showVideoSource, idle: 'No show video playing' },
    { id: 'crowd', name: 'Wristbands from above', idle: '' },
  ],
  crowd: () => ({
    groups: orbFX.groups, hw: SPEC.bird.hw, hh: SPEC.bird.hh,
    visible: (g) => shownInScene(g.mesh),
    level: orbFX.brightness * Math.max(1, orbFX.sourceGain || 1),
  }),
});
feedsUI.restore();

// SHOW: pick sections of the crowd on a map from above and give each its own
// look (showdesigner.js). OrbFX's 'design' mode hands the painting to its engine.
const showEngine = initShowEngine({ orbFX });
orbFX.painter = showEngine.paint;
// IR moving heads round the rim (and under the halo board in the arena). They
// send the wash's command down their beams, so only the bands inside one catch
// it (irheads.js); the engine hands them the bands of an 'ir' zone.
const irHeads = initIRHeads({ scene, jumboY: () => jumboMesh.position.y, tempo: () => showEngine.tempo });
showEngine.ir = irHeads;
mirrorSkip.push(irHeads.group);
const showUI = initShowDesigner({
  engine: showEngine, orbFX, controls,
  visible: (g) => shownInScene(g.mesh),
  stageAt: () => ({ ...stagePoint(), concert: currentMode === 'concert' }),
  onLive: () => liveCam?.refresh?.(),
});

// --- the camera's X on stage ---------------------------------------------------------
// Simulates a camera aimed at one spot: an X taped on the deck at the
// performer's mark, with the camera on a tripod out front (stagemark.js).
// With "Picks you up: Only on the X" (the camera window, the default), the
// camera only sees you, and hand tracking only works, while you stand within
// MARK_RADIUS of the X, on the deck. Step off and everything it sends goes
// dark; step back on and it picks you up again at once.
const stageMark = buildStageMark(scene);
const markAt = { x: 0, y: 0, z: 0 };
let markFor = { cfg: null, mode: '', at: -1e9 };
let markShown = { mode: '', live: false, on: false };
function placeMark() {
  const P = stagePoint();
  const top = groundHeightAt(P.x, P.z, 60);   // the deck's surface at the mark
  markAt.x = P.x; markAt.z = P.z; markAt.y = isFinite(top) ? top : 0;
  // the camera stands out toward the house, a little to one side so it is
  // clear of a catwalk, on whatever is there
  const camX = P.x + 5, camZ = P.z + 2.5;
  const base = groundHeightAt(camX, camZ, markAt.y + 0.3);
  stageMark.place({ x: markAt.x, y: markAt.y, z: markAt.z, camX, camZ, camBaseY: isFinite(base) ? base : markAt.y });
}
function updateMark(t, force = false) {
  const mode = liveCam.pickup;
  const markMode = mode === 'mark';
  // Quick Showcase has no camera: no X, no tripod on stage
  stageMark.group.visible = markMode && !document.body.classList.contains('mode-quick');
  // the stage can change under the mark (creative mode, a new deck): re-place
  // it when it does, and look again every couple of seconds for anything else
  const now = performance.now();
  if (markMode && (markFor.cfg !== stageCfg || markFor.mode !== currentMode || now - markFor.at > 2000)) {
    markFor = { cfg: stageCfg, mode: currentMode, at: now };
    placeMark();
  }
  // on the X: feet on the deck, within the circle (a little more to step off,
  // so standing on the line does not flicker)
  const p = camera.position;
  const d = Math.hypot(p.x - markAt.x, p.z - markAt.z);
  const onDeck = Math.abs(p.y - EYE - markAt.y) < 0.6;
  const inside = markMode && onDeck && d <= MARK_RADIUS + (onMark ? 0.2 : 0);
  camPipe.cfg.pickup = !markMode || inside;
  if (force || inside !== markShown.on || mode !== markShown.mode || liveCam.live !== markShown.live) {
    onMark = inside;
    markShown = { mode, live: liveCam.live, on: inside };
    stageMark.setState({ live: liveCam.live, onMark: inside });
    markHud.classList.toggle('show', markMode && liveCam.live && !document.body.classList.contains('mode-quick'));
    markHud.classList.toggle('on', inside);
    markHud.textContent = inside ? 'ON THE X · PICKING UP' : 'OFF THE X · NOT PICKING UP';
    liveCam.refresh();
    handsUI.refresh();
  }
  if (markMode) stageMark.tick(t);
}
// stand on the X, facing the house, the way the stage view does
function goToMark() {
  placeMark();
  viewFromStage();
}
// the pill at the top of the room that says whether the camera has you
const markHud = document.createElement('div');
markHud.id = 'markHud';
document.body.appendChild(markHud);

const seatTint = new THREE.Color();
let seatHex = null;   // last colour chosen in the venue picker, null = as built
// The bowl shells and the concert floor chairs are one house: same base
// colour, same per-seat variation, tinted in a single pass. Hoisted so the
// stage rebuild can re-apply it to freshly-built chairs.
function applySeatColor(hex) {
  seatHex = hex;
  const base = new THREE.Color(hex);
  for (const mesh of [bowl.seats, concertSeats.chairs]) {
    if (!mesh || !mesh.instanceColor) continue;
    for (let i = 0; i < mesh.count; i++) {
      seatTint.copy(base).multiplyScalar(0.8 + ((i * 7) % 4) * 0.08);
      mesh.setColorAt(i, seatTint);
    }
    mesh.instanceColor.needsUpdate = true;
  }
}
const consoleUI = initConsole({
  orbFX, fasciaFX, crowdFX, jumbo: scoreboard,
  lights: { set(key, v) { lightCfg[key] = v; applyState(false); } },
  rigFX,
  bstageFX,
  sphere: { set: applySphereLook },
  venue: {
    setSeatColor: applySeatColor,
    toggleBanners() { ceiling.banners.visible = !ceiling.banners.visible; return ceiling.banners.visible; },
    toggleJumbo() { jumboMesh.visible = !jumboMesh.visible; return jumboMesh.visible; },
  },
  controls,
});
// Show Control moves by its title bar like the other windows
makeMovable(document.getElementById('console'), { handle: '#conHead', key: 'console' });
// an open-air bowl sounds like one: the stadium boots with its own acoustic preset
if (SPEC.soundPreset) document.querySelector(`[data-sndp="${SPEC.soundPreset}"]`)?.click();
// a ring rig groups by ring, not by truss number: relabel the console chips
if (showRig.plan && showRig.plan.ring) {
  const names = { lx1: 'Outer + mid rings', lx2: 'Inner ↓ globe', lx3: 'Inner ↑ sky', floor: 'Deck edge' };
  for (const [k, n] of Object.entries(names)) { const b = document.querySelector(`[data-grp="${k}"]`); if (b) b.textContent = n; }
}
// no centre-hung scoreboard in an open-roof stadium: hide it and hide its
// console section. Hidden, not removed — the winch and colour listeners bound
// later in this file still need their elements to exist.
if (IS_STADIUM) {
  jumboMesh.visible = false;
  const sec = document.getElementById('jumboVisBtn')?.closest('section.grp');
  if (sec) sec.style.display = 'none';
  // a 600-head ring rig needs more cones drawn to read as lit all the way round
  const rb = document.getElementById('rigBeams'); if (rb) rb.value = String(rigFX.beamBudget);
  const lp = document.getElementById('laserPer'); if (lp) lp.value = String(rigFX.laserPer);
} else {
  // fireworks are the open-air stadium's: under a roof the section and its tiles go
  // (the sphere deck is gated on SPEC.sphere just below, not on the venue)
  const sec = document.getElementById('fireFireworks')?.closest('section.grp');
  if (sec) sec.style.display = 'none';
  document.querySelectorAll('[data-preset="fx:fireworks"], [data-preset="fx:fwshow"], [data-preset="fx:fwfinale"]').forEach((t) => { t.style.display = 'none'; });
}
// the giant sphere is a stadium stage option, so its skin deck only means
// something in a room that has one
if (!SPEC.sphere) { const sd = document.getElementById('sphereDeck'); if (sd) sd.style.display = 'none'; }
// --- the giant sphere's skin ------------------------------------------------------
// Earth / Moon / Mars / Sun wear their own maps; 'video' wears whatever the
// screens are routing; 'rig' is a solid that follows colour A. The halo above
// the sphere always shows the routed content (it shares the wall material).
let sphereLook = 'earth';
let sphereSpin = 0;
function sphereVideoMap() {
  const feed = screenFeed();
  return feed.live ? feed.tex : showRig.idleTex;
}
function applySphereLook(key) {
  if (!SPHERE_LOOKS[key]) key = 'earth';
  sphereLook = key;
  document.querySelectorAll('[data-preset^="sphere:"]').forEach((b) => b.classList.toggle('on', b.dataset.preset === 'sphere:' + key));
  if (!stage.sphereMat) return;
  const L = SPHERE_LOOKS[key], mat = stage.sphereMat;
  if (L.pattern) {                       // shader skin
    stage.sphere.material = stage.patternMat;
    stage.patternMat.uniforms.uMode.value = L.pattern;
  } else {                               // map skin
    stage.sphere.material = mat;
    if (L.tex) { mat.map = L.tex(); mat.color.setScalar(L.tint); }
    else if (key === 'video') { mat.map = sphereVideoMap(); mat.color.setScalar(L.tint); }
    else if (key === 'rig') { mat.map = null; mat.color.copy(rigFX.colorA).multiplyScalar(1.4); }
    else { mat.map = null; mat.color.setScalar(0); }
    mat.needsUpdate = true;
  }
  sphereSpin = L.spin || 0;
  stage.atmo.visible = !!L.glow;
  if (L.glow) { stage.atmoMat.uniforms.uColor.value.setHex(L.glow); stage.atmoMat.uniforms.uGain.value = L.glowK ?? 1; }
}
// after a stage (re)build: the halo takes the wall material, the globe its look
function hookSphereStage() {
  if (stage.halo) stage.halo.material = showRig.wallMat;
  applySphereLook(sphereLook);
}
hookSphereStage();

// --- stage layout switching -------------------------------------------------
// The layout is part of the project (chosen in the menu). Switching rebuilds
// the stage and the concert floor, then rebinds every system that held
// references into them: screen FX, orb engine, crowd sprites, bird view.
function disposeDeep(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mt of mats) mt.dispose?.();
  });
}

// Tarps apply to every configuration (rings work in hockey/basketball too);
// the behind-stage set only means anything with a far stage.
let curtainCut = null;
let coverCfg = { behind: 'none', rings: [] };
// The C-stage deck stands on legs over the seats it occupies, so those seats
// come OUT. It passes its own footprint test rather than a position plus a
// radius, so exactly the 10 seats under the slab go and nothing else, and the
// mask can never drift from the geometry. No tarp: the deck is the cover.
// Gated on concert mode: stageCfg keeps its C-stage when creative mode swaps
// to a sport, and the seats under it must come back with the deck gone.
const covArgs = () => ({
  ...coverCfg,
  cstage: currentMode === 'concert' && stageCfg?.cstage ? { ...CSTAGE_POS, inside: (x, z) => cstageLocal(x, z, CSTAGE_MASK_PAD.x, CSTAGE_MASK_PAD.z), tarp: false } : null,
});
function applyCovers({ behind = 'none', rings = [] } = {}) {
  coverCfg = { behind, rings };
  coversOn = bowl.setCovers(covArgs());
  bowlCull();
  applyState(false);
}

// Bowl seats, wristbands and crowd figures behind the room curtain OR under a
// tarp are truly culled (zero-scaled), not just occluded — so nothing glows
// through, the bird view matches, and effects stop computing as if those
// seats were sold.
function bowlCull() {
  const cut = curtainOn ? curtainCut : null;
  // NOT gated on coversOn: that flag says whether any tarp GEOMETRY got built,
  // which is false whenever `behind` is none and no ring is tarped — and the
  // C-stage asks for a seat mask with no tarp at all (the deck is its own
  // cover). Gating on it meant the seats under the deck were culled only while
  // some unrelated tarp happened to be up, and stood back up the moment the
  // tarps were set to none: the back row's shells poke 10 cm above the slab, so
  // the one at the deck's edge read as a random single seat in the platform.
  // coverMask already returns null when there is genuinely nothing to mask.
  const mask = currentMode !== 'creative' ? bowl.coverMask(covArgs()) : null;
  const targets = [bowl.seats, bowl.orbs, crowdFX.meshes[0]].filter(Boolean);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const mesh of targets) {
    if (!mesh.userData._savedIM) {
      mesh.userData._savedIM = mesh.instanceMatrix.array.slice();
    }
    const saved = mesh.userData._savedIM;
    const arr = mesh.instanceMatrix.array;
    const masked = mask && mesh.count === mask.length;
    for (let i = 0; i < mesh.count; i++) {
      const o = i * 16;
      const x = saved[o + 12];                 // instance world x from the saved matrix
      if ((cut !== null && x < cut + 0.3) || (masked && mask[i])) {
        zero.toArray(arr, o);
      } else {
        for (let k = 0; k < 16; k++) arr[o + k] = saved[o + k];
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  // the camera's section aims fit the open seats only: re-fit to the new house
  if (liveCam?.live && SECTION_AIMS.has(liveCam.aim)) requestRemap();
}
function applyCurtain(cutX = null) {
  curtainCut = cutX;
  curtainOn = bowl.setCurtain(cutX);
  bowlCull();
  applyState(false);
}

// The touring rig loads in against the deck. The whole package (trusses,
// screens, PA, heads, beams, lasers, confetti, stage keys) maps deck-local:
// x' = pos + x*s, where the reference deck spans [-33, -20]. Curtained rooms
// host the same-size deck, so s stays 1 and the rig just slides east; a
// 'large' deck stretches the rig to fit; the middle stage centres the truss
// package over the round deck and swaps the wall for a hung centre screen.
const RIG_REF_BACK = -33, RIG_REF_DEPTH = 13.0;
function applyRigXform(pos, s) {
  for (const g of [showRig.group, rigFX.group]) {
    g.position.x = pos;
    g.scale.x = s;
  }
  rigFX.offsetX = pos;
  rigFX.scaleX = s;
}

function applyRigTransform() {
  const cfg = stageCfg;
  let s = 1, pos = 0;
  // A CUSTOM RIG PLAN is authored in absolute world metres against the room it
  // was designed for. The config-driven shift/x-stretch below exists to slide
  // the DEFAULT rig onto whatever deck the wizard built — applying it to a
  // plan drags the user's trusses off their marks and overlaps the stage.
  // So a plan is placed exactly where it was drawn, and only the screen
  // selection below still runs.
  if (rigPlan) {
    for (const g of [showRig.group, rigFX.group]) { g.position.x = 0; g.scale.x = 1; }
    rigFX.offsetX = 0;
    rigFX.scaleX = 1;
  } else if (cfg.position === 'middle') {
    pos = 24.4;              // LX2 (local -24.4) lands on the world centre
    applyRigXform(pos, s);
  } else {
    const d = deriveStage(cfg);
    const cut = CURTAIN_CUT[cfg.curtains];
    const back = cut != null ? cut + 0.25 : SPEC.stageBack;   // the default rig slides onto this room's deck
    s = THREE.MathUtils.clamp((d.frontX - back) / RIG_REF_DEPTH, 0.55, 1.6);
    pos = back - RIG_REF_BACK * s;
    applyRigXform(pos, s);
  }
  // the sphere stage flies the whole touring rig above its halo (the trusses
  // would otherwise sit inside the globe) and brings its own screen
  const isSphere = cfg.position === 'middle' && cfg.middleShape === 'sphere';
  const sphereStage = isSphere && !rigPlan;
  const lift = sphereStage ? SPEC.sphere.rigLift : 0;
  for (const g of [showRig.group, rigFX.group]) g.position.y = lift;
  rigFX.offsetY = lift;
  // pick the live screen for this config
  const middle = cfg.position === 'middle';
  const want = middle
    ? (cfg.screen === 'circle' ? 'mcircle' : cfg.screen === 'heart' ? 'mheart' : 'cyl')
    : (cfg.screen === 'circle' ? 'fcircle' : cfg.screen === 'heart' ? 'fheart' : 'wall');
  // the globe's halo is the sphere stage's screen whatever rig it flies: the
  // drum that hangs over an ordinary middle stage would sit beside the dome
  for (const [k, grp] of Object.entries(showRig.screens)) grp.visible = k === want && !isSphere;
  // hanging props stay ahead of the stage, rig and curtain in every room size
  const propFront = cfg.position === 'middle' ? 10 : deriveStage(cfg).frontX + 3;
  propsFX.setRegion(Math.min(propFront, 28), 40);
  // deck key rides the rig; the B special tracks the actual B-stage centre
  stageKeys[0].light.position.x = pos + stageKeys[0].baseX * s;
  stageKeys[0].light.target.position.x = pos + stageKeys[0].baseTX * s;
  const bc = stage.bCenter;
  if (bc) {
    if (sphereStage) {
      // the reference shot: one hard white beam straight down onto the top of the globe
      const top = CAT_H + SPEC.sphere.sink + SPEC.sphere.R;
      stageKeys[1].light.position.set(bc.x, top + 22, bc.z);
      stageKeys[1].light.target.position.set(bc.x, top, bc.z);
    } else {
      stageKeys[1].light.position.set(bc.x, 21, bc.z);
      stageKeys[1].light.target.position.copy(bc);
    }
  }
}
// place the default rig on THIS room's deck now: setStageConfig skips its
// rebuild when the wizard hands back the boot config, so nothing else would
applyRigTransform();

// Rebuild the stage + concert floor for a new config, then rebind every
// system that held references into them: screen FX, orb engine, crowd
// sprites, bird view, mirror pass.
function setStageConfig(next) {
  const cfg = normalizeStageCfg(next);
  if (JSON.stringify(cfg) === JSON.stringify(stageCfg)) return;
  stageCfg = cfg;

  scene.remove(stage.group);
  disposeDeep(stage.group);
  scene.remove(concertSeats.group);
  disposeDeep(concertSeats.group);
  // mirrorSkip must not accumulate dead references across rebuilds — the
  // mirror pass walks it every reflection frame and the GC can't collect them
  for (const dead of [concertSeats.group, ...crowdFX.meshes.slice(3)]) {
    const ix = mirrorSkip.indexOf(dead);
    if (ix !== -1) mirrorSkip.splice(ix, 1);
  }

  stage = buildStage(scene, cfg);
  concertSeats = buildConcertSeating(scene, cfg);

  bstageFX.rebind(stage);
  hookSphereStage();
  // the new chairs are built in house crimson — re-tint if the picker moved
  if (seatHex) applySeatColor(seatHex);
  applyVideoRoute();   // rebind resets contentMap to the fresh stage's idle
  orbFX.setGroup(3, { mesh: concertSeats.orbs, pos: concertSeats.orbPos });
  // top-down at once; the live camera's aim re-fits on the next frame, once
  if (liveCam?.live) requestRemap(); else remapVideo();

  concertSeats.orbs.layers.enable(2);
  orbMeshes[3] = concertSeats.orbs;

  // fresh crowd sprites, one block per floor zone (seated / standing GA)
  crowdFX.meshes.length = 3;   // keep bowl / courtside / floorSeats
  const blocks = buildCrowd(scene, concertSeats.crowdBlocks.map((b) => ({
    pos: b.pos, drop: b.drop, parent: concertSeats.group,
  })));
  for (const mmesh of blocks.meshes) {
    mmesh.layers.set(3);
    crowdFX.meshes.push(mmesh);
    mirrorSkip.push(mmesh);
  }
  crowdFX.set({});   // re-sync visibility + orb lift onto the new meshes

  mirrorSkip.push(concertSeats.group);
  // the C-stage brings its own 4x4 tarp — rebuild covers + cull for the new cfg
  coversOn = bowl.setCovers(covArgs());
  bowlCull();
  applyRigTransform();
  foh.group.visible = currentMode === 'concert' && !['theatre', 'hemicycle'].includes(stageCfg.curtains);
  applyState(false);
}
// legacy entry point for old saved projects that stored a layout string
const setStageLayout = (l) => setStageConfig(l);

const directorUI = initDirector({ controls, audio: audioFX });
// --- followspot ---------------------------------------------------------------
// A strong operator spot perched at the top of the east bowl. Press G to enter
// aim mode: the next click raycasts into the room and the beam swings to
// whatever it hit — seats, deck, catwalk, a person-height point on the floor.
const followSpot = {
  on: false,
  aim: false,
  light: new THREE.SpotLight(0xfff3d8, 42000, 0, 0.062, 0.35, 2),
  target: new THREE.Vector3(-20, 2.5, 0),   // what the operator aimed at
  cur: new THREE.Vector3(-20, 2.5, 0),
  end: new THREE.Vector3(-20, 2.5, 0),      // the beam's final backstop —
  curEnd: new THREE.Vector3(-20, 2.5, 0),   // light that misses keeps going
};
followSpot.light.position.set(SPEC.followSpot.x, SPEC.followSpot.y, 0);
followSpot.light.visible = false;
scene.add(followSpot.light, followSpot.light.target);
const fsConeGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
fsConeGeo.translate(0, -0.5, 0);   // apex at the origin, extends down local -y
const fsCone = new THREE.Mesh(fsConeGeo, new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uBlock: { value: 1.0 } },   // fraction of the throw where the aim hit sits
  vertexShader: /* glsl */`
    varying float vAlong; varying vec3 vN; varying vec3 vV;
    void main() {
      vAlong = -position.y;                    // 0 at the lens, 1 at the backstop
      vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uBlock;
    varying float vAlong; varying vec3 vN; varying vec3 vV;
    void main() {
      // bright core through the cone's middle, feathered silhouette edges,
      // intensity easing off along the throw the way haze really reads
      float edge = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.4);
      float along = (0.9 - 0.45 * vAlong) * smoothstep(0.0, 0.06, vAlong);
      // projector behaviour: rays that hit the aimed object stop there, the
      // rest of the cone carries on dimmer to the real backstop
      float spill = mix(1.0, 0.32, smoothstep(uBlock - 0.015, uBlock + 0.05, vAlong));
      // light has no end-cap: alpha reaches exactly zero before the rim, so
      // the geometric cone opening can never read as a circle — the landing
      // pool on the surface is what carries the hit
      float tip = 1.0 - smoothstep(0.72, 0.97, vAlong);
      gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * edge * along * spill * tip * 0.6, 1.0);
    }`,
}));
fsCone.visible = false;
fsCone.userData.noAim = true;
scene.add(fsCone);
// the landing pool: a hot soft ellipse where the beam meets the surface
const fsPoolMat = (r, g, b) => new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  uniforms: { uTint: { value: new THREE.Color(r, g, b) } },
  vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform vec3 uTint;
    varying vec2 vU;
    void main() {
      float d = length(vU - 0.5) * 2.0;
      float a = pow(max(1.0 - d, 0.0), 1.8);
      gl_FragColor = vec4(uTint * a, 1.0);
    }`,
});
const fsPool = new THREE.Mesh(new THREE.CircleGeometry(1, 28), fsPoolMat(2.1, 2.0, 1.7));
const fsPool2 = new THREE.Mesh(new THREE.CircleGeometry(1, 28), fsPoolMat(0.7, 0.66, 0.55));
for (const pl of [fsPool, fsPool2]) {
  pl.visible = false;
  pl.userData.noAim = true;
  scene.add(pl);
}
const fsHint = document.getElementById('fsHint');
// the physical followspot: base plate, post, and a barrel that tracks the beam
const fsRig = new THREE.Group();
fsRig.position.copy(followSpot.light.position);
{
  // MeshBasic: house lights never reach the ceiling zone, so lit materials
  // vanish up there and the perch reads as a floating dot. Flat dark greys
  // keep the silhouette legible from the floor in every lighting state.
  const steel = new THREE.MeshBasicMaterial({ color: 0x2c2f36 });
  const rail = new THREE.MeshBasicMaterial({ color: 0x3a3e47 });
  // operator platform, railed, HUNG from the house steel — nothing floats
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 2.4), steel);
  plat.position.y = -0.92;
  fsRig.add(plat);
  for (const [px, pz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), rail);
    post.position.set(px, -0.42, pz);
    fsRig.add(post);
    // hoist tube up to the roof steel at y=38.5 (local: 38.5 - 27.5 = 11.0)
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, SPEC.followSpot.hoist, 6), steel);
    drop.position.set(px, SPEC.followSpot.hoist / 2 - 0.92, pz);
    fsRig.add(drop);
  }
  for (const s of [-1, 1]) {
    const railX = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.05, 0.05), rail);
    railX.position.set(0, 0.08, s * 1.1);
    const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.32), rail);
    railZ.position.set(s * 1.1, 0.08, 0);
    fsRig.add(railX, railZ);
  }
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.85, 10), steel);
  post.position.y = -0.45;
  fsRig.add(post);
  // two warm work lights on the rail posts + the platform's edge glow strip:
  // the visual anchors that tell the eye something real is mounted up there
  for (const s of [-1, 1]) {
    const work = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.5, 0.9) })
    );
    work.position.set(s * 1.1, 0.12, -1.1);
    fsRig.add(work);
  }
}
const fsBarrel = new THREE.Group();
{
  const body = new THREE.MeshBasicMaterial({ color: 0x24272e });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.35, 14), body);
  tube.geometry.rotateX(Math.PI / 2);
  tube.position.z = 0.55;
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.5), body);
  rear.position.z = -0.2;
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 18, Math.PI), new THREE.MeshBasicMaterial({ color: 0x34373f }));
  yoke.rotation.z = Math.PI;
  yoke.position.y = -0.05;
  // red tally on the rear housing — every real followspot has one
  const tally = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.15, 0.1) })
  );
  tally.position.set(0, 0.28, -0.42);
  fsBarrel.add(tube, rear, yoke, tally);
}
const fsLens = new THREE.Mesh(
  new THREE.CircleGeometry(0.155, 18),
  new THREE.MeshBasicMaterial({ color: 0x222222 })
);
fsLens.position.z = 1.24;
fsBarrel.add(fsLens);
fsRig.add(fsBarrel);
fsRig.traverse((o) => { o.userData.noAim = true; });
scene.add(fsRig);

function setFollowSpot(on) {
  followSpot.on = on;
  if (!on) setFollowAim(false);
  applyState(false);
}
function setFollowAim(a) {
  followSpot.aim = a && followSpot.on;
  fsHint?.classList.toggle('show', followSpot.aim);
  document.body.classList.toggle('fsAim', followSpot.aim);
}
// Aiming is an analytic ray-march against the same ground function the walker
// uses (floor, every seat tier, stage decks) — instant, no 26k-instance
// raycast. The room curtain is a plane test on top.
const fsRay = new THREE.Raycaster();
function aimFollowSpotFrom(ndcX, ndcY) {
  fsRay.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const o = fsRay.ray.origin, d = fsRay.ray.direction;
  let tCurt = Infinity;
  if (curtainOn && curtainCut != null && Math.abs(d.x) > 1e-5) {
    const tc = (curtainCut - o.x) / d.x;
    if (tc > 0) tCurt = tc;
  }
  let prev = 0.5;
  for (let t = 1; t < 140; t += 0.45) {
    if (t >= tCurt) {
      followSpot.target.set(o.x + d.x * tCurt, o.y + d.y * tCurt, o.z + d.z * tCurt);
      return true;
    }
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const g = groundHeightAt(x, z, y);
    if (y <= (isFinite(g) ? g : 40)) {
      // bisect a little for a crisp landing point
      let lo = prev, hi = t;
      for (let i = 0; i < 5; i++) {
        const mid = (lo + hi) / 2;
        const gy = groundHeightAt(o.x + d.x * mid, o.z + d.z * mid, o.y + d.y * mid);
        if (o.y + d.y * mid <= (isFinite(gy) ? gy : 40)) hi = mid; else lo = mid;
      }
      followSpot.target.set(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      // the rest of the cone keeps going: march on past the aimed object to
      // wherever the unblocked light finally lands
      let endT = hi;
      for (let t2 = hi + 1.2; t2 < 140; t2 += 0.6) {
        const gy2 = groundHeightAt(o.x + d.x * t2, o.z + d.z * t2, o.y + d.y * t2);
        endT = t2;
        if (o.y + d.y * t2 <= (isFinite(gy2) ? gy2 : 40)) break;
      }
      followSpot.end.set(o.x + d.x * endT, o.y + d.y * endT, o.z + d.z * endT);
      return true;
    }
    prev = t;
  }
  return false;
}
function updateFollowSpot(dt) {
  const live = followSpot.on && currentMode === 'concert';
  followSpot.light.visible = live;
  fsCone.visible = live;
  fsPool.visible = live;
  if (!live) fsPool2.visible = false;
  fsRig.visible = currentMode === 'concert';
  fsLens.material.color.setScalar(live ? 3.0 : 0.13);   // lens blooms when hot
  followSpot.cur.lerp(followSpot.target, Math.min(1, dt * 1.8));  // operator swing
  followSpot.curEnd.lerp(followSpot.end, Math.min(1, dt * 1.8));
  fsBarrel.lookAt(followSpot.cur);
  if (!live) return;
  followSpot.light.target.position.copy(followSpot.cur);
  const P = followSpot.light.position;
  const hitLen = _fsDir.subVectors(followSpot.cur, P).length();
  const dir = _fsDir.subVectors(followSpot.curEnd, P);
  const len = Math.max(dir.length(), hitLen);
  fsCone.position.copy(P);
  fsCone.quaternion.setFromUnitVectors(_fsDown, dir.normalize());
  fsCone.scale.set(len * 0.068, len, len * 0.068);
  const block = Math.min(hitLen / len, 1);
  fsCone.material.uniforms.uBlock.value = block;
  placePool(fsPool, followSpot.cur, hitLen * 0.075 + 0.5, dir);
  // the spill's own landing glow, only when part of the beam carries on
  fsPool2.visible = live && block < 0.96;
  if (fsPool2.visible) placePool(fsPool2, followSpot.curEnd, len * 0.075 + 0.5, dir);
}
// orient a landing pool to the local surface and stretch it along the beam by
// the incidence angle — a hit ellipse, not a floating disc
const _fsN = new THREE.Vector3(), _fsT = new THREE.Vector3(), _fsB = new THREE.Vector3(), _fsM = new THREE.Matrix4();
function placePool(pool, at, r, beamDir) {
  const ry = at.y + 0.4;
  const gx = (groundHeightAt(at.x + 0.35, at.z, ry) - groundHeightAt(at.x - 0.35, at.z, ry)) / 0.7;
  const gz = (groundHeightAt(at.x, at.z + 0.35, ry) - groundHeightAt(at.x, at.z - 0.35, ry)) / 0.7;
  _fsN.set(isFinite(gx) ? -gx : 0, 1, isFinite(gz) ? -gz : 0).normalize();
  const dn = Math.abs(beamDir.dot(_fsN));
  const stretch = THREE.MathUtils.clamp(1 / Math.max(dn, 0.3), 1, 3.2);
  _fsT.copy(beamDir).addScaledVector(_fsN, -beamDir.dot(_fsN));
  if (_fsT.lengthSq() < 1e-4) _fsT.set(1, 0, 0); else _fsT.normalize();
  _fsB.crossVectors(_fsN, _fsT);
  _fsM.makeBasis(_fsT, _fsB, _fsN);
  pool.quaternion.setFromRotationMatrix(_fsM);
  pool.position.copy(at).addScaledVector(_fsN, 0.07);
  pool.scale.set(r * stretch, r, 1);
}
const _fsDir = new THREE.Vector3(), _fsDown = new THREE.Vector3(0, -1, 0);
// drag-to-aim: hold and sweep; single clicks still aim
let fsDrag = false;
const fsAimFromEvent = (e) => {
  if (controls.isLocked) aimFollowSpotFrom(0, 0);
  else aimFollowSpotFrom((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
};
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!followSpot.aim) return;
  fsDrag = true;
  fsAimFromEvent(e);
});
window.addEventListener('pointermove', (e) => { if (fsDrag && followSpot.aim) fsAimFromEvent(e); });
window.addEventListener('pointerup', () => { fsDrag = false; });

// --- main screen pose ---------------------------------------------------------
// Depth/height in metres, tilt/turn in degrees, applied to EVERY main-screen
// variant's pivot so the sliders move whichever shape the project shows. Part
// of a look (showfx capture), so a screen can rise and lean over the stage on
// a pad — and it travels to the phone through the relay for free.
const screenPose = { dx: 0, dy: 0, tilt: 0, turn: 0 };
const SCREEN_POSE_UI = [['scrDepth', 'dx'], ['scrHeight', 'dy'], ['scrTilt', 'tilt'], ['scrTurn', 'turn']];
function setScreenPose(p, syncUI = true) {
  Object.assign(screenPose, p);
  for (const pivot of Object.values(showRig.screenPivots || {})) {
    const b = pivot.userData.base;
    pivot.position.set(b.x + screenPose.dx, b.y + screenPose.dy, b.z);
    // the screens face +x: TURN yaws about y; TILT pitches about the screen's
    // own width axis (z), and positive tilt leans the top toward the floor —
    // "looking down over the stage". Tilt first, then yaw in the room.
    pivot.rotation.set(0,
      THREE.MathUtils.degToRad(screenPose.turn),
      THREE.MathUtils.degToRad(-screenPose.tilt), 'YZX');
  }
  if (syncUI) {
    for (const [id, k] of SCREEN_POSE_UI) {
      const el = document.getElementById(id);
      if (el) el.value = String(screenPose[k]);
    }
  }
}

// --- SHOW FX console page ------------------------------------------------------
{
  const btn = (id) => document.getElementById(id);
  const act = (el, on) => el.classList.toggle('active', on);
  btn('togglePyro').addEventListener('click', (e) => {
    e.stopPropagation();
    pyroFX.setPyro(!pyroFX.state.pyro);
    act(e.target, pyroFX.state.pyro);
  });
  btn('fireArenaPop').addEventListener('click', (e) => {
    e.stopPropagation(); if (!window.__presetQuiet) arenaFX.firePoppers();
  });
  // --- PA speakers: positional audio with acoustic presets ---
  // PA switch: on the DIRECTOR deck, where the transport is — that is where
  // you are when you decide whether the room should be making noise.
  const spkBtn = btn('dirSpk');
  // The PA takes the DIRECTOR's track (the engine shares audioFX's context
  // and routes through it) — never the tour video, which stays muted so no
  // surprise second song appears when the switch flips.
  const paVol = btn('dirPaVol');
  spkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    audioFX.setEnabled(!audioFX.state.on);
    spkBtn.classList.toggle('on', audioFX.state.on);
    if (paVol) paVol.style.display = audioFX.state.on ? '' : 'none';
  });
  if (paVol) {
    paVol.addEventListener('input', (e) => audioFX.setVolume(parseFloat(e.target.value)));
    paVol.addEventListener('click', (e) => e.stopPropagation());
  }
  // --- VR REMOTE: mirror this show onto a phone ---------------------------
  btn('dirRemote').addEventListener('click', (e) => {
    e.stopPropagation();
    setRemote(!remoteOn);
  });
  // --- screens follow the timeline ----------------------------------------
  btn('dirVidSync').addEventListener('click', (e) => {
    e.stopPropagation();
    setVideoSync(!videoSyncOn);
    // handing control back to the timeline: catch the film up immediately
    // instead of waiting for the next transport move
    if (videoSyncOn) syncVideoToTransport();
  });
  // --- crowd ambience: an independent looping bed with its own fader -------
  // Deliberately NOT routed through audioFX: the crowd is the room itself,
  // not programme material. It plays on its own output so the PA switch —
  // which carries only the director's track — never touches it.
  const crowdBtn = btn('dirCrowd');
  const crowdVol = btn('crowdVol');
  const crowdEl = document.getElementById('crowdEl');
  crowdEl.volume = parseFloat(crowdVol.value);
  crowdBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (crowdEl.paused) crowdEl.play();
    else crowdEl.pause();
    crowdBtn.classList.toggle('on', !crowdEl.paused);
    crowdVol.style.display = crowdEl.paused ? 'none' : '';
  });
  crowdVol.addEventListener('input', (e) => { crowdEl.volume = parseFloat(e.target.value); });
  crowdVol.addEventListener('click', (e) => e.stopPropagation());
  document.querySelectorAll('[data-sndp]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    audioFX.setPreset(b.dataset.sndp);
    document.querySelectorAll('[data-sndp]').forEach((x) => act(x, x === b));
  }));
  btn('spkVol')?.addEventListener('input', (e) => audioFX.setVolume(parseFloat(e.target.value)));
  // --- sound desk: live tone / room / stack controls over any preset ---
  const DESK_FLAT = { bass: 0, mid: 0, treble: 0, reverb: 1, punch: 0, sub: 1, rear: 1 };
  // data-desk, NOT data-sfx — the crowd's ROAR/OLÉ/CLAP buttons already own
  // that attribute and a shared selector would cross-wire the two systems
  document.querySelectorAll('[data-desk]').forEach((s) => {
    s.addEventListener('input', (e) => audioFX.setFX(s.dataset.desk, parseFloat(e.target.value)));
  });
  btn('sfxFlat')?.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const [k, v] of Object.entries(DESK_FLAT)) {
      audioFX.setFX(k, v);
      const el = document.querySelector(`[data-desk="${k}"]`);
      if (el) el.value = String(v);
    }
  });
  // (the console's own music source is gone \u2014 the DIRECTOR is the one and
  // only track source, and the PA plays whatever the director plays)
  // --- moving risers ---
  btn('aLiftSlider').addEventListener('input', (e) => { liftTargets.a = parseFloat(e.target.value); });
  btn('bLiftSlider').addEventListener('input', (e) => { liftTargets.b = parseFloat(e.target.value); });
  // one AMOUNT knob for all three confetti systems
  const setConfettiAmt = (v) => {
    pyroFX.setConfettiDensity(v);
    arenaFX.setConfettiDensity(v);
    rigFX.confetti.mesh.material.uniforms.uDensity.value = v;
  };
  btn('confettiAmt').addEventListener('input', (e) => setConfettiAmt(parseFloat(e.target.value)));
  btn('toggleSheet').addEventListener('click', (e) => {
    e.stopPropagation();
    arenaFX.setSheet(!arenaFX.state.sheet);
    act(e.currentTarget, arenaFX.state.sheet);
  });
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    arenaFX.setSheetMode(b.dataset.sheet);
    document.querySelectorAll('[data-sheet]').forEach((x) => act(x, x === b));
  }));
  btn('sheetColor').addEventListener('input', (e) => arenaFX.setSheetColor(e.target.value));
  btn('sheetSpeed').addEventListener('input', (e) => arenaFX.setSheetSpeed(parseFloat(e.target.value)));
  btn('toggleBalloons').addEventListener('click', (e) => {
    e.stopPropagation();
    balloonFX.setOn(!balloonFX.state.on);
    act(e.currentTarget, balloonFX.state.on);
  });
  btn('balloonCount').addEventListener('input', (e) => balloonFX.setCount(parseInt(e.target.value, 10)));
  btn('balloonSize').addEventListener('input', (e) => balloonFX.setSize(parseFloat(e.target.value)));
  document.querySelectorAll('[data-bmode]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    balloonFX.setMode(b.dataset.bmode);
    document.querySelectorAll('[data-bmode]').forEach((x) => act(x, x === b));
  }));
  btn('firePyroBtn').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) pyroFX.firePyro(); });
  // outdoor pyro: fireworks round the stadium
  btn('fireFireworks').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) fireworksFX.fire(); });
  btn('fireFinale').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) fireworksFX.fireFinale(); });
  btn('toggleFireworks').addEventListener('click', (e) => {
    e.stopPropagation(); fireworksFX.setShow(!fireworksFX.state.show); act(e.target, fireworksFX.state.show);
  });
  document.querySelectorAll('[data-fwp]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    fireworksFX.setPreset(b.dataset.fwp);
    document.querySelectorAll('[data-fwp]').forEach((x) => act(x, x === b));
  }));
  btn('fwSound').addEventListener('click', (e) => {
    e.stopPropagation(); fireworksFX.setSound(!fireworksFX.state.sound); act(e.target, fireworksFX.state.sound);
  });
  btn('fwVolume').addEventListener('input', (e) => fireworksFX.setVolume(parseFloat(e.target.value)));
  document.querySelectorAll('[data-pyrop]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    pyroFX.setPyroPreset(b.dataset.pyrop);
    document.querySelectorAll('[data-pyrop]').forEach((x) => act(x, x === b));
  }));
  btn('toggleFlames').addEventListener('click', (e) => {
    e.stopPropagation();
    pyroFX.setFlames(!pyroFX.state.flames);
    act(e.target, pyroFX.state.flames);
  });
  document.querySelectorAll('[data-flame]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    pyroFX.setFlameMode(b.dataset.flame);
    document.querySelectorAll('[data-flame]').forEach((x) => act(x, x === b));
  }));
  btn('firePoppers').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) pyroFX.firePoppers(); });
  btn('fireStreamers').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) pyroFX.fireStreamers(); });
  btn('toggleSpot').addEventListener('click', (e) => {
    e.stopPropagation();
    setFollowSpot(!followSpot.on);
    act(e.target, followSpot.on);
  });
  btn('spotAim').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!followSpot.on) { setFollowSpot(true); act(btn('toggleSpot'), true); }
    setFollowAim(true);
  });
  document.querySelectorAll('[data-props]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    propsFX.set({ mode: b.dataset.props });
    document.querySelectorAll('[data-props]').forEach((x) => act(x, x === b));
  }));
  btn('propsMotion').addEventListener('click', (e) => {
    e.stopPropagation();
    propsFX.set({ motion: !propsFX.state.motion });
    act(e.target, propsFX.state.motion);
  });
  document.querySelectorAll('[data-sfx]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.__presetQuiet) return;   // a bank being built (layerpresets.js): no real roar
    crowdSFX.play(b.dataset.sfx);
  }));
  // video presets
  document.querySelectorAll('[data-vpreset]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    videoPreset = b.dataset.vpreset;
    vPresets.setPreset(videoPreset === 'off' ? null : videoPreset);
    document.querySelectorAll('[data-vpreset]').forEach((x) => act(x, x === b));
    applyVideoRoute();
  }));
  // floor projection
  btn('projFloor').addEventListener('click', (e) => {
    e.stopPropagation();
    projFloorOn = !projFloorOn;
    act(e.target, projFloorOn);
    applyVideoRoute();
  });
  // flown banner screens: two positions, every shape, all on the same feed
  for (const [attr, key] of [['data-flownb', 'bstage'], ['data-flownf', 'foh']]) {
    document.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const want = b.getAttribute(attr);
      const set = showRig.flown[key];
      for (const k of Object.keys(set)) set[k].visible = (k === want);
      document.querySelectorAll(`[${attr}]`).forEach((x) => act(x, x === b));
    }));
  }
  // side screens
  document.querySelectorAll('[data-sidescr]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const [k, grp] of Object.entries(showRig.sides)) grp.visible = k === b.dataset.sidescr;
    document.querySelectorAll('[data-sidescr]').forEach((x) => act(x, x === b));
  }));
  // --- main screen pose sliders ---
  for (const [id, k] of SCREEN_POSE_UI) {
    btn(id).addEventListener('input', (e) => setScreenPose({ [k]: parseFloat(e.target.value) }, false));
  }
  btn('scrPoseReset').addEventListener('click', (e) => {
    e.stopPropagation();
    setScreenPose({ dx: 0, dy: 0, tilt: 0, turn: 0 });
  });
  // jumbotron winch
  btn('jumboLift').addEventListener('click', (e) => {
    e.stopPropagation();
    jumboUp = !jumboUp;
    e.target.innerHTML = jumboUp ? '&#9660; LOWER' : '&#9650; RETRACT';
    act(e.target, jumboUp);
  });
  // smoke
  btn('toggleFog').addEventListener('click', (e) => {
    e.stopPropagation();
    smokeFX.setFog(!smokeFX.state.fog);
    act(e.target, smokeFX.state.fog);
  });
  btn('fogDensity').addEventListener('input', (e) => {
    smokeFX.setFogDensity((parseFloat(e.target.value) - 0.3) / 1.1);
  });
  btn('fireJets').addEventListener('click', (e) => { e.stopPropagation(); if (!window.__presetQuiet) smokeFX.fireJets(); });
  btn('toggleJets').addEventListener('click', (e) => {
    e.stopPropagation();
    smokeFX.setJets(!smokeFX.state.jets);
    act(e.target, smokeFX.state.jets);
  });
  // ceiling flag
  // FAST SEATS: the low-poly seat mode, with a before/after FPS readout so the
  // saving is measured rather than guessed
  document.getElementById('seatLowBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !e.currentTarget.classList.contains('active');
    bowl.setSeatStyle(on ? 'flat' : 'box');
    e.currentTarget.classList.toggle('active', on);
    e.currentTarget.textContent = on ? 'Fast seats \u00b7 on' : 'Fast seats';
  });
  // --- crowd: the hands-up cue. ("Move with orbs" is gone: the bands follow
  // the arms now, always, so there is nothing left to switch.)
  btn('handsUpBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    crowdFX.handsUp();
    // arms go up holding a LIT band — a dark orb in a raised hand reads wrong
    if (orbFX.mode === 'off') orbFX.set({ mode: 'psolid' });
    document.querySelectorAll('[data-people]').forEach((b) => act(b, b.dataset.people === 'handsup'));
  });

  // Leaving the show has to stop the sound. The PA, the imported music and the
// crowd bed all keep running otherwise — you land back on the menu with the
// arena still playing behind it.
function silenceSession() {
  audioFX.setEnabled(false);
  document.getElementById('dirSpk')?.classList.remove('on');
  const mus = document.getElementById('musicEl');
  if (mus) mus.pause();
  const vid = document.getElementById('video');
  if (vid) { vid.pause(); vid.muted = true; }   // the PA switch owns the unmute
  const crw = document.getElementById('crowdEl');
  if (crw) crw.pause();
  document.getElementById('dirCrowd')?.classList.remove('on');
  const cv = document.getElementById('crowdVol'); if (cv) cv.style.display = 'none';
  const pv = document.getElementById('dirPaVol'); if (pv) pv.style.display = 'none';
  crowdSFX.stopLoop?.();
  directorUI.engine?.pause?.();   // the track on the timeline, too
}
for (const id of ['mmReturn', 'settingsMenuBtn']) {
  document.getElementById(id)?.addEventListener('click', silenceSession);
}
// and if the tab itself goes away mid-show
window.addEventListener('pagehide', silenceSession);

document.getElementById('suiteLightsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !e.currentTarget.classList.contains('active');
    bowl.setSuiteLights(on);
    e.currentTarget.classList.toggle('active', on);
  });
  document.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    flagFX.set(b.dataset.flag === 'off' ? null : b.dataset.flag);
    document.querySelectorAll('[data-flag]').forEach((x) => act(x, x === b));
  }));
  // crowd ambience loop: plays arena/assets/crowd-loop.mp3 when present
  let loopOn = false;
  btn('crowdLoopBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (window.__presetQuiet) return;
    loopOn = !loopOn;
    if (loopOn) {
      const ok = await crowdSFX.playLoop();
      if (!ok) {
        loopOn = false;
        const t = e.target.innerHTML;
        e.target.textContent = 'Add crowd-loop.mp3 first';
        setTimeout(() => { e.target.innerHTML = t; }, 2400);
      }
    } else {
      crowdSFX.stopLoop();
    }
    act(e.target, loopOn);
  });
}

// Wristband orbs default a notch smaller than they were built: at full size
// the discs merge into a solid sheet from across the bowl, and 0.9 keeps the
// individual lights readable. setSize scales the shared geometry, and
// orbFX.setGroup re-applies it whenever the concert floor is rebuilt.
orbFX.setSize(0.5);      // a wristband, not a basketball

const padsUI = initPads({
  consoleUI, show: showUI,
  rigFX, orbFX, fasciaFX, bstageFX, crowdFX,
  venue: { getLighting: () => lighting, setLighting },
  director: directorUI,
  showfx: {
    capture: () => ({
      pyro: pyroFX.state.pyro, flames: pyroFX.state.flames, flameMode: pyroFX.state.flameMode,
      pyroPreset: pyroFX.state.pyroPreset,
      fog: smokeFX.state.fog, jets: smokeFX.state.jets,
      videoPreset, projFloor: projFloorOn,
      props: propsFX.state.mode, propsMotion: propsFX.state.motion,
      spot: followSpot.on, spotTarget: followSpot.target.toArray(),
      balloons: { ...balloonFX.state },
      confettiAmt: parseFloat(document.getElementById('confettiAmt').value),
      // NOT captured any more: screenPose (where the big screen hangs), sound
      // (which PA room the track plays through) and lifts (the stage risers).
      // Those are the venue, not the show — a cue that silently re-routed the PA
      // or moved the screen mid-song was a bug wearing a feature's clothes.
      sheet: arenaFX.state.sheet, sheetMode: arenaFX.state.sheetMode,
      sheetColor: '#' + arenaFX.state.sheetColor.getHexString(),
      sheetSpeed: arenaFX.state.sheetSpeed,
    }),
    apply: (s) => {
      if (s.pyroPreset) pyroFX.state.pyroPreset = s.pyroPreset;
      pyroFX.setPyro(!!s.pyro);
      pyroFX.setFlames(!!s.flames);
      smokeFX.setFog(!!s.fog);
      smokeFX.setJets(!!s.jets);
      if (s.videoPreset !== undefined) {
        videoPreset = s.videoPreset || 'off';
        vPresets.setPreset(videoPreset === 'off' ? null : videoPreset);
      }
      if (s.projFloor !== undefined) projFloorOn = !!s.projFloor;
      applyVideoRoute();
      document.querySelectorAll('[data-vpreset]').forEach((b) => b.classList.toggle('active', b.dataset.vpreset === videoPreset));
      document.getElementById('toggleFog')?.classList.toggle('active', !!s.fog);
      document.getElementById('toggleJets')?.classList.toggle('active', !!s.jets);
      document.getElementById('projFloor')?.classList.toggle('active', !!s.projFloor);
      if (s.flameMode) pyroFX.setFlameMode(s.flameMode);
      propsFX.set({ mode: s.props || 'off', motion: s.propsMotion !== false });
      setFollowSpot(!!s.spot);
      if (s.spotTarget) followSpot.target.fromArray(s.spotTarget);
      // reflect in the console buttons
      const act = (id, on) => document.getElementById(id)?.classList.toggle('active', on);
      act('togglePyro', !!s.pyro); act('toggleFlames', !!s.flames);
      act('toggleSpot', !!s.spot); act('propsMotion', s.propsMotion !== false);
      document.querySelectorAll('[data-flame]').forEach((b) => b.classList.toggle('active', b.dataset.flame === (s.flameMode || 'gold')));
      document.querySelectorAll('[data-props]').forEach((b) => b.classList.toggle('active', b.dataset.props === (s.props || 'off')));
      // s.sound / s.lifts / s.screenPose may still be present in pads saved before
      // they were dropped from the snapshot; they are venue setup and are ignored.
      if (s.confettiAmt !== undefined) {
        pyroFX.setConfettiDensity(s.confettiAmt);
        arenaFX.setConfettiDensity(s.confettiAmt);
        rigFX.confetti.mesh.material.uniforms.uDensity.value = s.confettiAmt;
        const ca = document.getElementById('confettiAmt');
        if (ca) ca.value = String(s.confettiAmt);
      }
      if (s.sheet !== undefined) {
        arenaFX.setSheet(!!s.sheet);
        arenaFX.setSheetMode(s.sheetMode || 'fan');
        if (s.sheetColor) arenaFX.setSheetColor(s.sheetColor);
        arenaFX.setSheetSpeed(s.sheetSpeed ?? 1);
        act('toggleSheet', !!s.sheet);
        const sc = document.getElementById('sheetColor');
        if (sc && s.sheetColor) sc.value = s.sheetColor;
        const sp = document.getElementById('sheetSpeed');
        if (sp) sp.value = String(arenaFX.state.sheetSpeed);
        document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === arenaFX.state.sheetMode));
      }
      if (s.balloons) {
        balloonFX.setOn(!!s.balloons.on);
        balloonFX.setCount(s.balloons.count ?? 26);
        balloonFX.setSize(s.balloons.size ?? 1);
        balloonFX.setMode(s.balloons.mode || 'mix');
        act('toggleBalloons', !!s.balloons.on);
        const bc = document.getElementById('balloonCount'); if (bc) bc.value = String(balloonFX.state.count);
        const bz = document.getElementById('balloonSize'); if (bz) bz.value = String(balloonFX.state.size);
        document.querySelectorAll('[data-bmode]').forEach((b) => b.classList.toggle('active', b.dataset.bmode === balloonFX.state.mode));
      }
    },
  },
});
// Step 8 of the usability brief: the console's Show page names the musical
// ladder instead of competing with it, so its one button has to actually get
// you there — open the deck, then the banks.
document.getElementById('conOpenBanks')?.addEventListener('click', (e) => {
  e.stopPropagation();
  consoleUI.toggle?.(false);
  directorUI.toggle(true);
  padsUI.toggleRail(true);
});

directorUI.setPadHooks({
  fire: (layer, i, params, cueT) => padsUI.fireAt(layer, i, { params, cueT }),
  fadeOf: (layer, i) => padsUI.fadeOf(layer, i),
  saveTo: (layer, i) => padsUI.assign(i, layer),
  // the cue card's fade editor: write a trigger's line, try it, watch it run
  setFade: (layer, i, fade) => padsUI.setFadeAt(layer, i, fade),
  fireNow: (layer, i) => padsUI.fireAt(layer, i, {}),
  fadeNow: () => fadeLineNow(),
  name: (layer, i) => padsUI.padName(layer, i),
  key: (i) => padsUI.padKey(i),
  padForPreset: (pid, i) => padsUI.padForPreset(pid, i),
  sectionPresets: () => padsUI.sectionPresets(),
  sectionName: (pid) => padsUI.sectionName(pid),
  closeLayers: () => padsUI.toggleView(false),
  hint: (msg) => padsUI.hint(msg),
  vibe: () => padsUI.vibe(),
  vibes: () => VIBES,
  setVibe: (id) => padsUI.setVibe(id),
  color: (layer) => padsUI.layerColor(layer),
  capture: () => padsUI.capture(),
  apply: (st, params) => padsUI.apply(st, null, params),
  allowed: () => padsUI.allowed(),
  setAllowed: (o) => padsUI.setAllowed(o),
  motions: () => MOTIONS,
  activePad: () => padsUI.activePad(),
  activeKeys: () => padsUI.activeKeys(),
  activeBaseline: () => padsUI.activeBaseline(),
  padStoredState: (l, i) => padsUI.padStoredState(l, i),
  refire: (l, i) => padsUI.refire(l, i),
  stashLook: (st, name) => padsUI.stashLook(st, name),
  writePad: (l, i, st, name, subs) => padsUI.writePad(l, i, st, name, subs),
  getBank: () => padsUI.getBank(),
  setBank: (b) => padsUI.setBank(b),
});
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
// The keyboard legend used to be added on entry and never taken away, so it
// sat across the bottom of every frame of the show. It now teaches you once
// and gets out of the way; freeing the mouse brings it back briefly, which is
// exactly when you might have forgotten which key does what.
let hudTimer = 0;
function hintHud(ms = 6000) {
  clearTimeout(hudTimer);
  if (!shortcutsOn()) { hud.classList.remove('show'); return; }
  hud.classList.add('show');
  hudTimer = setTimeout(() => hud.classList.remove('show'), ms);
}
const fpsEl = document.getElementById('fps');
const menuBar = document.getElementById('menuBar');
let entered = false;
// the menu owns the overlay: it picks the building and hands over to creative
// mode (builder.js), which owns what is on the floor and locks the pointer
const builderUI = initBuilder({
  setMode, setStageConfig, applyCovers, applyCurtain, setBasketballFloor, controls,
  currentRig: () => rigPlan,   // the plan this page was built with (null = house rig)
  settle: settleCamera,        // keep the camera out of whatever was just built
});
const menuUI = initMenu({ controls, builder: builderUI, spawn: spawnAtStage });
// once inside, a click on the empty 3D view re-locks the pointer (unless a
// panel is open — then the click belongs to the panel workflow)
// Click the 3D view to look around (the mouse turns the camera); click again,
// or press Esc, to get the cursor back. Panels stay open either way.
let cursorFreedAt = -1e9;
renderer.domElement.addEventListener('click', () => {
  if (MOBILE) return;   // a phone looks round by dragging (mobile.js)
  if (followSpot.aim) return;   // pointerdown/drag owns aiming
  if (performance.now() - cursorFreedAt < 400) return;   // the click that just freed the cursor
  if (overlay.style.display === 'none' && !controls.isLocked) controls.lock();
});
document.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || e.button !== 0 || followSpot.aim || vrView.stereoOn) return;
  cursorFreedAt = performance.now();
  controls.unlock();
});
document.getElementById('resumeBtn').addEventListener('click', (e) => { e.stopPropagation(); controls.lock(); });
document.getElementById('settingsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('settingsPanel').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!e.isTrusted) return;   // a Settings switch pressing a console button for you is not a click outside
  if (!e.target.closest('#topLeft, #settingsPanel, #mSet')) document.getElementById('settingsPanel').classList.add('hidden');
  if (!e.target.closest('#menuBar')) document.getElementById('mainMenuDrop')?.classList.add('hidden');
});
// back to the main menu: from the MAIN MENU dropdown, or the bottom of Settings
function goMainMenu() {
  setFollowAim(false);
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('mainMenuDrop')?.classList.add('hidden');
  menuBar.style.display = 'none';
  overlay.style.display = 'flex';
}
document.getElementById('settingsMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); goMainMenu(); });
document.getElementById('mmReturn').addEventListener('click', (e) => { e.stopPropagation(); goMainMenu(); });
// MAIN MENU opens its dropdown: how to get around, the tutorial, the way back
document.getElementById('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('mainMenuDrop').classList.toggle('hidden');
});
controls.addEventListener('lock', () => {
  entered = true;
  if (!overlay.classList.contains('lightsDown')) overlay.style.display = 'none';
  menuBar.style.display = 'none';
  hintHud();
});
controls.addEventListener('unlock', () => {
  // after the first entry, Esc just frees the mouse: the scene stays on
  // screen and the console/mode buttons are clickable
  if (entered) { menuBar.style.display = 'flex'; hintHud(3500); }
  else overlay.style.display = 'flex';
  // keyup events stop arriving once the pointer is free — without this the
  // avatar keeps running in whatever direction was held at the Esc moment
  for (const k in keys) keys[k] = false;
});

// Keyboard shortcuts (Settings): off, the letter keys that open windows or
// change the room do nothing. Moving, jumping, flying and the , . camera keys always work.
const SHORTCUT_KEYS = new Set(['KeyL', 'KeyR', 'KeyP', 'Tab', 'KeyB', 'KeyO', 'KeyG', 'KeyH', 'KeyV', 'KeyM']);
function shortcutsOn() { try { return localStorage.getItem('ht-shortcuts') === '1'; } catch (_) { return false; } }
window.addEventListener('keydown', (e) => {
  if (shortcutsOn() || !SHORTCUT_KEYS.has(e.code) || e.metaKey || e.ctrlKey || typingNow()) return;
  if (e.code === 'Tab' && overlay.style.display === 'none') e.preventDefault();
  e.stopImmediatePropagation();
}, true);
const keys = {};
// the phone's joystick (mobile.js): -1..1 each way, on top of the keys
const touchMove = { x: 0, y: 0 };
let flying = false;
// the phone's Fly button: up you hop (a few metres, smoothly) and stay up; again, and you drop
let flyRise = 0;
function toggleFly() {
  flying = !flying;
  velY = 0;
  if (flying) { flyRise = 3.2; grounded = false; } else flyRise = 0;
  return flying;
}
document.addEventListener('keydown', (e) => {
  if (typingNow()) return;   // a field has the keys
  keys[e.code] = true;
  // the arrow keys walk: keep them from scrolling or nudging a focused slider
  if (/^Arrow/.test(e.code) && overlay.style.display === 'none') {
    e.preventDefault();
    if (document.activeElement?.type === 'range') document.activeElement.blur();
  }
  if (e.code === 'KeyL') setLighting(lighting === 'house' ? 'game' : 'house');
  if (e.code === 'KeyR' && menuUI.mode !== 'quick') directorUI.toggle();
  if (e.code === 'KeyP') wantShot = true;
  if (e.code === 'Escape' && entered && !controls.isLocked) {
    // browsers block re-locking for ~1s after an Esc exit; retry once
    const relock = () => { try { controls.lock(); } catch (_) {} };
    relock();
    setTimeout(() => { if (!controls.isLocked) relock(); }, 1100);
  }
  if (e.code === 'Tab') { e.preventDefault(); if (menuUI.mode !== 'quick') consoleUI.toggle(); }
  if (e.code === 'Comma') nextAngle(-1);
  if (e.code === 'Period') nextAngle(1);
  if (e.code === 'KeyB' && !builderUI.enabled) setBirdMode(birdMode === 'off' ? 'arena' : 'off');
  if (e.code === 'KeyG' && currentMode === 'concert') {
    if (!followSpot.on) setFollowSpot(true);
    setFollowAim(!followSpot.aim);
  }
  if (e.code === 'KeyF') {
    flying = !flying;
    velY = 0;
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

const EYE = 1.60;   // eye height for ~1.72 m; 1.75 read as 8 ft tall
// someone typing into a field (a number, a name, a colour) is not walking
const typingNow = () => {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(TEXTAREA|SELECT)$/.test(a.tagName) || (a.tagName === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(a.type)));
};
const freeMove = () => overlay.style.display === 'none' && !typingNow();   // in the room, not typing
let velY = 0, grounded = true, bobPhase = 0;

// --- preset camera angles ( , and . cycle ) --------------------------------
// pos/look are world metres; `fly` suspends gravity for the elevated seats so
// the camera holds its height instead of dropping to the floor.
const ARENA_ANGLES = [
  // In concert mode this becomes the B-stage: standing on the deck, facing out
  // over the floor crowd. It has to fly, because walk mode clamps to a flat
  // floor at EYE and would drop you straight off the deck.
  { name: 'Center Court',      pos: [0, EYE, 0],     look: [16, 3.2, 0],  fly: false,
    concert: { name: 'B-Stage', pos: [B_CENTER_X, CAT_H + EYE, 0], look: [20, 2.2, 0], fly: true } },
  { name: 'Baseline',          pos: [29, EYE, 0],    look: [0, 2.5, 0],   fly: false },
  { name: "Scorer's Table",    pos: [0, EYE, 12.5],  look: [0, 2, -2],    fly: false },
  { name: 'Lower Bowl Side',   pos: [0, 6.2, 22],    look: [0, 1.5, 0],   fly: true },
  { name: 'Lower Bowl Corner', pos: [27, 7.5, 21],   look: [0, 1.5, 0],   fly: true },
  { name: 'Club Level',        pos: [0, 14, 36],     look: [0, 1, 0],     fly: true },
  // Measured from groundHeightAt after the suite lift raised both tier gaps:
  // the 400s tread here is 31.5 and the 300s corner tread 26.1, so eye level
  // is tread + 1.7. At the old values the camera sat inside the concrete.
  { name: 'Upper Bowl',        pos: [0, 33.2, 52],   look: [0, 1, 0],     fly: true },
  { name: 'Upper Corner',      pos: [43, 27.8, 40],  look: [0, 1, 0],     fly: true },
  { name: 'Rafters',           pos: [0, 29, 12],     look: [0, 0, 0],     fly: true, air: true },   // air: hangs in the roof on purpose, never snapped to a seat
  // Concert: up on the main deck at the head of the ramp, backed off 1.5 m
  // toward the video wall, looking out over the crowd — the downstage mark.
  { name: 'Stage Front',       pos: [-14, EYE, 0],   look: [-30, 8, 0],   fly: false,
    concert: { name: 'Downstage', pos: [DOWNSTAGE_X - 1.5, MAIN_H + EYE, 0],
               look: [22, 1.6, 0], fly: true } },
];
// the stadium's spots: same idea, pitch-sized
const STADIUM_ANGLES = [
  { name: 'Centre Circle',     pos: [0, EYE, 0],                        look: [30, 3.5, 0],  fly: false,
    concert: { name: 'B-Stage', pos: [B_CENTER_X, CAT_H + EYE, 0], look: [30, 2.2, 0], fly: true } },
  { name: 'Goal Line',         pos: [PITCH.L / 2 - 1, EYE, 0],          look: [0, 3, 0],     fly: false },
  { name: 'Touchline',         pos: [0, EYE, PITCH.W / 2 + 2],          look: [0, 2.5, -10], fly: false },
  { name: 'Lower Tier Side',   pos: [0, 10, BOWL_B + 14],               look: [0, 1.5, 0],   fly: true },
  { name: 'Lower Tier Corner', pos: [BOWL_A + 6, 15, BOWL_B + 12],      look: [0, 1.5, 0],   fly: true },
  { name: 'Club Level',        pos: [0, 26, BOWL_B + 36],               look: [0, 1, 0],     fly: true },
  { name: 'Upper Tier',        pos: [0, 46, BOWL_B + 62],               look: [0, 1, 0],     fly: true },
  { name: 'Upper Corner',      pos: [BOWL_A + 34, 44, BOWL_B + 34],     look: [0, 1, 0],     fly: true },
  { name: 'Night Sky',         pos: [0, 40, -(BOWL_B + 30)],            look: [0, 110, 60],  fly: true, air: true },   // high over the north stand: the far rim, the pylons and the whole sky; the sphere's halo stays low in frame
  { name: 'Stage Front',       pos: [DOWNSTAGE_X + 12, EYE, 0],         look: [DOWNSTAGE_X - 10, 9, 0], fly: false,
    concert: { name: 'Downstage', pos: [DOWNSTAGE_X - 1.5, MAIN_H + EYE, 0], look: [30, 1.6, 0], fly: true } },
];
// the cricket ground: out in the middle, at the bowler's end, on the rope,
// then round and up the oval's tiers
const CRICKET_ANGLES = [
  { name: 'The Middle',        pos: [0, EYE, 1.5],                      look: [30, 3, 0],    fly: false,
    concert: { name: 'B-Stage', pos: [B_CENTER_X, CAT_H + EYE, 0], look: [30, 2.2, 0], fly: true } },
  { name: "Bowler's End",      pos: [13, EYE, 0.6],                     look: [-30, 2, 0],   fly: false },
  { name: 'On the Rope',       pos: [0, EYE, BOWL_B - 6],               look: [0, 3, -20],   fly: false },
  { name: 'Lower Tier Side',   pos: [0, 10, BOWL_B + 14],               look: [0, 1.5, 0],   fly: true },
  { name: 'Lower Tier End',    pos: [BOWL_A + 12, 11, 0],               look: [0, 1.5, 0],   fly: true },
  { name: "Members' Level",    pos: [0, 24, BOWL_B + 34],               look: [0, 1, 0],     fly: true },
  { name: 'Upper Tier',        pos: [0, 42, BOWL_B + 58],               look: [0, 1, 0],     fly: true },
  // over the rim, not in the top rows: up there the people beside you fill the frame
  { name: 'Over the Corner',   pos: [(BOWL_A + 72) * 0.72, 60, (BOWL_B + 72) * 0.72], look: [0, 1, 0], fly: true, air: true },
  { name: 'Night Sky',         pos: [0, 40, -(BOWL_B + 30)],            look: [0, 110, 60],  fly: true, air: true },
  { name: 'Stage Front',       pos: [DOWNSTAGE_X + 12, EYE, 0],         look: [DOWNSTAGE_X - 10, 9, 0], fly: false,
    concert: { name: 'Downstage', pos: [DOWNSTAGE_X - 1.5, MAIN_H + EYE, 0], look: [30, 1.6, 0], fly: true } },
];
// the festival field: always a show, so every view is of the crowd and the stage
const FESTIVAL_ANGLES = [
  { name: 'Front of the Crowd', pos: [DOWNSTAGE_X + 7, EYE, 0],         look: [40, 3, 0],    fly: false },
  { name: 'In the Crowd',      pos: [0, EYE, 6],                        look: [DOWNSTAGE_X, 8, 0], fly: false },
  // just behind the last of the crowd, up on the viewing platform
  { name: 'Back of the Field', pos: [BOWL_A + 8, 5, 0],                 look: [DOWNSTAGE_X, 7, 0], fly: true, air: true },
  { name: 'Delay Tower',       pos: [10, 15.6, -24],                    look: [DOWNSTAGE_X, 5, 0], fly: true, air: true },
  { name: 'By the Stalls',     pos: [20, EYE, BOWL_B + 3],              look: [0, 3, 0],     fly: false },
  { name: 'Downstage',         pos: [DOWNSTAGE_X - 1.5, MAIN_H + EYE, 0], look: [30, 1.6, 0], fly: true },
  { name: 'Stage Roof',        pos: [DOWNSTAGE_X + 4, 28, 0],           look: [40, 0, 0],    fly: true, air: true },
  { name: 'Big Wheel',         pos: [52, 40, -(BOWL_B + 62)],           look: [0, 2, 0],     fly: true, air: true },
  { name: 'Overhead',          pos: [10, 90, 0.5],                      look: [10, 0, 0],    fly: true, air: true },
];
const ANGLES = IS_FESTIVAL ? FESTIVAL_ANGLES : IS_CRICKET ? CRICKET_ANGLES : IS_STADIUM ? STADIUM_ANGLES : ARENA_ANGLES;
let angleIdx = 0;
let angleIdleTimer = 0;
const angleHud = document.getElementById('angleHud');
const angleNumEl = document.getElementById('angleNum');
const angleNameEl = document.getElementById('angleName');

// the next (or previous) view in the cycle, stepping over the ones left out
function nextAngle(dir) {
  const n = ANGLES.length;
  for (let k = 1; k <= n; k++) {
    const i = (((angleIdx + dir * k) % n) + n) % n;
    if (!ANGLES[i].skip) { setAngle(i); return; }
  }
  setAngle(angleIdx + dir);
}
function setAngle(i) {
  viewChanges = (viewChanges || 0) + 1;   // the tutorial watches this
  angleIdx = (i % ANGLES.length + ANGLES.length) % ANGLES.length;
  const base0 = ANGLES[angleIdx];
  const base = base0.pose ? { ...base0, ...base0.pose() } : base0;   // a view worked out from the venue now
  if (base.pos?.isVector3) { base.pos = base.pos.toArray(); base.look = base.look.toArray(); }
  const a = (currentMode === 'concert' && base.concert) ? base.concert : base;
  // Snap seated presets to whatever the floor actually is under them, instead
  // of trusting the y they were authored with. Those numbers were measured
  // against an older bowl and every one of them rotted as the room changed:
  // Center Court and Stage Front ended up buried inside the B-stage and
  // catwalk decks (ground 1.5, camera 1.6), and Upper Bowl / Upper Corner
  // floated 3.8 m and 6.4 m over their seats. Deriving it means they cannot go
  // stale again the next time a tier moves.
  //
  // Keyed on `air`, NOT on `fly`: fly only means walk mode cannot hold you
  // there, which is true of every seat in the upper tiers — those are exactly
  // the presets that were floating. Only a deliberately airborne view
  // (Rafters, Night Sky) keeps its authored height.
  let py = a.pos[1];
  if (!a.air) {
    const g = groundHeightAt(a.pos[0], a.pos[2], a.pos[1] + 2);
    if (isFinite(g)) py = g + EYE;
  }
  camera.position.set(a.pos[0], py, a.pos[2]);
  camera.lookAt(a.look[0], a.look[1], a.look[2]);
  // PointerLockControls re-reads camera.quaternion on each mouse move, so
  // mouse-look simply continues from the new orientation.
  flying = a.fly;
  velY = 0;
  grounded = !a.fly;
  bobPhase = 0;
  angleNumEl.textContent = "";   // just the name: simpler
  angleNameEl.textContent = a.name;
  const hvName = document.getElementById('viewName'), hvNum = document.getElementById('viewNum');
  if (hvName) hvName.textContent = a.name;
  if (hvNum) hvNum.textContent = `View ${angleIdx + 1} of ${ANGLES.length} · , and .`;
  angleHud.classList.add('show');
  angleHud.classList.remove('idle');
  clearTimeout(angleIdleTimer);
  // a moment under the camera button, then gone
  angleIdleTimer = setTimeout(() => angleHud.classList.remove('show'), 1500);
}

// Where a project drops you: on your feet in the house, facing the stage —
// never wherever the camera was last left. Concert rooms aim at the deck (or
// the round stage in the middle); sport rooms fall back to the centre-court
// preset.
function spawnAtStage() {
  if (currentMode !== 'concert') { setAngle(0); return; }
  // on the X on stage, looking out at the crowd
  const P = stagePoint();
  const top = groundHeightAt(P.x, P.z, 60);
  if (isFinite(top)) {
    placeMark();
    camera.position.set(P.x, top + EYE, P.z);
    camera.lookAt(P.x + 40, top + EYE + 3, P.z);
    flying = false; velY = 0; grounded = true; bobPhase = 0;
    angleHud.classList.remove('show');               // not one of the numbered angles
    return;
  }
  // no deck under the X (inside the globe): out in the crowd, facing the stage
  const d = deriveStage(stageCfg);
  let px, look;
  if (stageCfg.position === 'middle') {
    px = middleRadius(stageCfg) + 15;                // outside the pit, in the crowd
    look = [0, MAIN_H + 2.2, 0];
  } else {
    px = d.frontX + 24;                              // ~24 m out from the deck lip
    look = [d.frontX - 6, MAIN_H + 3.0, 0];          // deck centre, wall rising behind
  }
  camera.position.set(px, EYE, 5.5);                 // off the catwalk axis, among the crowd
  camera.lookAt(look[0], look[1], look[2]);
  flying = false; velY = 0; grounded = true; bobPhase = 0;
  angleHud.classList.remove('show');                 // not one of the numbered angles
}

// Creative mode swaps the floor out from under the camera. A walking camera
// steps up onto a deck that now stands where it was (centre court becomes the
// B-stage), drops to the floor when its deck goes away, and only walks back
// in at the spawn point if it ended up inside something solid (the globe).
// Flying views keep their height: they were put there on purpose.
function settleCamera() {
  if (flying) return;
  const p = camera.position;
  const top = groundHeightAt(p.x, p.z, p.y);   // highest surface up to eye height
  if (!isFinite(top)) { spawnAtStage(); return; }
  if (Math.abs(top + EYE - p.y) > 0.02) {
    p.y = top + EYE;
    velY = 0; grounded = true; bobPhase = 0;
  }
}

const MAX_STEP = 0.55;   // seat rows rise 0.42-0.6: walkable. Tier fronts need a jump.
const STEP_LERP = 14;    // step-up smoothing rate (1/s)
// refY: the caller's feet (or a ray sample) — the bowl is multi-storey, so we
// return the highest surface that is not above refY + a step, falling back to
// the lowest one so nobody is ever left with no ground at all.
// Custom stage decks from a rig plan are real floors: same rule as the bowl
// surfaces — you stand on the highest one at or below your feet.
function planDeckY(x, z) {
  let best = -Infinity;
  for (const d of showRig.planDecks) {
    const c = Math.cos(-d.rot), s = Math.sin(-d.rot);
    const dx = x - d.x, dz = z - d.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) <= d.w / 2 && Math.abs(lz) <= d.d / 2 && d.top > best) best = d.top;
  }
  return best;
}

function groundHeightAt(x, z, refY = Infinity) {
  const off = bowlOffsetAt(x, z);
  if (off >= BOWL_OUTER_OFF) return Infinity;      // the outer wall
  if (currentMode === 'concert' && stageBlocks(stageCfg, x, z)) return Infinity;   // solid stage volumes (the globe)
  const cands = bowlSurfacesAt(off, bowlNormalZ2(x, z));   // the stadium's rim varies round the bowl
  if (currentMode === 'concert') {
    const s = stageSurfaceY(stageCfg, x, z);
    if (isFinite(s) && s > -1e5) cands.push(s);
  }
  const pd = planDeckY(x, z);
  if (pd > -Infinity) cands.push(pd);
  if (!cands.length) return Infinity;
  let best = -Infinity, low = Infinity;
  for (const y of cands) {
    if (y < low) low = y;
    if (y <= refY + MAX_STEP + 0.06 && y > best) best = y;
  }
  return best > -Infinity ? best : low;
}

// flying's walls: a spot is free when there is no wall there or within a
// body's width of it, and the ground under it is not a step up of more than a seat row
const FLY_CLEAR = 1.0, FLY_PAD = 1.2;
function flyFree(x, z, y) {
  for (const [dx, dz] of [[0, 0], [FLY_PAD, 0], [-FLY_PAD, 0], [0, FLY_PAD], [0, -FLY_PAD]]) {
    const g = groundHeightAt(x + dx, z + dz, y - FLY_CLEAR);
    if (!isFinite(g)) return false;
    if (dx === 0 && dz === 0 && g - (y - FLY_CLEAR) > MAX_STEP) return false;
  }
  return true;
}

function updateMovement(dt) {
  // In VR there is no pointer lock to wait for (iOS has no such API) — the
  // head aims and a keyboard or gamepad walks. Everything below already works
  // off camera orientation, so it needs no other change.
  // with the cursor free (a panel in use, the builder) the keys still walk:
  // only typing into a field holds them
  if (!controls.isLocked && !vrView.stereoOn && !freeMove()) return;
  const sprint = keys.ShiftLeft || keys.ShiftRight ? 2.05 : 1;
  let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (fwd && strafe) { fwd *= 0.7071; strafe *= 0.7071; }
  if (touchMove.x || touchMove.y) {
    fwd = Math.max(-1, Math.min(1, fwd + touchMove.y));
    strafe = Math.max(-1, Math.min(1, strafe + touchMove.x));
  }

  if (flying) {
    // free flight: move in the LOOK direction, Space/C for vertical
    const speed = 9 * sprint;
    const dir = new THREE.Vector3();
    const P = camera.position;
    const px = P.x, pz = P.z;
    camera.getWorldDirection(dir);
    P.addScaledVector(dir, fwd * speed * dt);
    controls.moveRight(strafe * speed * dt);
    const vert = (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0);
    P.y += vert * speed * 0.8 * dt;
    if (flyRise > 0) { const up = Math.min(flyRise, Math.max(0.4, flyRise * 5) * dt); P.y += up; flyRise -= up; }
    P.y = THREE.MathUtils.clamp(P.y, 0.4, SPEC.fly.yMax);
    // walled in: the building's outer wall, solid stage parts and the tiers stop
    // you the way they stop a walker; you slide along them rather than through
    if (flyFree(px, pz, P.y)) {
      if (!flyFree(P.x, P.z, P.y)) {
        const nx = P.x, nz = P.z;
        if (flyFree(nx, pz, P.y)) P.z = pz;
        else if (flyFree(px, nz, P.y)) P.x = px;
        else { P.x = px; P.z = pz; }
      }
    }
    // never down into the seats or the floor
    const g = groundHeightAt(P.x, P.z, P.y - FLY_CLEAR);
    if (isFinite(g) && P.y < g + FLY_CLEAR) P.y = g + FLY_CLEAR;
    grounded = false;
    return;
  }

  const speed = 4.2 * sprint;
  const prevX = camera.position.x, prevZ = camera.position.z;
  controls.moveForward(fwd * speed * dt);
  controls.moveRight(strafe * speed * dt);

  // ground sampling: the bowl profile makes rows and aisle stairs walkable,
  // the stage query makes decks solid, Infinity is a hard wall
  const feet = camera.position.y - EYE;
  let ground = groundHeightAt(camera.position.x, camera.position.z, feet);
  if (!isFinite(ground) || ground - feet > MAX_STEP) {
    camera.position.x = prevX;
    camera.position.z = prevZ;
    ground = groundHeightAt(prevX, prevZ, feet);
    if (!isFinite(ground)) ground = feet;   // never trap the camera
  }

  if (keys.Space && grounded) { velY = 5.4; grounded = false; }
  velY -= 15.5 * dt;
  camera.position.y += velY * dt;

  const moving = (fwd || strafe) && grounded;
  if (moving) bobPhase += dt * speed * 1.85;
  const bob = moving ? Math.sin(bobPhase) * 0.028 : 0;

  const floorY = ground + EYE + bob;
  if (camera.position.y <= floorY && velY <= 0) {
    // landing / step-up: lerp so stair rows read as steps, not teleports
    camera.position.y += (floorY - camera.position.y) * Math.min(1, dt * STEP_LERP);
    if (floorY - camera.position.y < 0.02) camera.position.y = floorY;
    velY = 0;
    grounded = true;
  } else if (grounded && camera.position.y - floorY <= MAX_STEP + 0.1) {
    // small step down: glide instead of a gravity pop on every seat row
    camera.position.y += (floorY - camera.position.y) * Math.min(1, dt * STEP_LERP);
    velY = 0;
  } else if (grounded) {
    grounded = false;   // walked off an edge: gravity takes it
  }
}

// --- resize ------------------------------------------------------------------
window.addEventListener('resize', () => {
  if (exporting) return;   // the export holds 1920x1080 until it is done
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  rigFX.setViewport(camera, window.innerHeight);   // stale value re-aliases lasers
});

window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const k in keys) keys[k] = false;
});

// debug handle for automated verification
// --- hover help: aim at a thing, get told what it is -------------------------
let helpOn = false;
let helpAcc = 0;
const helpTip = document.getElementById('helpTip');
const helpRay = new THREE.Raycaster();
const helpMouse = new THREE.Vector2(0, 0);
window.addEventListener('mousemove', (e) => {
  helpMouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  helpMouse.px = e.clientX; helpMouse.py = e.clientY;
});
const ensureHelp = (o, name, blurb) => {
  if (o && !o.userData.help) o.userData.help = { name, blurb };
  return o;
};
function helpTargets() {
  return [
    ensureHelp(stage.group, 'Stage', 'The performance package: A-stage, runway and B-stage. Reshape it in the BUILD panel or wizard.'),
    ensureHelp(scoreboard.group || jumboMesh, 'Jumbotron', 'The centre-hung scoreboard. Raise or dock it from the SCREENS page.'),
    ensureHelp(showRig.group, 'Show rig', 'Trusses, fixtures, lasers, screens and PA points. Driven from the STAGE and LIGHTS pages.'),
    ensureHelp(foh.group || foh, 'FOH', 'Front-of-house: the mix position. Audio and lighting desks live here mid-bowl.'),
    ensureHelp(balloonFX.group, 'Crowd balloons', 'Giant beach balls batted around the floor. CROWD page controls count, size and style.'),
    ensureHelp(bowl.suites, 'VIP suites', 'Hollow luxury boxes with seat terraces. Lights toggle on the VENUE page.'),
    ...bowl.fascias.map((f) => ensureHelp(f.mesh, 'LED fascia', 'The ribbon board circling each tier. Modes and colours on the SCREENS page.')),
    ensureHelp(ceiling.group, 'House steel', 'Roof trusses, catwalks and rigging the whole show hangs from.'),
  ].filter(Boolean);
}
function updateHelp(dt) {
  helpAcc += dt;
  if (helpAcc < 0.15) return;
  helpAcc = 0;
  if (controls.isLocked) helpRay.setFromCamera({ x: 0, y: 0 }, camera);
  else helpRay.setFromCamera(helpMouse, camera);
  const hit = helpRay.intersectObjects(helpTargets(), true)[0];
  let info = null;
  for (let o = hit && hit.object; o; o = o.parent) {
    if (o.userData.help) { info = o.userData.help; break; }
  }
  if (!info) { helpTip.classList.add('hidden'); return; }
  helpTip.innerHTML = `<b>${info.name}</b>${info.blurb}`;
  helpTip.classList.remove('hidden');
  if (controls.isLocked) {
    helpTip.style.left = '52%'; helpTip.style.top = '54%';
  } else {
    helpTip.style.left = Math.min(window.innerWidth - 260, (helpMouse.px || 0) + 16) + 'px';
    helpTip.style.top = ((helpMouse.py || 0) + 14) + 'px';
  }
}
document.getElementById('helpBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  helpOn = !helpOn;
  e.currentTarget.classList.toggle('active', helpOn);
  if (!helpOn) helpTip.classList.add('hidden');
});

window.__dbg = { songBeats, reelCuts, updateHelp, get rigPlan() { return rigPlan; }, get stage() { return stage; }, camera, scene, renderer, composer, bloom, THREE, controls, setMode, setLighting, setBasketballFloor, jumboMesh, keys, groundHeightAt, orbFX, fasciaFX, crowdFX, crowd, jumbo: scoreboard, consoleUI, seatCount: bowl.seatCount, bowl, floorSeatCount: floorSeats.seatCount, get concertSeatCount() { return concertSeats.seatCount; }, get concertSeats() { return concertSeats; }, showRig, rigFX, bstageFX, setAngle, ANGLES, exportBirdPNG, directorUI, padsUI, menuUI, builderUI, get liveCam() { return liveCam; }, get camPipe() { return camPipe; }, handsUI, feedsUI, showEngine, showUI, irHeads, get showPanel() { return showPanel; }, get audience() { return audience; }, get undoHistory() { return undoHistory; }, recordShowVideo, pyroFX, propsFX, balloonFX, arenaFX, audioFX, LIFTS, liftTargets, crowdSFX, smokeFX, hockeyProps, foh, flagFX, vPresets, followSpot, setFollowSpot, aimFollowSpotFrom, setStageConfig, applyCovers, applyCurtain, get stageCfg() { return stageCfg; }, syncVideoToTransport, setVideoSync, get videoSyncOn() { return videoSyncOn; }, spawnAtStage, setScreenPose, screenPose, VENUE, SPEC, PITCH, pitch, stageRoof, ceiling, endBoards, applySphereLook, setLook, LOOKS, groundHeightAt, fireworksFX };

// ---------------------------------------------------------------------------
// PHONE VR (?vr) — stereo split + sensor head tracking.
//
// WebXR cannot serve this: iOS Safari has none and Chrome dropped Cardboard,
// so the phone-in-a-holder case is hand-rolled. StereoEffect does the eye
// split; src/vrphone.js supplies head orientation.
//
// The phone is a VIEWER, not a control surface — you cannot reach the screen
// once it is in the headset. It takes its whole look from the laptop over the
// show relay below, and its vantage point from the laptop's preset angles.
// ---------------------------------------------------------------------------
const stereo = new StereoEffect(renderer);
const vrPhone = initVRPhone();
const vrView = {
  stereoOn: false,
  baseYaw: 0,          // vantage-point facing; head tracking is relative to it
};

// Everything a phone cannot afford, turned off in one place. Each of these is
// an existing knob — nothing here is VR-specific machinery.
const VR_MAX_BEAMS = 20;                // the volumetric integrator is the hog
const VR_MAX_CROWD = 0.6;

// The laptop's snapshot carries ITS budgets, so a mirrored state would undo
// the phone's profile every 200 ms. Clamp the two cost knobs that appear in
// capture() on the way in and let everything else mirror faithfully.
function clampForVR(state) {
  if (state.rig) {
    state.rig.beamBudget = Math.min(state.rig.beamBudget ?? VR_MAX_BEAMS, VR_MAX_BEAMS);
  }
  if (state.crowd) {
    state.crowd.level = Math.min(state.crowd.level ?? VR_MAX_CROWD, VR_MAX_CROWD);
  }
  return state;
}

function applyVRProfile() {
  bowl.setSeatStyle('flat');            // billboards: ~2 tris a seat, not ~24
  rigFX.beamBudget = VR_MAX_BEAMS;
  balloonFX.setOn(false);
  crowdFX.set({ level: 0.5 });
  mirror.visible = false;               // a full extra scene render at 30 Hz
  setBirdMode('off');
  shadowBakes = 0;
  for (const t of [wallVideoTex, fasciaVideoTex]) t.anisotropy = 4;
}

// Recentring has to be reachable without touching the screen: the laptop can
// send it, and a tap works while the phone is still in your hand.
function vrRecenter() { vrPhone.recenter(); }

// ---------------------------------------------------------------------------
// GAMEPAD — the practical way to move while the phone is in the headset.
//
// iOS Safari supports the Gamepad API for Bluetooth PS/Xbox/MFi pads, and a
// USB-C or Bluetooth keyboard already works through the normal key handlers.
// A mouse cannot help: iOS has no Pointer Lock, so there is no mouse-look —
// but none is needed, the head does the aiming.
//
// Sticks are folded into the existing `keys` flags rather than adding a second
// movement path, so collision, stepping, gravity and fly mode stay identical.
// ---------------------------------------------------------------------------
const padPrev = {};
function pollGamepad(dt) {
  if (!navigator.getGamepads) return;
  const gp = [...navigator.getGamepads()].find((g) => g && g.connected);
  if (!gp) return;
  const ax = (i) => {
    const v = gp.axes[i] || 0;
    return Math.abs(v) < 0.18 ? 0 : v;      // deadzone: sticks rest off-centre
  };
  const held = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  // edge detection, so a held button toggles once instead of every frame
  const tapped = (i) => {
    const now = held(i);
    const was = padPrev[i];
    padPrev[i] = now;
    return now && !was;
  };

  const lx = ax(0), ly = ax(1), rx = ax(2);
  keys.KeyW = ly < 0; keys.KeyS = ly > 0;
  keys.KeyA = lx < 0; keys.KeyD = lx > 0;
  keys.ShiftLeft = held(10) || held(11) || held(6) || held(7);   // stick click / triggers
  keys.Space = held(0);
  keys.KeyC = held(1);
  // right stick turns the room: you cannot always spin your chair
  if (rx) vrView.baseYaw -= rx * dt * 2.0;
  if (tapped(2)) vrRecenter();                    // X / square
  if (tapped(3)) flying = !flying;                // Y / triangle
  if (tapped(12)) setAngle(angleIdx - 1);         // d-pad up / down: vantage points
  if (tapped(13)) setAngle(angleIdx + 1);
}

if (VR) {
  document.documentElement.classList.add('vrMode');
  const gate = document.createElement('div');
  gate.id = 'vrGate';
  gate.innerHTML = '<b><img class="pmLogo" src="./assets/pixmob-logo.png" alt="PIXMOB">STAGE</b><span>Enter VR</span>'
    + '<small>Turn the phone landscape, then slide it into the headset.</small>'
    + '<em class="vrSetup">or set the show up on the phone first</em>';
  document.body.appendChild(gate);

  // Leaves the menu behind without pointer lock, which can never resolve on a
  // phone — and the app's whole UI gate hangs off its 'lock' event.
  const leaveMenu = () => {
    document.body.classList.remove('menu');
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  };

  // iPhone Safari has no Element.requestFullscreen at all (only <video>), so
  // this is a no-op there and the real answer is Add to Home Screen. Android
  // and iPad honour it.
  const goFullscreen = async () => {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return false;
    try { await fn.call(el, { navigationUI: 'hide' }); return true; } catch (_) { return false; }
  };

  const setStereo = (on) => {
    vrView.stereoOn = on;
    document.documentElement.classList.toggle('vrStereo', on);
    if (on) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      stereo.setSize(window.innerWidth, window.innerHeight);
    } else {
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    }
  };

  const enterVR = async () => {
    // the permission call must be the first step of the gesture: iOS only
    // grants motion access from inside a real tap
    const ok = await vrPhone.enable();
    goFullscreen();
    applyVRProfile();
    leaveMenu();
    clearTimeout(hudTimer); hud.classList.remove('show');   // VR: no legend at all
    vrPhone.recenter();
    setStereo(true);
    gate?.remove();
    if (!ok) {
      // no sensors (declined, or a plain-http origin): still worth showing —
      // the laptop can fly the camera — but say why the head is frozen
      const warn = document.createElement('div');
      warn.id = 'vrWarn';
      warn.textContent = 'No motion access — head tracking off. Needs https and Allow.';
      document.body.appendChild(warn);
      setTimeout(() => warn.remove(), 6000);
    }
  };

  // The phone is a normal screen until it goes in the headset, so the second
  // path drops you into the app with the console and director usable — set the
  // show up by hand, then tap VIEW IN VR when you are ready to insert it.
  const setupOnPhone = () => {
    leaveMenu();
    gate?.remove();
    const enterBtn = document.createElement('button');
    enterBtn.id = 'vrEnter';
    enterBtn.textContent = 'VIEW IN VR';
    enterBtn.addEventListener('click', (e) => { e.stopPropagation(); enterVR(); });
    document.body.appendChild(enterBtn);
  };

  gate.querySelector('span').addEventListener('click', (e) => {
    e.stopPropagation(); enterVR();
  });
  gate.querySelector('.vrSetup').addEventListener('click', (e) => {
    e.stopPropagation(); setupOnPhone();
  });

  // Touch gestures, chosen so neither can fire by accident inside a headset:
  //   two fingers  → back out of stereo to the normal UI
  //   double tap   → re-centre the view on where you are facing now
  let lastTap = 0;
  renderer.domElement.addEventListener('touchend', (e) => {
    if (e.touches.length >= 1) return;              // still mid-gesture
    if (e.changedTouches.length >= 2) {
      if (vrView.stereoOn) { setStereo(false); setupOnPhone(); }
      return;
    }
    const now = performance.now();
    if (now - lastTap < 400 && vrView.stereoOn) vrRecenter();
    lastTap = now;
  });

  const resize = () => {
    if (!vrView.stereoOn) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    stereo.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  window.addEventListener('resize', () => setTimeout(resize, 60));
}

// ---------------------------------------------------------------------------
// SHOW RELAY — laptop drives, phone mirrors.
//
// The payload is padsUI.capture()/apply(): the app's own whole-show snapshot,
// already proven serialisable (it round-trips through localStorage and the
// .arenashow file). State is mirrored rather than commands replayed, so a cue
// needs no plumbing of its own — only genuine one-shots travel as events.
// ---------------------------------------------------------------------------
const RELAY = { push: '/show/push', events: '/show/events' };
const FIRES = {
  confetti: () => rigFX.fireConfetti(),
  pyro: () => pyroFX.firePyro(),
  poppers: () => pyroFX.firePoppers(),
  streamers: () => pyroFX.fireStreamers(),
  arenapop: () => arenaFX.firePoppers(),
  fireworks: () => fireworksFX.fire(),
  fwfinale: () => fireworksFX.fireFinale(),
  jets: () => smokeFX.fireJets(),
  handsup: () => crowdFX.handsUp(),
  recenter: () => vrRecenter(),
};

function relaySend(msg) {
  fetch(RELAY.push, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
    keepalive: true,
  }).catch(() => { /* relay down: the show goes on locally */ });
}

// --- sender: the laptop ---------------------------------------------------
let remoteOn = false;
let lastSentState = '';
let lastSentVenue = '';
let lastSentAngle = -1;

// One-shots are mirrored by wrapping the engine methods ONCE, so every path
// that fires them — console button, pad, or a director timeline stamp — is
// covered without touching a single handler. The phone never wraps, so an
// applied fire cannot echo back.
if (!VR) {
  for (const [obj, method, name] of [
    [rigFX, 'fireConfetti', 'confetti'],
    [pyroFX, 'firePyro', 'pyro'],
    [pyroFX, 'firePoppers', 'poppers'],
    [pyroFX, 'fireStreamers', 'streamers'],
    [arenaFX, 'firePoppers', 'arenapop'],
    [fireworksFX, 'fire', 'fireworks'],
    [fireworksFX, 'fireFinale', 'fwfinale'],
    [smokeFX, 'fireJets', 'jets'],
    [crowdFX, 'handsUp', 'handsup'],
  ]) {
    if (typeof obj?.[method] !== 'function') continue;
    const orig = obj[method].bind(obj);
    obj[method] = (...a) => {
      if (remoteOn) relaySend({ type: 'fire', name });
      return orig(...a);
    };
  }
}

function relayTick() {
  if (!remoteOn) return;
  if (angleIdx !== lastSentAngle) {
    lastSentAngle = angleIdx;
    relaySend({ type: 'view', angle: angleIdx });
  }
  const s = JSON.stringify(padsUI.capture());
  if (s !== lastSentState) {
    lastSentState = s;
    relaySend({ type: 'state', state: JSON.parse(s) });
  }
  // the venue shape is a teardown-and-rebuild on the far end, so it travels
  // separately and only when it actually moves
  const v = JSON.stringify({
    room: VENUE, mode: currentMode, cfg: stageCfg,
    covers: coverCfg, curtain: curtainCut,
  });
  if (v !== lastSentVenue) {
    lastSentVenue = v;
    relaySend({ type: 'venue', venue: JSON.parse(v) });
  }
}
function setRemote(on) {
  remoteOn = !!on;
  document.getElementById('dirRemote')?.classList.toggle('on', remoteOn);
  if (remoteOn) { lastSentState = ''; lastSentVenue = ''; lastSentAngle = -1; relayTick(); }
}
setInterval(relayTick, 200);

// --- receiver: the phone -------------------------------------------------
if (VR) {
  const es = new EventSource(RELAY.events);
  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type === 'state' && msg.state) {
      try { padsUI.apply(clampForVR(msg.state)); } catch (err) { console.warn('state apply', err); }
    } else if (msg.type === 'venue' && msg.venue) {
      const v = msg.venue;
      // the laptop is in the other room: switch venues and come back subscribed
      if (v.room && v.room !== VENUE) { reloadIntoVenue(v.room); return; }
      if (v.mode && v.mode !== currentMode) setMode(v.mode);
      if (v.cfg) setStageConfig(v.cfg);          // early-returns when identical
      if (v.covers) applyCovers(v.covers);
      applyCurtain(v.curtain ?? null);
    } else if (msg.type === 'view' && Number.isInteger(msg.angle)) {
      // position only: orientation belongs to the head. The preset's own
      // facing becomes the forward reference the sensors work against.
      const base = ANGLES[msg.angle];
      const a = base && (currentMode === 'concert' && base.concert ? base.concert : base);
      if (a) {
        camera.position.set(a.pos[0], a.pos[1], a.pos[2]);
        vrView.baseYaw = Math.atan2(a.look[0] - a.pos[0], a.look[2] - a.pos[2]);
        if (!vrPhone.state.on) camera.lookAt(a.look[0], a.look[1], a.look[2]);
      }
    } else if (msg.type === 'fire' && FIRES[msg.name]) {
      FIRES[msg.name]();
    }
  };
}

// --- loop with adaptive resolution ------------------------------------------------
const clock = new THREE.Clock();
let frames = 0, accum = 0, pixelRatio = MAX_PR;
// the VR floor stays high enough that the room never turns to mush: below
// this, drop scene detail instead of resolution
const MIN_PR = VR ? 0.9 : 0.65;
let prVotes = 0;   // hysteresis for the adaptive-resolution controller
// Recovery memory. The old controller only stepped UP below 10 ms/frame, so a
// machine that runs 70-90 fps could drop resolution on any hitch (opening a
// panel, a scene rebuild) and then never climb back: the picture stayed soft
// for the rest of the session. Now it climbs whenever there is headroom, and a
// level that fails right after being tried becomes a ceiling for a while so
// the two thresholds can't ping-pong.
let prCeiling = Infinity, prCeilingUntil = 0, prSteppedUpAt = -1;
// The shortest frame seen so far is about one refresh of this screen. A 60 Hz
// screen (most TVs and projectors a demo gets plugged into) never shows more
// than 60 frames, so "slower than 65 fps" would read every frame there as too
// slow and sink the resolution to the floor; on those the goal is holding 60,
// and a long calm stretch at a full 60 is the only sign of headroom.
let minDt = Infinity, calm = 0;


const _crowdTint = new THREE.Color(), _tintC = new THREE.Color();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (shadowBakes > 0) { renderer.shadowMap.needsUpdate = true; shadowBakes--; }
  // the head owns the camera in VR; PointerLockControls never engages there
  if (vrView.stereoOn) vrPhone.update(camera, vrView.baseYaw);
  pollGamepad(dt);
  if (tour) stepTour(); else updateMovement(dt);
  if (scene.fog?.isFogExp2) {
    const k = Math.min(1, Math.max(0, (camera.position.y - TOP_Y_BOWL * 0.6) / Math.max(10, TOP_Y_BOWL * 1.4)));
    scene.fog.density = fogBase * (1 - 0.84 * k * k * (3 - 2 * k));
  }
  syncAudienceBands();
  updateMark(clock.elapsedTime);
  scoreboard.update(dt);
  jumboMesh.tick?.(dt);
  // the playing trigger's fade line sets the grand master before anything is lit
  setGrand(fadeLineNow().level);
  // the heads swing before the bands are coloured, so a beam lights what it points at now
  irHeads.update(dt, orbFX.mode === 'design' ? showEngine.irParams : null);
  orbFX.update(dt);
  fasciaFX.update(dt);
  followShow(dt, clock.elapsedTime);
  // wash bounce onto the 2D crowd: sum the live show lights, keep it subtle
  _crowdTint.setRGB(0, 0, 0);
  for (const s of showLights) {
    if (s.visible) _crowdTint.add(_tintC.copy(s.color).multiplyScalar(Math.min(1.5, s.intensity / 900)));
  }
  _crowdTint.multiplyScalar(0.12);
  crowdFX.setShowTint(_crowdTint, dt);
  smokeFX.setTint?.(_crowdTint);
  crowdFX.update(dt);
  updateFollowSpot(dt);
  // moving risers: motor-speed glide toward the console targets; groups are
  // recreated on stage rebuilds, so drive them fresh every frame
  LIFTS.b += Math.max(-dt * 1.1, Math.min(dt * 1.1, liftTargets.b - LIFTS.b));
  LIFTS.a += Math.max(-dt * 1.1, Math.min(dt * 1.1, liftTargets.a - LIFTS.a));
  if (stage.bLift) stage.bLift.position.y = LIFTS.b;
  if (stage.aLift) stage.aLift.position.y = LIFTS.a;
  audioFX.update(dt);
  if (helpOn) updateHelp(dt);
  pyroFX.update(dt);
  propsFX.update(dt);
  balloonFX.update(dt);
  arenaFX.update(dt);
  smokeFX.update(dt);
  vPresets.update(dt);
  // jumbotron winch. Show height 18.4; RETRACT docks it snugly in the truss
  // forest just under the ceiling deck — it never pierces the roof geometry
  // and never pops out of existence, so there is nothing to glitch.
  jumboMesh.position.y += ((jumboUp ? SPEC.jumbo.up : JUMBO_HANG) - jumboMesh.position.y) * Math.min(1, dt * 1.4);
  // props pulse between the console's rig colours; a throttled partial set
  if ((frames & 15) === 0) propsFX.set({ colorA: rigFX.colorA, colorB: rigFX.colorB });
  if (currentMode === 'concert') { rigFX.update(dt, camera); bstageFX.update(dt); if ((frames & 7) === 0) syncRigLights(); }
  syncVideoToTransport();
  if (stage.sphere) {   // the globe turns; patterns animate and take the rig colours; 'rig' follows colour A
    stage.sphere.rotation.y += dt * sphereSpin;
    const pu = stage.patternMat.uniforms;
    pu.uTime.value += dt; pu.uColorA.value.copy(rigFX.colorA); pu.uColorB.value.copy(rigFX.colorB);
    if (sphereLook === 'rig') stage.sphereMat.color.copy(rigFX.colorA).multiplyScalar(1.4);
  }
  lookPass.uniforms.uTime.value += dt;
  ceiling.tick?.(dt);   // the stadium's stars twinkle
  grounds?.tick(dt);    // the festival's big wheel turns
  fireworksFX.tick(dt, camera);
  for (const t of led.textures) t.offset.x += dt * 0.02;

  // adaptive resolution: keep mouse-look latency low on big/retina windows.
  // Runs BEFORE the render so a resize is refilled in the same task — resizing
  // after presenting flashes one cleared (black) frame.
  // a single long frame (layout hitch, texture upload) is capped so it can't
  // masquerade as sustained slowness; a genuinely slow machine still reads slow
  frames++; accum += Math.min(dt, 0.03);
  if (dt > 0.002 && dt < minDt) minDt = dt;
  if (frames === 45 && !renderer.xr.isPresenting && !exporting) {
    const avg = accum / frames;
    const now = clock.elapsedTime;
    const maxPR = MAX_PR;
    if (now > prCeilingUntil) prCeiling = Infinity;
    // dead band + several consecutive votes before acting, so a frame time
    // sitting near a threshold can never oscillate. In the headset the goal is
    // a steady 45+, not 60 — chasing 60 on a phone just parks the resolution
    // on the floor.
    const hz60 = !VR && minDt > 0.0145;
    calm = avg < 0.0172 ? calm + 1 : 0;
    const wantDown = avg > (VR ? 0.0222 : hz60 ? 0.0185 : 0.0155);   // slower than ~45 / ~54 / ~65 fps
    const wantUp = (avg < (VR ? 0.0140 : 0.0135) || (hz60 && calm >= 8))   // faster than ~71 / ~74 fps
      && pixelRatio + 0.05 < Math.min(maxPR, prCeiling);
    if (wantDown) prVotes = Math.max(0, prVotes) + 1;
    else if (wantUp) prVotes = Math.min(0, prVotes) - 1;
    else prVotes = 0;                              // in the band: stay put
    let target = pixelRatio;
    if (prVotes >= 2) {
      // stepping down right after stepping up: that level is too much for
      // this scene right now — don't retry it for a while
      if (prSteppedUpAt >= 0 && now - prSteppedUpAt < 4) { prCeiling = pixelRatio; prCeilingUntil = now + 45; }
      target = Math.max(MIN_PR, pixelRatio - 0.15); prVotes = 0;
    } else if (prVotes <= -3) { target = Math.min(maxPR, pixelRatio + 0.1); prVotes = 0; prSteppedUpAt = now; calm = 0; }
    if (Math.abs(target - pixelRatio) > 0.01) {
      pixelRatio = target;
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      rigFX.setViewport(camera, window.innerHeight);
    }
    if (fpsEl) fpsEl.textContent = `${Math.round(1 / avg)} FPS`;
    frames = 0; accum = 0;
  }

  // Stereo bypasses the composer, so there is no bloom in the headset: the
  // post chain would have to run per eye, which is exactly the cost a phone
  // does not have. Tone mapping still applies (set on the renderer).
  if (vrView.stereoOn) stereo.render(scene, camera);
  else if (renderer.xr.isPresenting) renderer.render(scene, camera);
  else { if (hazePass.enabled) hazeTick(); composer.render(); }
  // the loading screen lifts once the room's materials are ready and a few frames are on screen
  if (bootFrames > 0 && bootReady && bootMenu && --bootFrames === 0) window.__boot?.done();
  // a recording takes the frame now, while the WebGL buffer can still be read
  if (exportFrame) exportFrame();
  if (birdMode !== 'off' && !renderer.xr.isPresenting && !vrView.stereoOn) renderBirdView();

  // screenshot: canvas only, no UI. Captured here — immediately after the
  // render — because the WebGL buffer is only readable in the same task.
  if (wantShot) {
    wantShot = false;
    renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      a.download = `hand-tracker-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
    const flash = document.getElementById('snapFlash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
  }


}
// --- defaults: black seats, fast 2D seats, wristbands that stay still ------------
applySeatColor('#141418');
{ const sc = document.getElementById('seatColor'); if (sc) sc.value = '#141418'; }
bowl.setSeatStyle('flat');
{ const b = document.getElementById('seatLowBtn'); if (b) { b.classList.add('active'); b.textContent = 'Fast seats · on'; } }
orbFX.set({ animMode: 0 });
document.querySelectorAll('[data-anim]').forEach((b) => b.classList.toggle('active', b.dataset.anim === '0'));

// --- the audience's own wristbands ---------------------------------------------------
// The seats' bands are the show's picture: they stay put, people or no people.
// The audience can carry smaller bands of its own: a second band per seat,
// sharing the seat band's position and colour buffers (so it shows the same
// show at no extra cost) but drawn at their own size and moving with the
// person holding it: a gentle sway, and the arms when the crowd moves.
// `size` is absolute (the seat pixels are orbFX._size): a quarter of the
// built orb, half a seat pixel, unless the panel says otherwise.
const audienceBands = { on: false, meshes: [], size: 0.25, glow: 1 };
let seatGlow = 1;   // Settings → Pixels → Glow: a multiplier on the dots' light, so more of it blooms
// The seat pixels can go too (the panel's pixel setting): their material is
// hidden rather than the mesh, so OrbFX keeps painting the colour buffer the
// hand-held bands read from.
let seatPixelsOn = true;
function syncAudienceBands() {
  orbFX.groups.forEach((g, gi) => {
    const f = g.mesh.material?.userData?.follow;
    if (f && f.value !== 0) f.value = 0;   // seat bands never move (a rebuilt floor comes back as 1)
    if (g.mesh.material && g.mesh.material.visible !== seatPixelsOn) g.mesh.material.visible = seatPixelsOn;
    if (g.mesh.material?.color && g.mesh.material.color.r !== seatGlow) g.mesh.material.color.setScalar(seatGlow);
    let e = audienceBands.meshes[gi];
    if (!audienceBands.on && !e) return;
    if (!e || e.userData.src !== g.mesh || e.userData.size !== orbFX._size || e.userData.band !== audienceBands.size) {
      if (e) { e.parent?.remove(e); e.geometry.dispose(); e.material.dispose(); }
      const geo = g.mesh.geometry.clone();
      const k = audienceBands.size / orbFX._size;   // the seat geometry carries the pixels' size
      geo.scale(k, k, k);
      const mat = g.mesh.material.clone();
      mat.visible = true;   // whatever the seat pixels are doing
      mat.userData.follow = { value: 2 };
      billboardInstanced(mat, { follow: 2, waveMute: gi === 0 ? 0 : 1 });
      e = new THREE.InstancedMesh(geo, mat, g.mesh.count);
      e.instanceMatrix = g.mesh.instanceMatrix;
      e.instanceColor = g.mesh.instanceColor;
      e.frustumCulled = false;
      e.userData.src = g.mesh;
      e.userData.size = orbFX._size;
      e.userData.band = audienceBands.size;
      (g.mesh.parent || scene).add(e);
      audienceBands.meshes[gi] = e;
    }
    e.count = g.mesh.count;
    e.visible = audienceBands.on && g.mesh.visible;
    if (e.material.color && e.material.color.r !== audienceBands.glow) e.material.color.setScalar(audienceBands.glow);
  });
}
// The pixel setting: which of the seat pixels, the people and the bands in
// their hands are in the room.
const PIXEL_MODES = {
  seats: { pixels: true, people: false, bands: false },
  people: { pixels: true, people: true, bands: false },
  all: { pixels: true, people: true, bands: true },
  bands: { pixels: false, people: true, bands: true },
};
// a console slider, moved the way a hand would move it, so its panel stays true
const nudge = (id, v) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const audience = {
  get people() { return crowdFX.mode !== 'off'; },
  // through the console's own buttons, so its panel stays true
  setPeople(on) { document.querySelector(`[data-people="${on ? 'idle' : 'off'}"]`)?.click(); },
  get bands() { return audienceBands.on; },
  setBands(on) { audienceBands.on = !!on; syncAudienceBands(); },
  get pixels() { return seatPixelsOn; },
  setPixels(on) { seatPixelsOn = !!on; syncAudienceBands(); },
  get mode() {
    const now = { pixels: this.pixels, people: this.people, bands: this.bands };
    return Object.keys(PIXEL_MODES).find((k) => Object.keys(now).every((q) => PIXEL_MODES[k][q] === now[q])) || null;
  },
  setMode(m) {
    const want = PIXEL_MODES[m];
    if (!want) return;
    this.setPixels(want.pixels);
    if (this.people !== want.people) this.setPeople(want.people);
    this.setBands(want.bands);
  },
  // sizes: the seat pixels and the hand-held bands, each on its own
  get pixelSize() { return orbFX._size; },
  setPixelSize(k) { orbFX.setSize(Math.min(1.5, Math.max(0.15, +k || 0.5))); syncAudienceBands(); },
  get pixelGlow() { return seatGlow; },
  setPixelGlow(k) { seatGlow = Math.min(2.5, Math.max(0.3, +k || 1)); syncAudienceBands(); },
  get bandGlow() { return audienceBands.glow; },
  setBandGlow(k) { audienceBands.glow = Math.min(2.5, Math.max(0.3, +k || 1)); syncAudienceBands(); },
  get bandSize() { return audienceBands.size; },
  setBandSize(k) { audienceBands.size = Math.min(0.75, Math.max(0.08, +k || 0.25)); syncAudienceBands(); },
  // how fast the crowd moves the bands it holds: the people and the sway together
  get bandSpeed() { return crowdFX.speed; },
  setBandSpeed(v) {
    v = Math.min(3, Math.max(0.2, +v || 1));
    nudge('peopleSpeed', v);
    nudge('animSpeed', v);
    crowdFX.set({ speed: v });
    orbFX.set({ animSpeed: v });
  },
};

// --- more camera angles, framed for the show on the crowd ----------------------------
// Worked out from the bowl itself (its inner edge and its top row), so the
// same views fit the arena and the stadium.
const TOP_Y = (() => { let m = 0; const q = bowl.orbPos; for (let i = 1; i < q.length; i += 3) if (q[i] > m) m = q[i]; return m; })();
const TOP_Y_BOWL = TOP_Y;
// `key` is what the video tour asks for, whatever a room calls the view
const SHOW_ANGLES = IS_FESTIVAL ? [
  // no stands at a festival: the crowd from the stage, from the back, from
  // the side, from the corner and from above, and from the middle of it
  { key: 'stage', name: 'Stage High', pos: [DOWNSTAGE_X + 2, 16, 0], look: [BOWL_A, 0, 0], fly: true, air: true },
  { key: 'far', name: 'Back of the Field', pos: [BOWL_A + 4, 18, 0], look: [DOWNSTAGE_X, 2, 0], fly: true, air: true },
  { key: 'across', name: 'Across the Crowd', pos: [10, 13, -(BOWL_B + 10)], look: [10, 0, 26], fly: true, air: true },
  { key: 'corner', name: 'Corner High', pos: [BOWL_A, 28, BOWL_B + 4], look: [-12, 0, -8], fly: true, air: true },
  { key: 'overhead', name: 'Overhead', pos: [10, 80, 0.5], look: [10, 0, 0], fly: true, air: true },
  { key: 'crowd', name: 'In the Crowd', pos: [6, EYE, 8], look: [DOWNSTAGE_X, 6, 0], fly: false },
] : [
  // the end views stay low enough to look under a hanging scoreboard
  { key: 'stage', name: 'Stage High', pos: [-(BOWL_A - 4), TOP_Y * 0.36, 0], look: [BOWL_A, TOP_Y * 0.2, 0], fly: true, air: true },
  { key: 'far', name: 'Far End High', pos: [BOWL_A - 4, TOP_Y * 0.36, 0], look: [-BOWL_A, TOP_Y * 0.2, 0], fly: true, air: true },
  // low on the near side, looking up at the far stands: the halo board hangs
  // across the middle of the bowl, and from any higher it fills the frame
  { key: 'across', name: 'Across the Bowl', pos: [0, TOP_Y * 0.18, -(BOWL_B - 1)], look: [0, TOP_Y * 0.36, BOWL_B + TOP_Y], fly: true, air: true },
  { key: 'corner', name: 'Corner High', pos: [BOWL_A - 6, TOP_Y * 0.5, BOWL_B - 2], look: [-BOWL_A * 0.6, TOP_Y * 0.12, -BOWL_B], fly: true, air: true },
  { key: 'overhead', name: 'Overhead', pos: [BOWL_A * 0.45, TOP_Y * 0.8, 0.5], look: [0, 0, 0], fly: true, air: true },
  { key: 'crowd', name: 'In the Crowd', pos: [BOWL_A * 0.45, EYE, BOWL_B * 0.35], look: [-BOWL_A, TOP_Y * 0.2, 0], fly: false },
];
const SHOW_ANGLE_START = ANGLES.length;
ANGLES.push(...SHOW_ANGLES);

// --- video export -----------------------------------------------------------------------
// The 3D view alone is recorded (none of the windows), 1920x1080 at 60 frames
// a second, for exactly as long as asked, with the song when one is loaded
// (started from the top, so the cues play as built). The camera cuts between
// slow shots kept close to the venue (orbits, over the crowd, a crane up, the
// rim, the stage, straight down...), dealt in a new order on "Mix it up", with
// any views picked by hand mixed in. At a chosen moment (0:40 unless told
// otherwise) it starts tight on the middle of the main screen and pulls
// straight back and up over seven seconds to show the whole stadium. With
// the PixMob outro, the show fades to black with the song in the half second
// before it, the song stops, the outro plays and its last half second fades
// to black. Every frame is put together in a 2D frame of its own (the 3D view
// or the outro, then the fade) and that frame is what is recorded.
const REC = { W: 1920, H: 1080, FPS: 60, FADE: 0.5, PULL: 7, OUTRO: 'assets/outro/pixmob-outro.mp4' };
// The sizes a recording can be. Each is rendered bigger than it is saved and
// drawn down into the frame (supersampled), so the crowd's thousands of dots
// and every edge come out clean instead of stair-stepped; and each gets a
// bitrate high enough that the encoder doesn't smear the sparkle into blocks.
const REC_SIZES = {
  1080: { W: 1920, H: 1080, render: 1.5, mbps: 40, avc: 'avc1.64002a' },
  1440: { W: 2560, H: 1440, render: 1.5, mbps: 60, avc: 'avc1.640033' },
  2160: { W: 3840, H: 2160, render: 1, mbps: 100, avc: 'avc1.640034' },
};
let exportFrame = null;   // set while recording: draws the frame just rendered into the recording
const smooth01 = (k) => k * k * (3 - 2 * k);
// the main screen as it hangs now: its middle, which way it faces, its size
function mainScreen() {
  let best = null, bestA = 0;
  showRig.group.updateMatrixWorld(true);
  const sz = new THREE.Vector3(), ws = new THREE.Vector3();
  showRig.group.traverse((o) => {
    if (!o.isMesh || o.material !== showRig.wallMat || !o.geometry) return;
    for (let q = o; q; q = q.parent) if (!q.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    o.geometry.boundingBox.getSize(sz);
    o.getWorldScale(ws);
    const area = Math.max(sz.x * ws.x * sz.y * ws.y, sz.x * ws.x * sz.z * ws.z);
    if (area > bestA) { bestA = area; best = o; }
  });
  if (!best) return null;
  const c = new THREE.Vector3(), size = new THREE.Vector3();
  best.geometry.boundingBox.getCenter(c);
  best.geometry.boundingBox.getSize(size);
  best.localToWorld(c);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(best.matrixWorld);
  n.y = 0;
  if (n.lengthSq() < 1e-4) n.set(1, 0, 0);
  n.normalize();
  if (n.dot(new THREE.Vector3(-c.x, 0, -c.z)) < 0) n.negate();   // it faces the crowd
  return { c, n, w: Math.max(size.x, size.z), h: size.y };
}
// the size of the ground: how far the seats reach each way, and how high
function groundSize() {
  const b = showEngine.planBounds();
  const R = Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1), 40);
  const top = IS_FESTIVAL ? 30 : Math.max(12, TOP_Y_BOWL);
  return { R, top, sx: SPEC.downstageX ?? -R * 0.6 };
}
// A shot is how long it lasts and where the camera is at each moment of it:
// at(k, cam) fills cam.pos, cam.look and cam.fov for k from 0 to 1.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const easeSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
function lineShot(from, to, lookFrom, lookTo = lookFrom, fov = 55) {
  return { at: (k, c) => { const e = easeSine(k); c.pos.lerpVectors(from, to, e); c.look.lerpVectors(lookFrom, lookTo, e); c.fov = fov; } };
}
// --- the shots ----------------------------------------------------------------------------
// A recording is a run of slow shots, each about seven seconds, cut together:
// low and high orbits, flying in over the crowd, a crane up out of the crowd,
// a run along the rim, the view from the stage, a fly-through, a corner
// reveal, straight down... all kept close to the venue, the bowl and the
// crowd filling the picture. The order (and each shot's side and starting
// point) comes from a seed, so "Mix it up" deals a new run and the panel can
// list exactly what will be recorded. Shots of your own (a move from A to B,
// at the time you choose) go in where you put them, and the camera's own
// fill the gaps. Indoors every shot stays under the roof.
function shotGeo() {
  const b = showEngine.planBounds();
  const RX = Math.max(Math.abs(b.x0), Math.abs(b.x1), 30), RZ = Math.max(Math.abs(b.z0), Math.abs(b.z1), 25);
  const top = IS_FESTIVAL ? 30 : Math.max(12, TOP_Y_BOWL);
  // indoors every shot stays under the roof steel; the scoreboard is kept
  // out of the picture by the sight-line check (shotOk), not by flying low
  let roof = Infinity;
  if (!IS_STADIUM) {
    const cb = new THREE.Box3().setFromObject(ceiling.group || ceiling);
    roof = Math.max(10, (isFinite(cb.min.y) ? cb.min.y : SPEC.roofY || TOP_Y_BOWL) - 2);
  }
  // where the stage is, to look at from the stands
  const middle = currentMode === 'concert' && stageCfg.position === 'middle';
  const sx = SPEC.downstageX ?? -RX * 0.5;
  const stage = middle ? V3(0, 6, 0) : V3(currentMode === 'concert' ? deriveStage(stageCfg).frontX - 6 : sx, 6, 0);
  // the board itself, not the thin cables it hangs from
  let jumbo = null;
  if (!IS_STADIUM && jumboMesh.visible) {
    jumboMesh.updateMatrixWorld(true);
    jumbo = new THREE.Box3();
    const b = new THREE.Box3();
    jumboMesh.traverse((o) => { if (o.isMesh) { b.setFromObject(o); if (b.max.x - b.min.x > 1) jumbo.union(b); } });
    jumbo.expandByScalar(0.6);
  }
  return { RX, RZ, R: Math.max(RX, RZ), top, roof, indoor: !IS_STADIUM, sx, stage, jumbo, A: BOWL_A, B: BOWL_B, out: IS_STADIUM ? 1 : 0.86 };
}
// --- is a shot any good? ---------------------------------------------------------------
// The camera must be in the open (above the seats it is over, inside the
// building's walls) and see what it looks at: no tier, wall, deck or
// scoreboard in the way. The bowl is a height field (groundHeightAt), so a
// sight line is walked in steps, each checked against the surface under it.
const topAt = (x, z) => groundHeightAt(x, z, 1e4);   // Infinity: in the outer wall, or inside something solid
function openAt(G, p, pad) {
  const h = topAt(p.x, p.z);
  if (isFinite(h)) return p.y > h + pad;
  return !G.indoor && p.y > G.top + 4;               // outside the walls: only from the sky, outdoors
}
const _ray = new THREE.Ray(), _hit = new THREE.Vector3();
function seesIt(G, from, to) {
  const n = 28;
  for (let i = 2; i < n - 2; i++) {
    const k = i / n, x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k, z = from.z + (to.z - from.z) * k;
    const h = topAt(x, z);
    if (isFinite(h) ? y < h + 0.25 : (G.indoor || y < G.top + 2)) return false;
  }
  if (G.jumbo) {
    _ray.origin.copy(from); _ray.direction.subVectors(to, from);
    const len = _ray.direction.length();
    _ray.direction.normalize();
    if (_ray.intersectBox(G.jumbo, _hit) && _hit.distanceTo(from) < len) return false;
  }
  return true;
}
// the scoreboard in the way: its outline, as the shot's lens sees it (16:9),
// covering the middle of the picture or more than a tenth of it
const _jcam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 2000), _jp = new THREE.Vector3();
function jumboInFrame(G, c) {
  _jcam.fov = c.fov || 55; _jcam.position.copy(c.pos); _jcam.lookAt(c.look);
  _jcam.updateProjectionMatrix(); _jcam.updateMatrixWorld(true);
  const B = G.jumbo;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, front = 0;
  for (let k = 0; k < 8; k++) {
    _jp.set(k & 1 ? B.max.x : B.min.x, k & 2 ? B.max.y : B.min.y, k & 4 ? B.max.z : B.min.z);
    _jp.applyMatrix4(_jcam.matrixWorldInverse);
    if (_jp.z >= -0.1) continue;            // a corner behind the lens: the rest say where it shows
    front++;
    _jp.applyMatrix4(_jcam.projectionMatrix);
    x0 = Math.min(x0, _jp.x); x1 = Math.max(x1, _jp.x); y0 = Math.min(y0, _jp.y); y1 = Math.max(y1, _jp.y);
  }
  if (!front) return false;                 // behind the camera
  if (B.distanceToPoint(c.pos) < 4) return true;   // right up against it
  const cx0 = Math.max(-1, x0), cx1 = Math.min(1, x1), cy0 = Math.max(-1, y0), cy1 = Math.min(1, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return false;   // out of the picture
  const area = ((cx1 - cx0) * (cy1 - cy0)) / 4;
  const middle = cx1 > -0.12 && cx0 < 0.12 && cy1 > -0.12 && cy0 < 0.12;   // over the very centre
  return middle || area > 0.16;
}
function shotOk(G, shot) {
  const c = { pos: V3(0, 0, 0), look: V3(0, 0, 0), fov: 55 };
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    shot.at(q, c);
    if (G.indoor && c.pos.y > G.roof + 0.01) return false;
    if (G.jumbo && G.jumbo.containsPoint(c.pos)) return false;
    if (G.jumbo && jumboInFrame(G, c)) return false;
    if (!openAt(G, c.pos, 1.6) || !seesIt(G, c.pos, c.look)) return false;
  }
  return true;
}
// a seat-height point in the stands, f of the way from the front row (0) to the back (1)
// (indoors, never so far back that the roof is in the way: the furthest row that fits under it)
function standPoint(G, a, f) {
  for (let k = f; k >= 0; k -= 0.03) {
    const x = Math.cos(a) * (G.A + k * (G.RX - G.A)), z = Math.sin(a) * (G.B + k * (G.RZ - G.B));
    const h = topAt(x, z);
    if (isFinite(h) && h + 2.4 <= G.roof) return V3(x, h + 2.4, z);
  }
  return V3(Math.cos(a) * G.A * 1.1, clampY(G, 8), Math.sin(a) * G.B * 1.1);
}
// from up in the stands, the stage in front: a slow drift along the rows
function fromStands(G, r, s, f, fov) {
  const a0 = s * (0.12 + r * 1.1);      // anywhere from the end facing the stage round to the sides
  const p0 = standPoint(G, a0, f), p1 = standPoint(G, a0 + s * 0.16, f);
  const look = G.stage;
  return { at: (q, c) => { c.pos.lerpVectors(p0, p1, easeSine(q)); c.look.copy(look); c.fov = fov; } };
}
const clampY = (G, y) => Math.min(G.roof, y);
// on the ellipse through the stands, k of the way out (1: their back edge)
const ell = (G, a, k, y) => V3(Math.cos(a) * G.RX * k * G.out, clampY(G, y), Math.sin(a) * G.RZ * k * G.out);
const orbit = (G, a0, a1, k, y0, y1, look, fov) => ({ at: (q, c) => {
  const e = easeSine(q), a = a0 + (a1 - a0) * e;
  c.pos.copy(ell(G, a, k, y0 + (y1 - y0) * e));
  c.look.copy(look); c.fov = fov;
} });
// the shot types: name, and how to make one (G: the venue's size; r: a random number 0..1; s: a side, 1 or -1)
const SHOT_TYPES = [
  { id: 'lowOrbit', name: 'Low orbit', make: (G, r, s) => orbit(G, 0.5 + r * 4, 0.5 + r * 4 + s * 0.34, 0.8, G.top + 12, G.top + 16, V3(G.sx * 0.2, 4, 0), 50) },
  { id: 'highOrbit', name: 'High orbit', make: (G, r, s) => orbit(G, r * 6.3, r * 6.3 + s * 0.28, 0.92, G.R * 0.78, G.R * 0.86, V3(G.sx * 0.15, 3, 0), 46) },
  { id: 'overCrowd', name: 'Over the crowd', make: (G, r, s) => lineShot(V3(G.A * 0.6, G.indoor ? 9 : 16, s * G.B * 0.25), V3(G.A * 0.32, G.indoor ? 6.5 : 13, s * G.B * 0.12), V3(G.sx, G.indoor ? 5 : 8, 0), V3(G.sx, G.indoor ? 5 : 7, 0), 55) },
  { id: 'from300', name: 'Stage from the 300s', make: (G, r, s) => fromStands(G, r, s, 0.62, 44) },
  // more places to stand: low in the 100s, the side stands across the bowl,
  // a corner high up, down on the floor in the crowd, the wing of the stage
  { id: 'front100', name: 'Stage from the 100s', make: (G, r, s) => fromStands(G, r, s, 0.18, 50) },
  { id: 'acrossBowl', name: 'Across the bowl', make: (G, r, s) => {
    const a = s * (Math.PI / 2 + (r - 0.5) * 0.7);
    const p0 = standPoint(G, a, 0.28), p1 = standPoint(G, a + s * 0.14, 0.28);
    const l0 = standPoint(G, a + Math.PI, 0.4), l1 = standPoint(G, a + Math.PI + s * 0.14, 0.4);
    return { at: (q, c) => { const e = easeSine(q); c.pos.lerpVectors(p0, p1, e); c.look.lerpVectors(l0, l1, e); c.look.y -= 3; c.fov = 50; } };
  } },
  { id: 'cornerHigh', name: 'High corner', make: (G, r, s) => {
    const a = s * (r < 0.5 ? 0.75 : 2.35);
    const p0 = standPoint(G, a, 0.82), p1 = standPoint(G, a + s * 0.1, 0.82);
    const look = V3(p0.x * 0.3, 1, p0.z * 0.3);   // down onto the floor below, the board out of the top of the picture
    return { at: (q, c) => { c.pos.lerpVectors(p0, p1, easeSine(q)); c.look.copy(look); c.fov = 54; } };
  } },
  { id: 'inCrowd', name: 'In the crowd', make: (G, r, s) => {
    const x0 = G.A * (0.15 + r * 0.35), z0 = s * G.B * (0.15 + r * 0.25);
    return lineShot(V3(x0, 2.6, z0), V3(x0 - G.A * 0.12, 2.9, z0 - s * G.B * 0.1), G.stage.clone().setY(6), G.stage.clone().setY(5.5), 60);
  } },
  { id: 'floorDolly', name: 'Floor dolly', make: (G, r, s) => {
    const z = s * G.B * 0.2, x0 = G.A * (0.05 + r * 0.2);
    const side = standPoint(G, s * Math.PI / 2, 0.35);
    return lineShot(V3(x0, 3.4, z), V3(x0 + G.A * 0.3, 3.4, z), side.clone().setX(x0).setY(side.y - 2), side.clone().setX(x0 + G.A * 0.3).setY(side.y - 2), 56);
  } },
  { id: 'stageWing', name: 'Stage wing', make: (G, r, s) => {
    const x = G.stage.x + 3, z = s * G.B * (0.32 + r * 0.12);
    return lineShot(V3(x, 7, z), V3(x + 4, 8, z * 0.9), V3(G.A * 0.6, 4, -s * G.B * 0.3), V3(G.A * 0.6, 4, -s * G.B * 0.1), 58);
  } },
  { id: 'from400', name: 'Stage from the 400s', make: (G, r, s) => fromStands(G, r, s, 0.88, 40) },
  { id: 'craneUp', name: 'Crane up', make: (G, r, s) => lineShot(V3(G.A * 0.25, 3.2, s * G.B * 0.35), V3(G.A * 0.29, clampY(G, G.top * 0.85), s * G.B * 0.4), V3(G.sx, 8, 0), V3(G.sx * 0.6, 4, 0), 56) },
  { id: 'rimRun', name: 'Along the rim', make: (G, r, s) => {
    const a0 = (s > 0 ? 0.9 : -0.9) + (r - 0.5) * 0.6;
    return { at: (q, c) => {
      const a = a0 + s * 0.26 * easeSine(q);
      c.pos.copy(ell(G, a, 0.9, G.top + 4));
      c.look.set(-c.pos.x * 0.45, G.top * 0.15, -c.pos.z * 0.45); c.fov = 52;
    } };
  } },
  { id: 'topDown', name: 'Straight down', make: (G, r, s) => ({ at: (q, c) => {
    const a = r * 6.3 + s * 0.3 * easeSine(q), h = clampY(G, G.R * 0.92 - easeSine(q) * G.R * 0.08);
    c.pos.set(Math.cos(a) * G.R * 0.08, h, Math.sin(a) * G.R * 0.08);
    c.look.set(G.sx * 0.1, 0, 0); c.fov = 54;
  } }) },
  { id: 'sideTrack', name: 'Side track', make: (G, r, s) => { const ly = G.indoor ? 4 : G.top * 0.25; return lineShot(V3(-G.A * 0.17, clampY(G, G.top * 0.75), s * G.B * 0.92), V3(G.A * 0.17, clampY(G, G.top * 0.8), s * G.B * 0.92), V3(-G.A * 0.1, ly, -s * G.B), V3(G.A * 0.1, ly, -s * G.B), 52); } },
  { id: 'stageView', name: 'From the stage', make: (G, r, s) => { const ly = G.indoor ? 5 : G.top * 0.35; return lineShot(V3(G.sx - 8, G.indoor ? 10 : 26, s * 4), V3(G.sx + 4, G.indoor ? 8.5 : 21, -s * 3), V3(G.A * 0.8, ly, 0), V3(G.A * 0.8, ly * 0.85, s * G.B * 0.15), 58); } },
  { id: 'flyThrough', name: 'Fly-through', make: (G, r, s) => lineShot(V3(G.A * 0.6, clampY(G, 34), -s * G.B * 0.15), V3(G.A * 0.05, clampY(G, 27), s * G.B * 0.06), V3(G.sx * 0.3, 6, 0), V3(G.sx, 8, 0), 55) },
  { id: 'cornerReveal', name: 'Corner reveal', make: (G, r, s) => {
    const a = (r < 0.5 ? 0.75 : 2.4) * s;
    if (G.indoor) return lineShot(ell(G, a, 0.95, G.roof * 0.55), ell(G, a, 0.8, G.roof), V3(G.sx * 0.5, 4, 0), V3(G.sx * 0.6, 3, 0), 52);
    return lineShot(ell(G, a, 1.0, G.top + 4), ell(G, a, 0.96, G.top + 30), V3(0, G.top * 0.2, 0), V3(G.sx * 0.15, 2, 0), 50);
  } },
  { id: 'slowOrbit', name: 'Slow orbit', make: (G, r, s) => orbit(G, r * 6.3, r * 6.3 + s * 0.3, 0.88, G.R * 0.6, G.R * 0.72, V3(G.sx * 0.15, 3, 0), 48) },
];
// Indoors these six fly under the scoreboard and look at the crowd in the
// stands, not up into the middle of the room (outdoors they stay as they are)
const seatsAt = (G, a, f, drop = 2) => { const p = standPoint(G, a, f); p.y -= drop; return p; };
const INDOOR_SHOTS = {
  // low over the floor crowd, the side stands filling the picture
  overCrowd: (G, r, s) => {
    const x0 = G.A * (0.45 + r * 0.2);
    return lineShot(V3(x0, 6.5, 0), V3(x0 - G.A * 0.3, 5.5, s * G.B * 0.12),
      seatsAt(G, s * (Math.PI / 2 - 0.25), 0.35), seatsAt(G, s * (Math.PI / 2 + 0.25), 0.35), 56);
  },
  // up from among the floor crowd, turning to the stands beside it
  craneUp: (G, r, s) => {
    const x = G.A * (0.15 + r * 0.3), z = s * G.B * 0.3;
    return lineShot(V3(x, 2.6, z), V3(x + 2, 9.5, z + s * 2),
      seatsAt(G, s * Math.PI / 2, 0.15, 1), seatsAt(G, s * Math.PI / 2, 0.45, 3), 58);
  },
  // along the front of the side stands, the far side's crowd across the floor
  sideTrack: (G, r, s) => {
    const a0 = s * (Math.PI / 2 + 0.35 - r * 0.2), a1 = a0 - s * 0.45;
    const p0 = standPoint(G, a0, 0.12), p1 = standPoint(G, a1, 0.12);
    return lineShot(p0, p1, seatsAt(G, a0 + Math.PI, 0.3, 3), seatsAt(G, a1 + Math.PI, 0.3, 3), 50);
  },
  // from the front of the stage, out to the crowd at the far end
  stageView: (G, r, s) => {
    const x = G.stage.x + 5, z = s * (2 + r * 4);
    return lineShot(V3(x, 4.5, z), V3(x + 3, 4.8, -z * 0.5),
      seatsAt(G, s * 0.35, 0.15, 3), seatsAt(G, -s * 0.2, 0.15, 3), 46);
  },
  // a low glide down the floor, the crowd on one side going by
  flyThrough: (G, r, s) => {
    const z = s * G.B * (0.2 + r * 0.15);
    return lineShot(V3(G.A * 0.6, 5, z), V3(G.A * 0.05, 4.5, z),
      seatsAt(G, s * 1.0, 0.3), seatsAt(G, s * 2.0, 0.3), 56);
  },
  // up out of a corner's front rows, the opposite corner's crowd coming into view
  cornerReveal: (G, r, s) => {
    const a = s * (r < 0.5 ? 0.75 : 2.35);
    const p0 = standPoint(G, a, 0.08), p1 = standPoint(G, a, 0.3);
    return lineShot(p0, p1, seatsAt(G, a + Math.PI, 0.25, 3), seatsAt(G, a + Math.PI, 0.45, 2), 54);
  },
};
for (const t of SHOT_TYPES) {
  const inside = INDOOR_SHOTS[t.id];
  if (inside) { const outside = t.make; t.make = (G, r, s) => (G.indoor ? inside(G, r, s) : outside(G, r, s)); }
}
const SHOT_BY_ID = Object.fromEntries(SHOT_TYPES.map((t) => [t.id, t]));

// --- more views (, and .) ------------------------------------------------------------
// Views worked out from this venue's own shape and checked like the video's
// shots (the camera in the open, nothing blocking it, no scoreboard filling
// the middle): the whole venue from round the stands, the stage looking out,
// the venue from above, the floor in among the crowd. Each works its pose out
// when it is picked, so a new stage moves its views with it.
function addVenueViews() {
  const G0 = shotGeo();
  const at = (pos, look) => ({ at: (q, c) => { c.pos.copy(pos); c.look.copy(look); c.fov = 60; } });
  const views = [];
  const add = (name, make) => {
    const p = make(shotGeo());
    if (p && shotOk(G0, at(p.pos, p.look))) views.push({ name, fly: true, air: true, pose: () => make(shotGeo()) });
  };
  // the whole venue from up in the stands, all the way round (the stage is at -x)
  const round = [[0, 'far end'], [0.6, 'far corner, right'], [-0.6, 'far corner, left'], [1.5, 'right side'], [-1.5, 'left side'], [2.3, 'near corner, right'], [-2.3, 'near corner, left']];
  for (const [a, where] of round) {
    add(`Overview · ${where}`, (G) => { const p = standPoint(G, a, 0.82); return { pos: p, look: V3(p.x * 0.05 + G.stage.x * 0.25, 2, p.z * 0.05) }; });
  }
  // from the stage, looking out at the crowd
  for (const [z, where] of [[0, 'centre'], [-9, 'left'], [9, 'right']]) {
    add(`Stage · looking out, ${where}`, (G) => {
      const x = G.stage.x + 3, top = topAt(x, z);
      return { pos: V3(x, (isFinite(top) ? top : 2) + 5, z), look: V3(G.A * 0.8, 6, z * 0.3) };
    });
  }
  add('Stage · high, looking out', (G) => ({ pos: V3(G.stage.x - 1, Math.min(G.roof, 13), 0), look: V3(G.A * 0.7, 3, 0) }));
  // from above, into the venue
  add('Top · the whole venue', (G) => ({ pos: V3(G.A * 0.35, G.indoor ? G.roof : G.top + 45, 0.5), look: V3(-G.A * 0.1, 0, 0) }));
  add('Top · over the stage', (G) => ({ pos: V3(G.stage.x + 22, G.indoor ? G.roof - 2 : G.top + 20, 0.5), look: V3(G.stage.x + 2, 0, 0) }));
  add('Top · over the floor', (G) => ({ pos: V3(G.A * 0.5, G.indoor ? G.roof - 4 : G.top + 10, 0.5), look: V3(G.A * 0.15, 0, 0) }));
  for (const [a, where] of [[0.9, 'right'], [-0.9, 'left']]) {
    add(`Top · from the ${where} corner`, (G) => { const p = standPoint(G, a, 0.98); p.y = Math.min(G.roof, p.y + 6); return { pos: p, look: V3(0, 0, 0) }; });
  }
  // down on the floor, among the crowd
  add('Floor · over the middle', (G) => ({ pos: V3(G.A * 0.3, 6, 0.5), look: G.stage.clone().setY(4) }));
  add('Floor · at the back, facing the stage', (G) => ({ pos: V3(G.A * 0.62, 6.5, G.B * 0.12), look: G.stage.clone().setY(4) }));
  add('Floor · turned round to the crowd', (G) => ({ pos: V3(G.stage.x + 14, 6, 0.5), look: V3(G.A, 7, 0) }));
  ANGLES.push(...views);
  // every view, old and new, is looked over: one too low to the ground, or
  // with the scoreboard over the middle of the picture, is left out of the
  // cycle (, . and the camera button step over it)
  const c = { pos: V3(0, 0, 0), look: V3(0, 0, 0), fov: camera.fov || 72 };
  let left = 0;
  for (const a0 of ANGLES) {
    const a = a0.pose ? a0.pose() : (a0.concert || a0);
    const pos = a.pos?.isVector3 ? a.pos : V3(...a.pos), look = a.look?.isVector3 ? a.look : V3(...a.look);
    if (!a0.pose && !a0.air) { const g = groundHeightAt(pos.x, pos.z, pos.y + 2); if (isFinite(g)) pos.y = g + EYE; }
    c.pos.copy(pos); c.look.copy(look);
    a0.skip = pos.y < 4 || (G0.jumbo && jumboInFrame(G0, c));
    if (!a0.skip) left++;
  }
  return left;
}

// a shot of your own: it moves from where you set A to where you set B (with
// no B, it holds A and drifts in a little)
const viewLook = (v) => V3(...v.p).add(new THREE.Vector3(0, 0, -80).applyQuaternion(new THREE.Quaternion(...v.q)));
function myShot(a, b) {
  const pa = V3(...a.p), la = viewLook(a), fa = a.fov || 55;
  const end = b || { p: pa.clone().lerp(la, 7 / 80).toArray(), q: a.q, fov: fa };
  const pb = V3(...end.p), lb = viewLook(end), fb = end.fov || fa;
  return { at: (q, c) => {
    const e = easeSine(q);
    c.pos.lerpVectors(pa, pb, e);
    c.look.lerpVectors(la, lb, e);
    c.fov = fa + (fb - fa) * e;
  } };
}
// a repeatable random run from a seed
function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The run of shots for `len` seconds of show: [{ t0, t1, kind, id, name, ... }].
// Your shots (mine: [{ t, d, a, b }]) go exactly where you put them and the
// pull-back at its moment (yours win where they overlap); every gap between
// them is filled with the camera's own shots, about six and a half seconds
// each, dealt from the seed. The ones you asked for come round most often:
// over the crowd, from the stage looking out, and the drone's sky views.
const FAVOURITES = ['from400', 'from300', 'acrossBowl', 'inCrowd', 'overCrowd', 'stageView', 'highOrbit', 'topDown'];
// the shots that look down from high over the middle: indoors that is the
// scoreboard and the roof, so they stay outside
const HIGH_ONLY = new Set(['highOrbit', 'topDown', 'slowOrbit']);
function shotPlan(len, pullAt, { seed = 1, mine = [] } = {}) {
  const rnd = seeded(seed);
  const deck = [];
  let last = null;
  const deal = () => {
    if (!deck.length) {
      const d = [...SHOT_TYPES.map((t) => t.id), ...FAVOURITES];   // a shot that can't see is swapped (goodShot)
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      deck.push(...d);
    }
    let id = deck.shift();
    if (id === last && deck.length) { deck.push(id); id = deck.shift(); }   // never the same twice running
    return (last = id);
  };
  // the fixed blocks: your shots, then the pull-back; a later one starts when the one before ends
  const blocks = (Array.isArray(mine) ? mine : [])
    .map((m, k) => ({ t0: Math.max(0, +m.t || 0), t1: Math.min(len, (+m.t || 0) + Math.max(1, +m.d || 6)), kind: 'mine', id: `mine${k}`, name: `My shot ${k + 1}`, mine: k }))
    .filter((b) => b.t1 - b.t0 >= 0.5 && b.t0 < len);
  if (pullAt != null && len >= REC.PULL) {
    const at = Math.min(Math.max(0, pullAt), len - REC.PULL);
    if (!blocks.some((b) => b.t0 < at + REC.PULL && b.t1 > at)) blocks.push({ t0: at, t1: at + REC.PULL, kind: 'pull', id: 'pull', name: 'Screen pull-back' });
  }
  blocks.sort((p, q) => p.t0 - q.t0);
  for (let i = 1; i < blocks.length; i++) blocks[i].t0 = Math.max(blocks[i].t0, blocks[i - 1].t1);
  const fixed = blocks.filter((b) => b.t1 - b.t0 >= 0.5);
  const plan = [];
  const fill = (t0, t1) => {
    const span = t1 - t0;
    if (span < 0.05) return;
    const n = Math.max(1, Math.round(span / 6.5));
    for (let i = 0; i < n; i++) {
      const id = deal();
      plan.push({ t0: t0 + (span * i) / n, t1: t0 + (span * (i + 1)) / n, kind: 'type', id, name: SHOT_BY_ID[id].name, r: rnd(), s: rnd() < 0.5 ? -1 : 1 });
    }
  };
  let at = 0;
  for (const b of fixed) { fill(at, b.t0); plan.push(b); at = b.t1; }
  fill(at, len);
  return plan;
}
// a plan's shots, made for this venue
function buildShots(plan, mine) {
  const G = shotGeo();
  return plan.map((p) => {
    const shot = p.kind === 'pull' ? pullBackShot()
      : p.kind === 'mine' ? (mine[p.mine]?.a ? myShot(mine[p.mine].a, mine[p.mine].b) : null)
        : goodShot(G, p);   // (may swap the shot, and its name, for one that sees)
    return { ...p, shot };
  }).filter((p) => p.shot);
}
// the shot the plan dealt, if it sees the show; else the same move from
// another side or start, else another kind of shot, else the 400s
function goodShot(G, p) {
  const first = SHOT_BY_ID[p.id].make(G, p.r, p.s);
  if (shotOk(G, first)) return first;
  const rnd = seeded(Math.floor(p.r * 1e9) + 7);
  const others = SHOT_TYPES.map((t) => t.id).filter((id) => id !== p.id);
  const tries = [p.id, p.id, p.id, p.id, ...others.sort(() => rnd() - 0.5), 'from400', 'from300'];
  for (const id of tries) {
    for (let k = 0; k < 3; k++) {
      const shot = SHOT_BY_ID[id].make(G, rnd(), rnd() < 0.5 ? -1 : 1);
      if (shotOk(G, shot)) { p.name = SHOT_BY_ID[id].name; return shot; }
    }
  }
  return SHOT_BY_ID.from400.make(G, 0.3, 1);
}
// THE shot: tight on the middle of the main screen, then straight away pulling
// back and up, fast at first and easing off, until the whole ground is in view
function pullBackShot() {
  const S = mainScreen();
  if (!S) return null;
  const G = shotGeo();
  const start = S.c.clone().addScaledVector(S.n, Math.max(2.2, S.w * 0.2));
  const end = IS_STADIUM ? V3(0, 0, 0).addScaledVector(S.n, G.R * 0.95) : V3(S.c.x, 0, S.c.z).addScaledVector(S.n, BOWL_A * 1.2);
  end.y = clampY(G, IS_STADIUM ? Math.max(G.top * 1.6, G.R * 0.85) : TOP_Y_BOWL * 0.9);
  const lookEnd = V3(S.c.x * 0.15, G.top * 0.05, 0);
  return { at: (k, c) => {
    const out = 1 - (1 - k) ** 3, up = 1 - (1 - k) ** 2;      // away at once, then slower; climbing all the way
    c.pos.set(start.x + (end.x - start.x) * out, start.y + (end.y - start.y) * up, start.z + (end.z - start.z) * out);
    c.look.lerpVectors(S.c, lookEnd, smooth01(Math.min(1, k / 0.6)));
    c.fov = 26 + ((IS_STADIUM ? 48 : 58) - 26) * out;   // and the lens widens as it goes
  } };
}
// where the camera is at moment t of the show part of a recording
function tourPose(t, c) {
  const cut = tour.cuts.find((q) => t < q.t1) || tour.cuts[tour.cuts.length - 1];
  cut.shot.at(Math.min(1, Math.max(0, (t - cut.t0) / (cut.t1 - cut.t0))), c);
}
const _cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
function stepTour() {
  const t = Math.min(Math.max(0, (performance.now() - tour.t0) / 1000), tour.showLen - 1e-3);
  tourPose(t, _cam);
  camera.position.copy(_cam.pos);
  camera.lookAt(_cam.look);
  if (camera.fov !== _cam.fov) { camera.fov = _cam.fov; camera.updateProjectionMatrix(); }
}
// the camera plan for a recording with `showLen` seconds of show
function makeTour(showLen, pullAt, opts = {}) {
  return { showLen, cuts: buildShots(shotPlan(showLen, pullAt, opts), opts.mine || []) };
}
// the panel's look at one shot of the plan: the camera put where it starts
function previewShot(len, pullAt, opts, index) {
  const cuts = buildShots(shotPlan(len, pullAt, opts), opts.mine || []);
  const cut = cuts[index];
  if (!cut) return;
  cut.shot.at(0.15, _cam);
  controls.unlock?.();
  camera.position.copy(_cam.pos);
  camera.lookAt(_cam.look);
  camera.fov = _cam.fov; camera.updateProjectionMatrix();
  flying = true; velY = 0;
}

// the outro clip, loaded and ready at its first frame
function loadOutro() {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.src = REC.OUTRO;
    v.preload = 'auto';
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    const done = (ok) => { v.oncanplaythrough = v.onerror = null; res(ok ? v : null); };
    v.oncanplaythrough = () => done(true);
    v.onerror = () => done(false);
    setTimeout(() => done(v.readyState >= 3), 6000);
    v.load();
  });
}
// seconds: the whole video, outro included. outro: close with the PixMob
// clip. fromTop: start the song (and its cues) from the beginning. pullAt:
// when the screen pull-back starts, or null for none.
// shots: { seed, mine } (shotPlan): which run of shots, and your own shots with their times
// size: 1080, 1440 or 2160 (REC_SIZES)
async function recordShowVideo({ seconds = 15, outro = true, fromTop = true, pullAt = 40, shots = {}, size = 2160, reel = null, onProgress, download = true } = {}) {
  if (exporting) return null;
  const total = Math.max(3, Math.min(600, Number(seconds) || 15));
  const S = REC_SIZES[size] || REC_SIZES[2160];
  REC.W = S.W; REC.H = S.H;
  const RW = Math.min(3840, Math.round(S.W * S.render)), RH = Math.round(RW * 9 / 16);   // the size it is drawn at
  const types = [`video/mp4;codecs=${S.avc},mp4a.40.2`, 'video/mp4;codecs=avc1.640034,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = typeof MediaRecorder !== 'undefined' ? types.find((t) => MediaRecorder.isTypeSupported(t)) : null;
  if (!mime) throw new Error('This browser can’t record video. Try Chrome.');
  const clip = outro ? await loadOutro() : null;
  const outroLen = clip && isFinite(clip.duration) ? Math.min(clip.duration, total - 0.5) : 0;
  const showLen = total - outroLen;
  const canvas = renderer.domElement;
  const keep = {
    pr: renderer.getPixelRatio(), pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov,
    flying, grounded, bird: birdMode, fit: canvas.style.objectFit,
  };
  exporting = true;
  controls.unlock?.();
  if (birdMode !== 'off') setBirdMode('off');
  renderer.setPixelRatio(1);
  composer.setPixelRatio(1);
  renderer.setSize(RW, RH, false);
  composer.setSize(RW, RH);
  camera.aspect = RW / RH;
  camera.updateProjectionMatrix();
  rigFX.setViewport(camera, RH);
  canvas.style.objectFit = 'contain';   // the window keeps its shape while the frame is 16:9

  // the frame that is recorded: the 3D view (or the outro), then the fade
  const frame = document.createElement('canvas');
  frame.width = REC.W; frame.height = REC.H;
  const g2 = frame.getContext('2d', { alpha: false });
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = 'high';   // the bigger render drawn down: the anti-aliasing
  g2.fillStyle = '#000';
  g2.fillRect(0, 0, REC.W, REC.H);
  // the sound: the song (dry, as mixed) and the outro's own, each on its own
  // fader so the song can fade away before the outro comes in
  const eng = directorUI.engine;
  const ctx = audioFX.getContext();
  const mixDest = ctx.createMediaStreamDestination();
  const master = ctx.createGain(), musicGain = ctx.createGain(), clipGain = ctx.createGain();
  master.connect(mixDest);
  musicGain.connect(master);
  clipGain.connect(master);
  if (eng.out) eng.out.connect(musicGain);
  let clipSrc = null;
  if (clip) {
    try { clipSrc = ctx.createMediaElementSource(clip); clipSrc.connect(clipGain); clipGain.connect(ctx.destination); } catch (_) { clipSrc = null; }
  }
  const wasPlaying = eng.playing, wasAt = eng.time();
  const song = !!eng.buffer;
  if (song && fromTop) { eng.stop(); eng.seek(0); }

  const stream = frame.captureStream(REC.FPS);
  const mix = new MediaStream([...stream.getVideoTracks(), ...mixDest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(mix, { mimeType: mime, videoBitsPerSecond: S.mbps * 1e6, audioBitsPerSecond: 256e3 });
  let drawn = 0;   // frames put into the recording, to tell how smooth it came out
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  let songFaded = false, endFaded = false, outroOn = false, reelAt = -1;
  const cuts = reel?.length ? reelCuts(reel.length, showLen, song ? (fromTop ? 0 : wasAt) : null, songBeats(eng.buffer)) : [];
  // the show fades to black, picture and song together, in the half second
  // before the outro; the song stops; the outro plays; its last half second
  // fades to black too. With no outro, the show's own last half second does.
  const showFadeAt = clip ? showLen - REC.FADE : total - REC.FADE;
  tour = { ...makeTour(showLen, pullAt, shots), t0: performance.now() };
  stepTour();
  const black = (f) => { if (f > 0) { g2.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`; g2.fillRect(0, 0, REC.W, REC.H); } };
  exportFrame = () => {
    const t = (performance.now() - tour.t0) / 1000;
    if (outroOn) {
      g2.fillStyle = '#000';
      g2.fillRect(0, 0, REC.W, REC.H);
      if (clip.readyState >= 2) {   // the outro fills the frame, kept to its own shape
        const vw = clip.videoWidth || REC.W, vh = clip.videoHeight || REC.H, k = Math.min(REC.W / vw, REC.H / vh);
        g2.drawImage(clip, (REC.W - vw * k) / 2, (REC.H - vh * k) / 2, vw * k, vh * k);
      }
      black((t - (total - REC.FADE)) / REC.FADE);
    } else {
      g2.drawImage(canvas, 0, 0, REC.W, REC.H);
      black((t - showFadeAt) / REC.FADE);
    }
    drawn++;
  };
  rec.start(500);
  if (song && fromTop) { eng.play(); directorUI.resyncCues?.(0); }
  try {
    await new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - tour.t0) / 1000;
        onProgress?.(Math.min(1, t / total));
        if (reel?.length && t < showLen) {   // the showreel: whose turn it is, changing on the beat
          const k = reelTurn(cuts, t);
          if (k !== reelAt) { reelAt = k; showUI.restore(reel[k], { live: true }); }
        }
        if (!songFaded && t >= showFadeAt) {   // the song fades with the picture
          songFaded = true;
          const now = ctx.currentTime;
          musicGain.gain.setValueAtTime(1, now);
          musicGain.gain.linearRampToValueAtTime(0, now + REC.FADE);
          if (eng.out) { eng.out.gain.setValueAtTime(eng.out.gain.value, now); eng.out.gain.linearRampToValueAtTime(0, now + REC.FADE); }
        }
        if (clip && !outroOn && t >= showLen) {   // then it stops, and the outro starts
          outroOn = true;
          if (song) eng.pause();
          clip.currentTime = 0;
          clip.play().catch(() => {});
        }
        if (clip && !endFaded && t >= total - REC.FADE) {   // the outro's own fade to black
          endFaded = true;
          const now = ctx.currentTime;
          clipGain.gain.setValueAtTime(1, now);
          clipGain.gain.linearRampToValueAtTime(0, now + REC.FADE);
        }
        if (t >= total) res(); else setTimeout(tick, 10);
      };
      tick();
    });
  } finally {
    rec.stop();
    await stopped;
    exportFrame = null;
    stream.getTracks().forEach((tr) => tr.stop());
    mixDest.stream.getTracks().forEach((tr) => tr.stop());
    if (clip) { clip.pause(); clipSrc?.disconnect(); clipGain.disconnect(); clip.removeAttribute('src'); clip.load(); }
    if (eng.out) { try { eng.out.disconnect(musicGain); } catch (_) {} eng.out.gain.cancelScheduledValues(ctx.currentTime); eng.out.gain.value = 1; }
    musicGain.disconnect();
    master.disconnect();
    // the song goes back to where it was, playing or not
    if (song) { eng.stop(); eng.seek(wasAt); if (wasPlaying) eng.play(); }
    tour = null;
    exporting = false;
    canvas.style.objectFit = keep.fit;
    renderer.setPixelRatio(keep.pr);
    composer.setPixelRatio(keep.pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = keep.fov;
    camera.updateProjectionMatrix();
    rigFX.setViewport(camera, window.innerHeight);
    camera.position.copy(keep.pos);
    camera.quaternion.copy(keep.quat);
    flying = keep.flying; grounded = keep.grounded; velY = 0;
    if (keep.bird !== 'off') setBirdMode(keep.bird);
  }
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  // how many frames a second the room was drawn at while it recorded: under
  // 60, the Mac couldn't keep up at this size and the video will stutter
  blob.fps = Math.round(drawn / total);
  if (download) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    a.download = `wristband-show-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  return blob;
}

// --- the offline render -------------------------------------------------------------------
// Recording in real time drops a frame whenever the Mac can't draw one in a
// sixtieth of a second (4K asks a lot), and dropped frames are what make a
// video stutter. The offline render never drops one: the whole room runs on a
// clock of its own that moves exactly a sixtieth of a second per frame, however
// long each frame takes to draw, and every frame goes to the H.264 encoder
// (WebCodecs) with its exact time. The song (from the top, so the cues play as
// built), its fade and the outro's sound are mixed apart (OfflineAudioContext)
// and encoded too, then it is all written into one MP4 (mp4mux.js). It takes
// longer than the video lasts; the panel shows how far it has got.
const canRenderOffline = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
// move a video to a moment and wait until that frame is there
function seekVideo(v, t) {
  return new Promise((res) => {
    if (!v || !isFinite(v.duration) || v.duration <= 0) { res(); return; }
    const at = Math.min(Math.max(0, t), v.duration - 0.001);
    if (Math.abs(v.currentTime - at) < 0.0005 && v.readyState >= 2) { res(); return; }
    let to = 0;
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    to = setTimeout(done, 2000);
    v.addEventListener('seeked', done);
    v.currentTime = at;
  });
}
// the sound of the whole video, mixed ahead: the song (fading out before the
// outro, or at the very end) and then the outro's own, fading at the end
// --- the venue's sound, for a video ---------------------------------------------------
// "Use venue speakers for music": the song from the PA's stacks, in the room's
// reverb, heard from the camera; the crowd's own sound on top, not through
// the PA. The mix (music, crowd, room, bass) is set in Settings → Sound.
// the song into `out` from the venue's PA, exactly as it plays live (the same
// recipe, audiofx.js renderPA, with the live PA's settings: venueSound.pa()),
// heard where the camera is: the listener rides the video's shots (poseAt),
// so the sound turns and fades with every shot as it would walking the room
function venuePA(ctx, input, out, mix, poseAt = null, total = 0) {
  renderPA(ctx, input, venueSound.pa(mix)).connect(out);
  const L = ctx.listener, c = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 }, f = new THREE.Vector3();
  const at = poseAt || ((t, q) => { q.pos.set(0, 2, 0); q.look.set(-30, 4, 0); });   // no shots: the middle of the floor, facing the stage
  for (let t = 0; t <= total; t += 0.05) {
    at(t, c);
    f.subVectors(c.look, c.pos).normalize();
    L.positionX.setValueAtTime(c.pos.x, t); L.positionY.setValueAtTime(c.pos.y, t); L.positionZ.setValueAtTime(c.pos.z, t);
    L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
    L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
  }
}
async function mixRenderAudio({ total, showLen, songFrom, outroLen, venue = null, poseAt = null }) {
  const sr = 48000, ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const eng = directorUI.engine;
  const showEnd = outroLen > 0 ? showLen : total;
  // the crowd: its own sound, through no speakers, fading with the show
  if (venue && (venue.crowd ?? 1) > 0) {
    try {
      // a two-minute seamless loop cut from the crowd recording (the full hour is far too big to decode)
      const cb = await ctx.decodeAudioData(await fetch('./assets/crowd-loop-video.m4a').then((r) => r.arrayBuffer()));
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = cb; src.loop = true;
      src.connect(g); g.connect(ctx.destination);
      const lv = venueSound.crowdLevel(venue);   // the same level the live crowd plays at
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(lv, 1.2);
      g.gain.setValueAtTime(lv, Math.max(1.2, showEnd - REC.FADE));
      g.gain.linearRampToValueAtTime(0, showEnd);
      src.start(0, Math.random() * Math.max(0, cb.duration - 1));
      src.stop(showEnd);
    } catch (_) { /* no crowd sound: the music alone */ }
  }
  if (eng.buffer && songFrom != null) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = eng.buffer;
    if (venue) {   // through the venue's PA, at the music level
      venuePA(ctx, src, g, venue, poseAt, showLen);
    } else src.connect(g);
    g.connect(ctx.destination);
    const end = outroLen > 0 ? showLen : total;
    g.gain.setValueAtTime(1, 0);
    g.gain.setValueAtTime(1, Math.max(0, end - REC.FADE));
    g.gain.linearRampToValueAtTime(0, end);
    src.start(0, Math.min(songFrom, eng.buffer.duration));
    src.stop(end);
  }
  if (outroLen > 0) {
    try {
      const ob = await ctx.decodeAudioData(await fetch(REC.OUTRO).then((r) => r.arrayBuffer()));
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = ob;
      src.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(1, showLen);
      g.gain.setValueAtTime(1, Math.max(showLen, total - REC.FADE));
      g.gain.linearRampToValueAtTime(0, total);
      src.start(showLen);
    } catch (_) { /* the outro plays silent */ }
  }
  return ctx.startRendering();
}
async function encodeAudio(buf, cfg, mux) {
  let failed = null;
  const aenc = new AudioEncoder({ output: (c, m) => mux.addAudio(c, m), error: (e) => { failed = e; } });
  aenc.configure(cfg);
  const sr = buf.sampleRate, n = buf.length, step = 4800;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  for (let o = 0; o < n && !failed; o += step) {
    const m = Math.min(step, n - o), data = new Float32Array(m * 2);
    data.set(L.subarray(o, o + m), 0);
    data.set(R.subarray(o, o + m), m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round((o * 1e6) / sr), data });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();
  if (failed) throw failed;
}
const fmtLeft = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
// the same choices as recordShowVideo, and signal: an AbortSignal that stops it
// reel: shows (designer snapshots) that take turns, an equal share of the show each
async function renderShowVideo({ seconds = 15, outro = true, fromTop = true, pullAt = 40, shots = {}, size = 2160, reel = null, venue = null, onProgress, signal = null, download = true } = {}) {
  if (exporting) return null;
  const total = Math.max(3, Math.min(600, Number(seconds) || 15));
  const S = REC_SIZES[size] || REC_SIZES[2160];
  REC.W = S.W; REC.H = S.H;
  const RW = Math.min(3840, Math.round(S.W * S.render)), RH = Math.round((RW * 9) / 16);
  const FPS = REC.FPS, N = Math.round(total * FPS);
  // the encoders: H.264 at this size (the best level it takes), AAC
  let vcfg = null;
  for (const codec of [S.avc, 'avc1.640034', 'avc1.640033', 'avc1.4d0034', 'avc1.42e034']) {
    const c = { codec, width: S.W, height: S.H, bitrate: S.mbps * 1e6, framerate: FPS, avc: { format: 'avc' }, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { vcfg = c; break; } } catch (_) { /* try the next */ }
  }
  if (!vcfg) throw new Error('This browser can’t encode H.264 at this size. Try Chrome, or a smaller size.');
  const acfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 256000 };
  let audioOk = false;
  try { audioOk = (await AudioEncoder.isConfigSupported(acfg)).supported; } catch (_) { /* no sound then */ }
  const mux = new Mp4Mux({ width: S.W, height: S.H, fps: FPS, audio: audioOk ? { sampleRate: 48000, channels: 2 } : null });
  let failed = null;
  const venc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: (e) => { failed = e; } });
  venc.configure(vcfg);

  // the outro, the song and where it starts
  const clip = outro ? await loadOutro() : null;
  const outroLen = clip && isFinite(clip.duration) ? Math.min(clip.duration, total - 0.5) : 0;
  const showLen = total - outroLen;
  const eng = directorUI.engine, song = !!eng.buffer;
  const wasPlaying = eng.playing, wasAt = eng.time();
  const songFrom = song && fromTop ? 0 : song && wasPlaying ? wasAt : null;   // null: no song in this video
  // the camera's run of shots: the picture follows it, and with the venue's
  // speakers on, so does what you hear
  const plan = makeTour(showLen, pullAt, shots);
  const poseAt = (t, c) => {
    const cut = plan.cuts.find((q) => t < q.t1) || plan.cuts[plan.cuts.length - 1];
    if (cut) cut.shot.at(Math.min(1, Math.max(0, (t - cut.t0) / (cut.t1 - cut.t0))), c);
  };
  if (audioOk) {
    onProgress?.(0, 'Mixing the sound…');
    await encodeAudio(await mixRenderAudio({ total, showLen, songFrom, outroLen, venue, poseAt: plan.cuts.length ? poseAt : null }), acfg, mux);
  }

  // take the room over: its size, its camera, its clock
  const canvas = renderer.domElement;
  const keep = {
    pr: renderer.getPixelRatio(), pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov,
    flying, grounded, bird: birdMode, fit: canvas.style.objectFit,
  };
  exporting = true; offline = true;
  controls.unlock?.();
  if (birdMode !== 'off') setBirdMode('off');
  renderer.setAnimationLoop(null);
  renderer.setPixelRatio(1);
  composer.setPixelRatio(1);
  renderer.setSize(RW, RH, false);
  composer.setSize(RW, RH);
  camera.aspect = RW / RH;
  camera.updateProjectionMatrix();
  rigFX.setViewport(camera, RH);
  canvas.style.objectFit = 'contain';
  const frame = document.createElement('canvas');
  frame.width = S.W; frame.height = S.H;
  const g2 = frame.getContext('2d', { alpha: false });
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = 'high';
  // every clock in the room reads performance.now(): from here it moves a frame at a time
  const realNow = performance.now.bind(performance), t0ms = realNow();
  let vms = t0ms;
  performance.now = () => vms;
  clock.oldTime = vms;
  // the screens' film: paused, and moved to each frame's moment
  const vid = orbFX.video, vidOn = !!(vid && vid.readyState >= 1 && isFinite(vid.duration) && vid.duration > 0 && videoPreset === 'off');
  const vidWasPaused = vid ? vid.paused : true, vidStart = vid ? vid.currentTime : 0;
  if (vid) vid.pause();
  if (clip) clip.pause();
  // the song: silent, on the render's clock, its cues following
  if (song) { eng.stop(); if (songFrom != null) { eng.virtual = songFrom; eng.playing = true; directorUI.resyncCues?.(songFrom); } }
  tour = { ...plan, t0: t0ms };
  const showFadeAt = clip ? showLen - REC.FADE : total - REC.FADE;
  const black = (f) => { if (f > 0) { g2.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`; g2.fillRect(0, 0, S.W, S.H); } };
  let tNow = 0, outroNow = false, reelAt = -1;
  const cuts = reel?.length ? reelCuts(reel.length, showLen, songFrom, songBeats(eng.buffer)) : [];
  exportFrame = () => {
    if (outroNow) {
      g2.fillStyle = '#000';
      g2.fillRect(0, 0, S.W, S.H);
      if (clip.readyState >= 2) {
        const vw = clip.videoWidth || S.W, vh = clip.videoHeight || S.H, k = Math.min(S.W / vw, S.H / vh);
        g2.drawImage(clip, (S.W - vw * k) / 2, (S.H - vh * k) / 2, vw * k, vh * k);
      }
      black((tNow - (total - REC.FADE)) / REC.FADE);
    } else {
      g2.drawImage(canvas, 0, 0, S.W, S.H);
      black((tNow - showFadeAt) / REC.FADE);
    }
  };
  const started = realNow();
  try {
    for (let i = 0; i < N; i++) {
      if (failed) throw failed;
      if (signal?.aborted) throw new Error('Stopped');
      tNow = i / FPS;
      vms = t0ms + tNow * 1000;
      outroNow = !!clip && tNow >= showLen;
      if (song && songFrom != null) {
        if (tNow < showLen) { eng.virtual = songFrom + tNow; directorUI.tickCues?.(); }
        else eng.playing = false;   // the song has stopped for the outro
      }
      if (reel?.length && !outroNow) {   // the showreel: whose turn it is, changing on the beat
        const k = reelTurn(cuts, tNow);
        if (k !== reelAt) { reelAt = k; showUI.restore(reel[k], { live: true }); }
      }
      if (outroNow) {
        await seekVideo(clip, tNow - showLen);
        exportFrame();
      } else {
        if (vidOn) {
          const want = videoSyncOn && song && songFrom != null ? eng.time() % vid.duration : (vidStart + tNow) % vid.duration;
          await seekVideo(vid, want);
          wallVideoTex.needsUpdate = true;
          fasciaVideoTex.needsUpdate = true;
        }
        animate();   // one frame of the room, drawn, then taken into the frame (exportFrame)
      }
      const vf = new VideoFrame(frame, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 3 && !failed) await new Promise((r) => setTimeout(r, 2));
      const done = (i + 1) / N, took = (realNow() - started) / 1000;
      onProgress?.(done, `Rendering… ${Math.round(done * 100)}% · about ${fmtLeft((took / done) * (1 - done))} left`);
      await new Promise((r) => setTimeout(r, 0));   // let the page show how far it has got
    }
    onProgress?.(1, 'Finishing the file…');
    await venc.flush();
  } finally {
    exportFrame = null;
    delete performance.now;        // the real clock again
    clock.oldTime = performance.now();
    venc.close?.();
    if (clip) { clip.removeAttribute('src'); clip.load(); }
    if (song) { eng.virtual = null; eng.playing = false; eng.seek(wasAt); if (wasPlaying) eng.play(); }
    if (vid) { vid.currentTime = vidStart; if (!vidWasPaused) vid.play().catch(() => {}); }
    tour = null;
    offline = false; exporting = false;
    canvas.style.objectFit = keep.fit;
    renderer.setPixelRatio(keep.pr);
    composer.setPixelRatio(keep.pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = keep.fov;
    camera.updateProjectionMatrix();
    rigFX.setViewport(camera, window.innerHeight);
    camera.position.copy(keep.pos);
    camera.quaternion.copy(keep.quat);
    flying = keep.flying; grounded = keep.grounded; velY = 0;
    if (keep.bird !== 'off') setBirdMode(keep.bird);
    renderer.setAnimationLoop(animate);
  }
  const blob = mux.finish();
  blob.fps = FPS;
  if (download) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    a.download = `wristband-show-${S.H}p-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  return blob;
}

Object.assign(window.__dbg, { setPaMakeup, renderShowVideo, mixRenderAudio, mainScreen, makeTour, shotPlan, shotGeo, shotOk, SHOT_TYPES, seesIt, openAt, jumboInFrame, loadOutro, tourPose: (t, c) => tourPose(t, c), setTour: (T) => { tour = T; } });

// --- screen glow and bloom (see screenGlow above) --------------------------------------
// the screens at the panel's glow, under the trigger's fade line
function applyScreens() {
  const k = screenGlow * grandK;
  jumboMesh.setLevel?.(k);
  showRig.wallMat.color.setScalar(1.75 * k);
  if (lighting !== 'blackout') {
    led.group.traverse((o) => { const m = o.material; if (m?.userData?.lit) m.color.copy(m.userData.lit).multiplyScalar(k); });
  }
}
function setScreenGlow(k) {
  screenGlow = Math.max(0, Math.min(1.5, +k || 0));
  fasciaFX.gain = screenGlow;
  if (fasciaFX.mode !== 'off') fasciaFX.set({});   // the current mode, at the new level
  applyScreens();
}

// --- the trigger's fade line ------------------------------------------------------------
// A trigger can carry a line (pads.js keeps it with the trigger, the SHOW
// panel draws it). It is a grand master over everything the show puts out,
// the wristbands, the rig and the screens, following the line from the
// moment the trigger fires: where the line is low the room goes to black,
// while the look keeps running underneath. A cue on the director's timeline
// runs its line in song time, so a scrub lands at the level the line has
// there; a trigger fired by hand runs it on the clock.
const fadeLine = { pts: null, dur: 1, t0: 0, song: false, layer: -1, pad: -1 };
function lineAt(pts, k) {
  if (k <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (k <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + (v1 - v0) * ((k - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
}
padsUI.onFire = (layer, i, pad, { cueT = null, refire = false } = {}) => {
  if (refire && fadeLine.layer === layer && fadeLine.pad === i) return;   // a switch flipped: the line runs on
  fadeLine.layer = layer; fadeLine.pad = i;
  const f = pad?.fade;
  if (!f || !Array.isArray(f.pts) || f.pts.length < 2 || !(f.dur > 0)) { fadeLine.pts = null; return; }
  fadeLine.pts = f.pts; fadeLine.dur = f.dur;
  fadeLine.targets = f.targets || null;   // what it fades; null = everything
  fadeLine.song = Number.isFinite(cueT);
  fadeLine.t0 = fadeLine.song ? cueT : performance.now() / 1000;
};
// where the line stands: its level (1 with no line) and how far along it is (0..1, -1 for none)
function fadeLineNow() {
  if (!fadeLine.pts) return { level: 1, k: -1, layer: fadeLine.layer, pad: fadeLine.pad };
  const now = fadeLine.song ? directorUI.engine.time() : performance.now() / 1000;
  const k = Math.max(0, Math.min(1, (now - fadeLine.t0) / fadeLine.dur));
  return { level: lineAt(fadeLine.pts, k), k, layer: fadeLine.layer, pad: fadeLine.pad };
}
// The trigger chooses what its line fades (fade.targets; everything when it
// says nothing): the wristbands, the rig, the room's lights, the video (every
// screen and ribbon board) and the crowd (the people themselves).
const FADE_TARGETS = ['orbs', 'rig', 'lights', 'video', 'crowd'];
function applyLightsFade() {
  for (const l of houseLights) if (l.userData.applied != null) l.intensity = l.userData.applied * lightsK;
  for (const w of bowlWashes) if (w.userData.applied != null) w.intensity = w.userData.applied * lightsK;
  if (hemi.userData.applied != null) hemi.intensity = hemi.userData.applied * lightsK;
}
let grandKey = '';
function setGrand(level) {
  const T = fadeLine.pts ? fadeLine.targets : null;
  const on = (t) => !T || T[t] !== false;
  const key = `${level.toFixed(3)}|${FADE_TARGETS.map((t) => (on(t) ? 1 : 0)).join('')}`;
  if (key === grandKey) return;
  grandKey = key;
  const k = level ** 2.2;   // the line is what the eye sees; the lights take linear light
  orbFX.grand = on('orbs') ? k : 1;
  orbFX._staticDirty = true;
  rigFX.grand = on('rig') ? k : 1;
  grandK = on('video') ? k : 1;
  fasciaFX.grand = grandK;
  applyScreens();
  lightsK = on('lights') ? k : 1;
  applyLightsFade();
  crowdFX.grand = on('crowd') ? k : 1;
  crowdFX.set({});
}
function setBloomGain(k) {
  bloomGain = Math.max(0, Math.min(1.5, +k || 0));
  bloom.strength = baseBloom * hazeBloomK * bloomGain;
}

// --- the simple SHOW panel: preset, colour, audience, camera, export -------------------
const room = {
  get dark() { return lighting === 'blackout'; },
  setDark(on) { setLighting(on ? 'blackout' : 'game'); },
  // Settings → Room: what this venue has, and nothing it hasn't
  suites: bowl.suites ? {
    get on() { return !!document.getElementById('suiteLightsBtn')?.classList.contains('active'); },
    set(on) { const b = document.getElementById('suiteLightsBtn'); if (b && b.classList.contains('active') !== !!on) b.click(); },
  } : null,
  jumbo: !IS_STADIUM && !IS_FESTIVAL ? {
    get on() { return jumboMesh.visible; },
    set(on) { const b = document.getElementById('jumboVisBtn'); if (b && jumboMesh.visible !== !!on) b.click(); },
    get up() { return jumboUp; },
    setUp(up) { if (jumboUp !== !!up) document.getElementById('jumboLift')?.click(); },
  } : null,
  banners: ceiling?.banners ? {
    get on() { return ceiling.banners.visible; },
    set(on) { const b = document.getElementById('bannersBtn'); if (b && ceiling.banners.visible !== !!on) b.click(); },
  } : null,
  leds: bowl.fascias?.length ? {
    get on() { return fasciaFX.mode !== 'off'; },
    set(on) { document.querySelector(`[data-fascia="${on ? 'show' : 'off'}"]`)?.click(); },
  } : null,
  screens: {
    get on() { return !screensOff; },
    set(on) { screensOff = !on; applyVideoRoute(); },
    upload() { document.getElementById('video-input')?.click(); },
    file: () => (videoPreset === 'show' ? null : screenVideoFile?.name || null),
    get effect() { return videoPreset === 'show'; },
    showEffect() { document.querySelector('[data-vpreset="show"]')?.click(); },
  },
};
// --- the venue's own lights follow the show -------------------------------------------
// Switched on, the VIP suites and the LED ribbons take the show's colour: the
// bright bands, averaged (the brightest count most), at full strength, eased
// so a cut reads as a quick fade. With no show on they glow warm white.
const showTint = new THREE.Color(1, 0.82, 0.58);
const WARM = new THREE.Color(1, 0.82, 0.58), _tintWant = new THREE.Color();
const suiteSwitch = document.getElementById('suiteLightsBtn');
let tintAt = -1, tintTarget = WARM;
const _tintB = new THREE.Color(), _pts = new Float32Array(600 * 4);
let showLift = 0;   // how lit the bands are on average, 0..1 (the show's energy)
function sampleShowColour() {
  const g = orbFX.groups[0];
  const a = g?.mesh?.instanceColor?.array;
  if (!a) return null;
  const n = g.n, step = Math.max(1, Math.floor(n / 800));
  let r = 0, gr = 0, b = 0, w = 0, lit = 0, cnt = 0, np = 0;
  for (let i = 0; i < n; i += step) {
    const R = a[i * 3], G = a[i * 3 + 1], B = a[i * 3 + 2], m = Math.max(R, G, B), k = m * m;
    r += R * k; gr += G * k; b += B * k; w += k; lit += Math.min(1, m); cnt++;
    if (m > 0.25 && np < 600) { _pts[np * 4] = R / m; _pts[np * 4 + 1] = G / m; _pts[np * 4 + 2] = B / m; _pts[np * 4 + 3] = k; np++; }
  }
  showLift = cnt ? lit / cnt : 0;
  if (w < 1e-3) return null;
  const m = Math.max(r, gr, b);
  _tintWant.setRGB(r / m, gr / m, b / m);
  // the show's two colours: the bright bands split in two by colour (two-means);
  // the bigger share is the first colour, the other the second. A one-colour
  // show gives the same one back for both.
  _tintB.copy(_tintWant);
  if (np > 8) {
    const P = _pts, c = [[0, 0, 0], [0, 0, 0]];
    const dist = (j, q) => (P[j] - q[0]) ** 2 + (P[j + 1] - q[1]) ** 2 + (P[j + 2] - q[2]) ** 2;
    // seeds: the band furthest from the average, and the one furthest from that
    let j1 = 0, best = -1;
    const mean = [_tintWant.r, _tintWant.g, _tintWant.b];
    for (let j = 0; j < np * 4; j += 4) { const v = dist(j, mean); if (v > best) { best = v; j1 = j; } }
    c[0] = [P[j1], P[j1 + 1], P[j1 + 2]];
    let j2 = 0; best = -1;
    for (let j = 0; j < np * 4; j += 4) { const v = dist(j, c[0]); if (v > best) { best = v; j2 = j; } }
    c[1] = [P[j2], P[j2 + 1], P[j2 + 2]];
    const W = [0, 0];
    if (best > 0.15) {
      for (let it = 0; it < 4; it++) {
        const acc = [[0, 0, 0], [0, 0, 0]];
        W[0] = W[1] = 0;
        for (let j = 0; j < np * 4; j += 4) {
          const q = dist(j, c[0]) <= dist(j, c[1]) ? 0 : 1, wt = P[j + 3];
          acc[q][0] += P[j] * wt; acc[q][1] += P[j + 1] * wt; acc[q][2] += P[j + 2] * wt; W[q] += wt;
        }
        for (const q of [0, 1]) if (W[q] > 0) c[q] = acc[q].map((v) => v / W[q]);
      }
      const big = W[0] >= W[1] ? 0 : 1, small = 1 - big;
      const norm = (v) => { const m = Math.max(...v) || 1; return v.map((x) => x / m); };
      _tintWant.setRGB(...norm(c[big]));
      if (W[small] > (W[0] + W[1]) * 0.12) _tintB.setRGB(...norm(c[small]));
      else _tintB.copy(_tintWant);
    }
  }
  return _tintWant;
}
const showTintB = new THREE.Color(1, 0.82, 0.58);
let tintTargetB = WARM, showOn = false;
const CAT_RED = new THREE.Color(0xff2412);
// Make a video → Use stage lights: in a concert the rig takes the bands'
// colours and their pace, calmer and dimmer than its own looks, no lasers
const stageFollow = { on: false, saved: null, vibe: '', vibeAt: -1 };
function setStageFollow(on) {
  on = !!on;
  if (on === stageFollow.on) return;
  stageFollow.on = on;
  if (on) {
    stageFollow.saved = { look: rigFX.look, master: rigFX.master, a: rigFX.colorA.clone(), b: rigFX.colorB.clone(), rate: rigFX.rate ?? 1 };
    stageFollow.vibe = '';
  } else if (stageFollow.saved) {
    const S = stageFollow.saved;
    rigFX.cue(S.look);
    rigFX.master = S.master; rigFX.rate = S.rate;
    rigFX.colorA.copy(S.a); rigFX.colorB.copy(S.b);
    stageFollow.saved = null;
  }
}
// the show's vibe, as a rig look and a pace
function stageVibe() {
  const k = showUI.demo === 'wash' ? 'wash' : showUI.demo === 'ir' ? 'ir' : showUI.demo === 'group' ? 'group' : 'grid';
  const tempo = showUI.tempo || 1;
  if (k === 'wash') {
    const w = showUI.wash, fast = w.fx === 'strobe' || w.speed > 2;
    if (fast) return { cue: 'tilt', rate: 0.9 * w.speed };
    if (w.fx === 'solid' || w.fx === 'fade') return { cue: 'ballad', rate: 0.5 * w.speed };
    return { cue: 'anthem', rate: 0.8 * w.speed };
  }
  if (k === 'ir') return { cue: 'anthem', rate: 0.7 * (showUI.ir.speed || 1) };
  if (k === 'group') return { cue: 'tilt', rate: Math.min(1.4, 0.25 / Math.max(0.05, showUI.group.step || 0.2)) };
  return { cue: 'anthem', rate: 0.8 * tempo };
}
function followShow(dt, now) {
  const suites = !!suiteSwitch?.classList.contains('active') && lighting !== 'blackout';
  const leds = fasciaFX.mode === 'show';
  const concert = currentMode === 'concert';
  const rig = stageFollow.on && concert;
  if (now - tintAt > 0.12 || now < tintAt) {
    tintAt = now;
    const c = orbFX.mode !== 'off' ? sampleShowColour() : null;
    showOn = !!c;
    tintTarget = c || WARM;
    tintTargetB = c ? _tintB : WARM;
  }
  const k = Math.min(1, dt * 5);
  showTint.lerp(tintTarget, k);
  showTintB.lerp(tintTargetB, k);
  if (leds) fasciaFX.colorA.copy(showTint);
  if (suites) bowl.setSuiteLights(true, showTint);
  // the catwalk's rope light and the B-stage's rim follow the bands, always
  if (concert && bstageFX.cat) {
    bstageFX.catMode = 'solid';
    bstageFX.catColor.copy(showOn ? showTint : CAT_RED);
  }
  if (concert) {
    if (showOn) {
      if (!bstageFX._rimOwn) bstageFX._rimOwn = { mode: bstageFX.ringMode, color: bstageFX.ringColor };
      bstageFX.ringMode = 'solid';
      bstageFX.ringColor = (bstageFX.ringColor && bstageFX.ringColor !== bstageFX._rimOwn.color) ? bstageFX.ringColor : new THREE.Color();
      bstageFX.ringColor.copy(showTint);
    } else if (bstageFX._rimOwn) {   // no show: the rim goes back to its own
      bstageFX.ringMode = bstageFX._rimOwn.mode;
      bstageFX.ringColor = bstageFX._rimOwn.color;
      bstageFX._rimOwn = null;
    }
  }
  if (rig) {
    if (now - stageFollow.vibeAt > 0.5 || now < stageFollow.vibeAt) {
      stageFollow.vibeAt = now;
      const V = stageVibe();
      if (V.cue !== stageFollow.vibe) { stageFollow.vibe = V.cue; rigFX.cue(V.cue); }
      rigFX.rate = Math.max(0.25, Math.min(1.4, V.rate));
    }
    rigFX.colorA.copy(showTint);
    rigFX.colorB.copy(showTintB);
    // calmer than the rig's own looks: dimmer, darker with the bands, and no lasers
    rigFX.master = showOn ? 0.18 + 0.14 * Math.min(1, showLift * 1.5) : 0.14;   // gentle: well under the rig's own looks
    rigFX.lasersOn = false; rigFX.strobeOn = false; rigFX.blindersOn = false;
  }
}
// --- the venue's speakers, live -----------------------------------------------------
// Make a video → "Use venue speakers for music": the song plays from the PA's
// stacks (audiofx.js: placed round the stage, heard from wherever the camera
// is, in the room's reverb) and the crowd's own sound plays on its own,
// not through the speakers. Settings → Sound sets the mix.
const venueSound = (() => {
  const spk = document.getElementById('dirSpk'), crowd = document.getElementById('crowdEl'), crowdBtn = document.getElementById('dirCrowd');
  let on = false, ownCrowd = false, crowdOn = true, mix = { music: 1, crowd: 1, room: 1, bass: 0, mid: 0, treble: 0, sub: 1, rear: 1, punch: 0 };
  const roomKey = () => (VENUE === 'arena' ? 'arena' : 'stadium');
  const CROWD_LOOP = './assets/crowd-loop-video.m4a';   // the same crowd the video uses
  let crowdSrc0 = null;
  // the PA as the mix sets it: live and in the video alike
  const pa = (m = mix) => ({
    preset: roomKey(),
    fx: {
      ...audioFX.fx,
      reverb: Math.min(2, m.room ?? 1),
      bass: Math.max(-1, Math.min(1, (m.bass ?? 0) / 12)),     // dB -> the desk's -1..1 (±12 dB)
      mid: Math.max(-1, Math.min(1, (m.mid ?? 0) / 10)),       // (±10 dB)
      treble: Math.max(-1, Math.min(1, (m.treble ?? 0) / 12)), // (±12 dB)
      sub: Math.min(2, m.sub ?? 1), rear: Math.min(2, m.rear ?? 1), punch: Math.min(1, m.punch ?? 0),
    },
    volume: 0.8 * Math.min(2, m.music ?? 1),   // up to 200%; the PA's limiter keeps it clean
  });
  const crowdLevel = (m = mix) => Math.min(1, 0.45 * (m.crowd ?? 1));
  function applyMix() {
    const P = pa();
    audioFX.setVolume(P.volume);
    for (const k of ['reverb', 'bass', 'mid', 'treble', 'sub', 'rear', 'punch']) audioFX.setFX(k, P.fx[k]);
    if (crowd) crowd.volume = crowdLevel();
  }
  function set(v) {
    on = !!v;
    if (on) {
      audioFX.setPreset(roomKey());
      document.querySelectorAll('[data-sndp]').forEach((x) => x.classList.toggle('active', x.dataset.sndp === roomKey()));
      if (!audioFX.state.on) spk?.click(); else spk?.classList.add('on');
      if (crowd && crowd.paused && !crowd.src.endsWith('crowd-loop-video.m4a')) { crowdSrc0 = crowd.getAttribute('src'); crowd.src = CROWD_LOOP; }
      applyMix();
      // switched on mid-song: the crowd comes back in under it
      if (crowdOn && directorUI.engine?.playing && crowd && crowd.paused) { crowd.play().catch(() => {}); ownCrowd = true; crowdBtn?.classList.add('on'); }
    } else {
      if (audioFX.state.on) spk?.click();
      if (ownCrowd && crowd && !crowd.paused) { crowd.pause(); crowdBtn?.classList.remove('on'); }
      ownCrowd = false;
      if (crowd && crowdSrc0 && crowd.paused) { crowd.src = crowdSrc0; crowdSrc0 = null; }
    }
  }
  {
    const eng = directorUI.engine, prev = eng.onended;
    eng.onended = () => {
      prev?.();
      if (ownCrowd && crowd && !crowd.paused) { crowd.pause(); crowdBtn?.classList.remove('on'); }
    };
  }
  return {
    get on() { return on; },
    set, pa, crowdLevel,
    setMix(m) { mix = { ...mix, ...m }; if (on) applyMix(); },
    // play / pause: the song from the PA (and the crowd under it). With a
    // song it is the song that decides; without one, the crowd alone
    get playing() {
      const eng = directorUI.engine;
      return eng?.buffer ? !!eng.playing : !!(ownCrowd && crowd && !crowd.paused);
    },
    toggle() {
      const eng = directorUI.engine, playing = this.playing;
      if (eng?.buffer && !!eng.playing === playing) document.getElementById('dirPlay')?.click();   // a finished song starts again from the top
      if (on && crowd) {
        if (playing) { crowd.pause(); crowdBtn?.classList.remove('on'); }
        else if (crowdOn && crowd.paused) { crowd.play().catch(() => {}); ownCrowd = true; crowdBtn?.classList.add('on'); }
      }
    },
    // the crowd's own sound, under the PA: on or off (live and in the video)
    get crowdOn() { return crowdOn; },
    setCrowd(v) {
      crowdOn = !!v;
      if (!crowd) return;
      if (!crowdOn && ownCrowd && !crowd.paused) { crowd.pause(); crowdBtn?.classList.remove('on'); }
      if (crowdOn && on && directorUI.engine?.playing && crowd.paused) { crowd.play().catch(() => {}); ownCrowd = true; crowdBtn?.classList.add('on'); }
    },
    get hasSong() { return !!directorUI.engine?.buffer; },
  };
})();

window.__dbg.venueSound = venueSound;

// --- the screens show the effect --------------------------------------------------------
// The default picture on the main screen and the B-stage is the show itself:
// the effect playing on the wristbands, drawn small and blown up soft with a
// glow, so the screens move in its colours and its rhythm. Upload a video in
// Settings and that plays instead.
{
  const small = document.createElement('canvas');
  small.width = 192; small.height = 108;
  const sctx = small.getContext('2d');
  let player = null, key = '', keyAt = -1, drawnAt = -1;
  vPresets.addPreset('show', (ctx, t, dt, W, H) => {
    if (t - drawnAt < 1 / 30 && t >= drawnAt) return;   // 30 frames a second is plenty for a wall
    drawnAt = t;
    const on = orbFX.mode === 'design' && showUI.hasShow;
    if (on && (t - keyAt > 0.4 || t < keyAt)) {
      keyAt = t;
      const snap = showUI.snapshot(), k = JSON.stringify(snap.zones);
      if (k !== key) { key = k; player = showEngine.preview(snap.zones); }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!on || !player) return;
    player.draw(sctx, performance.now() / 1000, (g) => shownInScene(g.mesh));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(8px)';
    ctx.drawImage(small, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  });
  if (!screenVideoFile) document.querySelector('[data-vpreset="show"]')?.click();
}

// the room's extras start off: no banners, no VIP lights, no LED ribbons
fasciaFX.set({ mode: 'off' });
document.querySelectorAll('[data-fascia]').forEach((b) => b.classList.toggle('active', b.dataset.fascia === 'off'));
if (ceiling?.banners) { ceiling.banners.visible = false; document.getElementById('bannersBtn')?.classList.remove('active'); }
if (suiteSwitch?.classList.contains('active')) suiteSwitch.click();

// the venue's own views join the list (, and .)
addVenueViews();

// every visit starts plain: seat pixels only, at their own size (100%)
audience.setMode('seats');
audience.setPixelSize(MOBILE ? 0.75 : 0.5);   // a phone: 150%, they read better on a small screen
audience.setBandSize(0.375);  // the bands in hand at 150%
setUserFov(userFov);          // the lens kept from last time
audience.setBandSpeed(0.2);   // the bands in hand sway slowly, 0.2x
const showPanel = initShowPanel({
  designer: showUI, orbFX, controls, audience, room, ir: irHeads, pads: padsUI, fadeNow: fadeLineNow,
  glow: {
    get screen() { return screenGlow; }, setScreen: setScreenGlow,
    get bloom() { return bloomGain; }, setBloom: setBloomGain,
  },
  angles: ANGLES.map((a, i) => ({ i, name: a.name, show: i >= SHOW_ANGLE_START })),
  setAngle: (i) => setAngle(i),
  // offline, frame by frame, wherever the browser can encode video itself; else in real time
  // the desktop app makes it in a hidden window, so the room stays yours to move around in
  record: (opts) => (DESKTOP_RENDER ? renderElsewhere(opts) : canRenderOffline() ? renderShowVideo(opts) : recordShowVideo(opts)),
  song: () => !!directorUI.engine.buffer,
  songTitle: () => (directorUI.engine.file?.name || '').replace(/\.[^.]+$/, ''),
  songLen: () => directorUI.engine.buffer?.duration || 0,
  venueSound,
  stageLights: { get on() { return stageFollow.on; }, set: (on) => setStageFollow(on), get concert() { return currentMode === 'concert'; } },
  // the recording's run of shots, for the panel to list, and to look at one of them
  shots: {
    plan: (len, pullAt, opts) => shotPlan(len, pullAt, opts),
    preview: (len, pullAt, opts, i) => previewShot(len, pullAt, opts, i),
    outroLen: 4.34,
  },
  // where the camera stands and looks, for the recording's hand-picked views
  camView: {
    get: () => ({ p: camera.position.toArray().map((v) => +v.toFixed(2)), q: camera.quaternion.toArray().map((v) => +v.toFixed(5)), fov: camera.fov }),
    set: (v) => {
      controls.unlock?.();
      camera.position.fromArray(v.p);
      camera.quaternion.fromArray(v.q);
      flying = true; velY = 0;
    },
  },
  venue: VENUE,
  preview: (list) => showEngine.preview(list),
  visible: (g) => shownInScene(g.mesh),
});
// a trigger changed (its look or its fade line): the director's lane shows it at once
{ const prev = padsUI.onChange; padsUI.onChange = () => { prev?.(); directorUI.redraw?.(); }; }

// --- undo and redo (history.js) ---------------------------------------------------------
// Everything you build, in parts, put back in this order: the triggers (fade
// lines too), the timeline, the show, the look on now and the trigger it came
// from, and the room's own settings. Firing a trigger, by hand or by a cue,
// is playing the show, not building it: what it changes is taken in, never
// made a step, so undo steps back through edits, not through the set list.
let pointerHeld = false;
const undoHistory = initHistory({
  parts: {
    bank: { get: () => padsUI.getBank(), set: (b) => padsUI.setBank(b) },
    cues: { get: () => directorUI.getCues(), set: (c) => directorUI.setCues(c) },
    show: { get: () => showUI.snapshot(), set: (s) => showUI.restore(s, { live: false }) },
    // while a song plays its cues own the look, and the trigger it came from
    look: { get: () => padsUI.capture(), set: (s) => { if (!directorUI.engine.playing) padsUI.apply(s); } },
    live: { get: () => padsUI.liveState(), set: (s) => { if (!directorUI.engine.playing) padsUI.setLiveState(s); } },
    room: {
      get: () => ({
        lighting, pixels: audience.pixels, people: audience.people, bands: audience.bands,
        psize: audience.pixelSize, bsize: audience.bandSize, bspeed: audience.bandSpeed, pglow: audience.pixelGlow, bglow: audience.bandGlow,
        glow: screenGlow, bloom: bloomGain, haze: arenaHaze, beams: !!irHeads.beamsOn,
      }),
      set: (r) => {
        if (r.lighting !== lighting) setLighting(r.lighting);
        if (r.pixels !== audience.pixels) audience.setPixels(r.pixels);
        if (r.people !== audience.people) audience.setPeople(r.people);
        if (r.bands !== audience.bands) audience.setBands(r.bands);
        if (r.psize !== audience.pixelSize) audience.setPixelSize(r.psize);
        if (r.pglow != null && r.pglow !== audience.pixelGlow) audience.setPixelGlow(r.pglow);
        if (r.bglow != null && r.bglow !== audience.bandGlow) audience.setBandGlow(r.bglow);
        if (r.bsize !== audience.bandSize) audience.setBandSize(r.bsize);
        if (r.bspeed !== audience.bandSpeed) audience.setBandSpeed(r.bspeed);
        if (r.glow !== screenGlow) setScreenGlow(r.glow);
        if (r.bloom !== bloomGain) setBloomGain(r.bloom);
        if (r.haze !== arenaHaze) setArenaHaze(r.haze);
        if (r.beams !== !!irHeads.beamsOn) irHeads.setBeams(r.beams);
        showPanel.refresh();
      },
    },
  },
  hold: () => pointerHeld,
  onChange: () => paintUndo(),
});
{ const prev = padsUI.onFire; padsUI.onFire = (...a) => { prev?.(...a); undoHistory.rebase(['look', 'live', 'show', 'room']); }; }
const undoBtn = document.getElementById('undoBtn'), redoBtn = document.getElementById('redoBtn');
function paintUndo() {
  undoBtn.disabled = !undoHistory.canUndo;
  redoBtn.disabled = !undoHistory.canRedo;
}
const UNDO_WORDS = { bank: 'triggers', cues: 'timeline', show: 'show', look: 'look', room: 'room' };
function undoRedo(redo = false) {
  const keys = redo ? undoHistory.redo() : undoHistory.undo();
  if (!keys) { padsUI.hint?.(redo ? 'Nothing to redo' : 'Nothing to undo'); return; }
  const what = [...new Set(keys.map((k) => UNDO_WORDS[k]).filter(Boolean))];
  padsUI.hint?.(`${redo ? 'Redone' : 'Undone'}${what.length ? `: ${what.join(', ')}` : ''}`);
}
undoBtn.addEventListener('click', (e) => { e.stopPropagation(); undoRedo(false); });
redoBtn.addEventListener('click', (e) => { e.stopPropagation(); undoRedo(true); });
// a slider still held is one drag: the step waits for the hand to let go
addEventListener('pointerdown', () => { pointerHeld = true; }, true);
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { pointerHeld = false; }, true);
addEventListener('blur', () => { pointerHeld = false; });
// anything a person does may have changed the show: snapshot once it settles
for (const t of ['pointerup', 'keyup', 'change', 'input', 'drop', 'dragend']) {
  addEventListener(t, (e) => { if (!e.target?.closest?.('#undoBar')) undoHistory.soon(); }, { capture: true, passive: true });
}
// Cmd+Z / Shift+Cmd+Z (Ctrl+Z / Ctrl+Y off the Mac); a text field keeps its own
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.repeat) return;
  const k = (e.key || '').toLowerCase();
  const redo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey);
  if (k !== 'z' && !redo) return;
  const t = e.target;
  if (t?.isContentEditable || t?.tagName === 'TEXTAREA'
      || (t?.tagName === 'INPUT' && !/^(range|checkbox|radio|button|color|file)$/i.test(t.type))) return;
  if (document.body.classList.contains('menu')) return;
  e.preventDefault();
  e.stopPropagation();
  undoRedo(redo);
}, true);
undoHistory.start();

// --- a saved show: everything, exactly as it was ------------------------------------------
// One .arenashow file holds the whole room (showfile.js): the venue and the
// stage, the look on now (rig, wristbands, crowd, screens, effects), the
// triggers and the timeline with its song, the show designer, the room's
// lights and the VIP suites, the crowd, the glow, the haze, the video on the
// screens (its file travels inside) and how it is routed, every switch and
// slider on the console, and where the camera stands. Opening one puts all
// of it back; a show from another venue reloads into that venue first.
const CONSOLE_SKIP = /cam|remote|record|snap|xr\b|vr\b|hand|feed|bird|help|menu|export|import|save|open|download|upload|reset|clear|confirm|fire|burst|pop|launch|test/i;
const dataKey = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
// a key that finds a control again: its id, or its tag and data attributes
function controlKey(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const d = Object.entries(el.dataset);
  return d.length ? `${el.tagName.toLowerCase()}${d.map(([k, v]) => `[data-${dataKey(k)}="${CSS.escape(v)}"]`).join('')}` : null;
}
// the console's own switches, sliders and pickers (and the room's few outside it)
const CONTROL_ROOTS = ['#console', '#settingsPanel'];
const CONTROL_EXTRA = ['#dirSpk', '#dirCrowd', '#crowdVol', '#dirPaVol', '#dirVidSync', '[data-sndp]'];
function consoleState() {
  const els = [...CONTROL_ROOTS.flatMap((r) => [...(document.querySelector(r)?.querySelectorAll('input, select, button') || [])]),
    ...CONTROL_EXTRA.flatMap((q) => [...document.querySelectorAll(q)])];
  const out = [];
  for (const el of els) {
    const k = controlKey(el);
    if (!k || CONSOLE_SKIP.test(k) || el.type === 'file' || el.closest('#setShow, #undoBar')) continue;
    if (el.tagName === 'BUTTON') out.push({ k, on: el.classList.contains('active') || el.classList.contains('on') });
    else if (el.type === 'checkbox' || el.type === 'radio') out.push({ k, c: el.checked });
    else out.push({ k, v: el.value });
  }
  return out;
}
// Back as they were. A switch (found by id) is clicked when it stands the
// other way; a choice among several (found by its data) is clicked when it
// was the one picked; sliders and pickers take their value and say so.
function applyConsoleState(list) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (c.on === undefined) continue;
    const el = document.querySelector(c.k);
    if (!el) continue;
    const now = el.classList.contains('active') || el.classList.contains('on');
    if (c.k.startsWith('#') ? now !== c.on : c.on && !now) el.click();
  }
  for (const c of list) {
    if (c.on !== undefined) continue;
    const el = document.querySelector(c.k);
    if (!el) continue;
    if (c.c !== undefined) { if (el.checked !== c.c) el.click(); continue; }
    if (el.value === c.v) continue;
    el.value = c.v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
const suiteBtn = document.getElementById('suiteLightsBtn');
function wholeShow() {
  const dir = directorUI.getProject();
  return {
    state: {
      venue: VENUE,
      builder: JSON.parse(JSON.stringify({ mode: builderUI.state.mode, curtains: builderUI.state.curtains, cfg: builderUI.state.cfg, covers: builderUI.state.covers, bfloor: builderUI.state.bfloor })),
      look: padsUI.capture(),
      live: padsUI.liveState(),
      bank: padsUI.getBank(),
      allowed: padsUI.allowed(),
      vibe: padsUI.vibe?.() ?? null,
      designer: showUI.snapshot(),
      room: {
        lighting, pixels: audience.pixels, people: audience.people, bands: audience.bands,
        psize: audience.pixelSize, bsize: audience.bandSize, bspeed: audience.bandSpeed, pglow: audience.pixelGlow, bglow: audience.bandGlow,
        glow: screenGlow, bloom: bloomGain, haze: arenaHaze, beams: !!irHeads.beamsOn,
        suites: !!suiteBtn?.classList.contains('active'), cameraLook: lookIdx,
      },
      video: { route: videoRoute, sync: videoSyncOn, preset: videoPreset, projFloor: projFloorOn, jumboUp, screensOff, pose: { ...screenPose }, custom: !!screenVideoFile },
      camera: { pos: camera.position.toArray(), quat: camera.quaternion.toArray(), flying, angle: angleIdx },
      console: consoleState(),
      director: { markers: dir.markers, sections: dir.sections, style: dir.style, pendings: dir.pendings, song: dir.audioFile?.name || null },
      savedAt: new Date().toISOString(),
    },
    files: { audio: dir.audioFile, video: screenVideoFile },
  };
}
async function saveShow() {
  const { state, files } = wholeShow();
  const blob = await writeShowFile(state, files);
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const base = files.audio?.name ? files.audio.name.replace(/\.[^.]+$/, '') : `show-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base}.arenashow`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  padsUI.hint?.('Show saved: the room, the lights, the video and every setting');
}
async function openShow(file) {
  let show;
  try { show = await readShowFile(file); } catch (err) { padsUI.hint?.(String(err.message || 'Not a saved show file')); return; }
  const { state: S, files } = show;
  // another venue: reload into it first, and open the show again there
  if (S.venue && S.venue !== VENUE && VENUES.some(([k]) => k === S.venue)) {
    await keepPendingShow(file);
    padsUI.hint?.('Opening the show’s venue…');
    builderUI.reboot({ venue: S.venue });
    return;
  }
  if (S.builder) builderUI.setState(S.builder);
  // the timeline: the song, its cues, sections, style and held edits (the first format kept them at the top)
  const D = S.director || { markers: S.markers, sections: S.sections };
  if (files.audio) await directorUI.loadProject({ audioFile: files.audio, ...D });
  if (S.bank) padsUI.setBank(S.bank);
  if (S.allowed) padsUI.setAllowed(S.allowed);
  if (S.vibe) padsUI.setVibe?.(S.vibe);
  // every switch and slider, then what the explicit state below says wins
  applyConsoleState(S.console);
  const Vd = S.video;
  if (Vd) {
    if (files.video) loadScreenVideo(files.video);
    if (Vd.route) document.querySelector(`[data-vroute="${Vd.route}"]`)?.click();
    setVideoSync(Vd.sync !== false);
    if (Vd.preset && Vd.preset !== videoPreset) document.querySelector(`[data-vpreset="${Vd.preset}"]`)?.click();
    if (Vd.pose) setScreenPose(Vd.pose);
    if (typeof Vd.screensOff === 'boolean' && Vd.screensOff !== screensOff) { screensOff = Vd.screensOff; applyVideoRoute(); }
  }
  if (S.designer) showUI.restore(S.designer, { live: false });
  if (S.look) padsUI.apply(S.look);
  if (S.live) padsUI.setLiveState(S.live);
  const R = S.room;
  if (R) {
    if (R.lighting && R.lighting !== lighting) setLighting(R.lighting);
    if (typeof R.pixels === 'boolean' && R.pixels !== audience.pixels) audience.setPixels(R.pixels);
    if (typeof R.people === 'boolean' && R.people !== audience.people) audience.setPeople(R.people);
    if (typeof R.bands === 'boolean' && R.bands !== audience.bands) audience.setBands(R.bands);
    if (R.psize) audience.setPixelSize(R.psize);
    if (R.pglow) audience.setPixelGlow(R.pglow);
    if (R.bglow) audience.setBandGlow(R.bglow);
    if (R.bsize) audience.setBandSize(R.bsize);
    if (R.bspeed) audience.setBandSpeed(R.bspeed);
    if (R.glow != null) setScreenGlow(R.glow);
    if (R.bloom != null) setBloomGain(R.bloom);
    if (R.haze != null) setArenaHaze(R.haze);
    if (R.beams != null && !!R.beams !== !!irHeads.beamsOn) irHeads.setBeams(R.beams);
    if (typeof R.suites === 'boolean' && suiteBtn && suiteBtn.classList.contains('active') !== R.suites) suiteBtn.click();
    if (Number.isFinite(R.cameraLook) && R.cameraLook !== lookIdx) setLook(R.cameraLook);
    showPanel.refresh();
  }
  const C = S.camera;
  if (C && Array.isArray(C.pos)) {
    camera.position.fromArray(C.pos);
    if (Array.isArray(C.quat)) camera.quaternion.fromArray(C.quat);
    flying = !!C.flying; velY = 0;
    if (Number.isFinite(C.angle)) angleIdx = C.angle;
  }
  undoHistory.reset();
  padsUI.hint?.('Show opened, exactly as it was saved');
}
directorUI.setProjectHandlers({ save: saveShow, open: openShow });
Object.assign(window.__dbg, { saveShow, openShow, wholeShow });
document.getElementById('saveShowBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('settingsPanel').classList.add('hidden');
  saveShow();
});
document.getElementById('openShowBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('project-input').click();
});
// --- the two ways of working (menu.js) ------------------------------------------------
// QUICK SHOWCASE: presets only. The director, the console and the camera
// tools step out of the way (index.html hides them under body.mode-quick),
// the SHOW panel opens, and a show is already on the wristbands.
// SHOW STUDIO: everything, and the director's deck opens, ready for a song.
const switchModeBtn = document.getElementById('switchModeBtn');
function applyAppMode(mode, { entering = false } = {}) {
  const quick = mode === 'quick';
  document.body.classList.toggle('mode-quick', quick);
  document.body.classList.toggle('mode-studio', !quick);
  if (switchModeBtn) switchModeBtn.innerHTML = `&#8644; Switch to ${quick ? 'Show Studio' : 'Quick Showcase'}${quick ? `<span class="mdLock">${menuUI.lockIcon}</span>` : ''}`;
  if (quick) {
    if (directorUI.open) directorUI.toggle(false);
    consoleUI.toggle(false);
    if (MOBILE || (entering && tips.willStart())) showPanel.close();   // the tutorial opens it when it gets there; a phone keeps the view clear
    else showPanel.open();
    if (entering && orbFX.mode !== 'design') showUI.playDemo(showUI.demoList[0].id);   // never an empty room
  } else if (entering && !tips.willStart()) {
    if (!directorUI.open) directorUI.toggle(true);
  }
  // a welcome: the stage cannons throw confetti as you walk in
  if (entering) setTimeout(() => rigFX.fireConfetti(), 500);
}
// the helper's cards: the first time into the room, and the ? in the header
// every window closed: the tutorial starts on a clear screen
function closeAllWindows() {
  showPanel.close?.(); showPanel.closeVideo?.();
  builderUI.close?.(); liveCam?.close?.(); handsUI.close?.(); feedsUI.close?.();
  consoleUI.toggle?.(false);
  if (directorUI.open) directorUI.toggle(false);
  document.getElementById('settingsPanel')?.classList.add('hidden');
}
// how the tutorial knows each step is done
var viewChanges = 0;   // (var: setAngle can run before this line does)
// the tutorial's walking steps start on the floor, never floating in a camera view
function toFloor() {
  if (!flying) return;
  spawnAtStage();
  flying = false; velY = 0;
}
const tips = initTips({
  studio: () => menuUI.mode === 'studio',
  closeAll: closeAllWindows,
  // each returns how far along it is (0..1) or true when done
  tasks: {
    // turn round a good way with the mouse. The camera step left you up in a
    // view: first, back down on the floor, where walking makes sense
    look: {
      start: () => { toFloor(); return { q: camera.quaternion.clone(), turned: 0 }; },
      done: (st) => {
        if (controls.isLocked) { st.turned += st.q.angleTo(camera.quaternion); }
        st.q.copy(camera.quaternion);
        return st.turned / 2.2;
      },
    },
    // two and a half seconds of walking
    walk: {
      start: () => { toFloor(); return { held: 0, last: performance.now() }; },
      done: (st) => {
        const now = performance.now();
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => keys[k])) st.held += now - st.last;
        st.last = now;
        return st.held / 2500;
      },
    },
    // fly, and climb four metres
    // a camera view leaves you up in the air: down you come, then fly up four metres
    fly: {
      start: () => { if (flying) { flying = false; velY = 0; } return { low: camera.position.y }; },
      done: (st) => {
        st.low = Math.min(st.low, camera.position.y);
        return flying ? 0.15 + 0.85 * Math.max(0, camera.position.y - st.low) / 4 : 0;
      },
    },
    land: { done: () => !flying },
    free: { done: () => !controls.isLocked },
    // walking with the mouse free: a second and a half of it
    freewalk: {
      start: () => ({ held: 0, last: performance.now() }),
      done: (st) => {
        const now = performance.now();
        if (!controls.isLocked && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => keys[k])) st.held += now - st.last;
        st.last = now;
        return st.held / 1500;
      },
    },
    camera: { start: () => viewChanges, done: (n) => (viewChanges - n) / 3 },
    show: { done: () => showPanel.isOpen },
    // three different effects
    effect: {
      start: () => ({ seen: new Set() }),
      done: (st) => {
        if (orbFX.mode !== 'design') return st.seen.size / 3;
        const k = `${showUI.demo}|${JSON.stringify(showUI.wash)}|${showUI.group?.preset}|${showUI.ir?.motion}`;
        st.seen.add(k);
        return (st.seen.size - 1) / 3;
      },
    },
    colour: {
      start: () => JSON.stringify(JSON.parse(localStorage.getItem('ht-showpanel') || '{}').col || null),
      done: (k0) => JSON.stringify(JSON.parse(localStorage.getItem('ht-showpanel') || '{}').col || null) !== k0,
    },
    video: { done: () => document.getElementById('videoPanel')?.classList.contains('open') },
    // the video steps read the Video window itself
    vadd: { start: () => document.querySelectorAll('#videoPanel .vpReel .vpItem').length, done: (n) => (document.querySelectorAll('#videoPanel .vpReel .vpItem').length - n) / 2 },
    vclip: {
      start: () => ({ sel: [...document.querySelectorAll('#videoPanel .vpItem')].findIndex((x) => x.classList.contains('sel')) }),
      done: (st) => [...document.querySelectorAll('#videoPanel .vpItem')].findIndex((x) => x.classList.contains('sel')) !== st.sel,
    },
    // pressing Choose a song is enough, even if they cancel: they know where it is now
    vsong: {
      start: () => {
        const st = { pressed: false };
        document.querySelector('#videoPanel [data-reelsong]')?.addEventListener('click', () => { st.pressed = true; }, { once: true });
        return st;
      },
      done: (st) => st.pressed,
    },
    // a short one (10 s or less) to start with: making a video takes a while
    vlen: {
      start: () => {
        const st = { touched: false };
        const inp = document.querySelector('#videoPanel input[data-reclen]');
        const mark = () => { st.touched = true; };
        inp?.addEventListener('input', mark);
        inp?.addEventListener('change', mark);
        return st;
      },
      done: (st) => st.touched && Number(document.querySelector('#videoPanel input[data-reclen]')?.value) <= 10,
    },
    vrec: { done: () => !document.querySelector('#videoPanel .spRecStop')?.hidden },
    build: { done: () => document.getElementById('buildPanel')?.classList.contains('open') },
    console: { done: () => !document.getElementById('console')?.classList.contains('hidden') },
  },
});
window.__dbg.tips = tips;
document.getElementById('mmTutorial')?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('mainMenuDrop')?.classList.add('hidden'); tips.start(); });
// Settings → Show me how: the tutorial again
{
  const how = document.createElement('button');
  how.id = 'tutorialBtn';
  how.innerHTML = '&#10067; Show me how';
  how.addEventListener('click', (e) => { e.stopPropagation(); tips.start(); });
  document.getElementById('settingsPanel')?.insertBefore(how, document.getElementById('snapBtn'));
  // keyboard shortcuts: off unless wanted
  const row = document.createElement('div');
  row.id = 'shortcutRow';
  row.className = 'aq spSwitchRow';
  row.innerHTML = '<span><b>Keyboard shortcuts</b></span><button class="aqSwitch" role="switch" aria-label="Keyboard shortcuts"><i></i></button>';
  const swb = row.querySelector('button');
  const paintSw = () => { swb.classList.toggle('on', shortcutsOn()); swb.setAttribute('aria-checked', String(shortcutsOn())); };
  paintSw();
  swb.addEventListener('click', (e) => {
    e.stopPropagation();
    try { localStorage.setItem('ht-shortcuts', shortcutsOn() ? '0' : '1'); } catch (_) { /* private mode */ }
    paintSw();
    if (shortcutsOn()) hintHud(6000); else hud.classList.remove('show');
  });
  how.after(row);
}
// the main menu closes the tutorial's cards (and their glow)
new MutationObserver(() => { if (document.body.classList.contains('menu')) tips.stop(); })
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });
// a soft word at the top right, until Show has been opened once
{
  const hint = document.createElement('div');
  hint.id = 'softHint';
  hint.textContent = 'Open Show for effects';
  document.body.appendChild(hint);
  let shownOnce = false;
  setInterval(() => {
    if (showPanel.isOpen) shownOnce = true;
    const inRoom = document.body.classList.contains('builderOn') && !document.body.classList.contains('menu');
    hint.classList.toggle('on', inRoom && !shownOnce && !tips.open);
  }, 400);
}
menuUI.onEnter = (mode) => { applyAppMode(mode, { entering: true }); if (!RENDER_JOB && !MOBILE) tips.firstTime(); };
applyAppMode(menuUI.mode);
switchModeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('settingsPanel').classList.add('hidden');
  const next = menuUI.mode === 'quick' ? 'studio' : 'quick';
  const go = () => {
    menuUI.setMode(next);
    applyAppMode(next, { entering: true });
    padsUI.hint?.(next === 'quick' ? 'Quick Showcase: presets only' : 'Show Studio: everything, built to a song');
  };
  if (next === 'studio') menuUI.requestStudio(go); else go();   // Studio asks for its code
});

// a show that sent us here from another venue opens now
takePendingShow().then((file) => { if (file) setTimeout(() => openShow(file), 1200); });

// setAnimationLoop instead of rAF: WebXR sessions drive the loop themselves
renderer.setAnimationLoop(animate);

// --- flying, made obvious: a badge at the top while you fly ---------------------------------
{
  const badge = document.createElement('div');
  badge.id = 'flyBadge';
  badge.innerHTML = '<b>FLYING</b><span><kbd>Space</kbd> up</span><span><kbd>C</kbd> down</span><span><kbd>F</kbd> walk</span>';
  document.body.appendChild(badge);
  setInterval(() => {
    const inRoom = document.body.classList.contains('builderOn') && !document.body.classList.contains('menu');
    const settings = !document.getElementById('settingsPanel')?.classList.contains('hidden');   // never over the Settings list
    badge.classList.toggle('on', inRoom && flying && !tour && !settings);
  }, 150);
}

// --- the buttons: a light on each when its window is open; one camera button --------------
{
  // Change camera angle: the main way round, so the best spot (top right).
  // ‹ goes back a view, the rest goes on; the keys are on the arrows: , and .
  const group = document.createElement('div');
  group.id = 'camGroup';
  group.innerHTML = '<button id="camPrev" title="Previous view (the , key)" aria-label="Previous view"><kbd><i>&lt;</i><i>,</i></kbd></button>'
    + '<button id="camAngleBtn" title="Next view (.)">CHANGE CAMERA ANGLE</button>'
    + '<button id="camNext" title="Next view (the . key)" aria-label="Next view"><kbd><i>&gt;</i><i>.</i></kbd></button>';
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    nextAngle(b.id === 'camPrev' ? -1 : 1);
  });
  const tr = document.getElementById('topRight');
  if (tr) tr.prepend(group); else document.body.appendChild(group);
  group.appendChild(angleHud);   // the view's name shows just under it
  // each window: its button, is it open, and how to close it
  const TOOLS = [
    ['showFab', () => showPanel.isOpen, () => showPanel.close()],
    ['videoFab', () => document.getElementById('videoPanel')?.classList.contains('open'), () => showPanel.closeVideo()],
    ['buildFab', () => document.getElementById('buildPanel')?.classList.contains('open'), () => builderUI.close()],
    ['camFab', () => document.getElementById('camPanel')?.classList.contains('open'), () => liveCam?.close?.()],
    ['handsFab', () => document.getElementById('handsPanel')?.classList.contains('open'), () => handsUI.close()],
    ['feedsFab', () => feedsUI.isOpen, () => feedsUI.close()],
    ['consoleBtn', () => !document.getElementById('console')?.classList.contains('hidden'), () => consoleUI.toggle(false)],
    ['directorBtn', () => !!directorUI.open, () => directorUI.toggle(false)],
    ['settingsBtn', () => !document.getElementById('settingsPanel')?.classList.contains('hidden'), () => document.getElementById('settingsPanel').classList.add('hidden')],
    ['menuBtn', () => !document.getElementById('mainMenuDrop')?.classList.contains('hidden'), () => document.getElementById('mainMenuDrop').classList.add('hidden')],
  ];
  const lights = [];
  for (const [id, isOpen, close] of TOOLS) {
    const b = document.getElementById(id);
    if (!b) continue;
    const l = document.createElement('i');
    l.className = 'hdLight';
    if (id !== 'menuBtn') b.prepend(l);
    lights.push([l, isOpen, close, false]);
  }
  // one window at a time: the one just opened stays, every other closes
  const paint = () => {
    const now = lights.map(([, isOpen]) => { try { return !!isOpen(); } catch (_) { return false; } });
    const opened = now.findIndex((on, i) => on && !lights[i][3]);
    if (opened >= 0) now.forEach((on, i) => { if (on && i !== opened) { try { lights[i][2](); } catch (_) { /* gone */ } now[i] = false; } });
    lights.forEach((L, i) => { L[0].classList.toggle('on', now[i]); L[3] = now[i]; });
  };
  setInterval(paint, 150);
  paint();
}

// --- the loading screen ------------------------------------------------------------------
// Every material in the room is prepared for the graphics card now, off the
// main thread where the browser can (compileAsync), instead of stalling the
// first frames one shader at a time. The bar creeps on while it works; the
// screen lifts after the first frames are drawn.
var bootReady = false, bootFrames = 3, bootMenu = false;
{
  // the menu's moving background is the first thing seen: wait for it to play (a few seconds at most)
  const mv = document.getElementById('mBgVideo');
  const menuOk = () => { bootMenu = true; };
  if (!mv || MOBILE || mv.readyState >= 3) menuOk();   // a phone has no menu film to wait for
  else { mv.addEventListener('canplay', menuOk, { once: true }); mv.addEventListener('error', menuOk, { once: true }); setTimeout(menuOk, 6000); }
  window.__boot?.step(0.55, 'Preparing the lights and screens');
  const t0 = performance.now();
  const creep = setInterval(() => {
    if (bootReady) { clearInterval(creep); return; }
    window.__boot?.step(0.55 + 0.35 * (1 - Math.exp(-(performance.now() - t0) / 5000)));
  }, 150);
  const ready = () => { bootReady = true; window.__boot?.step(0.95, 'Almost ready'); };
  try { (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).then(ready, ready); }
  catch (_) { ready(); }
}

// --- videos made in the background (the desktop app) -------------------------------------
// In the Mac app, Record hands the whole show (the .arenashow Save show writes)
// to a second, hidden window that makes the video while you keep moving round
// this one. A small card at the bottom shows how far it has got.
var DESKTOP_RENDER = !!window.pixmobDesktop?.render && !new URLSearchParams(location.search).has('render');
var RENDER_JOB = !!window.pixmobDesktop?.render && new URLSearchParams(location.search).has('render');
const bgJob = { cb: null };
async function renderElsewhere({ onProgress, signal, ...opts }) {
  const DR = window.pixmobDesktop.render;
  onProgress?.(0, 'Getting the show ready…');
  const { state, files } = wholeShow();
  const buf = await (await writeShowFile(state, files)).arrayBuffer();
  return new Promise((resolve, reject) => {
    bgJob.cb = { onProgress, resolve, reject };
    signal?.addEventListener('abort', () => DR.cancel(), { once: true });
    bgCard.start();
    DR.start(buf, { ...opts, place: VENUE }).then((r) => {
      if (!r?.ok) { bgJob.cb = null; bgCard.end(false, r?.error); reject(new Error(r?.error || 'The video could not be started')); }
    }, (err) => { bgJob.cb = null; bgCard.end(false); reject(err); });
  });
}
// the card: collapsed to a lime bar and a number; tap it for the time left and Stop
const bgCard = (() => {
  const el = document.createElement('div');
  el.id = 'bgRender';
  el.hidden = true;
  el.innerHTML = '<button class="brHead" aria-expanded="false"><span class="brName">Making your video</span><span class="brPct">0%</span></button>'
    + '<div class="brBar"><i></i></div>'
    + '<div class="brMore"><span class="brText"></span><button class="brStop">Stop</button></div>';
  document.body.appendChild(el);
  let hideT = 0;
  el.querySelector('.brHead').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !el.classList.contains('open');
    el.classList.toggle('open', open);
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  el.querySelector('.brStop').addEventListener('click', (e) => { e.stopPropagation(); window.pixmobDesktop?.render?.cancel(); });
  return {
    start() {
      clearTimeout(hideT);
      el.hidden = false;
      el.classList.remove('done', 'failed', 'open');
      el.querySelector('.brName').textContent = 'Making your video';
      this.progress(0, 'Opening the show…');
    },
    progress(k, text) {
      el.querySelector('.brPct').textContent = `${Math.round(k * 100)}%`;
      el.querySelector('.brBar i').style.width = `${Math.round(k * 100)}%`;
      if (text) el.querySelector('.brText').textContent = text.replace(/^Rendering… \d+% · /, '');
    },
    end(ok, msg) {
      el.classList.add(ok ? 'done' : 'failed');
      el.querySelector('.brName').textContent = ok ? 'Saved to Downloads ✓' : (msg === 'Stopped' ? 'Stopped' : 'Could not make the video');
      el.querySelector('.brPct').textContent = '';
      if (ok) el.querySelector('.brBar i').style.width = '100%';
      el.querySelector('.brText').textContent = msg && msg !== 'Stopped' ? msg : '';
      hideT = setTimeout(() => { el.hidden = true; }, ok ? 6000 : 4000);
    },
  };
})();
if (DESKTOP_RENDER) {
  const DR = window.pixmobDesktop.render;
  DR.onProgress((k, text) => { bgCard.progress(k, text); bgJob.cb?.onProgress?.(k, text); });
  DR.onDone((r) => {
    const cb = bgJob.cb;
    bgJob.cb = null;
    bgCard.end(!!r?.ok, r?.ok ? null : r?.error);
    if (!cb) return;
    if (r?.ok) cb.resolve({ fps: r.fps || 60 });
    else cb.reject(new Error(r?.error === 'Stopped' ? 'Stopped' : (r?.error || 'The video could not be made')));
  });
}
// the hidden window: take the job, open its show, make the video, hand it back
if (RENDER_JOB) {
  (async () => {
    const DR = window.pixmobDesktop.render;
    try {
      const job = await DR.job();
      if (!job) return;
      while (!bootReady) await new Promise((r) => setTimeout(r, 100));
      DR.progress(0, 'Opening the show…');
      menuUI.enter?.('studio');
      await new Promise((r) => setTimeout(r, 800));
      await openShow(new File([job.show], 'job.arenashow'));
      await new Promise((r) => setTimeout(r, 1500));   // the screens' film and the song settle in
      const { place, ...opts } = job.opts || {};
      const blob = await renderShowVideo({ ...opts, download: false, onProgress: (k, t) => DR.progress(k, t) });
      if (!blob) throw new Error('The video could not be made');
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      const name = `wristband-show-${opts.size || 1080}p-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.mp4`;
      DR.done({ ok: true, data: await blob.arrayBuffer(), name, fps: blob.fps || 60 });
    } catch (err) {
      DR.done({ ok: false, error: String(err?.message || err || 'The video could not be made') });
    }
  })();
}

// --- the phone and tablet showcase ---------------------------------------------------------
if (MOBILE) {
  import('./mobile.js').then((m) => m.initMobile({ camera, view: renderer.domElement, controls, nextAngle, touchMove, menuUI, overlay, closeAll: closeAllWindows, toggleFly, isFlying: () => flying, keys }));
}
