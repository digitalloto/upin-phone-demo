#!/usr/bin/env node
// UPIN Safety Guard — no fake OUTPUTS
//
// Hard rule: UPIN must never output an invented position.
// A layer either computes from real sensor data or reports OFFLINE — nothing in between.
//
// This test FAILS the build if random/np.random/Math.random feeds directly into:
//   - a returned Position field (lat / lon / alt / latitude / longitude / altitude)
//   - an output accuracy value  (acc / accuracy)
//   - a confidence or score value (conf / confidence / score)
//
// This test ALLOWS random when it only perturbs:
//   - agent parameters, DNA/weights, particle STATE, exploration/mutation
//   - i.e. inputs to a real algorithm, not the algorithm's output
//
// Usage:
//   node scripts/guard-no-fake-outputs.mjs
//   exit 0 = clean, exit 1 = violations found

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// -----------------------------------------------------------------------------
// Rule table
// -----------------------------------------------------------------------------
// Field names that identify an OUTPUT the user (or a caller) will trust.
// Case-insensitive match on the property key OR the assignment target.
const PROHIBITED_OUTPUT_KEYS = [
  'lat', 'latitude',
  'lon', 'long', 'longitude',
  'alt', 'altitude',
  'acc', 'accuracy',
  'conf', 'confidence',
  'score'
];

// Any of these patterns means "random source"
const RANDOM_PATTERNS = [
  /Math\.random\s*\(/,
  /\brandom\.random\s*\(/,
  /\bnp\.random\.normal\b/,
  /\brandomNormal\b/,
  /\bcrypto\.getRandomValues\b/
];

// Names of containers / iterator objects that are INTERNAL algorithm state.
// Random applied to fields on these is legitimate exploration/mutation, not output.
const INTERNAL_CONTAINERS = [
  'particle', 'particles', '_particles', 'newp', 'newparticles', 'nextparticles',
  'agent', 'agents', '_agents',
  'variant', 'variants',
  'dna', 'gene', 'genes', 'genome',
  'child', 'children', 'offspring',
  'swarm', 'school', 'schools', 'fish',
  'candidate', 'candidates',
  'weight', 'weights',
  'chromosome', 'chromosomes',
  'pool', 'pools'
];

// Common loop-iterator variable names that MAY be a particle/agent
// — only accepted as internal when combined with nearby internal-container context.
const LOOP_VAR_NAMES = new Set(['p', 'q', 'v', 'a', 'x']);

// Files that are ALLOWED to invent values (test fixtures, kept per audit CATEGORY E).
const ALLOWED_FILES = new Set([
  'test-full-cycle.mjs',
  'run-tests.mjs',
  'scripts/guard-no-fake-outputs.mjs' // this file has synthetic examples inside strings
]);

// Directories to skip entirely
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'data', 'docs']);

// Extensions to scan
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.py']);

// -----------------------------------------------------------------------------
// File walker
// -----------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (SKIP_DIRS.has(name)) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, out); continue; }
    if (!SCAN_EXT.has(extname(name))) continue;
    if (ALLOWED_FILES.has(rel)) continue;
    out.push(p);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Line classifier
// -----------------------------------------------------------------------------
// Look BACK from lineIdx (up to `lookback` lines) for any reference to an
// internal-container name. Used to decide whether an object literal or a loop
// iterator is inside algorithm-internal state.
function hasInternalContextAbove(lines, lineIdx, lookback = 20) {
  const start = Math.max(0, lineIdx - lookback);
  for (let i = lineIdx; i >= start; i--) {
    // Strip string literals so DOM class names like 'l-fish' or 'Fish' don't match.
    const l = lines[i]
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, '``')
      .toLowerCase();
    for (const name of INTERNAL_CONTAINERS) {
      // Whole-word JS identifier boundary — exclude hyphens (CSS/kebab) and quotes.
      const rx = new RegExp('(^|[^-a-z0-9_])' + name + '(?![-a-z0-9_])', 'i');
      if (rx.test(l)) return name;
    }
  }
  return null;
}

// Returns { violation: bool, target: string|null, reason: string, allow?: string }
function classifyLine(line, lines = null, lineIdx = 0) {
  // Must contain a random source first
  const hasRandom = RANDOM_PATTERNS.some(rx => rx.test(line));
  if (!hasRandom) return { violation: false, target: null, reason: 'no-random' };

  // Position of the random source on this line
  const rx = RANDOM_PATTERNS.find(r => r.test(line));
  const randomIdx = line.search(rx);
  const prefix = line.slice(0, randomIdx);

  // Property-key form:  key: ...random...
  // Member-assign form: something.KEY = / += ...random...
  // Bare-assign form:   KEY = / += ...random...
  const keyMatches = [...prefix.matchAll(/(?:^|[\s{,(])['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\s*:/g)];
  const dotMatches = [...prefix.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[+\-*/]?=(?!=)/g)];
  const bareAssign = [...prefix.matchAll(/(?:^|[\s;{])([a-zA-Z_][a-zA-Z0-9_]*)\s*[+\-*/]?=(?!=)/g)];

  const candidates = [];
  for (const m of keyMatches)  candidates.push({ receiver: null,  key: m[1], form: 'property' });
  for (const m of dotMatches)  candidates.push({ receiver: m[1], key: m[2], form: 'member-assign' });
  for (const m of bareAssign)  candidates.push({ receiver: null,  key: m[1], form: 'bare-assign' });

  if (candidates.length === 0) {
    return { violation: false, target: null, reason: 'no-binding' };
  }

  // Take the LAST candidate — that is the immediate binding for the random value.
  const last = candidates[candidates.length - 1];
  const keyLower = last.key.toLowerCase();

  // Not a protected output field → definitely allowed.
  if (!PROHIBITED_OUTPUT_KEYS.includes(keyLower)) {
    return { violation: false, target: last.key, reason: 'random binds to non-output field ' + last.key };
  }

  // The key IS a protected output field. Check for legitimate-internal exceptions.
  const receiverLower = (last.receiver || '').toLowerCase().replace(/^_/, '');

  // Exception 1: receiver is a named internal container (e.g. particle.lat, agent.lat, dna.lat)
  if (INTERNAL_CONTAINERS.includes(receiverLower)) {
    return { violation: false, target: last.key, reason: 'internal: receiver "' + last.receiver + '" is algorithm state' };
  }

  // Exception 2: receiver is a short loop-var (p, q...) AND we can see an
  // internal container nearby (within 20 lines above). This catches:
  //     this._particles.forEach(p => { p.lat += ... + Math.random() ... })
  if (last.receiver && LOOP_VAR_NAMES.has(receiverLower) && lines) {
    const container = hasInternalContextAbove(lines, lineIdx, 20);
    if (container) {
      return { violation: false, target: last.key, reason: 'internal: loop var "' + last.receiver + '" over ' + container };
    }
  }

  // Exception 3: property form inside an object literal that is being pushed
  // into an internal container:
  //     this._particles.push({ lat: base + Math.random()*x, lon: ... })
  //     newP.push({ lat: parent.lat + (Math.random()-.5)*0.0001, ... })
  if (last.form === 'property' && lines) {
    const container = hasInternalContextAbove(lines, lineIdx, 20);
    if (container) {
      return { violation: false, target: last.key, reason: 'internal: property inside ' + container + ' container' };
    }
  }

  return {
    violation: true,
    target: last.key,
    reason: 'random flows into output field "' + last.key + '" (' + last.form + ')'
  };
}

// -----------------------------------------------------------------------------
// Self-tests
// -----------------------------------------------------------------------------
function selfTest() {
  // Each case: { lines: [...], testIdx: int, shouldViolate: bool }
  // testIdx = which line in the block to classify (context above matters).
  const cases = [
    // ── ALLOWED (algorithm exploration / mutation / state) ────────────
    { name: 'DNA weight (LAYER_swarm_optimizer style)',
      lines: ['pool.variants.push({', 'weights: {', 'speedMult: 0.95 + Math.random() * 0.1,', '}});'],
      testIdx: 2, shouldViolate: false },
    { name: 'Particle state init inside _particles.push',
      lines: ['this._particles.push({',
              '  lat: baseLat + (Math.random()-0.5)*0.002,',
              '  lon: baseLon + (Math.random()-0.5)*0.002,',
              '  w: 1/N',
              '});'],
      testIdx: 1, shouldViolate: false },
    { name: 'Particle state mutation inside forEach(p=>)',
      lines: ['this._particles.forEach(p => {',
              '  p.lat += sNoise*Math.cos(h)*dt/111320 + (Math.random()-0.5)*this.spread;',
              '});'],
      testIdx: 1, shouldViolate: false },
    { name: 'Named particle receiver',
      lines: ['particle.lat = particle.lat + Math.random()*0.001;'],
      testIdx: 0, shouldViolate: false },
    { name: 'Named DNA receiver',
      lines: ['dna.mutation = (Math.random() - 0.5) * 0.05;'],
      testIdx: 0, shouldViolate: false },
    { name: 'Named agent receiver on lat',
      lines: ['agent.lat = truth.lat + (Math.random()-0.5)*0.0001;'],
      testIdx: 0, shouldViolate: false },
    { name: 'Local jitter variable',
      lines: ['const jitter = Math.random();'],
      testIdx: 0, shouldViolate: false },
    { name: 'Swarm weights',
      lines: ['weights.gpsW = parent.weights.gpsW + (Math.random()-0.5)*0.1;'],
      testIdx: 0, shouldViolate: false },
    { name: 'newP particle array push',
      lines: ['const newP = [];',
              'for (let i=0;i<N;i++) {',
              '  newP.push({ lat: ps[j].lat + (Math.random()-0.5)*0.0001, lon: ps[j].lon, w: 1/N });',
              '}'],
      testIdx: 2, shouldViolate: false },

    // ── PROHIBITED (fake OUTPUTS) ─────────────────────────────────────
    { name: 'Fake GPS lat returned to caller',
      lines: ['function useFallbackGPS() {',
              '  return { lat: base.lat + Math.random()*0.001, lon: base.lon, acc: 8 };',
              '}'],
      testIdx: 1, shouldViolate: true },
    { name: 'DR position with fake lat noise',
      lines: ['drPos.lat += dLat + (Math.random()-0.5)*0.000004;'],
      testIdx: 0, shouldViolate: true },
    { name: 'Fake accuracy value',
      lines: ['return { pos: p, accuracy: 2 + Math.random() * 5 };'],
      testIdx: 0, shouldViolate: true },
    { name: 'Fake confidence 0.85+random',
      lines: ['this.conf = Math.min(1, 0.85 + Math.random()*0.1);'],
      testIdx: 0, shouldViolate: true },
    { name: 'Fake drill score',
      lines: ['const score = drills.length ? Math.round(60 + Math.random()*35) : 0;'],
      testIdx: 0, shouldViolate: true },
    { name: 'Fake Fish agent output',
      lines: ['function fishAgent(gps) {',
              '  return { lat: gps.lat+(Math.random()-.5)*n, lon: gps.lon, confidence: 0.9+Math.random()*0.1 };',
              '}'],
      testIdx: 1, shouldViolate: true },
    { name: 'Fake altitude',
      lines: ['return { alt: 100 + Math.random()*5 };'],
      testIdx: 0, shouldViolate: true },
  ];

  let ok = true;
  let pass = 0;
  let allowed = 0;
  let caught = 0;
  for (const c of cases) {
    const r = classifyLine(c.lines[c.testIdx], c.lines, c.testIdx);
    const got = r.violation;
    if (got === c.shouldViolate) {
      pass++;
      if (c.shouldViolate) caught++; else allowed++;
    } else {
      ok = false;
      const kind = c.shouldViolate ? 'missed violation' : 'false positive';
      console.error(`SELF-TEST FAIL (${kind}): ${c.name}`);
      console.error(`  line: ${c.lines[c.testIdx].trim()}`);
      console.error(`  reason: ${r.reason}`);
    }
  }
  console.log(`✓ Self-tests pass (${allowed} legitimate uses accepted, ${caught} fake outputs caught, ${pass}/${cases.length})`);
  return ok;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
console.log('UPIN guard: no fake OUTPUTS from random sources');
console.log('------------------------------------------------');

if (!selfTest()) {
  console.error('\n❌ Self-tests failed. Guard logic is broken; refusing to run.');
  process.exit(2);
}

const files = walk(ROOT);
console.log(`Scanning ${files.length} source files...\n`);

const violations = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = classifyLine(line, lines, i);
    if (r.violation) {
      violations.push({
        file: relative(ROOT, f),
        line: i + 1,
        target: r.target,
        snippet: line.trim().slice(0, 120)
      });
    }
  }
}

if (violations.length === 0) {
  console.log('✅ CLEAN — no random source feeds into any position / accuracy / confidence output.');
  process.exit(0);
}

console.error(`❌ ${violations.length} violation(s) found:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  → ${v.target}`);
  console.error(`      ${v.snippet}`);
}
console.error('\nRule: UPIN must never output an invented position, accuracy, or confidence.');
console.error('      A layer either computes from real sensor data or reports OFFLINE.');
process.exit(1);
