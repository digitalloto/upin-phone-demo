// LAYER 4 — Swarm Optimizer (PATENT-PENDING — DO NOT PUSH TO PUBLIC)
// "System and method for multi-agent variant optimisation of sensor fusion
//  weights in GPS-denied positioning, using surveyed-landmark reference
//  truth as feedback signal."
//
// 50 variants per algorithm. They compete. Best survive. Self-tuning.
// REQUIRES Layer 1 (landmark reference) for truth signal.
// Delete this file → algorithms run with fixed weights again.
(function(){
'use strict';

const LAYER4={
  version:'L4.1.0',
  enabled:false, // must be explicitly enabled + Layer 1 active
  variantCount:50,
  topSurvivors:10,
  cullIntervalMs:30000, // every 30 seconds
  lastCullTime:0,
  pools:[], // [{formulaIdx, variants:[{weights, errHistory, errAvg}]}]
  targetFormulas:[], // indices of formulas to wrap

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  // Initialize swarm for specified formula indices
  init(F, formulaIndices){
    this.targetFormulas=formulaIndices;
    this.pools=[];
    formulaIndices.forEach(fi=>{
      const pool={formulaIdx:fi, variants:[]};
      for(let v=0;v<this.variantCount;v++){
        pool.variants.push({
          id:v,
          // Variant 0 = base (no perturbation). Rest = random ±5% on each weight.
          weights:{
            speedMult: v===0?1:(0.95+Math.random()*0.1),
            headingOff: v===0?0:((Math.random()-0.5)*10),
            accelScale: v===0?1:(0.95+Math.random()*0.1),
            gyroScale:  v===0?1:(0.95+Math.random()*0.1),
            compassW:   v===0?0.7:(0.5+Math.random()*0.4),
            gpsW:       v===0?0.7:(0.5+Math.random()*0.4)
          },
          errHistory:[],
          errAvg:999,
          pos:null
        });
      }
      this.pools.push(pool);
    });
    this.lastCullTime=performance.now();
    this.enabled=true;
  },

  // Run one tick: evaluate all variants against truth
  tick(F, truth, dt){
    if(!this.enabled||!truth||!truth.lat) return;

    this.pools.forEach(pool=>{
      const baseF=F[pool.formulaIdx];
      if(!baseF||!baseF.predict) return;

      pool.variants.forEach(variant=>{
        // Initialize variant position
        if(!variant.pos) variant.pos={lat:truth.lat, lon:truth.lon};

        // Apply variant weights as perturbation to base formula prediction
        const basePos={lat:variant.pos.lat, lon:variant.pos.lon};
        try{
          const pred=baseF.predict(basePos, dt*variant.weights.speedMult);
          if(!pred) return;
          // Apply heading offset
          const hOff=variant.weights.headingOff*Math.PI/180;
          const dLat=pred.lat-basePos.lat;
          const dLon=pred.lon-basePos.lon;
          const rotLat=dLat*Math.cos(hOff)-dLon*Math.sin(hOff);
          const rotLon=dLat*Math.sin(hOff)+dLon*Math.cos(hOff);
          const finalPos={
            lat:basePos.lat+rotLat*variant.weights.accelScale,
            lon:basePos.lon+rotLon*variant.weights.accelScale
          };

          // Score against truth
          const err=this._hav(finalPos, truth);
          variant.errHistory.push(err);
          if(variant.errHistory.length>30) variant.errHistory.shift();
          variant.errAvg=variant.errHistory.reduce((s,e)=>s+e,0)/variant.errHistory.length;

          // Reset variant position to truth (like base formulas)
          variant.pos={lat:truth.lat, lon:truth.lon};
        }catch(e){}
      });
    });

    // Cull every 30 seconds
    const now=performance.now();
    if(now-this.lastCullTime>this.cullIntervalMs){
      this._cull();
      this.lastCullTime=now;
    }
  },

  // Natural selection: top 10 survive, bottom 40 replaced
  _cull(){
    this.pools.forEach(pool=>{
      pool.variants.sort((a,b)=>a.errAvg-b.errAvg);
      const survivors=pool.variants.slice(0, this.topSurvivors);
      const newVariants=[];
      // Keep survivors
      survivors.forEach(s=>newVariants.push(s));
      // Generate 40 new variants near the best survivors
      for(let i=0;i<this.variantCount-this.topSurvivors;i++){
        const parent=survivors[i%survivors.length];
        newVariants.push({
          id:this.topSurvivors+i,
          weights:{
            speedMult: parent.weights.speedMult*(0.97+Math.random()*0.06),
            headingOff: parent.weights.headingOff+(Math.random()-0.5)*5,
            accelScale: parent.weights.accelScale*(0.97+Math.random()*0.06),
            gyroScale: parent.weights.gyroScale*(0.97+Math.random()*0.06),
            compassW: Math.max(0.1,Math.min(1,parent.weights.compassW+(Math.random()-0.5)*0.1)),
            gpsW: Math.max(0.1,Math.min(1,parent.weights.gpsW+(Math.random()-0.5)*0.1))
          },
          errHistory:[],
          errAvg:999,
          pos:null
        });
      }
      pool.variants=newVariants;
    });
  },

  // Get best variant for a formula
  bestVariant(formulaIdx){
    const pool=this.pools.find(p=>p.formulaIdx===formulaIdx);
    if(!pool||!pool.variants.length) return null;
    return pool.variants.reduce((best,v)=>v.errAvg<best.errAvg?v:best, pool.variants[0]);
  },

  // CSV trailer: converged weights
  csvTrailer(){
    let s='\n# SWARM OPTIMIZER — CONVERGED WEIGHTS\n';
    s+='# Swarm-Version: '+this.version+'\n';
    s+='# Variants-Per-Formula: '+this.variantCount+'\n';
    this.pools.forEach(pool=>{
      const best=pool.variants[0]; // already sorted by cull
      if(!best) return;
      s+='# Formula['+pool.formulaIdx+']: best_err='+best.errAvg.toFixed(1)+'m weights='+JSON.stringify(best.weights)+'\n';
    });
    return s;
  },

  // UI stats
  stats(){
    return this.pools.map(pool=>{
      const best=pool.variants.reduce((b,v)=>v.errAvg<b.errAvg?v:b, pool.variants[0]);
      return {
        formulaIdx:pool.formulaIdx,
        bestErr:best?best.errAvg.toFixed(1):'--',
        generation:Math.floor((performance.now()-this.lastCullTime)/this.cullIntervalMs)
      };
    });
  }
};

window.LAYER4=LAYER4;
})();
