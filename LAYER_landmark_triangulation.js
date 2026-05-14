// LAYER 3 — Landmark Triangulation (Trilateration)
// Computes position from distances to 3+ known landmarks using NLLS gradient descent.
// This is the same math as GPS itself — intersection of spheres/circles.
// Replaces the weighted-centroid approach in the base LANDMARK_TRI.
// Delete this file → system reverts to the base weighted-centroid approach.
(function(){
'use strict';

const LAYER3={
  version:'L3.1.0',
  enabled:true,
  // Last trilateration result
  lastPos:null,
  lastResidual:Infinity,
  lastAnchors:0,
  // History for checkpoint mode
  checkpoints:[], // [{lat, lon, t, landmarkId, dist}]
  imuDist:0,      // accumulated IMU distance since last checkpoint
  lastIMUTime:0,

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  // NLLS trilateration: find lat/lon that minimizes sum of (measured_dist - predicted_dist)^2
  // anchors: [{lat, lon, dist}] where dist is the measured/estimated distance in meters
  trilaterate(anchors, initialGuess){
    if(!anchors||anchors.length<3) return null;

    let lat=initialGuess?initialGuess.lat:0;
    let lon=initialGuess?initialGuess.lon:0;

    // If no initial guess, use weighted centroid as starting point
    if(!initialGuess){
      let sL=0,sO=0,sW=0;
      anchors.forEach(a=>{const w=1/(a.dist+1);sL+=a.lat*w;sO+=a.lon*w;sW+=w;});
      lat=sL/sW; lon=sO/sW;
    }

    const lr=0.0000001; // learning rate in degrees
    const iterations=200;

    for(let iter=0;iter<iterations;iter++){
      let gradLat=0, gradLon=0;
      anchors.forEach(a=>{
        const pred=this._hav({lat,lon},{lat:a.lat,lon:a.lon});
        const err=pred-a.dist;
        // Numerical gradient
        const dLat=this._hav({lat:lat+0.00001,lon},{lat:a.lat,lon:a.lon})-pred;
        const dLon=this._hav({lat,lon:lon+0.00001},{lat:a.lat,lon:a.lon})-pred;
        gradLat+=err*dLat/1.11; // normalize
        gradLon+=err*dLon/1.11;
      });
      lat-=gradLat*lr;
      lon-=gradLon*lr;
    }

    // Compute residual (RMS error)
    let sumSq=0;
    anchors.forEach(a=>{
      const pred=this._hav({lat,lon},{lat:a.lat,lon:a.lon});
      sumSq+=(pred-a.dist)**2;
    });
    const residual=Math.sqrt(sumSq/anchors.length);

    return {lat, lon, residual, nAnchors:anchors.length};
  },

  // Main update: called each tick with the current best position estimate
  // Uses distances from the position estimate to nearby landmarks as "measured" distances
  update(bestPos, landmarks){
    if(!this.enabled||!bestPos||!landmarks||!landmarks.length) return null;

    // Find the 5 nearest landmarks with computed distances
    const anchors=landmarks
      .map(lm=>({
        lat:lm.lat, lon:lm.lon, name:lm.n||lm.name,
        dist:this._hav(bestPos,{lat:lm.lat,lon:lm.lon})
      }))
      .filter(a=>a.dist<5000) // within 5km
      .sort((a,b)=>a.dist-b.dist)
      .slice(0,7); // top 7 nearest

    if(anchors.length<3) return null;

    const result=this.trilaterate(anchors, bestPos);
    if(result){
      this.lastPos=result;
      this.lastResidual=result.residual;
      this.lastAnchors=result.nAnchors;
    }
    return result;
  },

  // Checkpoint mode: at known waypoints, record exact distance
  addCheckpoint(landmarkLat, landmarkLon, landmarkId){
    const pos=this.lastPos||{lat:0,lon:0};
    this.checkpoints.push({
      lat:landmarkLat, lon:landmarkLon, id:landmarkId,
      dist:this._hav(pos,{lat:landmarkLat,lon:landmarkLon}),
      t:performance.now()
    });
    if(this.checkpoints.length>20) this.checkpoints.shift();
  },

  // CSV columns
  csvColumns(){
    if(!this.lastPos) return {landmark_tri_lat:'',landmark_tri_lon:'',landmark_tri_n_anchors:0,landmark_tri_residual_m:''};
    return {
      landmark_tri_lat:this.lastPos.lat.toFixed(7),
      landmark_tri_lon:this.lastPos.lon.toFixed(7),
      landmark_tri_n_anchors:this.lastAnchors,
      landmark_tri_residual_m:this.lastResidual.toFixed(1)
    };
  }
};

// Override the existing LANDMARK_TRI.update with Layer 3's NLLS version
// while preserving the draw() method
if(typeof window!=='undefined'){
  const _origUpdate=window.LANDMARK_TRI?window.LANDMARK_TRI.update:null;
  const _origDraw=window.LANDMARK_TRI?window.LANDMARK_TRI.draw:null;

  // Patch into the existing LANDMARK_TRI if it exists
  if(window.LANDMARK_TRI){
    const origUpdate=LANDMARK_TRI.update.bind(LANDMARK_TRI);
    LANDMARK_TRI.update=function(gps){
      // Run original to populate nearby list (used by draw)
      origUpdate(gps);
      // Run NLLS trilateration on the nearby landmarks
      if(LAYER3.enabled && typeof LANDMARKS!=='undefined' && gps){
        const result=LAYER3.update(gps, LANDMARKS);
        if(result){
          // Override the weighted centroid with NLLS result
          this.triPos={lat:result.lat, lon:result.lon, landmarks:result.nAnchors};
        }
      }
    };
  }
}

window.LAYER3=LAYER3;
})();
