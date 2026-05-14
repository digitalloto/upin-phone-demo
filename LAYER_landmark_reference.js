// LAYER 1 — Landmark Reference (Truth Layer)
// Provides surveyed landmark positions as "ground truth" for error calculation.
// When active, all formula errors are computed against the landmark position, NOT phone GPS.
// Delete this file + remove its <script> tag → system reverts to phone-GPS-only truth.
(function(){
'use strict';

const LAYER1={
  version:'L1.1.0',
  enabled:false,
  landmarks:[], // merged list: CSV + LANDMARKS array
  selectedIdx:-1,

  // Merge landmarks from CSV data and the Google Places LANDMARKS array
  init(){
    const merged=[];
    // 1. Google Places landmarks (from landmarks-data.js)
    if(typeof LANDMARKS!=='undefined'){
      LANDMARKS.forEach(lm=>{
        merged.push({
          id:lm.id, name:lm.n, lat:lm.lat, lon:lm.lon,
          direction:lm.d, type:lm.t, density:lm.z,
          uncertainty_m:10, source:'google_places'
        });
      });
    }
    // 2. CSV landmarks (loaded inline below)
    LAYER1_CSV.forEach(lm=>{
      // Deduplicate: skip if a Google landmark is within 100m
      const dup=merged.find(m=>this._hav(m,lm)<100);
      if(!dup){
        merged.push({
          id:lm.landmark_id, name:lm.name, lat:lm.lat, lon:lm.lon,
          direction:lm.direction, type:lm.landmark_type, density:lm.density_zone,
          uncertainty_m:parseFloat(lm.uncertainty_m)||5, source:'csv_surveyed'
        });
      }
    });
    this.landmarks=merged;
    this._buildUI();
  },

  _hav(a,b){
    const R=6371000,dLa=(b.lat-a.lat)*Math.PI/180,dLo=(b.lon-a.lon)*Math.PI/180;
    const x=Math.sin(dLa/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  },

  _buildUI(){
    const container=document.getElementById('layer1RefMode');
    if(!container) return;
    // Mode selector
    let h='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
    h+='<span style="font-size:7px;font-weight:700;color:var(--td);letter-spacing:1px">REF MODE:</span>';
    h+='<select id="refModeSelect" onchange="LAYER1.setMode(this.value)" style="background:var(--bg);border:1px solid var(--border);color:var(--tp);font-family:inherit;font-size:9px;padding:3px;border-radius:2px">';
    h+='<option value="gps">Phone GPS</option>';
    h+='<option value="landmark">Surveyed Landmark</option>';
    h+='</select>';
    h+='<select id="landmarkSelect" onchange="LAYER1.selectLandmark(this.value)" style="display:none;background:var(--bg);border:1px solid var(--green);color:var(--green);font-family:inherit;font-size:8px;padding:3px;border-radius:2px;max-width:200px">';
    h+='<option value="-1">-- Choose landmark --</option>';
    // Group by direction
    const dirs=['Centre','N','NE','E','SE','S','SW','W','NW'];
    dirs.forEach(dir=>{
      const inDir=this.landmarks.filter(l=>l.direction===dir);
      if(inDir.length){
        h+='<optgroup label="'+dir+'">';
        inDir.forEach((lm,i)=>{
          const globalIdx=this.landmarks.indexOf(lm);
          h+='<option value="'+globalIdx+'">'+lm.name+' ('+dir+')</option>';
        });
        h+='</optgroup>';
      }
    });
    h+='</select>';
    h+='<span id="refStatus" style="font-size:7px;color:var(--td)"></span>';
    h+='</div>';
    container.innerHTML=h;
  },

  setMode(mode){
    const lmSelect=document.getElementById('landmarkSelect');
    if(mode==='landmark'){
      if(lmSelect) lmSelect.style.display='inline-block';
      if(this.selectedIdx>=0) this._activate(this.selectedIdx);
    } else {
      if(lmSelect) lmSelect.style.display='none';
      this.enabled=false;
      this.selectedIdx=-1;
      if(typeof LANDMARK_REF!=='undefined'){
        LANDMARK_REF.active=false;
      }
      const st=document.getElementById('refStatus');
      if(st) st.textContent='Using phone GPS as truth';
      if(st) st.style.color='var(--td)';
    }
  },

  selectLandmark(idx){
    idx=parseInt(idx);
    if(idx<0||idx>=this.landmarks.length){
      this.enabled=false;
      if(typeof LANDMARK_REF!=='undefined') LANDMARK_REF.active=false;
      return;
    }
    this._activate(idx);
  },

  _activate(idx){
    const lm=this.landmarks[idx];
    if(!lm) return;
    this.selectedIdx=idx;
    this.enabled=true;
    // Set the global LANDMARK_REF that scoreFormulas will read
    if(typeof LANDMARK_REF!=='undefined'){
      LANDMARK_REF.active=true;
      LANDMARK_REF.lat=lm.lat;
      LANDMARK_REF.lon=lm.lon;
      LANDMARK_REF.name=lm.name;
      LANDMARK_REF.id=lm.id;
    }
    const st=document.getElementById('refStatus');
    if(st){
      st.textContent='REF: '+lm.name+' ('+lm.lat.toFixed(5)+', '+lm.lon.toFixed(5)+') ±'+lm.uncertainty_m+'m';
      st.style.color='var(--green)';
    }
  },

  // Returns the truth position to use for error scoring
  getTruth(phoneGps){
    if(this.enabled && this.selectedIdx>=0){
      const lm=this.landmarks[this.selectedIdx];
      return {lat:lm.lat, lon:lm.lon, acc:lm.uncertainty_m, source:'landmark'};
    }
    return phoneGps;
  },

  // CSV metadata line for the reference mode
  csvHeader(){
    if(this.enabled && this.selectedIdx>=0){
      const lm=this.landmarks[this.selectedIdx];
      return '# Test-Mode: surveyed-landmark\n# Ref-Lat: '+lm.lat+'\n# Ref-Lon: '+lm.lon+'\n# Ref-Name: '+lm.name+'\n# Ref-ID: '+lm.id+'\n';
    }
    return '# Test-Mode: phone-gps\n';
  }
};

// CSV landmark data (parsed from data/chennai_landmarks.csv)
const LAYER1_CSV=[
{"landmark_id":"CHN_C_01","name":"Chennai Central Railway Station","lat":13.0825,"lon":80.2752,"direction":"Centre","landmark_type":"transport","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_C_02","name":"Egmore Railway Station","lat":13.0732,"lon":80.2609,"direction":"Centre","landmark_type":"transport","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_C_03","name":"Government Museum Chennai","lat":13.0696,"lon":80.2549,"direction":"Centre","landmark_type":"government","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_N_01","name":"Anna Nagar Tower","lat":13.085,"lon":80.2098,"direction":"N","landmark_type":"landmark","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_N_02","name":"Koyambedu Bus Terminal","lat":13.0694,"lon":80.196,"direction":"N","landmark_type":"transport","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_N_03","name":"Ambattur Industrial Estate Gate","lat":13.1145,"lon":80.1564,"direction":"N","landmark_type":"junction","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_N_04","name":"Madhavaram Junction","lat":13.1486,"lon":80.2318,"direction":"N","landmark_type":"junction","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_N_05","name":"Tiruvottiyur Temple","lat":13.159,"lon":80.3004,"direction":"N","landmark_type":"temple","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_NE_01","name":"Royapuram Railway Station","lat":13.1096,"lon":80.294,"direction":"NE","landmark_type":"transport","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_NE_02","name":"Tondiarpet Market Junction","lat":13.1175,"lon":80.2851,"direction":"NE","landmark_type":"junction","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_NE_03","name":"Washermanpet Metro Station","lat":13.1122,"lon":80.2811,"direction":"NE","landmark_type":"metro_station","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_NE_04","name":"Ennore Port Gate","lat":13.212,"lon":80.3205,"direction":"NE","landmark_type":"landmark","density_zone":"open_sky","uncertainty_m":10},
{"landmark_id":"CHN_E_01","name":"Marina Beach Lighthouse","lat":13.0395,"lon":80.2796,"direction":"E","landmark_type":"landmark","density_zone":"open_sky","uncertainty_m":5},
{"landmark_id":"CHN_E_02","name":"Kapaleeshwarar Temple (Mylapore)","lat":13.0336,"lon":80.2694,"direction":"E","landmark_type":"temple","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_E_03","name":"San Thome Cathedral","lat":13.0335,"lon":80.2779,"direction":"E","landmark_type":"religious","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_E_04","name":"Triplicane Big Mosque","lat":13.0585,"lon":80.2728,"direction":"E","landmark_type":"religious","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_E_05","name":"George Town (High Court)","lat":13.0874,"lon":80.2871,"direction":"E","landmark_type":"government","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_SE_01","name":"Besant Nagar Beach","lat":13.0002,"lon":80.2711,"direction":"SE","landmark_type":"landmark","density_zone":"open_sky","uncertainty_m":5},
{"landmark_id":"CHN_SE_02","name":"Thiruvanmiyur MRTS Station","lat":12.9833,"lon":80.2634,"direction":"SE","landmark_type":"transport","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_SE_03","name":"VGP Universal Kingdom Gate","lat":12.9735,"lon":80.2572,"direction":"SE","landmark_type":"landmark","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_SE_04","name":"Tidel Park (IT Corridor)","lat":12.9881,"lon":80.2461,"direction":"SE","landmark_type":"landmark","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_S_01","name":"Adyar Eco Park","lat":13.006,"lon":80.2568,"direction":"S","landmark_type":"park","density_zone":"open_sky","uncertainty_m":5},
{"landmark_id":"CHN_S_02","name":"Velachery MRTS Station","lat":12.9796,"lon":80.2182,"direction":"S","landmark_type":"transport","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_S_03","name":"Phoenix Marketcity Mall","lat":12.9917,"lon":80.2181,"direction":"S","landmark_type":"landmark","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_S_04","name":"Tambaram Railway Station","lat":12.9249,"lon":80.1179,"direction":"S","landmark_type":"transport","density_zone":"suburban","uncertainty_m":10},
{"landmark_id":"CHN_S_05","name":"Pallikaranai Marshland","lat":12.938,"lon":80.2087,"direction":"S","landmark_type":"park","density_zone":"open_sky","uncertainty_m":10},
{"landmark_id":"CHN_SW_01","name":"Guindy National Park","lat":13.004,"lon":80.2315,"direction":"SW","landmark_type":"park","density_zone":"open_sky","uncertainty_m":5},
{"landmark_id":"CHN_SW_02","name":"Chennai Airport (Domestic)","lat":12.9941,"lon":80.1709,"direction":"SW","landmark_type":"transport","density_zone":"open_sky","uncertainty_m":10},
{"landmark_id":"CHN_SW_03","name":"Chrompet Bus Depot","lat":12.9516,"lon":80.1414,"direction":"SW","landmark_type":"transport","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_SW_04","name":"Pallavaram Junction","lat":12.9679,"lon":80.1492,"direction":"SW","landmark_type":"junction","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_W_01","name":"T Nagar Pondy Bazaar","lat":13.0427,"lon":80.2354,"direction":"W","landmark_type":"junction","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_W_02","name":"Vadapalani Murugan Temple","lat":13.052,"lon":80.2122,"direction":"W","landmark_type":"temple","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_W_03","name":"Valasaravakkam Junction","lat":13.0467,"lon":80.1717,"direction":"W","landmark_type":"junction","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_W_04","name":"Porur Junction","lat":13.0365,"lon":80.1562,"direction":"W","landmark_type":"junction","density_zone":"suburban","uncertainty_m":5},
{"landmark_id":"CHN_W_05","name":"CMBT Metro Station","lat":13.0689,"lon":80.1994,"direction":"W","landmark_type":"metro_station","density_zone":"dense_urban","uncertainty_m":5},
{"landmark_id":"CHN_NW_01","name":"Anna Nagar West Roundtana","lat":13.093,"lon":80.203,"direction":"NW","landmark_type":"junction","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_NW_02","name":"Padi Junction Flyover","lat":13.1088,"lon":80.2035,"direction":"NW","landmark_type":"junction","density_zone":"urban","uncertainty_m":5},
{"landmark_id":"CHN_NW_04","name":"Mogappair Eri (Lake Park)","lat":13.0927,"lon":80.1779,"direction":"NW","landmark_type":"park","density_zone":"open_sky","uncertainty_m":5},
{"landmark_id":"CHN_NW_05","name":"Thirumangalam Junction","lat":13.0866,"lon":80.2253,"direction":"NW","landmark_type":"junction","density_zone":"dense_urban","uncertainty_m":5}
];

// Auto-init when DOM is ready
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>LAYER1.init());
} else {
  // Script loaded after DOMContentLoaded (deferred), init on next tick
  setTimeout(()=>LAYER1.init(),0);
}

window.LAYER1=LAYER1;
})();
