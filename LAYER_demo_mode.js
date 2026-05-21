// LAYER 9 — Demo Mode: Automated GPS denial/restore cycles for testing
// Runs a scripted sequence: GPS ON → JAM → RESTORE → JAM (longer) → RESTORE...
// Each cycle teaches the system and logs performance for analysis.
// Delete this file + remove <script> tag → system reverts. Nothing breaks.
(function(){
'use strict';

const LAYER9={
  version:'L9.2.0',
  enabled:false,
  running:false,
  sequence:[
    ['GPS',120],['JAM',30],['GPS',30],['JAM',60],['GPS',30],
    ['JAM',120],['GPS',30],['JAM',180],['GPS',30],['JAM',300],['GPS',60],
  ],
  currentStep:0,
  stepStart:0,
  totalStart:0,
  log:[],
  _interval:null,

  start(){
    if(this.running) return;
    this.running=true;
    this.currentStep=0;
    this.totalStart=performance.now();
    this.log=[];
    this._startStep();
    this._interval=setInterval(()=>this._tick(),1000);
    if(window.V&&window.V.calibrate)window.V.calibrate();
  },

  stop(){
    this.running=false;
    if(this._interval){clearInterval(this._interval);this._interval=null;}
    const ph=this._getPhase();
    if(ph==='jammed'||ph==='spoofed'){
      if(window.V&&V.resurface)V.resurface();
    }
  },

  _startStep(){
    if(this.currentStep>=this.sequence.length){
      this._finish();
      return;
    }
    const [mode, dur]=this.sequence[this.currentStep];
    this.stepStart=performance.now();
    const pos=this._getPos();
    this.log.push({
      step:this.currentStep, phase:mode, duration:dur,
      startLat:pos?pos.lat:0, startLon:pos?pos.lon:0,
      endLat:0, endLon:0, drift_m:0, bestFormula:'', bestErr:0
    });
    if(mode==='JAM'){
      if(window.V&&V.jam)V.jam();
    } else if(mode==='GPS'){
      const ph=this._getPhase();
      if(ph==='jammed'||ph==='spoofed'){
        if(window.V&&V.resurface)V.resurface();
      }
    }
    this._updateUI();
  },

  _tick(){
    if(!this.running)return;
    const [mode, dur]=this.sequence[this.currentStep];
    const elapsed=(performance.now()-this.stepStart)/1000;
    this._updateUI();
    if(elapsed>=dur){
      const entry=this.log[this.log.length-1];
      const pos=this._getPos();
      if(pos){entry.endLat=pos.lat;entry.endLon=pos.lon;}
      if(entry.startLat&&entry.endLat){
        entry.drift_m=this._hav({lat:entry.startLat,lon:entry.startLon},{lat:entry.endLat,lon:entry.endLon});
      }
      const best=this._getBest();
      if(best){
        entry.bestFormula=best.name;
        entry.bestErr=best.errAvg;
      }
      this.currentStep++;
      this._startStep();
    }
  },

  _finish(){
    this.running=false;
    if(this._interval){clearInterval(this._interval);this._interval=null;}
    const ph=this._getPhase();
    if(ph==='jammed'||ph==='spoofed'){
      if(window.V&&V.resurface)V.resurface();
    }
    this._updateUI();
  },

  _getPos(){
    if(window._upin)return window._upin.getPos();
    return null;
  },

  _getPhase(){
    if(window._upin)return window._upin.getPhase();
    return 'idle';
  },

  _getBest(){
    if(window._upin)return window._upin.getBest();
    return null;
  },

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  _updateUI(){
    const el=document.getElementById('layer9UI');
    if(!el)return;
    if(!this.running){
      if(this.log.length>0){
        let h='<div style="font-size:8px;color:var(--green)">DEMO COMPLETE — '+this.log.length+' steps</div>';
        h+='<table style="width:100%;font-size:7px;border-collapse:collapse">';
        h+='<tr style="color:var(--td)"><th>Step</th><th>Phase</th><th>Dur</th><th>Drift</th><th>Best</th></tr>';
        this.log.forEach(l=>{
          const col=l.phase==='JAM'?'var(--red)':'var(--green)';
          h+='<tr style="color:'+col+'"><td>'+l.step+'</td><td>'+l.phase+'</td><td>'+l.duration+'s</td><td>'+l.drift_m.toFixed(0)+'m</td><td>'+l.bestFormula+'</td></tr>';
        });
        h+='</table>';
        el.innerHTML=h;
      } else {
        el.innerHTML='<button onclick="LAYER9.start()" style="font-family:inherit;font-size:9px;padding:6px 12px;border:2px solid var(--amber);background:rgba(232,168,50,.1);color:var(--amber);border-radius:3px;cursor:pointer;width:100%">START DEMO MODE (15 min cycle)</button>';
      }
      return;
    }
    const [mode, dur]=this.sequence[this.currentStep];
    const elapsed=Math.round((performance.now()-this.stepStart)/1000);
    const totalElapsed=Math.round((performance.now()-this.totalStart)/1000);
    const remaining=dur-elapsed;
    const totalSteps=this.sequence.length;
    let h='<div style="display:flex;justify-content:space-between;align-items:center">';
    h+='<span style="font-size:9px;font-weight:900;color:'+(mode==='JAM'?'var(--red)':'var(--green)')+'">';
    h+=(mode==='JAM'?'GPS DENIED':'GPS ACTIVE')+' — '+remaining+'s left</span>';
    h+='<span style="font-size:7px;color:var(--td)">Step '+(this.currentStep+1)+'/'+totalSteps+' | '+Math.floor(totalElapsed/60)+':'+String(totalElapsed%60).padStart(2,'0')+'</span>';
    h+='</div>';
    h+='<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;overflow:hidden">';
    h+='<div style="height:100%;width:'+Math.round(elapsed/dur*100)+'%;background:'+(mode==='JAM'?'var(--red)':'var(--green)')+';border-radius:2px"></div>';
    h+='</div>';
    if(this.log.length>1){
      const jamLogs=this.log.filter(l=>l.phase==='JAM'&&l.drift_m>0);
      if(jamLogs.length>0){
        const avgDrift=jamLogs.reduce((s,l)=>s+l.drift_m,0)/jamLogs.length;
        h+='<div style="font-size:7px;color:var(--td);margin-top:2px">Avg denial drift: '+avgDrift.toFixed(0)+'m across '+jamLogs.length+' jams</div>';
      }
    }
    h+='<button onclick="LAYER9.stop()" style="font-family:inherit;font-size:7px;padding:3px 8px;border:1px solid var(--red);background:none;color:var(--red);border-radius:2px;cursor:pointer;margin-top:4px">STOP DEMO</button>';
    el.innerHTML=h;
  },

  csvTrailer(){
    if(this.log.length===0)return '';
    let s='\n# LAYER 9: DEMO MODE RESULTS\n';
    s+='# Demo-Steps: '+this.log.length+'\n';
    this.log.forEach(l=>{
      s+='# Step'+l.step+': '+l.phase+' '+l.duration+'s drift='+l.drift_m.toFixed(0)+'m best='+l.bestFormula+' err='+l.bestErr.toFixed(1)+'m\n';
    });
    const jamLogs=this.log.filter(l=>l.phase==='JAM'&&l.drift_m>0);
    if(jamLogs.length>0){
      s+='# Avg-JAM-Drift: '+(jamLogs.reduce((s,l)=>s+l.drift_m,0)/jamLogs.length).toFixed(0)+'m\n';
      s+='# Max-JAM-Drift: '+Math.max(...jamLogs.map(l=>l.drift_m)).toFixed(0)+'m\n';
    }
    return s;
  }
};

window.LAYER9=LAYER9;
})();
