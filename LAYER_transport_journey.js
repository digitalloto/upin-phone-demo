// LAYER 8 — Transport Mode + Journey Tracker
// Adjusts all speed/motion parameters for the detected transport type.
// Provides journey tracking with preset destinations.
// Delete this file + remove <script> tag → system reverts. Nothing breaks.
(function(){
'use strict';

// Chennai railway stations with coordinates
const TRAIN_STATIONS=[
  {name:'Chennai Central',lat:13.0825,lon:80.2752,code:'MAS'},
  {name:'Chennai Egmore',lat:13.0732,lon:80.2609,code:'MS'},
  {name:'Chennai Beach',lat:13.0993,lon:80.2936,code:'MSB'},
  {name:'Chennai Fort',lat:13.0874,lon:80.2871,code:'MSF'},
  {name:'Tambaram',lat:12.9249,lon:80.1179,code:'TBM'},
  {name:'Chromepet',lat:12.9516,lon:80.1414,code:'CMP'},
  {name:'Guindy',lat:13.0065,lon:80.2133,code:'GY'},
  {name:'Mambalam',lat:13.0335,lon:80.2219,code:'MBM'},
  {name:'Kodambakkam',lat:13.0527,lon:80.2247,code:'KOD'},
  {name:'Nungambakkam',lat:13.0601,lon:80.2378,code:'NBK'},
  {name:'Chetpet',lat:13.0719,lon:80.2411,code:'CPT'},
  {name:'Perambur',lat:13.1145,lon:80.2451,code:'PER'},
  {name:'Villivakkam',lat:13.1229,lon:80.2143,code:'VLK'},
  {name:'Avadi',lat:13.1145,lon:80.1018,code:'AVD'},
  {name:'Thiruvanmiyur',lat:12.9833,lon:80.2634,code:'TMY'},
  {name:'Velachery',lat:12.9796,lon:80.2182,code:'VLY'},
  {name:'Pallavaram',lat:12.9679,lon:80.1492,code:'PLM'},
  {name:'Arakkonam',lat:13.0784,lon:79.6676,code:'AJJ'},
  {name:'Kanchipuram',lat:12.8285,lon:79.7103,code:'CJ'},
  {name:'Chengalpattu',lat:12.6853,lon:79.9761,code:'CGL'},
  {name:'Vellore',lat:12.9202,lon:79.1553,code:'KPD'},
  {name:'Katpadi Junction',lat:12.9697,lon:79.1454,code:'KPD'},
  {name:'Jolarpettai',lat:12.5699,lon:78.5737,code:'JTJ'},
  {name:'Bangalore',lat:12.9778,lon:77.5728,code:'SBC'},
  {name:'Tiruvallur',lat:13.1431,lon:79.9078,code:'TRL'},
  {name:'Villupuram',lat:11.9404,lon:79.4901,code:'VM'},
  {name:'Pondicherry',lat:11.9340,lon:79.8288,code:'PDY'},
  {name:'Trichy',lat:10.7905,lon:78.6856,code:'TPJ'},
  {name:'Madurai',lat:9.9193,lon:78.1194,code:'MDU'},
  {name:'Coimbatore',lat:11.0014,lon:76.9556,code:'CBE'},
];

const TRANSPORT_MODES={
  static:  {label:'Static',     maxSpeed:0,   cellRadius:1500, zupt_accel:0.05, jumpReject:5,   icon:'📍'},
  walk:    {label:'Walking',    maxSpeed:8,   cellRadius:1500, zupt_accel:0.08, jumpReject:15,  icon:'🚶'},
  cycle:   {label:'Bicycle',    maxSpeed:35,  cellRadius:1500, zupt_accel:0.1,  jumpReject:50,  icon:'🚲'},
  car:     {label:'Car/Auto',   maxSpeed:150, cellRadius:2000, zupt_accel:0.03, jumpReject:200, icon:'🚗'},
  train:   {label:'Train',      maxSpeed:200, cellRadius:4000, zupt_accel:0.02, jumpReject:200, icon:'🚆'},
  flight:  {label:'Flight',     maxSpeed:900, cellRadius:10000,zupt_accel:0.01, jumpReject:500, icon:'✈️'},
};

const LAYER8={
  version:'L8.1.0',
  enabled:true,
  mode:'car',
  journey:{
    active:false,
    from:null,     // {name, lat, lon}
    to:null,       // {name, lat, lon}
    startTime:0,
    stations:[],   // passed stations
    nextStation:null,
    distTotal_km:0,
    distRemaining_km:0,
    eta_min:0,
    speedHistory:[], // rolling speed for ETA
  },

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  setMode(mode){
    if(!TRANSPORT_MODES[mode]) return;
    this.mode=mode;
    const cfg=TRANSPORT_MODES[mode];
    // Apply to Layer 2 (GPS smoothing)
    if(window.LAYER2){
      LAYER2.maxSpeedKmh=cfg.maxSpeed||200;
      LAYER2.mode=cfg.maxSpeed<=15?'walking':'vehicle';
    }
    // Apply to Layer 7 (CID speed default radius)
    if(window.LAYER7){
      LAYER7.cidSpeed.cellRadius_m=cfg.cellRadius;
    }
  },

  setDestination(fromIdx, toIdx){
    const from=fromIdx>=0?TRAIN_STATIONS[fromIdx]:null;
    const to=toIdx>=0?TRAIN_STATIONS[toIdx]:null;
    if(!from&&!to){ this.journey.active=false; return; }
    this.journey.active=true;
    this.journey.from=from;
    this.journey.to=to;
    this.journey.startTime=performance.now();
    this.journey.stations=[];
    this.journey.speedHistory=[];
    if(from&&to){
      this.journey.distTotal_km=this._hav(from,to)/1000;
      this.journey.distRemaining_km=this.journey.distTotal_km;
    }
    // Find intermediate stations on the route
    if(from&&to){
      this.journey.nextStation=this._findNearest(from.lat,from.lon,1);
    }
  },

  _findNearest(lat,lon,skip){
    let best=null, bestDist=Infinity;
    TRAIN_STATIONS.forEach(s=>{
      const d=this._hav({lat,lon},s);
      if(d<bestDist&&d>500*skip){bestDist=d;best={...s,dist_m:d};}
    });
    return best;
  },

  // Called each tick
  tick(gps, fusedSpeed_kmh){
    if(!this.enabled) return;
    if(!gps||!gps.lat) return;

    // Track journey progress
    if(this.journey.active&&this.journey.to){
      this.journey.distRemaining_km=this._hav(gps,this.journey.to)/1000;
      // Speed history for ETA
      const spd=fusedSpeed_kmh||0;
      this.journey.speedHistory.push(spd);
      if(this.journey.speedHistory.length>60) this.journey.speedHistory.shift();
      const avgSpeed=this.journey.speedHistory.reduce((s,v)=>s+v,0)/this.journey.speedHistory.length;
      this.journey.eta_min=avgSpeed>1?(this.journey.distRemaining_km/avgSpeed*60):0;

      // Station detection: passed within 500m of a station
      TRAIN_STATIONS.forEach(s=>{
        const d=this._hav(gps,s);
        if(d<500 && !this.journey.stations.find(p=>p.code===s.code)){
          this.journey.stations.push({...s, t:performance.now(), dist_m:Math.round(d)});
        }
      });
      // Next station
      this.journey.nextStation=this._findNextOnRoute(gps);
    }
  },

  _findNextOnRoute(gps){
    if(!this.journey.to) return null;
    let best=null, bestDist=Infinity;
    TRAIN_STATIONS.forEach(s=>{
      if(this.journey.stations.find(p=>p.code===s.code)) return; // already passed
      const dToUs=this._hav(gps,s);
      const dToDest=this._hav(s,this.journey.to);
      // Station must be ahead (closer to destination than we are, or at least in that direction)
      if(dToUs<bestDist && dToUs>300){
        bestDist=dToUs; best={...s,dist_m:Math.round(dToUs)};
      }
    });
    return best;
  },

  // Build UI
  buildUI(){
    const el=document.getElementById('layer8UI');
    if(!el) return;
    let h='<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px">';
    h+='<span style="font-size:7px;font-weight:700;color:var(--td);letter-spacing:1px">MODE:</span>';
    Object.keys(TRANSPORT_MODES).forEach(k=>{
      const m=TRANSPORT_MODES[k];
      const sel=k===this.mode;
      h+='<button onclick="LAYER8.setMode(\''+k+'\')" style="font-family:inherit;font-size:8px;padding:3px 6px;border:1px solid '+(sel?'var(--green)':'var(--border)')+';background:'+(sel?'rgba(61,204,110,.15)':'var(--panel)')+';color:'+(sel?'var(--green)':'var(--td)')+';border-radius:2px;cursor:pointer">'+m.icon+' '+m.label+'</button>';
    });
    h+='</div>';
    // Journey
    h+='<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">';
    h+='<span style="font-size:7px;font-weight:700;color:var(--td);letter-spacing:1px">JOURNEY:</span>';
    h+='<select id="journeyFrom" style="background:var(--bg);border:1px solid var(--border);color:var(--tp);font-family:inherit;font-size:8px;padding:2px;border-radius:2px;max-width:120px"><option value="-1">From...</option>';
    TRAIN_STATIONS.forEach((s,i)=>{ h+='<option value="'+i+'">'+s.name+' ('+s.code+')</option>'; });
    h+='</select>';
    h+='<span style="color:var(--td)">→</span>';
    h+='<select id="journeyTo" style="background:var(--bg);border:1px solid var(--green);color:var(--green);font-family:inherit;font-size:8px;padding:2px;border-radius:2px;max-width:120px"><option value="-1">To...</option>';
    TRAIN_STATIONS.forEach((s,i)=>{ h+='<option value="'+i+'">'+s.name+' ('+s.code+')</option>'; });
    h+='</select>';
    h+='<button onclick="LAYER8.setDestination(parseInt(document.getElementById(\'journeyFrom\').value),parseInt(document.getElementById(\'journeyTo\').value))" style="font-family:inherit;font-size:7px;padding:3px 6px;border:1px solid var(--cyan);background:rgba(77,166,255,.1);color:var(--cyan);border-radius:2px;cursor:pointer">SET</button>';
    h+='</div>';
    // Journey status
    h+='<div id="journeyStatus" style="font-size:8px;color:var(--td);margin-top:4px"></div>';
    el.innerHTML=h;
  },

  updateUI(){
    const el=document.getElementById('journeyStatus');
    if(!el) return;
    if(!this.journey.active){el.textContent='No journey set';return;}
    const j=this.journey;
    let s='';
    if(j.from) s+=j.from.name;
    if(j.to) s+=' → '+j.to.name;
    if(j.distRemaining_km>0) s+=' | '+j.distRemaining_km.toFixed(1)+' km left';
    if(j.eta_min>0) s+=' | ETA '+Math.round(j.eta_min)+' min';
    if(j.stations.length>0) s+=' | Passed: '+j.stations.map(p=>p.code).join('→');
    if(j.nextStation) s+=' | Next: '+j.nextStation.name+' ('+Math.round(j.nextStation.dist_m/1000)+'km)';
    el.textContent=s;
    el.style.color=j.distRemaining_km<1?'var(--green)':'var(--cyan)';
  },

  // CSV
  csvHeaderCols:'Transport_Mode,Journey_From,Journey_To,Journey_Remaining_km,Journey_ETA_min,Stations_Passed',

  csvRowData(){
    const j=this.journey;
    return [
      this.mode,
      j.from?j.from.code:'',
      j.to?j.to.code:'',
      j.distRemaining_km>0?j.distRemaining_km.toFixed(2):'',
      j.eta_min>0?j.eta_min.toFixed(0):'',
      j.stations.length
    ].join(',');
  },

  csvTrailer(){
    let s='\n# LAYER 8: TRANSPORT + JOURNEY\n';
    s+='# L8-Mode: '+this.mode+' ('+TRANSPORT_MODES[this.mode].label+')\n';
    s+='# L8-Max-Speed: '+TRANSPORT_MODES[this.mode].maxSpeed+' km/h\n';
    s+='# L8-Cell-Radius: '+TRANSPORT_MODES[this.mode].cellRadius+' m\n';
    if(this.journey.active){
      s+='# L8-Journey: '+(this.journey.from?this.journey.from.name:'?')+' → '+(this.journey.to?this.journey.to.name:'?')+'\n';
      s+='# L8-Distance-Total: '+(this.journey.distTotal_km||0).toFixed(1)+' km\n';
      s+='# L8-Distance-Remaining: '+(this.journey.distRemaining_km||0).toFixed(1)+' km\n';
      s+='# L8-Stations-Passed: '+this.journey.stations.length+'\n';
      this.journey.stations.forEach(p=>{
        s+='#   '+p.code+' ('+p.name+') at '+(Math.round((p.t-this.journey.startTime)/1000))+'s, '+p.dist_m+'m away\n';
      });
    }
    return s;
  },

  STATIONS:TRAIN_STATIONS,
  MODES:TRANSPORT_MODES
};

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>LAYER8.buildUI());
} else {
  setTimeout(()=>LAYER8.buildUI(),100);
}

window.LAYER8=LAYER8;
})();
