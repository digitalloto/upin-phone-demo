// LAYER 6 — Bounded Learning + Algebraic Sensor Reconstruction
// Component A: GPS as teacher signal (scoring, NOT constraining)
// Component B: 8 physics formulas that fill sensor gaps
// Delete this file + remove <script> tag → system reverts. Nothing breaks.
(function(){
'use strict';

// ═══════════════════════════════════════
// COMPONENT A — BOUNDED LEARNING SIGNAL
// ═══════════════════════════════════════
const BOUND={
  enabled:true,
  centre:null,       // {lat, lon}
  radius_m:20,
  type:'NONE',       // GPS_ANCHOR | CONE_EXTRAPOLATED | UNBOUNDED
  lastGoodGPS:null,  // {lat, lon, t, speed, heading}
  lastGoodTime:0,
  scores:{},         // formulaIdx → {history:[], avg60s}
  _mapCircle:null,

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  // A.1 — Compute the bound each tick
  updateBound(gps, speedEst, heading){
    const now=performance.now();
    // Check if GPS is good (available and not jump-flagged)
    const gpsGood=gps&&gps.lat&&(!gps._l2flags||!gps._l2flags.gps_jump_rejected);

    if(gpsGood){
      this.centre={lat:gps.lat, lon:gps.lon};
      this.radius_m=20;
      this.type='GPS_ANCHOR';
      this.lastGoodGPS={lat:gps.lat, lon:gps.lon, t:now, speed:speedEst||0, heading:heading||0};
      this.lastGoodTime=now;
    } else if(this.lastGoodGPS && (now-this.lastGoodTime)<300000){ // within 5 min
      const elapsed_s=(now-this.lastGoodTime)/1000;
      const spd=this.lastGoodGPS.speed||0;
      const hdg=(this.lastGoodGPS.heading||0)*Math.PI/180;
      const drift_m=spd*elapsed_s;
      this.radius_m=20+drift_m;
      this.centre={
        lat:this.lastGoodGPS.lat+(spd*Math.cos(hdg)*elapsed_s)/111320,
        lon:this.lastGoodGPS.lon+(spd*Math.sin(hdg)*elapsed_s)/(111320*Math.cos(this.lastGoodGPS.lat*Math.PI/180))
      };
      this.type='CONE_EXTRAPOLATED';
    } else {
      this.type='UNBOUNDED';
      this.centre=null;
      this.radius_m=Infinity;
    }
  },

  // A.2 — Score each algorithm
  scoreAlgorithms(F, gpsSys){
    if(!this.centre||this.type==='UNBOUNDED') return;
    F.forEach((f,i)=>{
      if(!f._lastPredLat||f.errAvg>=999) return;
      const dist=this._hav({lat:f._lastPredLat,lon:f._lastPredLon}, this.centre);
      let score;
      if(dist<=this.radius_m){
        score=1.0-(dist/this.radius_m);
      } else {
        score=-((dist-this.radius_m)/this.radius_m);
        score=Math.max(score,-1);
      }
      if(!this.scores[i]) this.scores[i]={history:[], avg60s:0};
      this.scores[i].history.push({t:performance.now(), s:score});
      // Keep 60s of history
      const cutoff=performance.now()-60000;
      this.scores[i].history=this.scores[i].history.filter(h=>h.t>cutoff);
      this.scores[i].avg60s=this.scores[i].history.reduce((sum,h)=>sum+h.s,0)/this.scores[i].history.length;
    });
  },

  // A.3 — Get bound score for a formula
  getScore(idx){
    return this.scores[idx]?this.scores[idx].avg60s:0;
  },

  // A.4 — Draw bound circle on map
  drawBound(map, F){
    if(this._mapCircle){try{map.removeLayer(this._mapCircle);}catch(e){}}
    // Remove old formula dots coloring
    if(this._boundDots){this._boundDots.forEach(d=>{try{map.removeLayer(d);}catch(e){}});}
    this._boundDots=[];

    if(!this.centre||this.type==='UNBOUNDED'||!this.enabled) return;

    // Orange bound circle
    if(typeof L!=='undefined'){
      const radius=Math.min(this.radius_m, 5000);
      this._mapCircle=L.circle([this.centre.lat,this.centre.lon],{
        radius:radius, color:'#ff9800', fillColor:'#ff9800',
        fillOpacity:0.05, weight:2, opacity:0.6, dashArray:'6,4'
      }).addTo(map);
      this._mapCircle.bindTooltip('Bound: '+Math.round(this.radius_m)+'m ('+this.type+')');

      // Color formula dots green (inside) or red (outside)
      F.forEach((f,i)=>{
        if(!f._lastPredLat||f.errAvg>=999) return;
        const dist=this._hav({lat:f._lastPredLat,lon:f._lastPredLon}, this.centre);
        const inside=dist<=this.radius_m;
        const dot=L.circleMarker([f._lastPredLat,f._lastPredLon],{
          radius:3, color:inside?'#3dcc6e':'#f06060',
          fillColor:inside?'#3dcc6e':'#f06060', fillOpacity:0.8, weight:1
        }).addTo(map);
        dot.bindTooltip(f.name+': '+(inside?'IN':'OUT')+' ('+dist.toFixed(0)+'m, score:'+this.getScore(i).toFixed(2)+')');
        this._boundDots.push(dot);
      });
    }
  },

  // CSV column value per formula
  csvScores(F){
    return F.map((f,i)=>this.getScore(i).toFixed(3));
  }
};

// ═══════════════════════════════════════
// COMPONENT B — ALGEBRAIC SENSOR RECONSTRUCTION
// Pure physics. Same input → same output. Always.
// ═══════════════════════════════════════
const ALGEBRA={
  // State
  velocity_ms:0,       // B.1
  dr_lat:0, dr_lon:0,  // B.2
  dr_drift_m:0,
  heading_compensated:0, // B.3
  altitude_baro_m:0,     // B.4
  steps_total:0,         // B.5
  walking_distance_m:0,
  cell_distance_km:0,    // B.6
  remaining_to_landmark_m:0, // B.7
  tri_lat:0, tri_lon:0, tri_anchors:0, // B.8

  // Internal state
  _lastAccelPeakT:0,
  _zupt_count:0,
  _lastDrGPS:null,
  _initialized:false,

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  // Called every tick with current sensor values
  update(sensors){
    const {accel, gyro, mag, compass, pressure, gps, speed, heading, dt,
           stepCount, boardTowerList, CAL, isStationary} = sensors;

    // B.1 — Velocity from accelerometer integration
    const ax=accel.x-(CAL?CAL.accelBias.x:0);
    const ay=accel.y-(CAL?CAL.accelBias.y:0);
    const az=accel.z-(CAL?CAL.accelBias.z:0);
    const accelMag=Math.sqrt(ax*ax+ay*ay+az*az);
    const gravityMag=9.81;
    const horizontal_accel=Math.max(0, accelMag-gravityMag);

    // ZUPT: use Layer 7 multi-modal ZUPT if available, else basic threshold
    const zupt_active=window.LAYER7&&LAYER7.enabled?LAYER7.zupt.isZUPT:(Math.abs(accelMag-gravityMag)<0.3);
    if(zupt_active){
      this._zupt_count++;
      if(this._zupt_count>=(2/Math.max(dt,0.01))){
        this.velocity_ms=0;
      }
    } else {
      this._zupt_count=0;
      this.velocity_ms+=horizontal_accel*dt;
      this.velocity_ms*=0.98;
    }

    // B.2 — Dead reckoning position from velocity
    if(gps&&gps.lat&&!this._initialized){
      this.dr_lat=gps.lat; this.dr_lon=gps.lon;
      this._lastDrGPS={lat:gps.lat,lon:gps.lon};
      this._initialized=true;
    }
    if(this._initialized){
      const hdg_rad=(compass+(CAL?CAL.compassOff:0))*Math.PI/180;
      const v=this.velocity_ms>0.1?this.velocity_ms:(speed||0);
      this.dr_lat+=( v*Math.cos(hdg_rad)*dt)/111320;
      this.dr_lon+=( v*Math.sin(hdg_rad)*dt)/(111320*Math.cos(this.dr_lat*Math.PI/180));
      if(this._lastDrGPS){
        this.dr_drift_m=this._hav({lat:this.dr_lat,lon:this.dr_lon},this._lastDrGPS);
      }
      // Reset DR to GPS when available and drift < 5m (stays honest)
      if(gps&&gps.lat&&this.dr_drift_m<5){
        this.dr_lat=gps.lat; this.dr_lon=gps.lon;
        this._lastDrGPS={lat:gps.lat,lon:gps.lon};
        this.dr_drift_m=0;
      }
    }

    // B.3 — Tilt-compensated heading from mag + accel
    if(mag&&(mag.x||mag.y||mag.z)){
      const roll_rad=Math.atan2(ay, az);
      const pitch_rad=Math.atan2(-ax, Math.sqrt(ay*ay+az*az));
      const mx_comp=mag.x*Math.cos(pitch_rad)+mag.z*Math.sin(pitch_rad);
      const my_comp=mag.x*Math.sin(roll_rad)*Math.sin(pitch_rad)
                   +mag.y*Math.cos(roll_rad)
                   -mag.z*Math.sin(roll_rad)*Math.cos(pitch_rad);
      let hdg=Math.atan2(-my_comp, mx_comp)*180/Math.PI;
      if(hdg<0) hdg+=360;
      this.heading_compensated=hdg;
    } else {
      this.heading_compensated=compass;
    }

    // B.4 — Barometric altitude
    if(pressure&&pressure>300){
      this.altitude_baro_m=44330*(1-Math.pow(pressure/1013.25, 0.1903));
    }

    // B.5 — Step detection from accelerometer peaks
    const now=performance.now();
    if(horizontal_accel>1.5 && (now-this._lastAccelPeakT)>300){
      this.steps_total++;
      this._lastAccelPeakT=now;
      this.walking_distance_m=this.steps_total*0.75;
    }

    // B.6 — Cell tower distance from RSSI (path loss model)
    // Use serving 4G cell (1800 MHz Band 3) or 2G (900 MHz) if available
    if(boardTowerList&&boardTowerList.length>0){
      const tower=boardTowerList[0];
      if(tower&&tower.rssi){
        let rssi_dbm=tower.rssi;
        if(rssi_dbm>0&&rssi_dbm<=31) rssi_dbm=-113+rssi_dbm*2; // CSQ→dBm
        const freq_mhz=tower.freq||(tower.radio==='gsm'?900:1800);
        const dist_km=Math.pow(10,(Math.abs(rssi_dbm)-32.45-20*Math.log10(freq_mhz))/20);
        this.cell_distance_km=Math.max(0.01, Math.min(50, dist_km));
      }
    } else if(sensors.boardData&&sensors.boardData.cell4g&&sensors.boardData.cell4g.rssi){
      let rssi=sensors.boardData.cell4g.rssi;
      if(rssi>0&&rssi<=31) rssi=-113+rssi*2;
      const dist_km=Math.pow(10,(Math.abs(rssi)-32.45-20*Math.log10(1800))/20);
      this.cell_distance_km=Math.max(0.01, Math.min(50, dist_km));
    }

    // B.7 — Remaining distance to landmark (requires active route)
    if(typeof LAYER1!=='undefined'&&LAYER1.enabled&&LAYER1.selectedIdx>=0&&gps&&gps.lat){
      const lm=LAYER1.landmarks[LAYER1.selectedIdx];
      if(lm) this.remaining_to_landmark_m=this._hav(gps,{lat:lm.lat,lon:lm.lon});
    }

    // B.8 — Algebraic trilateration from 3+ anchor distances
    this._trilaterate(boardTowerList, gps);
  },

  // B.8 — Linearized trilateration from 3+ anchors
  _trilaterate(towers, gps){
    // Collect anchors with known positions
    const anchors=[];
    if(towers){
      towers.forEach(t=>{
        if(t.lat&&t.lon&&t.rssi){
          const freq=t.freq||1800;
          const dist_m=Math.pow(10,(Math.abs(t.rssi)-32.45-20*Math.log10(freq))/20)*1000;
          anchors.push({lat:t.lat, lon:t.lon, dist:dist_m});
        }
      });
    }
    // Also use nearby landmarks if Layer 1 has them and we have GPS
    if(typeof LANDMARKS!=='undefined'&&gps&&gps.lat){
      const sorted=[...LANDMARKS].map(lm=>({
        lat:lm.lat, lon:lm.lon,
        dist:this._hav(gps,{lat:lm.lat,lon:lm.lon})
      })).filter(a=>a.dist<3000).sort((a,b)=>a.dist-b.dist).slice(0,5);
      anchors.push(...sorted);
    }

    this.tri_anchors=anchors.length;
    if(anchors.length<3){
      this.tri_lat=0; this.tri_lon=0;
      return;
    }

    // Convert to local meters (flat earth approx for small area)
    const refLat=anchors[0].lat, refLon=anchors[0].lon;
    const mPerDegLat=111320;
    const mPerDegLon=111320*Math.cos(refLat*Math.PI/180);
    const pts=anchors.map(a=>({
      x:(a.lon-refLon)*mPerDegLon,
      y:(a.lat-refLat)*mPerDegLat,
      d:a.dist
    }));

    // Linearized system: subtract first equation from each subsequent
    // 2(x2-x1)·x + 2(y2-y1)·y = d1²-d2² - x1²+x2² - y1²+y2²
    const x1=pts[0].x, y1=pts[0].y, d1=pts[0].d;
    let A=[], b=[];
    for(let i=1;i<Math.min(pts.length,6);i++){
      const xi=pts[i].x, yi=pts[i].y, di=pts[i].d;
      A.push([2*(xi-x1), 2*(yi-y1)]);
      b.push(d1*d1-di*di - x1*x1+xi*xi - y1*y1+yi*yi);
    }

    // Least squares: (A^T A)^-1 A^T b
    const AtA=[[0,0],[0,0]], Atb=[0,0];
    for(let i=0;i<A.length;i++){
      AtA[0][0]+=A[i][0]*A[i][0]; AtA[0][1]+=A[i][0]*A[i][1];
      AtA[1][0]+=A[i][1]*A[i][0]; AtA[1][1]+=A[i][1]*A[i][1];
      Atb[0]+=A[i][0]*b[i]; Atb[1]+=A[i][1]*b[i];
    }
    const det=AtA[0][0]*AtA[1][1]-AtA[0][1]*AtA[1][0];
    if(Math.abs(det)<1e-10) return;
    const xSol=(AtA[1][1]*Atb[0]-AtA[0][1]*Atb[1])/det;
    const ySol=(-AtA[1][0]*Atb[0]+AtA[0][0]*Atb[1])/det;

    this.tri_lat=refLat+ySol/mPerDegLat;
    this.tri_lon=refLon+xSol/mPerDegLon;
  },

  // CSV trailer block
  csvTrailer(gps){
    let s='\n# ==== LAYER 6: ALGEBRAIC RECONSTRUCTION ====\n';
    s+='# Velocity (B.1):     algebra_velocity_ms = '+this.velocity_ms.toFixed(2)+(this._zupt_count>20?' (ZUPT active)':'')+'\n';
    s+='# Dead reckon (B.2):  lat='+this.dr_lat.toFixed(4)+' lon='+this.dr_lon.toFixed(4)+' (drift since last GPS: '+this.dr_drift_m.toFixed(1)+'m)\n';
    s+='# Heading (B.3):      tilt-compensated = '+this.heading_compensated.toFixed(1)+'°\n';
    s+='# Altitude (B.4):     baro = '+this.altitude_baro_m.toFixed(1)+'m'+(gps&&gps.alt?' (GPS = '+gps.alt.toFixed(1)+'m, diff '+Math.abs(this.altitude_baro_m-(gps.alt||0)).toFixed(1)+'m)':'')+'\n';
    s+='# Steps (B.5):        total = '+this.steps_total+' steps (~'+this.walking_distance_m.toFixed(1)+'m walked)\n';
    s+='# Cell (B.6):         serving cell distance estimate = '+this.cell_distance_km.toFixed(1)+' km\n';
    s+='# Landmark (B.7):     '+(this.remaining_to_landmark_m>0?this.remaining_to_landmark_m.toFixed(0)+'m to selected landmark':'n/a (no landmark selected)')+'\n';
    s+='# Trilat (B.8):       '+(this.tri_anchors>=3?'lat='+this.tri_lat.toFixed(5)+' lon='+this.tri_lon.toFixed(5)+' ('+this.tri_anchors+' anchors)':'INSUFFICIENT — '+this.tri_anchors+' anchor(s), need 3+')+'\n';
    return s;
  },

  // Per-row CSV columns
  csvRow(){
    return [
      this.velocity_ms.toFixed(3),
      this.dr_lat.toFixed(7), this.dr_lon.toFixed(7),
      this.heading_compensated.toFixed(1),
      this.altitude_baro_m.toFixed(1),
      this.steps_total, this.walking_distance_m.toFixed(1),
      this.cell_distance_km.toFixed(2),
      this.remaining_to_landmark_m.toFixed(0),
      this.tri_anchors>=3?this.tri_lat.toFixed(7):'',
      this.tri_anchors>=3?this.tri_lon.toFixed(7):'',
      this.tri_anchors
    ].join(',');
  },

  reset(){
    this.velocity_ms=0; this.dr_lat=0; this.dr_lon=0; this.dr_drift_m=0;
    this.heading_compensated=0; this.altitude_baro_m=0;
    this.steps_total=0; this.walking_distance_m=0;
    this.cell_distance_km=0; this.remaining_to_landmark_m=0;
    this.tri_lat=0; this.tri_lon=0; this.tri_anchors=0;
    this._zupt_count=0; this._lastAccelPeakT=0;
    this._lastDrGPS=null; this._initialized=false;
  }
};

// ═══════════════════════════════════════
// LAYER 6 PUBLIC API
// ═══════════════════════════════════════
const LAYER6={
  version:'L6.1.0',
  enabled:true,
  BOUND:BOUND,
  ALGEBRA:ALGEBRA,

  // Called each tick from the main loop
  tick(sensors, F){
    if(!this.enabled) return;
    const {gps, speed, heading}=sensors;
    // Component A
    BOUND.updateBound(gps, speed, heading);
    BOUND.scoreAlgorithms(F, gps);
    // Component B
    ALGEBRA.update(sensors);
  },

  // Draw bound circle on map (called from UI update)
  drawMap(map, F){
    if(!this.enabled) return;
    BOUND.drawBound(map, F);
  },

  // CSV header columns for per-row data
  csvHeaderCols:'Bound_Score,Alg_Vel_ms,Alg_DR_Lat,Alg_DR_Lon,Alg_Hdg_Comp,Alg_Alt_Baro,Alg_Steps,Alg_Walk_m,Alg_Cell_km,Alg_LM_Remain_m,Alg_Tri_Lat,Alg_Tri_Lon,Alg_Tri_N',

  // Per-row CSV data
  csvRowData(formulaIdx){
    const bs=BOUND.getScore(formulaIdx);
    return bs.toFixed(3)+','+ALGEBRA.csvRow();
  },

  // Full trailer
  csvTrailer(gps){
    let s='\n# LAYER 6: BOUNDED LEARNING\n';
    s+='# L6-Bound-Type: '+BOUND.type+'\n';
    s+='# L6-Bound-Radius: '+BOUND.radius_m.toFixed(0)+'m\n';
    if(BOUND.centre) s+='# L6-Bound-Centre: '+BOUND.centre.lat.toFixed(6)+','+BOUND.centre.lon.toFixed(6)+'\n';
    s+=ALGEBRA.csvTrailer(gps);
    return s;
  },

  reset(){
    BOUND.scores={};
    BOUND.lastGoodGPS=null;
    BOUND.centre=null;
    BOUND.type='NONE';
    ALGEBRA.reset();
  }
};

window.LAYER6=LAYER6;
window.BOUND=BOUND;
window.ALGEBRA=ALGEBRA;
})();
