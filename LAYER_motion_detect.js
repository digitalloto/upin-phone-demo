// LAYER 7 — Multi-Modal Speed Estimation + Motion Detection
// Detects movement WITHOUT relying on IMU integration.
// Uses: CID transitions, WiFi BSSID turnover, 2G RSSI gradients.
// Delete this file + remove <script> tag → system reverts. Nothing breaks.
(function(){
'use strict';

const LAYER7={
  version:'L7.1.0',
  enabled:true,

  // ─── Component A: Improved ZUPT state ───
  zupt:{
    accelXBuf:[], accelYBuf:[], gyroZBuf:[],
    lastCID:0, cidStableSince:0,
    lastBSSIDs:new Set(),
    bssidOverlap:1.0,
    BUF_SIZE:50,
    isZUPT:false,

    update(ax, ay, gz, cid, bssids, now){
      this.accelXBuf.push(ax); if(this.accelXBuf.length>this.BUF_SIZE) this.accelXBuf.shift();
      this.accelYBuf.push(ay); if(this.accelYBuf.length>this.BUF_SIZE) this.accelYBuf.shift();
      this.gyroZBuf.push(gz); if(this.gyroZBuf.length>this.BUF_SIZE) this.gyroZBuf.shift();

      if(cid && cid!==this.lastCID){ this.lastCID=cid; this.cidStableSince=now; }
      if(bssids && bssids.size>0){
        if(this.lastBSSIDs.size>0){
          let overlap=0;
          bssids.forEach(b=>{ if(this.lastBSSIDs.has(b)) overlap++; });
          this.bssidOverlap=bssids.size>0?overlap/bssids.size:1;
        }
        this.lastBSSIDs=new Set(bssids);
      }

      const axStd=this._std(this.accelXBuf);
      const ayStd=this._std(this.accelYBuf);
      const gzStd=this._std(this.gyroZBuf);
      const cidStable=(now-this.cidStableSince)>30000;
      const bssidStable=this.bssidOverlap>0.8;

      this.isZUPT=(axStd<0.05 && ayStd<0.05 && gzStd<0.1 && cidStable && bssidStable);
      return this.isZUPT;
    },

    _std(arr){
      if(arr.length<3) return 999;
      const m=arr.reduce((s,v)=>s+v,0)/arr.length;
      return Math.sqrt(arr.reduce((s,v)=>s+(v-m)*(v-m),0)/arr.length);
    }
  },

  // ─── Component B: CID Transition Speed ───
  cidSpeed:{
    history:[], // [{cid, t}]
    radiusEstimates:[], // for auto-tuning
    cellRadius_m:1500,
    changeCount60s:0,
    speed_kmh:0,
    confidence:'LOW',

    update(cid, now, gpsSpeed){
      if(!cid) return;
      if(this.history.length===0 || this.history[this.history.length-1].cid!==cid){
        this.history.push({cid, t:now});
      }
      const cutoff=now-60000;
      this.history=this.history.filter(h=>h.t>cutoff);
      this.changeCount60s=0;
      for(let i=1;i<this.history.length;i++){
        if(this.history[i].cid!==this.history[i-1].cid) this.changeCount60s++;
      }
      this.speed_kmh=(this.changeCount60s*this.cellRadius_m)/60*3.6;
      this.confidence=this.changeCount60s>=3?'HIGH':this.changeCount60s>=1?'MEDIUM':'LOW';

      // Auto-tune radius when GPS speed available
      if(gpsSpeed>2 && this.changeCount60s>0){
        const actual=gpsSpeed/((this.changeCount60s/60)*3.6)*1000;
        if(actual>500 && actual<10000){
          this.radiusEstimates.push(actual);
          if(this.radiusEstimates.length>100) this.radiusEstimates.shift();
          this.cellRadius_m=this.radiusEstimates.reduce((s,v)=>s+v,0)/this.radiusEstimates.length;
        }
      }
    }
  },

  // ─── Component C: WiFi BSSID Turnover Speed ───
  wifiSpeed:{
    scanHistory:[], // last 6 scans
    speed_kmh:0,
    turnover_pct:0,
    confidence:'LOW',
    // WiFi APs naturally fluctuate 30-50% between scans even when stationary
    // Only count turnover above 50% as movement
    calibTable:[[0,0],[30,0],[50,0],[60,5],[70,15],[80,30],[90,60],[100,100]],
    _calLearned:[],

    update(bssidSet, now, gpsSpeed){
      if(!bssidSet || bssidSet.size===0) return;
      this.scanHistory.push({bssids:new Set(bssidSet), t:now});
      if(this.scanHistory.length>12) this.scanHistory.shift();
      // Need at least 4 scans (~40s) before reporting — single-scan noise is too high
      if(this.scanHistory.length<4){ this.confidence='LOW'; this.speed_kmh=0; return; }
      // Compare against scan from ~30s ago (not just previous) to smooth noise
      const prev=this.scanHistory[Math.max(0,this.scanHistory.length-4)];
      const curr=this.scanHistory[this.scanHistory.length-1];
      let newCount=0;
      curr.bssids.forEach(b=>{ if(!prev.bssids.has(b)) newCount++; });
      this.turnover_pct=curr.bssids.size>0?(newCount/curr.bssids.size)*100:0;
      this.speed_kmh=this._lookup(this.turnover_pct);
      this.confidence=this.turnover_pct>30?'HIGH':this.turnover_pct>10?'MEDIUM':'LOW';
      // Auto-tune
      if(gpsSpeed>1 && this.turnover_pct>5){
        this._calLearned.push({turnover:this.turnover_pct, speed:gpsSpeed*3.6});
        if(this._calLearned.length>200) this._calLearned.shift();
      }
    },

    _lookup(pct){
      const t=this._calLearned.length>20?this._buildCal():this.calibTable;
      for(let i=1;i<t.length;i++){
        if(pct<=t[i][0]){
          const frac=(pct-t[i-1][0])/(t[i][0]-t[i-1][0]);
          return t[i-1][1]+frac*(t[i][1]-t[i-1][1]);
        }
      }
      return t[t.length-1][1];
    },

    _buildCal(){
      const bins=[0,10,20,35,50,70,85,100];
      const cal=bins.map(b=>[b,0]);
      const counts=bins.map(()=>0);
      this._calLearned.forEach(s=>{
        for(let i=0;i<bins.length-1;i++){
          if(s.turnover>=bins[i]&&s.turnover<bins[i+1]){
            cal[i][1]+=s.speed; counts[i]++; break;
          }
        }
      });
      cal.forEach((c,i)=>{ if(counts[i]>0) c[1]/=counts[i]; });
      return cal;
    }
  },

  // ─── Component D: 2G RSSI Gradient Speed ───
  rssiSpeed:{
    rssiHistory:{}, // cid → [{rssi, t}]
    speed_kmh:0,
    sumAbsGrad:0,
    confidence:'LOW',

    update(towers, now){
      if(!towers||!Array.isArray(towers)) return;
      towers.forEach(t=>{
        const cid=t.cid||t.cellid;
        if(!cid) return;
        if(!this.rssiHistory[cid]) this.rssiHistory[cid]=[];
        this.rssiHistory[cid].push({rssi:t.rssi||0, t:now});
        if(this.rssiHistory[cid].length>20) this.rssiHistory[cid].shift();
      });
      // Compute gradient sum
      let sumGrad=0, gradCount=0;
      Object.keys(this.rssiHistory).forEach(cid=>{
        const h=this.rssiHistory[cid];
        if(h.length<2) return;
        const recent=h[h.length-1];
        const old=h.find(e=>(now-e.t)>50000 && (now-e.t)<70000);
        if(!old) return;
        const dt_min=(recent.t-old.t)/60000;
        if(dt_min<0.1) return;
        sumGrad+=Math.abs((recent.rssi-old.rssi)/dt_min);
        gradCount++;
      });
      this.sumAbsGrad=gradCount>0?sumGrad:0;
      // Map to speed
      if(this.sumAbsGrad<5) this.speed_kmh=0;
      else if(this.sumAbsGrad<15) this.speed_kmh=15*(this.sumAbsGrad-5)/10;
      else if(this.sumAbsGrad<30) this.speed_kmh=15+25*(this.sumAbsGrad-15)/15;
      else if(this.sumAbsGrad<60) this.speed_kmh=40+40*(this.sumAbsGrad-30)/30;
      else this.speed_kmh=80+20*Math.min((this.sumAbsGrad-60)/30,1);
      this.confidence=gradCount>=3?'HIGH':gradCount>=1?'MEDIUM':'LOW';
    }
  },

  // ─── Component E: Fused Speed ───
  fused:{
    speed_kmh:0,
    sourceCount:0,

    compute(imuSpeed, cidSpeed, wifiSpeed, rssiSpeed, cidConf, wifiConf, rssiConf){
      const sources=[];
      if(imuSpeed>0.5) sources.push({speed:imuSpeed*3.6, weight:0.3});
      if(cidConf!=='LOW') sources.push({speed:cidSpeed, weight:0.3});
      if(wifiConf!=='LOW') sources.push({speed:wifiSpeed, weight:0.2});
      if(rssiConf!=='LOW') sources.push({speed:rssiSpeed, weight:0.2});
      this.sourceCount=sources.length;
      if(sources.length===0){ this.speed_kmh=0; return 0; }
      if(sources.length===1){ this.speed_kmh=sources[0].speed; return this.speed_kmh; }
      // Outlier rejection: drop if >50% from median
      const sorted=[...sources].sort((a,b)=>a.speed-b.speed);
      const median=sorted[Math.floor(sorted.length/2)].speed;
      const filtered=median>1?sources.filter(s=>Math.abs(s.speed-median)/median<0.5):sources;
      if(filtered.length===0){ this.speed_kmh=median; return median; }
      let wSum=0, sSum=0;
      filtered.forEach(s=>{ sSum+=s.speed*s.weight; wSum+=s.weight; });
      this.speed_kmh=wSum>0?sSum/wSum:0;
      return this.speed_kmh;
    }
  },

  // ─── Component F: Improved Turn Detection ───
  turns:{
    gyroZBuf:[], // rolling buffer of gyroZ samples
    turnCount60s:0,
    turnHistory:[], // [{t, angle, lat, lon}]
    _detecting:false,
    _detectStart:0,
    _integratedAngle:0,
    _consecutiveAbove:0,

    update(gyroZ, dt, lat, lon, now){
      this.gyroZBuf.push({gz:gyroZ, t:now});
      if(this.gyroZBuf.length>300) this.gyroZBuf.shift(); // ~30s at 10Hz
      // Detect: |gyroZ| > 25°/s for 5+ consecutive samples
      if(Math.abs(gyroZ)>25){
        this._consecutiveAbove++;
        if(!this._detecting && this._consecutiveAbove>=5){
          this._detecting=true;
          this._detectStart=now;
          this._integratedAngle=0;
        }
      } else {
        if(this._detecting){
          // Turn ended: check if integrated angle > 30°
          if(Math.abs(this._integratedAngle)>30){
            this.turnHistory.push({t:now, angle:this._integratedAngle, lat, lon});
          }
          this._detecting=false;
          this._integratedAngle=0;
        }
        this._consecutiveAbove=0;
      }
      if(this._detecting){
        this._integratedAngle+=gyroZ*dt;
        if((now-this._detectStart)>5000){
          // Max 5s — force end
          if(Math.abs(this._integratedAngle)>30){
            this.turnHistory.push({t:now, angle:this._integratedAngle, lat, lon});
          }
          this._detecting=false;
          this._integratedAngle=0;
          this._consecutiveAbove=0;
        }
      }
      // Count turns in last 60s
      const cutoff=now-60000;
      this.turnHistory=this.turnHistory.filter(t=>t.t>cutoff-300000); // keep 5 min
      this.turnCount60s=this.turnHistory.filter(t=>t.t>cutoff).length;
    },

    lastTurn(){
      if(this.turnHistory.length===0) return null;
      return this.turnHistory[this.turnHistory.length-1];
    }
  },

  // ─── Component G: Improved RF Fingerprint ───
  fingerprint:{
    stored:[], // [{lat, lon, towers:{cid→avgRssi}, sampleCount, t}]
    _accumulator:{}, // cid → [rssi values]
    _accumStart:0,
    _accumLat:0, _accumLon:0,
    matchResult:null,
    matchError_m:Infinity,

    addScan(towers, lat, lon, now){
      if(!towers||towers.length===0||!lat) return;
      if(this._accumStart===0){
        this._accumStart=now;
        this._accumLat=lat; this._accumLon=lon;
        this._accumulator={};
      }
      towers.forEach(t=>{
        const cid=t.cid||t.cellid;
        if(!cid) return;
        if(!this._accumulator[cid]) this._accumulator[cid]=[];
        this._accumulator[cid].push(t.rssi||0);
      });
      // After 30s, store averaged fingerprint
      if((now-this._accumStart)>30000){
        const fp={lat:this._accumLat, lon:this._accumLon, towers:{}, sampleCount:0, t:now};
        Object.keys(this._accumulator).forEach(cid=>{
          const vals=this._accumulator[cid];
          fp.towers[cid]=vals.reduce((s,v)=>s+v,0)/vals.length;
          fp.sampleCount+=vals.length;
        });
        if(Object.keys(fp.towers).length>0){
          // Dedupe: if we have a fingerprint within 50m, update it
          const existing=this.stored.find(s=>this._hav(s,fp)<50);
          if(existing){
            Object.assign(existing.towers, fp.towers);
            existing.sampleCount+=fp.sampleCount;
            existing.t=now;
          } else {
            this.stored.push(fp);
            if(this.stored.length>100) this.stored.shift();
          }
        }
        this._accumStart=0;
        this._accumulator={};
      }
    },

    match(currentTowers){
      if(!currentTowers||currentTowers.length===0||this.stored.length===0){
        this.matchResult=null; return null;
      }
      const current={};
      currentTowers.forEach(t=>{
        const cid=t.cid||t.cellid;
        if(cid) current[cid]=t.rssi||0;
      });
      const currentCids=Object.keys(current);
      if(currentCids.length===0){ this.matchResult=null; return null; }
      let bestFP=null, bestScore=-1;
      this.stored.forEach(fp=>{
        let sim=0;
        currentCids.forEach(cid=>{
          if(fp.towers[cid]!==undefined){
            sim+=1-Math.min(1,Math.abs(current[cid]-fp.towers[cid])/20);
          }
        });
        const score=sim/currentCids.length;
        if(score>bestScore){ bestScore=score; bestFP=fp; }
      });
      if(bestFP && bestScore>0.3){
        this.matchResult={lat:bestFP.lat, lon:bestFP.lon, conf:bestScore};
        return this.matchResult;
      }
      this.matchResult=null;
      return null;
    },

    _hav(a,b){
      const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
      const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
      return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
    }
  },

  // ─── Component H: Tower Database Logging ───
  towerLog:{
    preloaded:0,
    discoveredThisRun:0,
    discoveredTotal:0,

    csvTrailer(boardTowerList, towerDB){
      const inDB=boardTowerList?boardTowerList.filter(t=>t.lat&&t.lon).length:0;
      const total=boardTowerList?boardTowerList.length:0;
      let s='\n# TOWER DATABASE GROWTH\n';
      s+='# Towers-Preloaded: '+(this.preloaded||0)+'\n';
      s+='# Towers-Discovered-This-Run: '+this.discoveredThisRun+'\n';
      s+='# Towers-Discovered-Total: '+(this.discoveredTotal||0)+'\n';
      s+='# Match-Rate: '+inDB+'/'+total+' ('+inDB+' of '+total+' current towers are in DB)\n';
      return s;
    }
  },

  // ─── Main tick: called from recording loop ───
  tick(sensors){
    if(!this.enabled) return;
    const {accel, gyro, gps, dt, boardData, boardTowerList} = sensors;
    const now=performance.now();
    const gpsSpeed=gps?gps.speed||0:0;

    // Get current 4G CID
    const cid4g=boardData&&boardData.cell4g?boardData.cell4g.cid:0;

    // Get current WiFi BSSIDs
    const wifiData=boardData&&boardData.wifi?(boardData.wifi.data||boardData.wifi.list||[]):[];
    const bssidSet=new Set();
    wifiData.forEach(ap=>{
      const b=ap.bssid||ap.b;
      if(b) bssidSet.add(b);
    });

    // Get current 2G towers
    const towers2g=boardData&&boardData.cell2g?(boardData.cell2g.data||boardData.cell2g.list||[]):[];

    // A: ZUPT
    this.zupt.update(accel.x, accel.y, gyro.z, cid4g, bssidSet, now);

    // B: CID speed
    this.cidSpeed.update(cid4g, now, gpsSpeed);

    // C: WiFi speed
    if(bssidSet.size>0) this.wifiSpeed.update(bssidSet, now, gpsSpeed);

    // D: RSSI gradient
    this.rssiSpeed.update(towers2g, now);

    // E: Fused
    const imuVel=typeof ALGEBRA!=='undefined'?ALGEBRA.velocity_ms:0;
    this.fused.compute(
      imuVel, this.cidSpeed.speed_kmh, this.wifiSpeed.speed_kmh, this.rssiSpeed.speed_kmh,
      this.cidSpeed.confidence, this.wifiSpeed.confidence, this.rssiSpeed.confidence
    );

    // F: Turn detection
    this.turns.update(gyro.z, dt, gps?gps.lat:0, gps?gps.lon:0, now);

    // G: RF Fingerprint
    const allTowers=[...towers2g];
    if(boardData&&boardData.cell4g&&boardData.cell4g.cid){
      allTowers.push({cid:boardData.cell4g.cid, rssi:boardData.cell4g.rssi||0});
    }
    if(gps&&gps.lat) this.fingerprint.addScan(allTowers, gps.lat, gps.lon, now);
    this.fingerprint.match(allTowers);
  },

  // ─── CSV header columns ───
  csvHeaderCols:'Speed_IMU_kmh,Speed_CID_kmh,CID_Conf,Speed_WiFi_kmh,WiFi_Turnover_pct,Speed_RSSI_kmh,RSSI_Grad,Speed_Fused_kmh,Fused_Sources,Turn_Count_60s,Last_Turn_Angle,ZUPT_Active,RF_FP_Conf',

  // ─── Per-row CSV data ───
  csvRowData(){
    const imuV=typeof ALGEBRA!=='undefined'?ALGEBRA.velocity_ms:0;
    const lt=this.turns.lastTurn();
    const fp=this.fingerprint.matchResult;
    return [
      (imuV*3.6).toFixed(1),
      this.cidSpeed.speed_kmh.toFixed(1),
      this.cidSpeed.confidence,
      this.wifiSpeed.speed_kmh.toFixed(1),
      this.wifiSpeed.turnover_pct.toFixed(0),
      this.rssiSpeed.speed_kmh.toFixed(1),
      this.rssiSpeed.sumAbsGrad.toFixed(1),
      this.fused.speed_kmh.toFixed(1),
      this.fused.sourceCount,
      this.turns.turnCount60s,
      lt?lt.angle.toFixed(0):'',
      this.zupt.isZUPT?'1':'0',
      fp?fp.conf.toFixed(2):''
    ].join(',');
  },

  // ─── CSV trailer ───
  csvTrailer(boardTowerList){
    let s='\n# LAYER 7: MOTION DETECTION\n';
    s+='# L7-CID-Changes-60s: '+this.cidSpeed.changeCount60s+'\n';
    s+='# L7-CID-Speed: '+this.cidSpeed.speed_kmh.toFixed(1)+' km/h ('+this.cidSpeed.confidence+')\n';
    s+='# L7-CID-Radius: '+this.cidSpeed.cellRadius_m.toFixed(0)+' m\n';
    s+='# L7-WiFi-Turnover: '+this.wifiSpeed.turnover_pct.toFixed(0)+'%\n';
    s+='# L7-WiFi-Speed: '+this.wifiSpeed.speed_kmh.toFixed(1)+' km/h\n';
    s+='# L7-RSSI-Gradient: '+this.rssiSpeed.sumAbsGrad.toFixed(1)+' dB/min\n';
    s+='# L7-RSSI-Speed: '+this.rssiSpeed.speed_kmh.toFixed(1)+' km/h\n';
    s+='# L7-Fused-Speed: '+this.fused.speed_kmh.toFixed(1)+' km/h ('+this.fused.sourceCount+' sources)\n';
    s+='# L7-Turns-60s: '+this.turns.turnCount60s+'\n';
    s+='# L7-RF-Fingerprints-Stored: '+this.fingerprint.stored.length+'\n';
    s+='# L7-ZUPT-Active: '+(this.zupt.isZUPT?'YES':'NO')+'\n';
    s+=this.towerLog.csvTrailer(boardTowerList);
    return s;
  },

  reset(){
    this.zupt.accelXBuf=[]; this.zupt.accelYBuf=[]; this.zupt.gyroZBuf=[];
    this.cidSpeed.history=[]; this.wifiSpeed.scanHistory=[];
    this.rssiSpeed.rssiHistory={};
    this.turns.turnHistory=[]; this.turns.gyroZBuf=[];
    this.fingerprint.stored=[]; this.fingerprint._accumulator={};
    this.fused.speed_kmh=0;
  }
};

window.LAYER7=LAYER7;
})();
