/**
 * main.js — Runtime. Screens, the frame loop, and the level context.
 */

import { AudioEngine } from './engine/audio.js';
import { Steering } from './engine/input.js';
import { TRIALS_PER_LEVEL, TRIAL_AUDIO_SCALE } from './engine/constants.js';
import { FIRST_NARROWING } from './levels/first-narrowing.js';

const LEVELS = {};
FIRST_NARROWING.forEach((lv) => { LEVELS[lv.id] = lv; });
const TOTAL_LEVELS = 100;

const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const steering = new Steering(() => {
  if (audio.ctx) audio.setListenerYaw(steering.yaw);
  if (running) $('headingCue').textContent = headingText();
});

let currentLevel = 1;
let trial = 1;
let running = false;
let rafId = null;
let lastFrame = 0;
let elapsed = 0;
let levelState = {};

// --- Screens ---------------------------------------------------------

const SCREENS = ['title', 'calibration', 'briefing', 'game', 'end'];
function goTo(name) {
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle('active', s === name));
}

// --- Level select ----------------------------------------------------

function buildLevelMap() {
  const map = $('levelmap');
  map.innerHTML = '';
  for (let n = 1; n <= TOTAL_LEVELS; n++) {
    const lv = LEVELS[n];
    const row = document.createElement('div');
    row.className = `level-row ${lv ? 'unlocked' : 'locked'}`;
    row.innerHTML =
      `<span class="num">${String(n).padStart(2, '0')}</span>` +
      `<span class="name">${lv ? lv.name : '·'}</span>` +
      `<span>${lv ? '' : '🔒'}</span>`;
    if (lv) row.addEventListener('click', () => { trial = 1; openBriefing(n); });
    map.appendChild(row);
  }
}

// --- Briefing --------------------------------------------------------

function openBriefing(id) {
  stopCalibration();
  currentLevel = id;
  const lv = LEVELS[id];

  $('briefLabel').textContent =
    `Level ${id} · ${lv.name} — Trial ${trial} of ${TRIALS_PER_LEVEL}`;

  const pct = Math.round(TRIAL_AUDIO_SCALE[trial - 1] * 100);
  const note = trial === 1
    ? `<br><br><i>Trial 1 of ${TRIALS_PER_LEVEL} — full clarity. Take whatever time you need.</i>`
    : `<br><br><i>Trial ${trial} of ${TRIALS_PER_LEVEL} — quieter now (~${pct}% as clear). A deeper kind of listening.</i>`;

  $('briefText').innerHTML = lv.briefing + note;
  $('gyroRow').style.display = lv.control === 'breathe' ? 'none' : 'block';
  goTo('briefing');
}

// --- Ear calibration -------------------------------------------------

let calCtx = null;
function stopCalibration() {
  if (calCtx) { try { calCtx.close(); } catch (e) { /* noop */ } calCtx = null; }
  $('btn-cal-toggle').textContent = 'Play Faint Tone';
}

function toggleCalibration() {
  if (calCtx) { stopCalibration(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  calCtx = new Ctx();

  const sr = calCtx.sampleRate;
  const buf = calCtx.createBuffer(1, sr * 3, sr);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }

  const src = calCtx.createBufferSource(); src.buffer = buf; src.loop = true;
  const filt = calCtx.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = 500; filt.Q.value = 0.7;
  const g = calCtx.createGain(); g.gain.value = 0.05;

  src.connect(filt); filt.connect(g); g.connect(calCtx.destination);
  src.start();
  $('btn-cal-toggle').textContent = 'Stop';
}

// --- UI callbacks passed to levels -----------------------------------

function headingText() {
  const r = steering.relativeYaw;
  if (Math.abs(r) < 4) return 'facing forward';
  return r > 0 ? `turned ${Math.round(r)}° right` : `turned ${Math.round(-r)}° left`;
}

const ui = {
  setPresence(v) { $('presenceFill').style.width = `${Math.max(0, Math.min(100, v))}%`; },
  setOrb(strength, notice = false) {
    const orb = $('orb');
    orb.classList.toggle('notice', notice);
    orb.style.transform = `scale(${(0.78 + strength * 0.42).toFixed(3)})`;
    orb.style.opacity = (0.4 + strength * 0.5).toFixed(2);
  },
  setWord(w) { $('breathword').textContent = w; },
  flash(msg) {
    $('headingCue').textContent = msg;
    setTimeout(() => { if (running) $('headingCue').textContent = headingText(); }, 1600);
  },
};

// --- Game loop -------------------------------------------------------

function start() {
  const lv = LEVELS[currentLevel];

  audio.init();
  audio.setAudioScale(TRIAL_AUDIO_SCALE[Math.min(trial, TRIALS_PER_LEVEL) - 1]);

  steering.reset();
  elapsed = 0;
  lastFrame = 0;
  levelState = {};
  ui.setPresence(0);

  $('controlsCommit').style.display = lv.control === 'commit' ? 'flex' : 'none';
  $('controlsHold').style.display = lv.control === 'hold' ? 'flex' : 'none';
  $('controlsBreathe').style.display = lv.control === 'breathe' ? 'flex' : 'none';
  $('dragzone').style.display = lv.control === 'breathe' ? 'none' : 'flex';
  $('headingCue').style.display = lv.control === 'breathe' ? 'none' : 'block';
  $('headingCue').textContent = 'facing forward';
  if (lv.control === 'commit') $('btnCommit').textContent = lv.commitLabel;

  lv.init(levelState, audio);
  running = true;
  rafId = requestAnimationFrame(frame);
}

function levelCtx() {
  return {
    yaw: steering.yaw,
    audio,
    elapsed,
    complete,
    ...ui,
  };
}

function frame(ts) {
  if (!running) return;
  if (!lastFrame) lastFrame = ts;
  const dt = Math.min((ts - lastFrame) / 1000, 0.1);
  lastFrame = ts;
  elapsed += dt;

  LEVELS[currentLevel].update(levelState, dt, elapsed, levelCtx());

  if (running) rafId = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  const lv = LEVELS[currentLevel];
  if (lv.cleanup) { try { lv.cleanup(levelState); } catch (e) { /* noop */ } }
  audio.close();
  steering.disableGyro();
}

function complete() {
  stop();
  goTo('end');

  const lv = LEVELS[currentLevel];
  const info = lv.completionText(levelState);
  $('endText').textContent = info.text;
  $('endSub').textContent =
    `Trial ${trial} of ${TRIALS_PER_LEVEL} complete. ${info.sub}`;

  const next = $('btn-next');
  if (trial < TRIALS_PER_LEVEL) {
    next.style.display = 'inline-block';
    next.textContent = 'Continue, Quieter Still';
    next.onclick = () => { trial++; openBriefing(currentLevel); };
  } else if (LEVELS[currentLevel + 1]) {
    next.style.display = 'inline-block';
    next.textContent = 'Continue';
    next.onclick = () => { trial = 1; openBriefing(currentLevel + 1); };
  } else {
    next.style.display = 'none';
  }
}

// --- Wiring ----------------------------------------------------------

buildLevelMap();

$('btn-calibrate').addEventListener('click', () => goTo('calibration'));
$('btn-cal-toggle').addEventListener('click', toggleCalibration);
$('btn-cal-done').addEventListener('click', () => { stopCalibration(); goTo('title'); });
$('btn-retry').addEventListener('click', () => openBriefing(currentLevel));

['btnLeft', 'btnLeft2'].forEach((id) => $(id).addEventListener('click', () => steering.turn(-15)));
['btnRight', 'btnRight2'].forEach((id) => $(id).addEventListener('click', () => steering.turn(15)));

steering.attachDrag($('dragzone'));

window.addEventListener('keydown', (e) => {
  if (!running) return;
  if (e.key === 'ArrowLeft') steering.turn(-8);
  if (e.key === 'ArrowRight') steering.turn(8);
  if (e.key === ' ' || e.key === 'Enter') tryCommit();
});

function tryCommit() {
  if (!running) return;
  const lv = LEVELS[currentLevel];
  if (lv.onCommit) lv.onCommit(levelState, levelCtx());
}
$('btnCommit').addEventListener('click', tryCommit);

const breatheBtn = $('btnBreathe');
function breathe(held) {
  return (e) => {
    if (e.cancelable) e.preventDefault();
    breatheBtn.classList.toggle('holding', held);
    const lv = LEVELS[currentLevel];
    if (lv.onBreathe) lv.onBreathe(levelState, held);
  };
}
breatheBtn.addEventListener('touchstart', breathe(true), { passive: false });
breatheBtn.addEventListener('touchend', breathe(false));
breatheBtn.addEventListener('mousedown', breathe(true));
breatheBtn.addEventListener('mouseup', breathe(false));
breatheBtn.addEventListener('mouseleave', breathe(false));

$('btn-start-audio').addEventListener('click', async () => {
  const lv = LEVELS[currentLevel];
  let gyro = false;
  if (lv.control !== 'breathe' && $('gyroToggle').checked) {
    gyro = await Steering.requestPermission();
  }
  if (gyro) steering.enableGyro();

  $('controlBadge').textContent = gyro ? 'steering · phone compass' : 'steering · swipe';
  $('dragHint').textContent = gyro ? 'turn your body or phone to steer' : '◂ swipe to turn ▸';

  goTo('game');
  start();
});
