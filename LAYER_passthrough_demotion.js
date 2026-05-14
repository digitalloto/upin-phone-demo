// LAYER 5 — Passthrough Demotion
// Ensures RUNNING algorithms rank above PASSTHROUGH in leaderboard & CSV header.
// Delete this file + remove its <script> tag → system reverts to original ranking.
(function(){
'use strict';

const LAYER5={
  enabled:true,
  version:'L5.1.0',

  // Classify a formula: RUNNING > PASSTHROUGH > WAITING > DISABLED
  classify(f, gpsSys){
    if(f.name.includes('disabled')) return 'DISABLED';
    if(f.errAvg>=999) return 'WAITING';
    if(f._lastPredLat && gpsSys &&
       Math.abs(f._lastPredLat - gpsSys.lat)<0.0000001 &&
       Math.abs(f._lastPredLon - gpsSys.lon)<0.0000001) return 'PASSTHROUGH';
    return 'RUNNING';
  },

  // Find best RUNNING formula index (skips PASSTHROUGH/WAITING/DISABLED)
  bestRunningIdx(F, gpsSys){
    let bestIdx=-1, bestErr=Infinity;
    F.forEach((f,i)=>{
      if(this.classify(f, gpsSys)==='RUNNING' && f.errAvg<bestErr){
        bestErr=f.errAvg; bestIdx=i;
      }
    });
    // Fallback: if no RUNNING formulas, pick lowest-error non-disabled
    if(bestIdx===-1){
      F.forEach((f,i)=>{
        if(!f.name.includes('disabled') && f.errAvg<bestErr){
          bestErr=f.errAvg; bestIdx=i;
        }
      });
    }
    return bestIdx===-1?0:bestIdx;
  },

  // Sort formulas for display: RUNNING first (by error asc), then PASSTHROUGH, WAITING, DISABLED
  sortedRankings(F, gpsSys){
    const classified=F.map((f,i)=>({
      idx:i, name:f.name, errAvg:f.errAvg,
      corrCount:f.corrCount, speedScale:f.speedScale,
      lat:f._lastPredLat||0, lon:f._lastPredLon||0,
      status:this.classify(f, gpsSys)
    }));
    const order={RUNNING:0, PASSTHROUGH:1, WAITING:2, DISABLED:3};
    classified.sort((a,b)=>{
      if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status];
      return a.errAvg-b.errAvg;
    });
    return classified;
  }
};

// Expose globally
window.LAYER5=LAYER5;
})();
