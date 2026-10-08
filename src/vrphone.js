// Phone-in-a-headset VR: head tracking from the device's motion sensors.
//
// This exists because WebXR is not an option here. iOS Safari has no WebXR at
// all and Chrome dropped Cardboard years ago, so `navigator.xr` never offers an
// immersive session on a phone. The stereo split itself is three's StereoEffect;
// this module supplies the head orientation, the way Cardboard did.
//
// Two hard platform constraints shape the API:
//  * DeviceOrientationEvent only fires in a SECURE CONTEXT — an http:// LAN
//    address can never head-track, which is why the dev server serves TLS.
//  * iOS 13+ requires DeviceOrientationEvent.requestPermission() from inside a
//    real user gesture, so enable() must be called straight out of a tap
//    handler — never on load, never after an await.
import * as THREE from 'three';

// -Y up correction: the sensor frame has the phone lying face-up, the camera
// frame has it held to your eyes.
const Q_SCREEN = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const ZEE = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

export function initVRPhone() {
  const state = { on: false, hasData: false, alphaOffset: 0 };
  let alpha = 0, beta = 0, gamma = 0;

  const euler = new THREE.Euler();
  const qDevice = new THREE.Quaternion();
  const qTwist = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  // Landscape in a headset means the screen is rotated 90°; without this the
  // world tilts on its side.
  const screenAngle = () => {
    const a = (screen.orientation && screen.orientation.angle);
    return (a == null ? (window.orientation || 0) : a) * DEG;
  };

  const onOrient = (e) => {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    alpha = (e.alpha || 0) * DEG;
    beta = (e.beta || 0) * DEG;
    gamma = (e.gamma || 0) * DEG;
    state.hasData = true;
  };

  function available() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
  }

  // Call from a tap handler. Resolves false when the user declines, when the
  // page is not secure, or when the device has no sensors.
  async function enable() {
    if (!available()) return false;
    const req = window.DeviceOrientationEvent.requestPermission;
    if (typeof req === 'function') {
      try {
        if (await req.call(window.DeviceOrientationEvent) !== 'granted') return false;
      } catch (_) {
        return false;   // thrown on an insecure origin
      }
    }
    // absolute first: on Android it is north-referenced and does not drift
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    state.on = true;
    return true;
  }

  function disable() {
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    window.removeEventListener('deviceorientation', onOrient, true);
    state.on = false;
    state.hasData = false;
  }

  // Make wherever the head is pointing now read as `baseYaw`. iOS alpha is
  // relative and drifts over minutes, so this is the cure the UI exposes.
  function recenter() {
    state.alphaOffset = -alpha;
  }

  // Orientation only — position stays with whatever set the vantage point.
  function update(camera, baseYaw = 0) {
    if (!state.on || !state.hasData) return false;
    euler.set(beta, alpha + state.alphaOffset, -gamma, 'YXZ');
    qDevice.setFromEuler(euler);
    qDevice.multiply(Q_SCREEN);
    qDevice.multiply(qTwist.setFromAxisAngle(ZEE, -screenAngle()));
    camera.quaternion.copy(qYaw.setFromAxisAngle(UP, baseYaw)).multiply(qDevice);
    return true;
  }

  return { state, available, enable, disable, recenter, update };
}
