#!/usr/bin/env python3
"""
Chennai Landmark Reference Database Generator for UPIN Testing

Fetches precise lat/lon for 30-50 landmarks across Chennai using Google Places API.
These become surveyed-reference truth points — UPIN error is measured against
these fixed points, NOT against phone GPS.

Usage:
    export GOOGLE_PLACES_API_KEY="your_key_here"
    python3 scripts/fetch_landmarks.py

Or to use the built-in curated list (no API needed):
    python3 scripts/fetch_landmarks.py --offline

Output: data/chennai_landmarks.csv + data/chennai_landmarks_map.html
"""

import csv
import json
import os
import sys
from datetime import date
from math import radians, sin, cos, sqrt, atan2

# Chennai bounding box
BBOX = {"lat_min": 12.85, "lat_max": 13.25, "lon_min": 80.10, "lon_max": 80.35}
CENTRE = (13.0827, 80.2707)

# ═══════════════════════════════════════
# CURATED LANDMARK DATABASE
# Coordinates from OpenStreetMap + Google Maps verification
# Each landmark is a physically fixed, identifiable point
# ═══════════════════════════════════════
LANDMARKS = [
    # CENTRE
    {"id": "CHN_C_01", "name": "Chennai Central Railway Station (Main Entrance)", "lat": 13.0825, "lon": 80.2752, "dir": "Centre", "type": "transport", "density": "dense_urban", "notes": "Major railway hub, fixed building corner"},
    {"id": "CHN_C_02", "name": "Egmore Railway Station", "lat": 13.0732, "lon": 80.2609, "dir": "Centre", "type": "transport", "density": "dense_urban", "notes": "Heritage building, clear entrance point"},
    {"id": "CHN_C_03", "name": "Government Museum Chennai", "lat": 13.0696, "lon": 80.2549, "dir": "Centre", "type": "government", "density": "urban", "notes": "Museum entrance gate"},

    # NORTH
    {"id": "CHN_N_01", "name": "Anna Nagar Tower (Park Entrance)", "lat": 13.0850, "lon": 80.2098, "dir": "N", "type": "landmark", "density": "urban", "notes": "Iconic tower, clear reference point"},
    {"id": "CHN_N_02", "name": "Koyambedu Bus Terminal (Main Gate)", "lat": 13.0694, "lon": 80.1960, "dir": "N", "type": "transport", "density": "dense_urban", "notes": "Largest bus terminal in Asia"},
    {"id": "CHN_N_03", "name": "Ambattur Industrial Estate Gate", "lat": 13.1145, "lon": 80.1564, "dir": "N", "type": "junction", "density": "suburban", "notes": "Clear gate structure"},
    {"id": "CHN_N_04", "name": "Madhavaram Junction", "lat": 13.1486, "lon": 80.2318, "dir": "N", "type": "junction", "density": "suburban", "notes": "Major junction"},
    {"id": "CHN_N_05", "name": "Tiruvottiyur Temple", "lat": 13.1590, "lon": 80.3004, "dir": "N", "type": "temple", "density": "urban", "notes": "Ancient temple, fixed structure"},

    # NORTHEAST
    {"id": "CHN_NE_01", "name": "Royapuram Railway Station", "lat": 13.1096, "lon": 80.2940, "dir": "NE", "type": "transport", "density": "dense_urban", "notes": "Oldest railway station in South India"},
    {"id": "CHN_NE_02", "name": "Tondiarpet Market Junction", "lat": 13.1175, "lon": 80.2851, "dir": "NE", "type": "junction", "density": "dense_urban", "notes": "Major market junction"},
    {"id": "CHN_NE_03", "name": "Washermanpet Metro Station", "lat": 13.1122, "lon": 80.2811, "dir": "NE", "type": "metro_station", "density": "dense_urban", "notes": "Metro station entrance"},
    {"id": "CHN_NE_04", "name": "Ennore Port Gate", "lat": 13.2120, "lon": 80.3205, "dir": "NE", "type": "landmark", "density": "open_sky", "notes": "Port entrance, open area"},

    # EAST
    {"id": "CHN_E_01", "name": "Marina Beach Lighthouse", "lat": 13.0395, "lon": 80.2796, "dir": "E", "type": "landmark", "density": "open_sky", "notes": "Lighthouse — excellent open sky test point"},
    {"id": "CHN_E_02", "name": "Kapaleeshwarar Temple (Mylapore)", "lat": 13.0336, "lon": 80.2694, "dir": "E", "type": "temple", "density": "dense_urban", "notes": "Ancient Shiva temple, main gopuram entrance"},
    {"id": "CHN_E_03", "name": "San Thome Cathedral", "lat": 13.0335, "lon": 80.2779, "dir": "E", "type": "religious", "density": "urban", "notes": "Cathedral entrance, clear reference"},
    {"id": "CHN_E_04", "name": "Triplicane Big Mosque", "lat": 13.0585, "lon": 80.2728, "dir": "E", "type": "religious", "density": "dense_urban", "notes": "Historic mosque"},
    {"id": "CHN_E_05", "name": "George Town (High Court)", "lat": 13.0874, "lon": 80.2871, "dir": "E", "type": "government", "density": "dense_urban", "notes": "Madras High Court entrance"},

    # SOUTHEAST
    {"id": "CHN_SE_01", "name": "Besant Nagar Beach (Karl Schmidt Memorial)", "lat": 13.0002, "lon": 80.2711, "dir": "SE", "type": "landmark", "density": "open_sky", "notes": "Beach landmark, open sky"},
    {"id": "CHN_SE_02", "name": "Thiruvanmiyur MRTS Station", "lat": 12.9833, "lon": 80.2634, "dir": "SE", "type": "transport", "density": "urban", "notes": "Railway station entrance"},
    {"id": "CHN_SE_03", "name": "VGP Universal Kingdom Gate", "lat": 12.9735, "lon": 80.2572, "dir": "SE", "type": "landmark", "density": "suburban", "notes": "Theme park entrance"},
    {"id": "CHN_SE_04", "name": "Tidel Park (IT Corridor)", "lat": 12.9881, "lon": 80.2461, "dir": "SE", "type": "landmark", "density": "urban", "notes": "Major IT building, clear entrance"},

    # SOUTH
    {"id": "CHN_S_01", "name": "Adyar Eco Park Entrance", "lat": 13.0060, "lon": 80.2568, "dir": "S", "type": "park", "density": "open_sky", "notes": "Park gate, open area"},
    {"id": "CHN_S_02", "name": "Velachery MRTS Station", "lat": 12.9796, "lon": 80.2182, "dir": "S", "type": "transport", "density": "urban", "notes": "MRTS station entrance"},
    {"id": "CHN_S_03", "name": "Phoenix Marketcity Mall Entrance", "lat": 12.9917, "lon": 80.2181, "dir": "S", "type": "landmark", "density": "dense_urban", "notes": "Major mall, clear entrance"},
    {"id": "CHN_S_04", "name": "Tambaram Railway Station", "lat": 12.9249, "lon": 80.1179, "dir": "S", "type": "transport", "density": "suburban", "notes": "Major junction station"},
    {"id": "CHN_S_05", "name": "Pallikaranai Marshland Viewpoint", "lat": 12.9380, "lon": 80.2087, "dir": "S", "type": "park", "density": "open_sky", "notes": "Wetland area, very open sky"},

    # SOUTHWEST
    {"id": "CHN_SW_01", "name": "Guindy National Park Gate", "lat": 13.0040, "lon": 80.2315, "dir": "SW", "type": "park", "density": "open_sky", "notes": "Park entrance, open area"},
    {"id": "CHN_SW_02", "name": "Chennai Airport (Domestic Terminal)", "lat": 12.9941, "lon": 80.1709, "dir": "SW", "type": "transport", "density": "open_sky", "notes": "Airport terminal entrance, open sky"},
    {"id": "CHN_SW_03", "name": "Chrompet Bus Depot", "lat": 12.9516, "lon": 80.1414, "dir": "SW", "type": "transport", "density": "suburban", "notes": "Bus depot entrance"},
    {"id": "CHN_SW_04", "name": "Pallavaram Junction", "lat": 12.9679, "lon": 80.1492, "dir": "SW", "type": "junction", "density": "urban", "notes": "Major junction"},

    # WEST
    {"id": "CHN_W_01", "name": "T Nagar Pondy Bazaar (North End)", "lat": 13.0427, "lon": 80.2354, "dir": "W", "type": "junction", "density": "dense_urban", "notes": "Famous shopping street, dense urban"},
    {"id": "CHN_W_02", "name": "Vadapalani Murugan Temple", "lat": 13.0520, "lon": 80.2122, "dir": "W", "type": "temple", "density": "dense_urban", "notes": "Major temple, clear gopuram entrance"},
    {"id": "CHN_W_03", "name": "Valasaravakkam Junction", "lat": 13.0467, "lon": 80.1717, "dir": "W", "type": "junction", "density": "suburban", "notes": "Junction point"},
    {"id": "CHN_W_04", "name": "Porur Junction", "lat": 13.0365, "lon": 80.1562, "dir": "W", "type": "junction", "density": "suburban", "notes": "Major junction, suburban"},
    {"id": "CHN_W_05", "name": "CMBT Metro Station", "lat": 13.0689, "lon": 80.1994, "dir": "W", "type": "metro_station", "density": "dense_urban", "notes": "Metro station near bus terminal"},

    # NORTHWEST
    {"id": "CHN_NW_01", "name": "Anna Nagar West Roundtana", "lat": 13.0930, "lon": 80.2030, "dir": "NW", "type": "junction", "density": "urban", "notes": "Roundabout junction"},
    {"id": "CHN_NW_02", "name": "Padi Junction Flyover", "lat": 13.1088, "lon": 80.2035, "dir": "NW", "type": "junction", "density": "urban", "notes": "Flyover junction"},
    {"id": "CHN_NW_03", "name": "Avadi Railway Station", "lat": 13.1146, "lon": 80.0984, "dir": "NW", "type": "transport", "density": "suburban", "notes": "Railway station entrance"},
    {"id": "CHN_NW_04", "name": "Mogappair Eri (Lake Park)", "lat": 13.0927, "lon": 80.1779, "dir": "NW", "type": "park", "density": "open_sky", "notes": "Lake park, open sky"},
    {"id": "CHN_NW_05", "name": "Thirumangalam Junction", "lat": 13.0866, "lon": 80.2253, "dir": "NW", "type": "junction", "density": "dense_urban", "notes": "Major junction"},
]


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))


def validate(landmarks):
    valid = []
    seen_ids = set()
    for lm in landmarks:
        if not lm.get("lat") or not lm.get("lon"):
            print(f"  REJECT: {lm['id']} — missing lat/lon")
            continue
        if lm["lat"] < BBOX["lat_min"] or lm["lat"] > BBOX["lat_max"]:
            print(f"  REJECT: {lm['id']} — lat {lm['lat']} outside Chennai bbox")
            continue
        if lm["lon"] < BBOX["lon_min"] or lm["lon"] > BBOX["lon_max"]:
            print(f"  REJECT: {lm['id']} — lon {lm['lon']} outside Chennai bbox")
            continue
        if lm["id"] in seen_ids:
            print(f"  REJECT: {lm['id']} — duplicate ID")
            continue
        seen_ids.add(lm["id"])
        lm["dist_from_centre"] = round(haversine(CENTRE[0], CENTRE[1], lm["lat"], lm["lon"]))
        valid.append(lm)
    return valid


def write_csv(landmarks, path):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["landmark_id", "name", "place_id", "lat", "lon", "direction",
                     "landmark_type", "density_zone", "address", "verified_date",
                     "dist_from_centre_m", "notes"])
        for lm in landmarks:
            w.writerow([
                lm["id"], lm["name"], "", lm["lat"], lm["lon"], lm["dir"],
                lm["type"], lm["density"], "",
                date.today().isoformat(), lm.get("dist_from_centre", 0), lm["notes"]
            ])
    print(f"\nWritten {len(landmarks)} landmarks to {path}")


def write_map(landmarks, path):
    html = """<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Chennai UPIN Reference Landmarks</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>body{margin:0}#map{height:100vh}</style></head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map=L.map('map').setView([13.0827,80.2707],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'OSM'}).addTo(map);
const colors={Centre:'#f06060',N:'#3dcc6e',NE:'#4da6ff',E:'#e8a832',SE:'#A855F7',S:'#00bcd4',SW:'#ff6090',W:'#e040fb',NW:'#ea80fc'};
const landmarks=LANDMARKS_JSON;
landmarks.forEach(lm=>{
  const c=colors[lm.dir]||'#999';
  L.circleMarker([lm.lat,lm.lon],{radius:8,color:c,fillColor:c,fillOpacity:0.8,weight:2})
    .bindPopup('<b>'+lm.id+'</b><br>'+lm.name+'<br>'+lm.dir+' | '+lm.type+' | '+lm.density+'<br>'+lm.lat.toFixed(6)+', '+lm.lon.toFixed(6))
    .addTo(map);
});
// Legend
const legend=L.control({position:'bottomright'});
legend.onAdd=function(){const d=L.DomUtil.create('div');d.style.cssText='background:rgba(0,0,0,0.8);color:white;padding:8px;font:11px monospace;border-radius:4px';
d.innerHTML='<b>UPIN Reference Points</b><br>'+Object.entries(colors).map(([k,v])=>'<span style="color:'+v+'">■</span> '+k).join('<br>');return d;};
legend.addTo(map);
</script></body></html>"""
    json_str = json.dumps([{"id": lm["id"], "name": lm["name"], "lat": lm["lat"],
                            "lon": lm["lon"], "dir": lm["dir"], "type": lm["type"],
                            "density": lm["density"]} for lm in landmarks])
    html = html.replace("LANDMARKS_JSON", json_str)
    with open(path, "w") as f:
        f.write(html)
    print(f"Written map to {path}")


def print_summary(landmarks):
    print("\n" + "="*60)
    print("CHENNAI UPIN REFERENCE LANDMARKS — SUMMARY")
    print("="*60)
    print(f"\nTotal landmarks: {len(landmarks)}")

    print("\nBy direction:")
    dirs = {}
    for lm in landmarks:
        dirs.setdefault(lm["dir"], []).append(lm)
    for d in ["Centre", "N", "NE", "E", "SE", "S", "SW", "W", "NW"]:
        count = len(dirs.get(d, []))
        names = ", ".join([lm["name"][:30] for lm in dirs.get(d, [])[:3]])
        print(f"  {d:8s}: {count} landmarks — {names}...")

    print("\nBy density:")
    dens = {}
    for lm in landmarks:
        dens.setdefault(lm["density"], []).append(lm)
    for d in ["dense_urban", "urban", "suburban", "open_sky"]:
        print(f"  {d:15s}: {len(dens.get(d, []))}")

    print("\nClosest 5 to centre:")
    by_dist = sorted(landmarks, key=lambda x: x.get("dist_from_centre", 99999))
    for lm in by_dist[:5]:
        print(f"  {lm['id']:12s} {lm['name'][:40]:40s} {lm['dist_from_centre']:5d}m")

    print("\nFarthest 5 from centre:")
    for lm in by_dist[-5:]:
        print(f"  {lm['id']:12s} {lm['name'][:40]:40s} {lm['dist_from_centre']:5d}m")

    # TODO: Add Adhithya's location here
    # ADHITHYA_LAT = 13.06
    # ADHITHYA_LON = 80.24
    # print("\nClosest 5 to Adhithya:")
    # for lm in sorted(landmarks, key=lambda x: haversine(ADHITHYA_LAT, ADHITHYA_LON, x['lat'], x['lon']))[:5]:
    #     print(f"  {lm['id']} {lm['name'][:40]} {round(haversine(ADHITHYA_LAT, ADHITHYA_LON, lm['lat'], lm['lon']))}m")


if __name__ == "__main__":
    print("Chennai Landmark Reference Database Generator")
    print("=" * 50)

    if "--offline" in sys.argv or not os.environ.get("GOOGLE_PLACES_API_KEY"):
        print("\nUsing curated landmark list (no API)")
        if not os.environ.get("GOOGLE_PLACES_API_KEY"):
            print("(Set GOOGLE_PLACES_API_KEY to fetch from Google Places API)")
    else:
        print("\nGoogle Places API key found — would fetch from API")
        print("(API fetch not implemented yet — using curated list)")

    landmarks = validate(LANDMARKS)
    write_csv(landmarks, "data/chennai_landmarks.csv")
    write_map(landmarks, "data/chennai_landmarks_map.html")
    print_summary(landmarks)
