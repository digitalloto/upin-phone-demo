// UPIN v6 — Layer 4 Acceptance Test
// Validates that data quality checks work correctly

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

function testLayer4(csvPath) {
  console.log('\n═══════════════════════════════════════');
  console.log('  UPIN v6 — LAYER 4 ACCEPTANCE TEST');
  console.log('═══════════════════════════════════════\n');

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  let passed = 0, failed = 0;

  function check(condition, name, detail) {
    if (condition) { passed++; console.log('  \x1b[32m✓ ' + name + '\x1b[0m'); }
    else { failed++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? ' → ' + detail : '')); }
  }

  // Test 1: No AccelX/Y/Z values > 30 m/s² (sensor glitch)
  const badAccel = rows.filter(r => Math.abs(Number(r.AccelX)) > 30 || Math.abs(Number(r.AccelY)) > 30 || Math.abs(Number(r.AccelZ)) > 30);
  check(badAccel.length === 0, 'No accel values > ±30 m/s² (' + badAccel.length + ' bad)', badAccel.length + ' rows have extreme accel');

  // Test 2: GPS coordinates in valid range when present
  const badGPS = rows.filter(r => {
    const lat = Number(r.GPS_Lat), lon = Number(r.GPS_Lon);
    return lat !== 0 && (lat < -90 || lat > 90 || lon < -180 || lon > 180);
  });
  check(badGPS.length === 0, 'All GPS coords in valid range (' + badGPS.length + ' bad)', badGPS.length + ' rows out of range');

  // Test 3: GPS_Acc realistic (when present, < 500m)
  const gpsRows = rows.filter(r => Number(r.GPS_Lat) > 1);
  const badAcc = gpsRows.filter(r => Number(r.GPS_Acc) > 500);
  check(badAcc.length < gpsRows.length * 0.1, 'GPS accuracy < 500m for 90%+ of fixes (' + badAcc.length + '/' + gpsRows.length + ' bad)', 'Too many bad accuracy values');

  // Test 4: Speed_Now is 0 or realistic (< 200 km/h = 55 m/s)
  const badSpeed = rows.filter(r => Number(r.Speed_Now) > 200);
  check(badSpeed.length === 0, 'No phantom speed > 200 km/h (' + badSpeed.length + ' bad)', badSpeed.length + ' rows have phantom speed');

  // Test 5: Pressure in realistic range when present (300-1100 hPa)
  const pressureRows = rows.filter(r => Number(r.Pressure) > 0);
  const badPressure = pressureRows.filter(r => Number(r.Pressure) < 300 || Number(r.Pressure) > 1100);
  check(badPressure.length === 0, 'Pressure in range 300-1100 hPa (' + badPressure.length + ' bad)', badPressure.length + ' out of range');

  // Test 6: No rejection of good data (all rows should be present — 1 per second)
  const duration = (Number(rows[rows.length-1].Time) - Number(rows[0].Time)) / 1000;
  const expectedRows = Math.floor(duration);
  const gapPct = Math.abs(rows.length - expectedRows) / expectedRows * 100;
  check(gapPct < 10, 'Row count matches duration: ' + rows.length + ' rows in ' + Math.round(duration) + 's (' + gapPct.toFixed(1) + '% gap)', 'Too many missing rows');

  // Test 7: Compass varies (not stuck at 0 — the bug we just fixed)
  const compassVals = rows.map(r => Number(r.Compass)).filter(v => !isNaN(v));
  const uniqueCompass = new Set(compassVals.map(v => Math.round(v))).size;
  check(uniqueCompass > 3, 'Compass has ' + uniqueCompass + ' unique values (need >3)', 'Compass stuck — magnetometer not flowing');

  console.log('\n═══════════════════════════════════════');
  if (failed === 0) {
    console.log('  \x1b[32mLAYER 4: PASS (' + passed + '/' + (passed + failed) + ')\x1b[0m');
  } else {
    console.log('  \x1b[31mLAYER 4: FAIL (' + failed + ' checks failed)\x1b[0m');
  }
  console.log('═══════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

const csvPath = process.argv[2];
if (!csvPath) { console.log('Usage: node tests/layer4_test.js <csv>'); process.exit(1); }
testLayer4(csvPath);
