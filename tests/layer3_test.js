// UPIN v6 — Layer 3 Acceptance Test
// Run this BEFORE writing Layer 3 code.
// It should FAIL initially (nothing built yet).
// After Layer 3 is built, it should PASS.

const fs = require('fs');

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = vals[i] ? vals[i].trim() : '');
    return row;
  });
}

function stdDev(arr) {
  const nums = arr.map(Number).filter(n => !isNaN(n));
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  return Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length);
}

function testLayer3(csvPath) {
  console.log('\n═══════════════════════════════════════');
  console.log('  UPIN v6 — LAYER 3 ACCEPTANCE TEST');
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(csvPath)) {
    console.log('  \x1b[31m✗ FAIL: CSV file not found: ' + csvPath + '\x1b[0m');
    console.log('  Run a 5-minute test first, then point this at the CSV.\n');
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  let passed = 0, failed = 0;

  function check(condition, name, detail) {
    if (condition) {
      passed++;
      console.log('  \x1b[32m✓ ' + name + '\x1b[0m');
    } else {
      failed++;
      console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? ' → ' + detail : ''));
    }
  }

  // Test 1: Minimum row count (5 min × 1 Hz = 300 rows minimum)
  check(rows.length >= 250,
    'Row count: ' + rows.length + ' (need ≥250 for 5 min)',
    'Only ' + rows.length + ' rows — BLE drops or test too short');

  // Test 2: Required columns exist
  const requiredCols = ['Time', 'AccelX', 'AccelY', 'AccelZ', 'GyroX', 'GyroY', 'GyroZ',
    'Compass', 'GPS_Lat', 'GPS_Lon', 'GPS_Speed', 'GPS_Acc', 'Pressure', 'BaroAlt'];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missingCols = requiredCols.filter(c => !headers.includes(c));
  check(missingCols.length === 0,
    'Required columns present (' + requiredCols.length + '/' + requiredCols.length + ')',
    'Missing: ' + missingCols.join(', '));

  // Test 3: AccelX has real noise (std > 0.05)
  const accelXStd = stdDev(rows.map(r => r.AccelX));
  check(accelXStd > 0.05,
    'AccelX std: ' + accelXStd.toFixed(4) + ' (need >0.05 for real IMU noise)',
    'AccelX std too low — IMU may not be capturing real data');

  // Test 4: AccelZ near gravity (mean between 8 and 11)
  const accelZMean = rows.map(r => Number(r.AccelZ)).filter(n => !isNaN(n));
  const azMean = accelZMean.length ? accelZMean.reduce((s, v) => s + v, 0) / accelZMean.length : 0;
  check(azMean > 8 && azMean < 11,
    'AccelZ mean: ' + azMean.toFixed(2) + ' (expect ~9.81 for gravity)',
    'AccelZ mean is ' + azMean.toFixed(2) + ' — sensor units may be wrong');

  // Test 5: Compass has variation (not all zeros)
  const compassNonZero = rows.filter(r => Number(r.Compass) !== 0).length;
  const compassPct = Math.round(compassNonZero / rows.length * 100);
  check(compassPct > 70,
    'Compass flowing: ' + compassPct + '% non-zero (need >70%)',
    'Only ' + compassPct + '% compass values non-zero');

  // Test 6: Pressure has values (not all zero)
  const pressureNonZero = rows.filter(r => Number(r.Pressure) > 300).length;
  const pressurePct = Math.round(pressureNonZero / rows.length * 100);
  check(pressurePct > 50,
    'Pressure flowing: ' + pressurePct + '% valid (need >50%)',
    'Only ' + pressurePct + '% pressure values valid');

  // Test 7: No algorithm columns in Layer 3 CSV (those belong to Layer 5/6)
  const algCols = headers.filter(h => h.startsWith('CT_') || h.startsWith('DR_') ||
    h.startsWith('WF_') || h.startsWith('CD_') || h.startsWith('PA_') || h.startsWith('Fused_'));
  check(algCols.length === 0,
    'No algorithm columns in Layer 3 (found ' + algCols.length + ')',
    'Layer 3 should not have: ' + algCols.join(', '));

  // Test 8: Time is monotonically increasing
  let timeErrors = 0;
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i].Time) <= Number(rows[i - 1].Time)) timeErrors++;
  }
  check(timeErrors === 0,
    'Time monotonic: ' + timeErrors + ' out-of-order rows',
    timeErrors + ' rows have time ≤ previous row');

  // Test 9: No NaN or undefined in sensor columns
  let nanCount = 0;
  ['AccelX', 'AccelY', 'AccelZ', 'GyroX', 'GyroY', 'GyroZ'].forEach(col => {
    rows.forEach(r => { if (r[col] === '' || r[col] === 'undefined' || r[col] === 'NaN') nanCount++; });
  });
  check(nanCount === 0,
    'No NaN/undefined in IMU columns (' + nanCount + ' found)',
    nanCount + ' NaN/undefined values in IMU data');

  // Summary
  console.log('\n═══════════════════════════════════════');
  if (failed === 0) {
    console.log('  \x1b[32mLAYER 3: PASS (' + passed + '/' + (passed + failed) + ')\x1b[0m');
    console.log('  Ready to proceed to Layer 4.');
  } else {
    console.log('  \x1b[31mLAYER 3: FAIL (' + failed + ' checks failed)\x1b[0m');
    console.log('  Fix the failures before proceeding.');
  }
  console.log('═══════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

// Run with: node tests/layer3_test.js path/to/your.csv
const csvPath = process.argv[2];
if (!csvPath) {
  console.log('Usage: node tests/layer3_test.js <path-to-csv>');
  console.log('Run a 5-minute test in UPIN v6, export CSV, then test it.');
  process.exit(1);
}
testLayer3(csvPath);
