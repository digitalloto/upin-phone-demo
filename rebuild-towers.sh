#!/bin/bash
# Download India tower data from OpenCellID and rebuild towers-data.js WITH LAC
# Run this on your Mac:
#   cd /path/to/upin-phone-demo
#   bash rebuild-towers.sh

TOKEN="pk.368752c41cec0c887116526b9ee678cd"
echo "Downloading India (MCC=404) tower data from OpenCellID..."
curl -o india-towers.csv.gz "https://opencellid.org/ocid/downloads?token=${TOKEN}&type=mcc&file=404.csv.gz"
gunzip -f india-towers.csv.gz
echo "Converting to towers-data.js with LAC..."

# CSV columns: radio,mcc,mnc,lac,cid,unit,lon,lat,range,samples,changeable,created,updated,averageSignal
node -e "
const fs=require('fs');
const lines=fs.readFileSync('india-towers.csv','utf8').split('\n');
const towers=[];
for(let i=1;i<lines.length;i++){
  const f=lines[i].split(',');
  if(f.length<8)continue;
  const lat=parseFloat(f[7]),lon=parseFloat(f[6]),mnc=parseInt(f[2]),cid=parseInt(f[4]),lac=parseInt(f[3]);
  if(!lat||!lon||!mnc)continue;
  towers.push({l:+lat.toFixed(4),o:+lon.toFixed(4),m:mnc,c:cid,a:lac});
}
fs.writeFileSync('towers-data.js','const TOWERS='+JSON.stringify(towers)+';');
console.log('Written '+towers.length+' towers with LAC to towers-data.js');
"
echo "Done! Refresh UPIN v5 to use the new tower data."
