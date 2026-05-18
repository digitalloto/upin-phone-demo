const CACHE='upin-v5b-v3';
const FILES=[
  '/upin-phone-demo/index-v5b.html',
  '/upin-phone-demo/index-v5.html',
  '/upin-phone-demo/upin_offline.html',
  '/upin-phone-demo/upin_ble_test.html',
  '/upin-phone-demo/towers-data.js',
  '/upin-phone-demo/landmarks-data.js',
  '/upin-phone-demo/LAYER_passthrough_demotion.js',
  '/upin-phone-demo/LAYER_landmark_reference.js',
  '/upin-phone-demo/LAYER_gps_smoothing.js',
  '/upin-phone-demo/LAYER_landmark_triangulation.js',
  '/upin-phone-demo/LAYER_bounded_math.js',
  '/upin-phone-demo/LAYER_swarm_optimizer.js',
  '/upin-phone-demo/LAYER_motion_detect.js',
  '/upin-phone-demo/LAYER_transport_journey.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    if(resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}
    return resp;
  }).catch(()=>new Response('Offline — cache miss',{status:503}))));
});
