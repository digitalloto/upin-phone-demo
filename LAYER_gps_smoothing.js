// LAYER 2 — GPS Smoothing
// Four independent filters to stop GPS from jumping 1-5km in static tests.
// Each filter has its own toggle. Delete this file → raw GPS passes through unfiltered.
(function(){
'use strict';

const LAYER2={
  version:'L2.2.0',
  jumpReject:true,
  motionReject:false,
  cellSanity:false,
  roadSnap:false,

  lastGood:null,
  lastGoodTime:0,
  lastRealUpdateTime:0, // when position ACTUALLY changed (not stale repeats)
  rejectStreak:0,
  maxRejectStreak:10,
  maxRejectTimeMs:5000, // after 5s of continuous rejection, force accept
  firstRejectTime:0,
  stats:{jumpsRejected:0, motionRejected:0, cellViolations:0, totalProcessed:0, forceAccepts:0},
  _log:[],

  maxSpeedKmh:200,
  walkingMaxKmh:15,
  stationaryRadiusM:8,
  mode:'vehicle',

  smoothGPS(raw, accelMag, isStationary, frozenPos){
    if(!raw||!raw.lat) return raw;
    this.stats.totalProcessed++;
    const now=performance.now();
    let pos={lat:raw.lat, lon:raw.lon, acc:raw.acc, speed:raw.speed};
    let rejected=false;
    let flags={};

    // 2A — Jump rejection (with stale-GPS protection)
    if(this.jumpReject && this.lastGood){
      const dist=this._hav(pos, this.lastGood);

      // Skip speed check for positions that haven't moved (stale repeats)
      if(dist < 1){
        // Position hasn't changed — don't update lastGoodTime
        // This prevents stale GPS from resetting the timer
        pos._l2flags=flags;
        return pos;
      }

      // Use time since position ACTUALLY changed, not since last callback
      const dt=Math.max((now-this.lastRealUpdateTime)/1000, 0.5);
      const impliedSpeed=(dist/dt)*3.6;
      const maxSpeed=this.mode==='walking'?this.walkingMaxKmh:this.maxSpeedKmh;

      if(impliedSpeed>maxSpeed){
        this.rejectStreak++;
        this.stats.jumpsRejected++;
        flags.gps_jump_rejected=true;
        flags.rejected_lat=pos.lat;
        flags.rejected_lon=pos.lon;
        flags.implied_speed_kmh=Math.round(impliedSpeed);

        // Track when rejection streak started
        if(this.rejectStreak===1) this.firstRejectTime=now;

        // Force accept after time limit OR streak limit
        const rejectDuration=now-this.firstRejectTime;
        if(this.rejectStreak>=this.maxRejectStreak || rejectDuration>this.maxRejectTimeMs){
          this.rejectStreak=0;
          this.firstRejectTime=0;
          this.stats.forceAccepts++;
          flags.force_accepted=true;
          flags.reject_duration_ms=Math.round(rejectDuration);
        } else {
          pos={lat:this.lastGood.lat, lon:this.lastGood.lon, acc:raw.acc, speed:0};
          rejected=true;
        }
      } else {
        this.rejectStreak=0;
        this.firstRejectTime=0;
      }
    }

    // 2B — Motion plausibility (stationary rejection)
    if(this.motionReject && !rejected && isStationary && frozenPos){
      const distFromFrozen=this._hav(pos, frozenPos);
      if(distFromFrozen>this.stationaryRadiusM){
        this.stats.motionRejected++;
        flags.motion_rejected=true;
        flags.motion_dist_m=Math.round(distFromFrozen);
        pos={lat:frozenPos.lat, lon:frozenPos.lon, acc:raw.acc, speed:0};
        rejected=true;
      }
    }

    // 2C — Cell sanity check (flag only, don't reject)
    if(this.cellSanity && !rejected){
      const cellCheck=this._checkCellSanity(pos);
      if(cellCheck.violation){
        this.stats.cellViolations++;
        flags.cell_sanity_violation=true;
        flags.cell_dist_km=cellCheck.distKm;
      }
    }

    // Update last good position
    if(!rejected){
      this.lastGood={lat:pos.lat, lon:pos.lon};
      this.lastGoodTime=now;
      this.lastRealUpdateTime=now;
    }

    this._log.push({t:now, flags:flags});
    if(this._log.length>500) this._log.shift();
    pos._l2flags=flags;
    return pos;
  },

  _checkCellSanity(pos){
    if(typeof boardTowerList==='undefined'||!boardTowerList||!boardTowerList.length)
      return {violation:false};
    let minDist=Infinity;
    boardTowerList.forEach(t=>{
      if(t.lat&&t.lon){
        const d=this._hav(pos,{lat:t.lat,lon:t.lon})/1000;
        if(d<minDist) minDist=d;
      }
    });
    if(minDist<Infinity && minDist>3) return {violation:true, distKm:Math.round(minDist*10)/10};
    return {violation:false};
  },

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  csvFlags(t){
    const entry=this._log.find(l=>Math.abs(l.t-t)<600);
    if(!entry||!Object.keys(entry.flags).length) return '';
    return JSON.stringify(entry.flags);
  },

  csvSummary(){
    let s='# GPS-Smoothing-Layer: L2.2.0\n';
    s+='# L2-Jump-Rejected: '+this.stats.jumpsRejected+'\n';
    s+='# L2-Force-Accepts: '+this.stats.forceAccepts+'\n';
    s+='# L2-Motion-Rejected: '+this.stats.motionRejected+'\n';
    s+='# L2-Cell-Violations: '+this.stats.cellViolations+'\n';
    s+='# L2-Total-Processed: '+this.stats.totalProcessed+'\n';
    return s;
  },

  reset(){
    this.lastGood=null;
    this.lastGoodTime=0;
    this.lastRealUpdateTime=0;
    this.rejectStreak=0;
    this.firstRejectTime=0;
    this.stats={jumpsRejected:0, motionRejected:0, cellViolations:0, totalProcessed:0, forceAccepts:0};
    this._log=[];
  }
};

window.LAYER2=LAYER2;
})();
