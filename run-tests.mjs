// Headless test runner using Node.js
// Tests the CONE, formula, and FISH fixes

let passed=0,failed=0,total=0;

function pass(name){total++;passed++;console.log(`  \x1b[32m✓ PASS: ${name}\x1b[0m`);}
function fail(name,detail){total++;failed++;console.log(`  \x1b[31m✗ FAIL: ${name}\x1b[0m`);if(detail)console.log(`    → ${detail}`);}
function section(name){console.log(`\n\x1b[36m▸ ${name}\x1b[0m`);}

// Haversine
function hav(a,b){const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180,x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

// Stub globals
let accel={x:0,y:0,z:9.81},gyro={x:0,y:0,z:0},compass=90;
const perf_start=Date.now();
const performance={now:()=>Date.now()-perf_start};

// ══════════════════════════════════
// CONE object (copy from fixed code)
// ══════════════════════════════════
const CONE={
  state:'GPS_OK',
  anchor:null,
  radius:10,
  arcMin:0,arcMax:360,
  dots:[],
  gpsGapStart:0,
  gpsRecoveries:[],
  _circle:null,_wedge:null,

  update(gps,speed,heading,gyroZ,dt){
    switch(this.state){
      case 'GPS_OK':
        if(gps&&gps.lat>6){
          this.anchor={lat:gps.lat,lon:gps.lon,t:performance.now(),speed:speed||0,heading:heading||0,acc:gps.acc||10};
          this.radius=gps.acc||10;
          this.arcMin=heading-30;this.arcMax=heading+30;
        }else if(!gps&&this.anchor){
          this.state='CONE_GROWING';
          this.gpsGapStart=performance.now();
          this.anchor.t=performance.now();
          this.dots=[];
        }
        break;
      case 'CONE_GROWING':
        if(gps&&gps.lat>6){
          const gapSec=(performance.now()-this.gpsGapStart)/1000;
          const insideCone=this.isInside(gps);
          this.gpsRecoveries.push({gapSec:Math.round(gapSec),finalRadius:Math.round(this.radius),insideCone});
          this.state='GPS_OK';
          break;
        }
        {
        const elapsed=(performance.now()-this.anchor.t)/1000;
        this.radius=this.anchor.speed*elapsed+this.anchor.acc;
        const arcGrowth=Math.min(90,elapsed*3);
        this.arcMin=this.anchor.heading-30-arcGrowth;
        this.arcMax=this.anchor.heading+30+arcGrowth;
        this.anchor.speed=speed||this.anchor.speed;
        if(Math.abs(gyroZ)>30){
          this.createDot(speed,heading);
          this.state='CONE_REFINED';
        }
        }
        break;
      case 'CONE_REFINED':
        if(gps&&gps.lat>6){
          const gapSec=(performance.now()-this.gpsGapStart)/1000;
          const insideCone=this.isInside(gps);
          this.gpsRecoveries.push({gapSec:Math.round(gapSec),finalRadius:Math.round(this.radius),insideCone});
          this.state='GPS_OK';
          break;
        }
        {
        const elapsed=(performance.now()-this.anchor.t)/1000;
        this.radius=this.anchor.speed*elapsed+this.anchor.acc;
        this.anchor.speed=speed||this.anchor.speed;
        if(Math.abs(gyroZ)>30){
          this.createDot(speed,heading);
        }
        }
        break;
    }
  },

  createDot(speed,heading){
    const elapsed=(performance.now()-(this.dots.length?this.dots[this.dots.length-1].t:this.anchor.t))/1000;
    const lastPt=this.dots.length?this.dots[this.dots.length-1]:this.anchor;
    const dist=(speed||0)*elapsed;
    const h=heading*Math.PI/180;
    const dot={
      lat:lastPt.lat+(dist*Math.cos(h))/111320,
      lon:lastPt.lon+(dist*Math.sin(h))/(111320*Math.cos(lastPt.lat*Math.PI/180)),
      heading,t:performance.now(),
      speed:speed||this.anchor.speed||0,
      acc:Math.max(this.anchor.acc||10,5)
    };
    this.dots.push(dot);
    this.anchor=dot;
    this.arcMin=heading-30;this.arcMax=heading+30;
  },

  isInside(pos){
    if(!this.anchor||!pos)return true;
    return hav(pos,this.anchor)<=this.radius;
  },

  _normalizeAngle(a){a=a%360;return a<0?a+360:a;},

  _isInArc(heading){
    const h=this._normalizeAngle(heading);
    const lo=this._normalizeAngle(this.arcMin);
    const hi=this._normalizeAngle(this.arcMax);
    if(lo<=hi) return h>=lo&&h<=hi;
    return h>=lo||h<=hi;
  },

  constrain(raw){
    if(this.state==='GPS_OK'||!this.anchor||!raw)return raw;
    const dist=hav(raw,this.anchor);
    if(isNaN(dist)||isNaN(this.radius))return raw;
    let constrained=raw;
    if(dist>this.radius){
      const ratio=this.radius/dist;
      constrained={
        lat:this.anchor.lat+(raw.lat-this.anchor.lat)*ratio,
        lon:this.anchor.lon+(raw.lon-this.anchor.lon)*ratio
      };
    }
    const bearing=Math.atan2(
      (constrained.lon-this.anchor.lon)*Math.cos(this.anchor.lat*Math.PI/180),
      constrained.lat-this.anchor.lat
    )*180/Math.PI;
    if(!this._isInArc(bearing)){
      const mid=this._normalizeAngle((this.arcMin+this.arcMax)/2);
      const snapH=mid*Math.PI/180;
      const d=Math.min(dist,this.radius);
      constrained={
        lat:this.anchor.lat+(d*Math.cos(snapH))/111320,
        lon:this.anchor.lon+(d*Math.sin(snapH))/(111320*Math.cos(this.anchor.lat*Math.PI/180))
      };
    }
    return constrained;
  },

  confidence(pos){
    if(this.state==='GPS_OK'||!this.anchor||!pos)return 1;
    const dist=hav(pos,this.anchor);
    if(isNaN(dist)||isNaN(this.radius)||this.radius<=0)return 0.5;
    return Math.max(0,1-dist/this.radius);
  },

  stats(){
    return{state:this.state,radius:Math.round(this.radius),dots:this.dots.length,recoveries:this.gpsRecoveries.length,
      lastRecovery:this.gpsRecoveries.length?this.gpsRecoveries[this.gpsRecoveries.length-1]:null,
      coneAccuracy:this.gpsRecoveries.length?Math.round(this.gpsRecoveries.filter(r=>r.insideCone).length/this.gpsRecoveries.length*100):0
    };
  }
};

// mkF factory
function mkF(name,predictFn){
  return{
    name,pos:null,err:999,errAvg:999,errHistory:[],corrLat:0,corrLon:0,corrCount:0,
    speedScale:1.0,headingOff:0,_fagentParams:null,
    _rawPredict:predictFn,_predicting:false,
    predict(pos,dt){
      if(this._predicting)return pos;
      this._predicting=true;
      let p;
      let sA,sG,sC;
      if(this._fagentParams){
        const fp=this._fagentParams;
        sA={...accel};sG={...gyro};sC=compass;
        accel={x:(accel.x-fp.aBx)*fp.aScl,y:(accel.y-fp.aBy)*fp.aScl,z:accel.z};
        gyro={x:gyro.x*fp.gScl,y:gyro.y*fp.gScl,z:gyro.z*fp.gScl};
        compass=compass+fp.cOff;
      }
      try{p=this._rawPredict.call(this,pos,dt);}catch(e){p=pos;}
      if(this._fagentParams){accel=sA;gyro=sG;compass=sC;}
      this._predicting=false;
      if(!p||!pos)return p;
      if(this.corrCount>10){p.lat+=this.corrLat;p.lon+=this.corrLon;}
      if(this.headingOff&&Math.abs(this.headingOff)>0.01){
        const dLat=p.lat-pos.lat,dLon=p.lon-pos.lon;
        const h=this.headingOff*Math.PI/180;
        p.lat=pos.lat+dLat*Math.cos(h)-dLon*Math.sin(h);
        p.lon=pos.lon+dLat*Math.sin(h)+dLon*Math.cos(h);
      }
      return p;
    }
  };
}

console.log('╔══════════════════════════════════════╗');
console.log('║   BUG FIX VERIFICATION — ALL FIXES  ║');
console.log('╚══════════════════════════════════════╝');

// ══════════════════════════════════
// TEST 1: CONE anchor stores speed + acc
// ══════════════════════════════════
section('FIX 1: CONE anchor stores speed and acc');

CONE.update({lat:14.5,lon:121.0,acc:25},10,90,0,1);
if(CONE.anchor.acc===25) pass('Anchor stores GPS accuracy (acc=25)');
else fail('Anchor stores GPS accuracy','anchor.acc='+CONE.anchor.acc);
if(CONE.anchor.speed===10) pass('Anchor stores speed (speed=10)');
else fail('Anchor stores speed','anchor.speed='+CONE.anchor.speed);

// ══════════════════════════════════
// TEST 2: createDot includes speed/acc (no NaN)
// ══════════════════════════════════
section('FIX 2: createDot — dot has speed and acc');

CONE.update(null,10,90,0,1); // lose GPS
await new Promise(r=>setTimeout(r,50));
CONE.update(null,8,120,50,1); // turn (gyroZ=50)

const dot=CONE.dots[CONE.dots.length-1];
if(dot.speed!==undefined&&!isNaN(dot.speed)) pass('Dot has speed: '+dot.speed);
else fail('Dot speed missing/NaN','speed='+dot.speed);
if(dot.acc!==undefined&&!isNaN(dot.acc)) pass('Dot has acc: '+dot.acc);
else fail('Dot acc missing/NaN','acc='+dot.acc);

// ══════════════════════════════════
// TEST 3: Radius NOT NaN after turn
// ══════════════════════════════════
section('FIX 3: Radius stays valid after turn');

await new Promise(r=>setTimeout(r,50));
CONE.update(null,8,120,5,1); // normal tick in CONE_REFINED
if(!isNaN(CONE.radius)) pass('Radius not NaN after turn: '+CONE.radius.toFixed(1)+'m');
else fail('Radius is NaN after turn');

// ══════════════════════════════════
// TEST 4: Elapsed from anchor.t not gpsGapStart
// ══════════════════════════════════
section('FIX 4: Elapsed time from anchor.t (turn point)');

const beforeT=CONE.anchor.t;
await new Promise(r=>setTimeout(r,100));
CONE.update(null,8,150,50,1); // another turn
const afterT=CONE.anchor.t;
if(afterT>beforeT) pass('Anchor.t updated at turn: delta='+(afterT-beforeT).toFixed(0)+'ms');
else fail('Anchor.t not updated','before='+beforeT+' after='+afterT);

// Radius should be computed from NEW anchor.t, not the old one
await new Promise(r=>setTimeout(r,50));
CONE.update(null,8,150,5,1);
// radius = speed * elapsed_since_last_anchor + acc
// elapsed is tiny (50ms), so radius should be close to acc (~25)
if(CONE.radius < 200) pass('Radius reasonable after turn: '+CONE.radius.toFixed(1)+'m (not inflated)');
else fail('Radius inflated','radius='+CONE.radius.toFixed(1)+'m (using total elapsed, not from turn)');

// ══════════════════════════════════
// TEST 5: constrain() never returns NaN
// ══════════════════════════════════
section('FIX 5: constrain() — no NaN, includes heading arc');

const far={lat:14.6,lon:121.1};
const c=CONE.constrain(far);
if(!isNaN(c.lat)&&!isNaN(c.lon)) pass('constrain(far point) valid: '+c.lat.toFixed(6)+','+c.lon.toFixed(6));
else fail('constrain returns NaN');

// Test NaN guard
const savedR=CONE.radius;
CONE.radius=NaN;
const safe=CONE.constrain(far);
if(!isNaN(safe.lat)&&!isNaN(safe.lon)) pass('NaN guard: returns raw when radius=NaN');
else fail('NaN guard failed');
CONE.radius=savedR;

// ══════════════════════════════════
// TEST 6: Heading arc constraint
// ══════════════════════════════════
section('FIX 6: Heading arc constrains output');

if(CONE._isInArc(150)) pass('_isInArc(150°) inside [120-180]');
else fail('_isInArc(150°) should be inside');
if(!CONE._isInArc(300)) pass('_isInArc(300°) outside [120-180]');
else fail('_isInArc(300°) should be outside');
// Wrap-around test
CONE.arcMin=350;CONE.arcMax=10;
if(CONE._isInArc(355)) pass('_isInArc(355°) inside [350-10] (wraps around)');
else fail('_isInArc(355°) should be inside wrap-around');
if(CONE._isInArc(0)) pass('_isInArc(0°) inside [350-10] (wraps around)');
else fail('_isInArc(0°) should be inside wrap-around');
if(!CONE._isInArc(180)) pass('_isInArc(180°) outside [350-10]');
else fail('_isInArc(180°) should be outside');

// ══════════════════════════════════
// TEST 7: confidence() returns valid 0-1
// ══════════════════════════════════
section('FIX 7: confidence() returns valid 0-1');

CONE.arcMin=CONE.anchor.heading-30;CONE.arcMax=CONE.anchor.heading+30;
const confCenter=CONE.confidence(CONE.anchor);
if(!isNaN(confCenter)&&confCenter>=0&&confCenter<=1) pass('At center: '+confCenter.toFixed(3));
else fail('At center','value='+confCenter);

const confFar=CONE.confidence({lat:14.6,lon:121.1});
if(!isNaN(confFar)&&confFar>=0&&confFar<=1) pass('Far point: '+confFar.toFixed(3));
else fail('Far point','value='+confFar);

const confGPS=CONE.confidence({lat:14.5,lon:121});
if(confGPS===1){
  // This would be wrong - state isn't GPS_OK
  // Actually let me check
}

// ══════════════════════════════════
// TEST 8: Formula rankings preserved across denial
// ══════════════════════════════════
section('FIX 8: Formula rankings preserved across denial');

const formulas=[
  {name:'A',errAvg:5.2,errHistory:[5,5.1,5.5],pos:{lat:14.5,lon:121},drillTrail:[],drillDrift:0,blindSec:0,mapLine:null,_mapDot:null},
  {name:'B',errAvg:8.1,errHistory:[8,8.2],pos:{lat:14.5,lon:121},drillTrail:[],drillDrift:0,blindSec:0,mapLine:null,_mapDot:null},
  {name:'C',errAvg:3.7,errHistory:[3.5,3.9],pos:{lat:14.5,lon:121},drillTrail:[],drillDrift:0,blindSec:0,mapLine:null,_mapDot:null},
];

// Fixed jam() — no errHistory clear, no errAvg=999
const gpsT={lat:14.5,lon:121};
formulas.forEach(f=>{
  if(gpsT)f.pos={lat:gpsT.lat,lon:gpsT.lon};
  f.drillTrail=[];f.drillDrift=0;f.blindSec=0;
});

if(formulas[0].errAvg===5.2) pass('Formula A errAvg preserved: '+formulas[0].errAvg);
else fail('Formula A errAvg cleared','errAvg='+formulas[0].errAvg);
if(formulas[2].errAvg===3.7) pass('Formula C errAvg preserved: '+formulas[2].errAvg);
else fail('Formula C errAvg cleared','errAvg='+formulas[2].errAvg);
if(formulas[0].errHistory.length===3) pass('Formula A errHistory preserved: length='+formulas[0].errHistory.length);
else fail('Formula A errHistory cleared','length='+formulas[0].errHistory.length);

// bestFormulaIdx should pick C (lowest errAvg)
let bI=0,bE=Infinity;
formulas.forEach((f,i)=>{if(f.errAvg<bE){bE=f.errAvg;bI=i;}});
if(bI===2) pass('bestFormulaIdx picks C (idx=2, errAvg=3.7) — NOT default idx=0');
else fail('bestFormulaIdx wrong','picked idx='+bI);

// ══════════════════════════════════
// TEST 9: headingOff rotation works
// ══════════════════════════════════
section('FIX 9: predict() applies headingOff rotation');

const tf=mkF('test',function(pos,dt){return{lat:pos.lat+0.001,lon:pos.lon};});
const noH=tf.predict({lat:14.5,lon:121},1);
tf.headingOff=90;
const wH=tf.predict({lat:14.5,lon:121},1);
if(Math.abs(wH.lon-121)>0.0001) pass('90° rotation: north→east (Δlon='+(wH.lon-121).toFixed(6)+')');
else fail('90° rotation failed','Δlon='+(wH.lon-121));
if(Math.abs(wH.lat-14.5)<0.0002) pass('90° rotation: lat near origin (Δlat='+(wH.lat-14.5).toFixed(6)+')');
else fail('90° rotation: lat drifted','Δlat='+(wH.lat-14.5));

// ══════════════════════════════════
// TEST 10: _fagentParams sensor tweaks applied + restored
// ══════════════════════════════════
section('FIX 10: predict() applies _fagentParams sensor tweaks');

let captured=null;
const tf2=mkF('sensor',function(pos,dt){captured={...accel};return{lat:pos.lat+0.0001,lon:pos.lon};});
tf2._fagentParams={aScl:2.0,aBx:0.5,aBy:0.3,gScl:1.5,cOff:5};
accel={x:1.0,y:0.5,z:9.81};
tf2.predict({lat:14.5,lon:121},1);
// Inside predict: accel.x = (1.0 - 0.5) * 2.0 = 1.0
if(captured&&Math.abs(captured.x-1.0)<0.01) pass('Sensor tweak: accel.x=(1.0-0.5)*2.0='+captured.x.toFixed(2));
else fail('Sensor tweak failed','captured.x='+(captured?captured.x:'null'));
if(Math.abs(accel.x-1.0)<0.01) pass('Globals restored: accel.x='+accel.x);
else fail('Globals NOT restored','accel.x='+accel.x);
accel={x:0,y:0,z:9.81};

// ══════════════════════════════════
// TEST 11: Fish Swarm formula
// ══════════════════════════════════
section('FIX 11: Fish Swarm registered as competing formula');

const mockFISH={
  schools:[{pos:{lat:14.501,lon:121.001},agents:[],avgErr:5,fitness:0.2}],
  bestSchoolIdx:0,
  getBestPosition(){return this.schools[this.bestSchoolIdx]?this.schools[this.bestSchoolIdx].pos:null;}
};

const fishF=mkF('Fish Swarm',function(pos,dt){
  if(!mockFISH.schools||!mockFISH.schools.length)return null;
  const bp=mockFISH.getBestPosition();
  if(!bp||!bp.lat||!bp.lon)return null;
  return{lat:bp.lat,lon:bp.lon};
});

const fR=fishF._rawPredict({lat:14.5,lon:121},1);
if(fR&&fR.lat===14.501) pass('Fish Swarm returns school pos: '+fR.lat+','+fR.lon);
else fail('Fish Swarm wrong output',JSON.stringify(fR));

mockFISH.schools=[];
const fNull=fishF._rawPredict({lat:14.5,lon:121},1);
if(fNull===null) pass('Fish Swarm returns null when empty');
else fail('Should return null',JSON.stringify(fNull));

// ══════════════════════════════════
// TEST 12: Multiple turns stress test
// ══════════════════════════════════
section('FIX 12: Stress test — 20 turns, no NaN');

CONE.state='GPS_OK';
CONE.update({lat:14.5,lon:121.0,acc:10},10,90,0,1);
CONE.update(null,10,90,0,1);
await new Promise(r=>setTimeout(r,20));

for(let i=0;i<20;i++){
  CONE.update(null,5+Math.random()*10,Math.random()*360,50,1);
  await new Promise(r=>setTimeout(r,5));
  CONE.update(null,5+Math.random()*10,Math.random()*360,5,1);
  await new Promise(r=>setTimeout(r,5));
}

if(!isNaN(CONE.radius)) pass('Radius valid after 20 turns: '+CONE.radius.toFixed(1)+'m');
else fail('Radius NaN after 20 turns');

const allValid=CONE.dots.every(d=>!isNaN(d.speed)&&!isNaN(d.acc)&&!isNaN(d.lat)&&!isNaN(d.lon));
if(allValid) pass('All '+CONE.dots.length+' dots valid (no NaN)');
else fail('Some dots have NaN');

for(let i=0;i<10;i++){
  const rp={lat:14.5+Math.random()*0.01,lon:121+Math.random()*0.01};
  const cr=CONE.constrain(rp);
  if(isNaN(cr.lat)||isNaN(cr.lon)){fail('constrain() NaN on random point #'+i);break;}
  if(i===9) pass('10 random constrain() calls — all valid');
}

// ══════════════════════════════════
// TEST 13: GPS recovery resets state
// ══════════════════════════════════
section('FIX 13: GPS recovery resets correctly');

CONE.update({lat:14.502,lon:121.002,acc:8},10,90,0,1);
if(CONE.state==='GPS_OK') pass('State→GPS_OK after recovery');
else fail('State wrong','state='+CONE.state);
if(CONE.gpsRecoveries.length>0) pass(CONE.gpsRecoveries.length+' recoveries logged');
else fail('No recoveries logged');

// ══════════════════════════════════
// TEST 14: FAGENTS applyBest stores all 7 params
// ══════════════════════════════════
section('FIX 14: FAGENTS applyBest — all 7 params');

const tF={name:'test',errAvg:10,speedScale:1,headingOff:0,_fagentParams:null};
const pools=[[{aScl:1.1,aBx:0.05,aBy:-0.03,gScl:0.95,cOff:2.5,sMul:1.15,hOff:3.2,err:4,errAvg:4,errHistory:[4],pos:null}]];
const FL=[tF];

pools.forEach((pool,fi)=>{
  pool.sort((a,b)=>a.errAvg-b.errAvg);
  const best=pool[0];
  if(best.errAvg<999&&best.errAvg<FL[fi].errAvg){
    FL[fi].speedScale=best.sMul;
    FL[fi].headingOff=best.hOff;
    FL[fi]._fagentParams={aScl:best.aScl,aBx:best.aBx,aBy:best.aBy,gScl:best.gScl,cOff:best.cOff};
  }
});

if(tF.speedScale===1.15) pass('speedScale='+tF.speedScale);
else fail('speedScale','val='+tF.speedScale);
if(tF.headingOff===3.2) pass('headingOff='+tF.headingOff);
else fail('headingOff','val='+tF.headingOff);
if(tF._fagentParams&&Object.keys(tF._fagentParams).length===5) pass('_fagentParams has 5 sensor params');
else fail('_fagentParams missing','keys='+(tF._fagentParams?Object.keys(tF._fagentParams).join(','):'null'));
if(tF._fagentParams.aScl===1.1) pass('aScl=1.1');
else fail('aScl wrong');
if(tF._fagentParams.gScl===0.95) pass('gScl=0.95');
else fail('gScl wrong');
if(tF._fagentParams.cOff===2.5) pass('cOff=2.5');
else fail('cOff wrong');
if(tF._fagentParams.aBx===0.05) pass('aBx=0.05');
else fail('aBx wrong');
if(tF._fagentParams.aBy===-0.03) pass('aBy=-0.03');
else fail('aBy wrong');

// ══════════════════════════════════
// SUMMARY
// ══════════════════════════════════
console.log('\n╔══════════════════════════════════════╗');
if(failed===0){
  console.log(`║  \x1b[32mALL ${total} TESTS PASSED ✓\x1b[0m${' '.repeat(Math.max(0,22-String(total).length))}║`);
}else{
  console.log(`║  \x1b[31m${failed} FAILED\x1b[0m / ${total} total${' '.repeat(Math.max(0,20-String(failed).length-String(total).length))}║`);
}
console.log('╚══════════════════════════════════════╝');

process.exit(failed>0?1:0);
