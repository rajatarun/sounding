/**
 * input.js — Steering.
 *
 * The player turns to listen. Three input paths, in order of preference:
 *   1. Phone compass (DeviceOrientationEvent) — physical turning, most embodied
 *   2. Swipe / drag
 *   3. On-screen arrow buttons
 *
 * NOTE ON HEAD TRACKING: AirPods head-tracking (CMHeadphoneMotionManager) is
 * NOT reachable from a web page — Apple exposes it only to native iOS. A native
 * WKWebView wrapper could bridge it in and call `Steering.turn()` directly;
 * that's the intended upgrade path, not a rewrite. See docs/ROADMAP.md.
 */

export class Steering {
  constructor(onChange) {
    this.yaw = 0;
    this.onChange = onChange || (() => {});
    this.gyroActive = false;
    this._lastHeading = null;
    this._onOrient = this._onOrient.bind(this);
  }

  turn(deltaDeg) {
    this.yaw = (this.yaw + deltaDeg + 360) % 360;
    this.onChange(this.yaw);
  }

  reset() { this.yaw = 0; this.onChange(0); }

  /** Signed offset from "facing forward", in [-180, 180]. For UI text. */
  get relativeYaw() { return this.yaw > 180 ? this.yaw - 360 : this.yaw; }

  // --- Compass ---------------------------------------------------------

  static async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE === 'undefined') return false;
    if (typeof DOE.requestPermission === 'function') {
      try { return (await DOE.requestPermission()) === 'granted'; }
      catch (e) { return false; }
    }
    return true; // non-iOS: no permission gate
  }

  enableGyro() {
    this._lastHeading = null;
    this.gyroActive = true;
    window.addEventListener('deviceorientation', this._onOrient, true);
  }

  disableGyro() {
    window.removeEventListener('deviceorientation', this._onOrient, true);
    this.gyroActive = false;
    this._lastHeading = null;
  }

  _onOrient(e) {
    const h = Steering._heading(e);
    if (h == null || isNaN(h)) return;
    if (this._lastHeading === null) { this._lastHeading = h; return; }

    // Feed *relative* delta, not absolute heading, so the player's starting
    // orientation is always "forward" regardless of which way they're facing.
    let delta = h - this._lastHeading;
    delta = ((delta + 180) % 360 + 360) % 360 - 180;
    this._lastHeading = h;
    if (Math.abs(delta) < 0.08) return; // deadzone: sensor jitter
    this.turn(delta);
  }

  static _heading(e) {
    // iOS gives a tilt-compensated compass heading directly.
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      return e.webkitCompassHeading;
    }
    if (e.alpha == null) return null;
    const h = Steering._fromEuler(e.alpha, e.beta, e.gamma);
    return isNaN(h) ? 360 - e.alpha : h;
  }

  /** Tilt-compensated heading from raw Euler angles (non-iOS fallback). */
  static _fromEuler(alpha, beta, gamma) {
    const d = Math.PI / 180;
    const x = beta ? beta * d : 0;
    const y = gamma ? gamma * d : 0;
    const z = alpha ? alpha * d : 0;
    const cY = Math.cos(y), cZ = Math.cos(z);
    const sX = Math.sin(x), sZ = Math.sin(z), sY = Math.sin(y);
    const cYaw = Math.cos(x);
    const Vx = -cZ * sY - sZ * sX * cY;
    const Vy = -sZ * sY + cZ * sX * cY;
    let heading = Math.atan2(Vx, Vy);
    if (heading < 0) heading += 2 * Math.PI;
    return heading * (180 / Math.PI);
  }

  // --- Drag ------------------------------------------------------------

  attachDrag(el, sensitivity = 0.35) {
    let dragging = false, lastX = 0;
    const start = (x) => { dragging = true; lastX = x; };
    const move = (x) => {
      if (!dragging) return;
      this.turn((x - lastX) * sensitivity);
      lastX = x;
    };
    const end = () => { dragging = false; };

    el.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
    el.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('mousedown', (e) => start(e.clientX));
    window.addEventListener('mousemove', (e) => move(e.clientX));
    window.addEventListener('mouseup', end);
  }
}

/** Absolute angular difference between two bearings, in [0, 180]. */
export function angleDiff(a, b) {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

/** 1 when facing a bearing dead-on, falling to 0 at 90° off. */
export function alignment(yaw, target) {
  return Math.max(0, Math.cos((angleDiff(yaw, target) * Math.PI) / 180));
}
