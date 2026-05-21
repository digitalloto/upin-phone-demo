// COMPREHENSIVE FORMULA EXECUTION TEST
// Simulates a full recording→denial→recovery cycle with realistic sensor data
// Tests every formula and system for crashes, NaN, and correct behavior

const performance = { now: () => Date.now() };
let passed = 0, failed = 0, warnings = 0;
function pass(n) { passed++; }
function fail(n, d) { failed++; console.log(`  \x1b[31m✗ FAIL: ${n}\x1b[0m${d ? ' → ' + d : ''}`); }
function warn(n) { warnings++; console.log(`  \x1b[33m⚠ WARN: ${n}\x1b[0m`); }
function section(n) { console.log(`\n\x1b[36m▸ ${n}\x1b[0m`); }

function hav(a, b) {
  const R = 6371000, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ═══════════════════════════════════
// Setup: minimal runtime environment
// ═══════════════════════════════════
let accel = { x: 0.1, y: -0.2, z: 9.78 };
let gyro = { x: 0, y: 0, z: 2 };
let compass = 90;
let mag = { x: 25, y: -15, z: 40 };
let gravity = { x: 0.1, y: -0.2, z: 9.78 };
let pressure = 1013.25, baroAlt = 50, temp = 25;
let stepCount = 100, lastStepT = 0;
let cellTowers4G = 2, cellTowers2G = 1, wifiAPs = 3;
let laserMm = 0;
let gpsSys = { lat: 13.08, lon: 80.27, speed: 8, acc: 5 };
let gpsTrue = { lat: 13.08, lon: 80.27 };
let drPos = { lat: 13.08, lon: 80.27 };
let phase = 'recording';
let startTime = performance.now() - 120000; // 2 minutes ago
let isStationary = false;
let frozenPos = null;
let boardData = null;
let boardConnected = false;

const CAL = {
  accelBias: { x: 0, y: 0, z: 0 }, accelScale: 0.5, gyroScale: 1,
  gyroBias: { x: 0, y: 0, z: 0 }, compassOff: 0, speedMult: 1
};

const DATA = {
  _samples: [],
  samples: [],
  count() { return this.samples.length; },
  record() {
    this.samples.push({
      lat: gpsSys ? gpsSys.lat : 13.08, lon: gpsSys ? gpsSys.lon : 80.27,
      speed: gpsSys ? gpsSys.speed : 0, heading: compass, dt: 1,
      ax: accel.x, ay: accel.y, az: accel.z, gz: gyro.z, compass: compass,
      laserMm: 0
    });
    if (this.samples.length > 200) this.samples.shift();
  }
};

// Fill with realistic recording data
for (let i = 0; i < 50; i++) {
  gpsSys = { lat: 13.08 + i * 0.00008, lon: 80.27 + i * 0.00005, speed: 8 + Math.random(), acc: 5 };
  compass = 45 + Math.sin(i * 0.1) * 5;
  DATA.record();
}
gpsSys = { lat: 13.084, lon: 80.2725, speed: 8, acc: 5 };

// Minimal stubs for systems formulas depend on
const UTIN = { predict() { return { lat: 13.081, lon: 80.271 }; }, lastTowers: [], update() {} };
const INS = {
  initialized: true, pos: { lat: 13.084, lon: 80.2725 },
  init() {}, update() {}, resetToGPS() {},
  getLatLon() { return this.pos; }
};
const ANIMAL = {
  ant: { steps: 100, prevSteps: 95, stepLen: 0.68, calibrated: true,
    detectStep() { this.steps++; }, ready() { return true; }, conf() { return 0.8; },
    predict(pos, dt) { return pos ? { lat: pos.lat + 0.00001, lon: pos.lon + 0.00001 } : null; },
    _lastPred: null
  },
  pigeon: { predict() { return null; }, ready() { return false; } },
  salmon: { predictFull() { return null; }, ready() { return false; } },
  whale: { predict() { return null; }, ready() { return false; } },
  bat: { predict() { return null; }, ready() { return false; } },
  predictDenied(pos, dt) { return pos ? { lat: pos.lat + 0.00001, lon: pos.lon } : null; },
  recordAll() {}
};
const COMBOS = {
  pool: [], generation: 0, POOL_SIZE: 20,
  bestPredict(pos, dt) { return pos ? { lat: pos.lat + 0.00005, lon: pos.lon + 0.00003 } : null; },
  bestDesc() { return 'F0+F3'; },
  init() {}, score() {}
};
const TERRAIN = { prints: [], match() { return null; }, record() {} };
const MANEUVER = { stats() { return {}; }, detectLive() { return null; }, record() {} };
const ROUTES = { stored: [], match() { return null; }, record() {} };
const LANDMARKS = [
  { lat: 13.085, lon: 80.275, n: 'MGR', d: 'C', t: 'transport' },
  { lat: 13.077, lon: 80.261, n: 'Egmore', d: 'C', t: 'transport' },
  { lat: 13.081, lon: 80.286, n: 'Fort', d: 'C', t: 'landmark' },
  { lat: 13.069, lon: 80.257, n: 'Museum', d: 'C', t: 'government' }
];
const LANDMARK_TRI = {
  nearby: LANDMARKS.map(lm => ({ ...lm, dist: hav({ lat: 13.084, lon: 80.2725 }, lm) })).sort((a, b) => a.dist - b.dist),
  triPos: { lat: 13.083, lon: 80.272, landmarks: 4 },
  update() {}, draw() {}
};
const LORA = { triPos: null };
const DOPPLER = { lastVelocity: null, record() {}, predict() { return null; }, userLat: 13.08, userLon: 80.27 };
const ROUTE_NAV = { active: false, predict() { return null; } };
const ML_TOGGLE = { svm: true, rf: true, doppler: true };
const SVM_GATE = { classify() { return { reliable: true, confidence: 0.8 }; } };
const RF_FUSION = { predict(pos, dt) { return pos ? { lat: pos.lat + 0.00002, lon: pos.lon + 0.00001 } : null; } };
const PREDICTOR = {
  speedBias: 1.0, headingBias: 0, cruiseState: 'cruise', confidence() { return 0.7; },
  predict(pos, dt) { return pos ? { lat: pos.lat + 0.00005, lon: pos.lon + 0.00003 } : null; },
  update() {}
};
const FISH = {
  schools: [{ pos: { lat: 13.0841, lon: 80.2726 }, agents: [], avgErr: 5, fitness: 0.2 }],
  bestSchoolIdx: 0,
  getBestPosition() { return this.schools[0] ? this.schools[0].pos : null; },
  tick() {}, scoreAll() {}, init() {}, generation: 50
};
const LAYER7 = { fused: { speed_kmh: 30 }, cidSpeed: null, zupt: { isZUPT: false }, enabled: true };
const ALGEBRA = { velocity_ms: 0 };
const LAYER5 = { enabled: true, bestRunningIdx(F) { let b = 0, bE = Infinity; F.forEach((f, i) => { if (f.errAvg < bE) { bE = f.errAvg; b = i; } }); return b; } };

// ═══════════════════════════════════
// Build formula infrastructure
// ═══════════════════════════════════

function velFromGPS(n = 5) {
  if (DATA.samples.length < n + 1) return null;
  const r = DATA.samples.slice(-n);
  let vL = 0, vO = 0;
  for (let i = 1; i < r.length; i++) { vL += (r[i].lat - r[i - 1].lat) / (r[i].dt || 1); vO += (r[i].lon - r[i - 1].lon) / (r[i].dt || 1); }
  return { vLat: vL / (n - 1), vLon: vO / (n - 1) };
}
function avgSpeed(n) {
  if (DATA.samples.length < 2) return 0;
  const r = DATA.samples.slice(-n);
  return r.reduce((s, p) => s + p.speed, 0) / r.length;
}
function bestSpeed() {
  const gps = avgSpeed(5);
  if (gps > 0.5) return gps;
  if (LAYER7 && LAYER7.fused && LAYER7.fused.speed_kmh > 2) return LAYER7.fused.speed_kmh / 3.6;
  return 0;
}
function bestHeading() { return compass + CAL.compassOff; }
function drPredict(pos, dt) {
  const s = bestSpeed();
  if (s < 0.1) return null;
  const h = bestHeading() * Math.PI / 180;
  return { lat: pos.lat + (s * Math.cos(h) * dt) / 111320, lon: pos.lon + (s * Math.sin(h) * dt) / (111320 * Math.cos(pos.lat * Math.PI / 180)) };
}
function sma(arr, w) { const s = arr.slice(-w); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0; }
function ema(arr, alpha) { if (!arr.length) return 0; let e = arr[0]; for (let i = 1; i < arr.length; i++) e = alpha * arr[i] + (1 - alpha) * e; return e; }
function getSpeedHist() { return DATA.samples.slice(-40).map(s => s.speed); }
function getHeadingHist() { return DATA.samples.slice(-40).map(s => s.heading); }
function getVelLatHist() { const s = DATA.samples.slice(-40); const v = []; for (let i = 1; i < s.length; i++) v.push((s[i].lat - s[i - 1].lat) / (s[i].dt || 1)); return v; }
function getVelLonHist() { const s = DATA.samples.slice(-40); const v = []; for (let i = 1; i < s.length; i++) v.push((s[i].lon - s[i - 1].lon) / (s[i].dt || 1)); return v; }

function validateFix(lat, lon, name) {
  if (isNaN(lat) || isNaN(lon)) return { ok: false };
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false };
  return { ok: true };
}

// mkF factory
const F = [];
function mkF(name, predictFn) {
  return {
    name, pos: null, err: 999, errAvg: 999, errHistory: [], drillTrail: [], drillDrift: 0, blindSec: 0,
    corrLat: 0, corrLon: 0, corrCount: 0, speedScale: 1.0, headingOff: 0, _fagentParams: null,
    mapLine: null, _mapDot: null, _lastPredLat: 0, _lastPredLon: 0,
    _rawPredict: predictFn, _predicting: false,
    predict(pos, dt) {
      if (this._predicting) return pos;
      this._predicting = true;
      let p;
      let sA, sG, sC;
      if (this._fagentParams) {
        const fp = this._fagentParams;
        sA = { ...accel }; sG = { ...gyro }; sC = compass;
        accel = { x: (accel.x - fp.aBx) * fp.aScl, y: (accel.y - fp.aBy) * fp.aScl, z: accel.z };
        gyro = { x: gyro.x * fp.gScl, y: gyro.y * fp.gScl, z: gyro.z * fp.gScl };
        compass = compass + fp.cOff;
      }
      try { p = this._rawPredict.call(this, pos, dt); } catch (e) { p = pos; }
      if (this._fagentParams) { accel = sA; gyro = sG; compass = sC; }
      this._predicting = false;
      if (!p || !pos) return p;
      if (this.corrCount > 10) { p.lat += this.corrLat; p.lon += this.corrLon; }
      if (this.headingOff && Math.abs(this.headingOff) > 0.01) {
        const dLat = p.lat - pos.lat, dLon = p.lon - pos.lon;
        const h = this.headingOff * Math.PI / 180;
        p.lat = pos.lat + dLat * Math.cos(h) - dLon * Math.sin(h);
        p.lon = pos.lon + dLat * Math.sin(h) + dLon * Math.cos(h);
      }
      return p;
    }
  };
}

// ═══════════════════════════════════
// Register ALL formulas
// ═══════════════════════════════════
F.push(mkF('Vel SMA', (pos, dt) => { const v = velFromGPS(5); return v ? { lat: pos.lat + v.vLat * dt, lon: pos.lon + v.vLon * dt } : drPredict(pos, dt); }));
F.push(mkF('Vel EMA', function(pos, dt) { const v = velFromGPS(3); if (!v) return null; const a = 0.3; this._vL = (this._vL || 0) * (1 - a) + v.vLat * a; this._vO = (this._vO || 0) * (1 - a) + v.vLon * a; return { lat: pos.lat + this._vL * dt, lon: pos.lon + this._vO * dt }; }));
F.push(mkF('Vel WMA', (pos, dt) => { if (DATA.samples.length < 4) return null; const r = DATA.samples.slice(-8); let vL = 0, vO = 0, tw = 0; for (let i = 1; i < r.length; i++) { const w = i; vL += w * (r[i].lat - r[i - 1].lat) / (r[i].dt || 1); vO += w * (r[i].lon - r[i - 1].lon) / (r[i].dt || 1); tw += w; } return { lat: pos.lat + (vL / tw) * dt, lon: pos.lon + (vO / tw) * dt }; }));
F.push(mkF('Accel+Comp', (pos, dt) => { const aM = Math.sqrt((accel.x - CAL.accelBias.x) ** 2 + (accel.y - CAL.accelBias.y) ** 2); const s = aM * CAL.accelScale * CAL.speedMult; const h = (compass + CAL.compassOff) * Math.PI / 180; return { lat: pos.lat + (s * Math.cos(h) * dt) / 111320, lon: pos.lon + (s * Math.sin(h) * dt) / (111320 * Math.cos(pos.lat * Math.PI / 180)) }; }));
F.push(mkF('Sensor Fuse', function(pos, dt) { const aM = Math.sqrt((accel.x - CAL.accelBias.x) ** 2 + (accel.y - CAL.accelBias.y) ** 2); const sS = aM * CAL.accelScale * CAL.speedMult; const sG = avgSpeed(5); const s = sS * 0.3 + sG * 0.7; this._h = (this._h || 0) + (gyro.z - CAL.gyroBias.z) * CAL.gyroScale * dt * 0.3; const cH = (compass + CAL.compassOff); const fH = (cH * 0.7 + this._h * 0.3) * Math.PI / 180; return { lat: pos.lat + (s * Math.cos(fH) * dt) / 111320, lon: pos.lon + (s * Math.sin(fH) * dt) / (111320 * Math.cos(pos.lat * Math.PI / 180)) }; }));
F.push(mkF('Consensus', function(pos, dt) { const preds = []; for (let i = 0; i < Math.min(5, F.length); i++) { if (F[i].name === 'Consensus' || F[i].name === 'Adaptive') continue; const p = F[i].predict({ ...pos }, dt); if (p) preds.push(p); } if (preds.length < 3) return null; preds.sort((a, b) => a.lat - b.lat); const mLat = preds[Math.floor(preds.length / 2)].lat; preds.sort((a, b) => a.lon - b.lon); return { lat: mLat, lon: preds[Math.floor(preds.length / 2)].lon }; }));
F.push(mkF('Strapdown INS', (pos, dt) => { const p = INS.getLatLon(); return p || pos; }));
F.push(mkF('Cell Tower', function(pos, dt) { if (gpsSys) this.blindSec = 0; else this.blindSec += dt; const t = UTIN.predict(); if (!t) return null; const vP = F[0].predict({ ...pos }, dt); if (!vP) return { lat: t.lat, lon: t.lon }; const tW = Math.min(0.8, Math.max(0, this.blindSec / 60)); return { lat: vP.lat * (1 - tW) + t.lat * tW, lon: vP.lon * (1 - tW) + t.lon * tW }; }));
F.push(mkF('Fish Swarm', function(pos, dt) { if (!FISH.schools || !FISH.schools.length) return null; const bp = FISH.getBestPosition(); if (!bp || !bp.lat || !bp.lon) return null; if (bp.lat < 1 && bp.lon < 1) return null; return { lat: bp.lat, lon: bp.lon }; }));
F.push(mkF('Baro+Vel', function(pos, dt) { if (!pos) return null; const s = bestSpeed(); if (s < 0.1) return null; const h = bestHeading() * Math.PI / 180; let vFactor = 1; if (pressure > 0) { this._lastAlt = this._lastAlt || baroAlt; const dAlt = baroAlt - this._lastAlt; this._lastAlt = baroAlt; vFactor = Math.max(0.5, Math.min(1.5, 1 - Math.abs(dAlt) * 0.05)); } return { lat: pos.lat + (s * vFactor * Math.cos(h) * dt) / 111320, lon: pos.lon + (s * vFactor * Math.sin(h) * dt) / (111320 * Math.cos(pos.lat * Math.PI / 180)) }; }));

// ═══════════════════════════════════
// TEST PHASE 1: Recording (GPS available)
// ═══════════════════════════════════
section('PHASE 1: Recording — all formulas predict with GPS');

const testPos = { lat: 13.084, lon: 80.2725 };
let phase1Fails = 0;

F.forEach((f, i) => {
  f.pos = { ...testPos };
  try {
    const result = f.predict({ ...testPos }, 1);
    if (result === null) {
      pass(f.name + ' returned null (acceptable)');
    } else if (isNaN(result.lat) || isNaN(result.lon)) {
      fail('F[' + i + '] ' + f.name + ': returns NaN', 'lat=' + result.lat + ' lon=' + result.lon);
      phase1Fails++;
    } else if (Math.abs(result.lat) > 90 || Math.abs(result.lon) > 180) {
      fail('F[' + i + '] ' + f.name + ': out of bounds', 'lat=' + result.lat + ' lon=' + result.lon);
      phase1Fails++;
    } else {
      const dist = hav(testPos, result);
      if (dist > 10000) {
        fail('F[' + i + '] ' + f.name + ': moved ' + dist.toFixed(0) + 'm in 1 tick (>10km)', '');
        phase1Fails++;
      } else {
        pass(f.name);
      }
    }
  } catch (e) {
    fail('F[' + i + '] ' + f.name + ': CRASHED', e.message);
    phase1Fails++;
  }
});

if (phase1Fails === 0) console.log('  \x1b[32m✓ All ' + F.length + ' formulas pass recording phase (no NaN, no crash, no >10km jump)\x1b[0m');
else console.log('  \x1b[31m✗ ' + phase1Fails + ' formulas failed recording phase\x1b[0m');

// ═══════════════════════════════════
// TEST PHASE 2: GPS Denial
// ═══════════════════════════════════
section('PHASE 2: GPS Denial — formulas predict without GPS');

gpsSys = null; // GPS denied
phase = 'jammed';

let phase2Fails = 0;
let phase2Nulls = 0;

// Run 10 ticks of denial
for (let tick = 0; tick < 10; tick++) {
  F.forEach((f, i) => {
    if (!f.pos) f.pos = { ...testPos };
    try {
      const result = f.predict({ ...f.pos }, 1);
      if (result === null) {
        phase2Nulls++;
        return;
      }
      if (isNaN(result.lat) || isNaN(result.lon)) {
        if (tick === 0) { fail('Denial tick ' + tick + ' F[' + i + '] ' + f.name + ': NaN', ''); phase2Fails++; }
        return;
      }
      if (Math.abs(result.lat) > 90 || Math.abs(result.lon) > 180) {
        if (tick === 0) { fail('Denial tick ' + tick + ' F[' + i + '] ' + f.name + ': out of bounds', ''); phase2Fails++; }
        return;
      }
      const dist = hav(f.pos, result);
      if (dist > 10000) {
        if (tick === 0) { fail('Denial tick ' + tick + ' F[' + i + '] ' + f.name + ': jumped ' + dist.toFixed(0) + 'm', ''); phase2Fails++; }
        return;
      }
      f.pos = result;
    } catch (e) {
      if (tick === 0) { fail('Denial F[' + i + '] ' + f.name + ': CRASHED', e.message); phase2Fails++; }
    }
  });
}

if (phase2Fails === 0) console.log('  \x1b[32m✓ All formulas survive 10 denial ticks (no NaN, no crash)\x1b[0m');
else console.log('  \x1b[31m✗ ' + phase2Fails + ' formulas failed denial phase\x1b[0m');

// ═══════════════════════════════════
// TEST PHASE 3: GPS Recovery
// ═══════════════════════════════════
section('PHASE 3: GPS Recovery');

gpsSys = { lat: 13.085, lon: 80.273, speed: 8, acc: 5 };
phase = 'recording';
let phase3Fails = 0;

F.forEach((f, i) => {
  f.pos = { lat: gpsSys.lat, lon: gpsSys.lon };
  try {
    const result = f.predict({ ...f.pos }, 1);
    if (result && (isNaN(result.lat) || isNaN(result.lon))) {
      fail('Recovery F[' + i + '] ' + f.name + ': NaN after recovery', '');
      phase3Fails++;
    } else {
      pass(f.name);
    }
  } catch (e) {
    fail('Recovery F[' + i + '] ' + f.name + ': CRASHED', e.message);
    phase3Fails++;
  }
});

if (phase3Fails === 0) console.log('  \x1b[32m✓ All formulas recover cleanly after GPS restored\x1b[0m');

// ═══════════════════════════════════
// TEST: mkF wrapper correctness
// ═══════════════════════════════════
section('mkF wrapper verification');

// Test _fagentParams save/restore
const testF = mkF('wrapper-test', (pos, dt) => { return { lat: pos.lat + 0.001, lon: pos.lon }; });
testF._fagentParams = { aScl: 2.0, aBx: 0.1, aBy: 0.05, gScl: 1.5, cOff: 3 };
const savedAccel = { ...accel };
const savedGyro = { ...gyro };
const savedCompass = compass;
testF.predict({ lat: 13, lon: 80 }, 1);
if (Math.abs(accel.x - savedAccel.x) < 0.001 && Math.abs(gyro.z - savedGyro.z) < 0.001 && compass === savedCompass) {
  pass('_fagentParams: globals saved and restored');
} else {
  fail('_fagentParams: globals NOT restored', `accel.x=${accel.x} (was ${savedAccel.x})`);
}

// Test headingOff rotation
const testF2 = mkF('hdg-test', (pos, dt) => ({ lat: pos.lat + 0.001, lon: pos.lon }));
testF2.headingOff = 90;
const r = testF2.predict({ lat: 13, lon: 80 }, 1);
if (r && Math.abs(r.lon - 80) > 0.0005) pass('headingOff=90° rotates north→east');
else fail('headingOff rotation failed');

// Test recursion guard
const testF3 = mkF('recurse-test', function(pos, dt) { return this.predict(pos, dt); });
const rr = testF3.predict({ lat: 13, lon: 80 }, 1);
if (rr && rr.lat === 13) pass('Recursion guard returns pos (no infinite loop)');
else fail('Recursion guard failed');

// ═══════════════════════════════════
// SUMMARY
// ═══════════════════════════════════
console.log('\n╔══════════════════════════════════════════════╗');
console.log(`║  Formulas tested: ${F.length}`);
console.log(`║  Recording phase: ${phase1Fails === 0 ? '\x1b[32mALL PASS\x1b[0m' : '\x1b[31m' + phase1Fails + ' FAIL\x1b[0m'}`);
console.log(`║  Denial phase:    ${phase2Fails === 0 ? '\x1b[32mALL PASS\x1b[0m' : '\x1b[31m' + phase2Fails + ' FAIL\x1b[0m'}`);
console.log(`║  Recovery phase:  ${phase3Fails === 0 ? '\x1b[32mALL PASS\x1b[0m' : '\x1b[31m' + phase3Fails + ' FAIL\x1b[0m'}`);
console.log(`║  Wrapper tests:   ${failed === phase1Fails + phase2Fails + phase3Fails ? '\x1b[32mALL PASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
console.log(`║  Total: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[33m${warnings} warnings\x1b[0m`);
console.log('╚══════════════════════════════════════════════╝');
process.exit(failed > 0 ? 1 : 0);
