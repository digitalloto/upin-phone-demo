// LAYER 2 — GPS Smoothing
// Four independent filters to stop GPS from jumping 1-5km in static tests.
// Each filter has its own toggle. Delete this file → raw GPS passes through unfiltered.
(function(){
'use strict';

const LAYER2={
  version:'L2.1.0',
  // Individual filter toggles
  jumpReject:true,     // 2A: Speed-based jump rejection
  motionReject:false,  // 2B: IMU-based motion plausibility (off by default, needs tuning)
  cellSanity:false,    // 2C: Cell tower sanity check (off by default)
  roadSnap:false,      // 2D: Road snap (future — needs OSM data)

  // State
  lastGood:null,       // {lat, lon, t}
  lastGoodTime:0,
  rejectStreak:0,
  maxRejectStreak:10,  // after 10 consecutive rejects (~5s), accept (tunnel exit etc.)
  stats:{jumpsRejected:0, motionRejected:0, cellViolations:0, totalProcessed:0},
  _log:[],             // recent filter events for CSV

  // Config
  maxSpeedKmh:200,     // vehicle mode: 200 km/h max plausible
  walkingMaxKmh:15,    // walking mode: 15 km/h max plausible
  stationaryRadiusM:8, // when stationary, reject GPS > this distance from frozen pos
  mode:'vehicle',      // 'vehicle' | 'walking'

  // Main entry point: filter a raw GPS reading
  smoothGPS(raw, accelMag, isStationary, frozenPos){
    if(!raw||!raw.lat) return raw;
    this.stats.totalProcessed++;
    const now=performance.now();
    let pos={lat:raw.lat, lon:raw.lon, acc:raw.acc, speed:raw.speed};
    let rejected=false;
    let flags={};

    // 2A — Jump rejection
    if(this.jumpReject && this.lastGood){
      const dt=(now-this.lastGoodTime)/1000;
      if(dt>0.1){
        const dist=this._hav(pos, this.lastGood);
        const impliedSpeed=(dist/dt)*3.6; // km/h
        const maxSpeed=this.mode==='walking'?this.walkingMaxKmh:this.maxSpeedKmh;
        if(impliedSpeed>maxSpeed){
          this.rejectStreak++;
          this.stats.jumpsRejected++;
          flags.gps_jump_rejected=true;
          flags.rejected_lat=pos.lat;
          flags.rejected_lon=pos.lon;
          flags.implied_speed_kmh=Math.round(impliedSpeed);
          if(this.rejectStreak<this.maxRejectStreak){
            pos={lat:this.lastGood.lat, lon:this.lastGood.lon, acc:raw.acc, speed:0};
            rejected=true;
          } else {
            // Streak exceeded: accept this position (teleport/tunnel exit)
            this.rejectStreak=0;
            flags.streak_override=true;
          }
        } else {
          this.rejectStreak=0;
        }
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

    // 2C — Cell sanity check (flag only, don't reject yet)
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
    }

    // Store flags for CSV
    this._log.push({t:now, flags:flags});
    if(this._log.length>500) this._log.shift();

    // Attach flags to the position object for CSV export
    pos._l2flags=flags;
    return pos;
  },

  // Cell sanity: check if GPS position is within reasonable range of serving cell
  _checkCellSanity(pos){
    // Use the board's tower list if available
    if(typeof boardTowerList==='undefined'||!boardTowerList||!boardTowerList.length)
      return {violation:false};
    // Find the closest known tower
    let minDist=Infinity;
    boardTowerList.forEach(t=>{
      if(t.lat&&t.lon){
        const d=this._hav(pos,{lat:t.lat,lon:t.lon})/1000; // km
        if(d<minDist) minDist=d;
      }
    });
    // If closest tower is > 3km away, flag
    if(minDist<Infinity && minDist>3){
      return {violation:true, distKm:Math.round(minDist*10)/10};
    }
    return {violation:false};
  },

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  // CSV columns added per row
  csvFlags(t){
    const entry=this._log.find(l=>Math.abs(l.t-t)<600);
    if(!entry||!Object.keys(entry.flags).length) return '';
    return JSON.stringify(entry.flags);
  },

  // Summary stats for CSV trailer
  csvSummary(){
    let s='# GPS-Smoothing-Layer: L2.1.0\n';
    s+='# L2-Jump-Rejected: '+this.stats.jumpsRejected+'\n';
    s+='# L2-Motion-Rejected: '+this.stats.motionRejected+'\n';
    s+='# L2-Cell-Violations: '+this.stats.cellViolations+'\n';
    s+='# L2-Total-Processed: '+this.stats.totalProcessed+'\n';
    s+='# L2-Filters: jump='+(this.jumpReject?'ON':'OFF')+' motion='+(this.motionReject?'ON':'OFF')+' cell='+(this.cellSanity?'ON':'OFF')+'\n';
    return s;
  },

  reset(){
    this.lastGood=null;
    this.lastGoodTime=0;
    this.rejectStreak=0;
    this.stats={jumpsRejected:0, motionRejected:0, cellViolations:0, totalProcessed:0};
    this._log=[];
  }
};

window.LAYER2=LAYER2;
})();
