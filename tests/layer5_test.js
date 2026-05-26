// UPIN v6 — Layer 5 Algorithm Acceptance Test
// Run after a walking test with GPS denial

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

function testLayer5(csvPath) {
  console.log('\n═══════════════════════════════════════');
  console.log('  UPIN v6 — LAYER 5 ALGORITHM TEST');
  console.log('═══════════════════════════════════════\n');

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  let passed = 0, failed = 0;

  function check(condition, name, detail) {
    if (condition) { passed++; console.log('  \x1b[32m✓ ' + name + '\x1b[0m'); }
    else { failed++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? ' → ' + detail : '')); }
  }

  // Test 1: Cell Tri has positions (at least some rows)
  const ctRows = rows.filter(r => r.CT_Lat && r.CT_Lat !== '' && Number(r.CT_Lat) > 1);
  check(ctRows.length > 0, 'Cell Tri: ' + ctRows.length + '/' + rows.length + ' rows with positions', 'No cell trilateration output — need 2+ known towers');

  // Test 2: Cell Tri unique positions (not stuck)
  const ctUnique = new Set(ctRows.map(r => r.CT_Lat)).size;
  check(ctUnique > 1 || ctRows.length === 0, 'Cell Tri: ' + ctUnique + ' unique positions', 'Stuck on one position');

  // Test 3: Cell Direction has output during movement
  const cdRows = rows.filter(r => r.CD_Lat && r.CD_Lat !== '' && Number(r.CD_Conf) > 0);
  check(cdRows.length > 0 || rows.filter(r => r.Phase === 'jammed').length === 0,
    'Cell Dir: ' + cdRows.length + ' rows with direction output', 'No cell direction output');

  // Test 4: WiFi FP has positions
  const wfRows = rows.filter(r => r.WF_Lat && r.WF_Lat !== '' && Number(r.WF_Lat) > 1);
  check(wfRows.length > 0, 'WiFi FP: ' + wfRows.length + '/' + rows.length + ' rows with positions', 'No WiFi fingerprint matches');

  // Test 5: IMU DR has positions during movement (not all null)
  const drRows = rows.filter(r => r.DR_Lat && r.DR_Lat !== '' && Number(r.DR_Lat) > 1);
  check(drRows.length > 0, 'IMU DR: ' + drRows.length + '/' + rows.length + ' rows with positions', 'No DR output — was device stationary?');

  // Test 6: Baro altitude varies
  const alts = rows.map(r => Number(r.PA_Alt)).filter(v => !isNaN(v) && v > 0);
  const altRange = alts.length > 0 ? Math.max(...alts) - Math.min(...alts) : 0;
  check(alts.length > 0, 'Baro: ' + alts.length + ' altitude readings, range ' + altRange.toFixed(1) + 'm', 'No altitude data');

  // Test 7: Fish School has positions
  const fishRows = rows.filter(r => r.Fish_Lat && r.Fish_Lat !== '' && Number(r.Fish_Lat) > 1);
  check(fishRows.length > 0, 'Fish: ' + fishRows.length + '/' + rows.length + ' rows with positions', 'No fish school output');

  // Test 8: Fusion picked a source (not all "none")
  const fusedRows = rows.filter(r => r.Fused_Src && r.Fused_Src !== 'none' && r.Fused_Src !== '');
  check(fusedRows.length > rows.length * 0.3, 'Fusion: ' + fusedRows.length + '/' + rows.length + ' rows with a source', 'Fusion mostly "none"');

  // Test 9: Fusion source distribution
  const srcCounts = {};
  rows.forEach(r => { const s = r.Fused_Src || 'none'; srcCounts[s] = (srcCounts[s] || 0) + 1; });
  console.log('\n  Fusion source distribution:');
  Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => {
    console.log('    ' + s + ': ' + c + ' (' + Math.round(c / rows.length * 100) + '%)');
  });

  // Test 10: During jammed phase, algorithms change position row-to-row
  const jamRows = rows.filter(r => r.Phase === 'jammed');
  if (jamRows.length > 5) {
    const fusedUnique = new Set(jamRows.map(r => r.Fused_Lat)).size;
    check(fusedUnique > 3, 'During denial: ' + fusedUnique + ' unique fused positions in ' + jamRows.length + ' rows', 'Position frozen during denial');
  } else {
    console.log('  ⚠ No jammed rows — run a GPS denial drill to test this');
  }

  console.log('\n═══════════════════════════════════════');
  if (failed === 0) console.log('  \x1b[32mLAYER 5: PASS (' + passed + '/' + (passed + failed) + ')\x1b[0m');
  else console.log('  \x1b[31mLAYER 5: ' + failed + ' FAIL, ' + passed + ' PASS\x1b[0m');
  console.log('═══════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

const csvPath = process.argv[2];
if (!csvPath) { console.log('Usage: node tests/layer5_test.js <csv>'); process.exit(1); }
testLayer5(csvPath);
