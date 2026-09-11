"use client";

/* eslint-disable react-hooks/purity -- Randomness and clocks are used only inside the imperative simulation engine. */

import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker, Polyline } from "leaflet";
import MultiplayerGame from "./multiplayer/MultiplayerGame";
import MultiplayerLobby from "./multiplayer/MultiplayerLobby";
import { CITIES, COUNTRIES, cityCountry, getCity, getCityZones } from "./multiplayer/cities";
import { VERIFIED_ROAD_STARTS } from "./multiplayer/road-starts";
import type { RoomSession, RoomSnapshot } from "./multiplayer/types";

type LatLng = [number, number];
type RouteData = { coords: LatLng[]; distance: number };
type Runner = {
  id: number; name: string; pos: LatLng; route: LatLng[]; routeIndex: number;
  marker: Marker; speed: number; caught: boolean; exposed: boolean;
  carLeft: number; switching: number; reserves: number; vehicle: string;
  planning: boolean; requestId: number; replanAfter: number;
  holdForPing: boolean; holdDecided: boolean;
};
type Hunter = { pos: LatLng; route: LatLng[]; routeIndex: number; speed: number; requestId: number; planning: boolean; replanAfter: number };
type TimedLayer = { layer: { remove: () => void }; expires: number };
type Engine = {
  simTime: number; gameLeft: number; zoneLeft: number; signalLeft: number; civilianLeft: number;
  phase: number; paused: boolean; timeScale: number; hunter: Hunter; runners: Runner[];
  lockId: number | null; lockEscape: number; closeLevel: "none" | "near" | "critical";
  lastNearestId: number | null; lastNearestDistance: number; lastHudAt: number;
  captured: number; finished: boolean; generation: number; layers: TimedLayer[];
};

const GAME_SECONDS = 120 * 60;
const ZONE_SECONDS = 15 * 60;
const SIGNAL_SECONDS = 6 * 60;
const CAR_SECONDS = 5 * 60;
const RUNNER_NAMES = ["Dani","Luca","Máté","Nóra","Bence","Zsófi","Áron","Lili","Marci","Anna"];
const VEHICLES = ["fehér Dacia","szürke kombi","piros kisautó","fekete SUV","kék sedan","ezüst taxi"];
const formatTime=(value:number)=>`${Math.floor(Math.max(0,value)/60)}:${String(Math.floor(Math.max(0,value)%60)).padStart(2,"0")}`;
const randomBetween=(min:number,max:number)=>min+Math.random()*(max-min);

type PracticeRole = "hunter" | "runner";
type PracticeConfig = { cityId: string; role: PracticeRole };

function PracticeGame({onBack,cityId,playerRole}:{onBack:()=>void;cityId:string;playerRole:PracticeRole}){
  const city=getCity(cityId)??CITIES[0];
  const cityStarts=VERIFIED_ROAD_STARTS[city.id]??VERIFIED_ROAD_STARTS.budapest;
  const HUNTER_START:[number,number]=[cityStarts[0].lat,cityStarts[0].lng];
  const RUNNER_STARTS:LatLng[]=cityStarts.slice(1).map(point=>[point.lat,point.lng]);
  const ZONES=getCityZones(city.id).map(zone=>({name:zone.name,center:[zone.lat,zone.lng] as LatLng,radius:zone.radius}));
  const CAPTURE_GOAL=playerRole==="hunter"?4:1;
  const mapNode=useRef<HTMLDivElement>(null),mapRef=useRef<LeafletMap|null>(null),leafletRef=useRef<typeof import("leaflet")|null>(null);
  const engineRef=useRef<Engine|null>(null),hunterMarker=useRef<Marker|null>(null),hunterLine=useRef<Polyline|null>(null),zoneLayers=useRef<Circle[]>([]),signalMarkers=useRef(new Map<number,Marker>());
  const routeQueue=useRef<Array<()=>void>>([]),activeRoutes=useRef(0),routeCache=useRef(new Map<string,RouteData>()),disposed=useRef(false);
  const [paused,setPaused]=useState(false),[timeScale,setTimeScale]=useState(1),[closeLevel,setCloseLevel]=useState<"none"|"near"|"critical">("none");
  const [routeMessage,setRouteMessage]=useState(playerRole==="hunter"?"Te vagy az üldöző: kattints egy közeli útra":"Te vagy a menekülő: kattints egy közeli útra"),[captureFlash,setCaptureFlash]=useState<string|null>(null),[callAlert,setCallAlert]=useState<string|null>(null),[gameOver,setGameOver]=useState<"hunter"|"runners"|null>(null);
  const [feed,setFeed]=useState<string[]>([playerRole==="hunter"?`A menekülők szétszóródtak ${city.name} területén.`:`A gépi üldöző elindult utánad ${city.name} utcáin.`,"A legközelebbi távolságmérő aktív."]);
  const [hud,setHud]=useState({gameLeft:GAME_SECONDS,zoneLeft:ZONE_SECONDS,signalLeft:SIGNAL_SECONDS,phase:0,captured:0,alive:playerRole==="hunter"?10:1,nearest:Infinity,trend:"→",current:ZONES[0].name,next:ZONES[1].name});

  const addFeed=(text:string)=>setFeed(items=>[text,...items].slice(0,5));
  const offsetPoint=(center:LatLng,radius:number):LatLng=>{const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*radius;return [center[0]+Math.sin(angle)*r/111320,center[1]+Math.cos(angle)*r/(111320*Math.cos(center[0]*Math.PI/180))]};
  const routeKey=(a:LatLng,b:LatLng)=>`${a[0].toFixed(4)},${a[1].toFixed(4)}>${b[0].toFixed(4)},${b[1].toFixed(4)}`;

  const pumpRoutes=()=>{
    while(activeRoutes.current<3&&routeQueue.current.length){const job=routeQueue.current.shift();if(job){activeRoutes.current++;job()}}
  };
  const requestRoute=(from:LatLng,to:LatLng,generation:number)=>new Promise<RouteData>((resolve,reject)=>{
    const key=routeKey(from,to),cached=routeCache.current.get(key);if(cached){resolve(cached);return}
    routeQueue.current.push(()=>{
      const url=`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
      fetch(url).then(r=>{if(!r.ok)throw new Error("route");return r.json()}).then(data=>{
        if(disposed.current||engineRef.current?.generation!==generation)throw new Error("stale");
        const found=data.routes?.[0];if(!found)throw new Error("route");
        const coords:LatLng[]=found.geometry.coordinates.map((p:[number,number])=>[p[1],p[0]]);
        const result={coords:[from,...coords],distance:Number(found.distance)||0};routeCache.current.set(key,result);resolve(result);
      }).catch(reject).finally(()=>{activeRoutes.current--;pumpRoutes()});
    });pumpRoutes();
  });

  const pointInZone=(point:LatLng,zoneIndex:number)=>Boolean(mapRef.current&&mapRef.current.distance(point,ZONES[zoneIndex].center)<=ZONES[zoneIndex].radius);
  const directionOf=(runner:Runner)=>{const next=runner.route[Math.min(runner.routeIndex+1,runner.route.length-1)];if(!next)return "ismeretlen irányba";const dy=next[0]-runner.pos[0],dx=next[1]-runner.pos[1];if(Math.abs(dx)>Math.abs(dy))return dx>0?"kelet felé":"nyugat felé";return dy>0?"észak felé":"dél felé"};

  const planRunner=(runner:Runner,avoidHunter=false)=>{
    const engine=engineRef.current,map=mapRef.current;if(!engine||!map||runner.caught||runner.planning||runner.switching>0||(playerRole==="runner"&&runner.id===0))return;
    const targetZone=runner.exposed?engine.phase:Math.min(engine.phase+1,ZONES.length-1);let target=offsetPoint(ZONES[targetZone].center,ZONES[targetZone].radius*.68);
    if(avoidHunter){const h=engine.hunter.pos,away:[number,number]=[runner.pos[0]+(runner.pos[0]-h[0])*1.8,runner.pos[1]+(runner.pos[1]-h[1])*1.8];target=pointInZone(away as LatLng,targetZone)?away as LatLng:target}
    runner.planning=true;const token=++runner.requestId,generation=engine.generation;
    requestRoute(runner.pos,target,generation).then(route=>{if(runner.requestId!==token||runner.caught)return;runner.route=route.coords;runner.routeIndex=0}).catch(()=>{runner.replanAfter=12}).finally(()=>{if(runner.requestId===token)runner.planning=false});
  };

  const planHunter=()=>{
    const engine=engineRef.current;if(!engine||playerRole!=="runner"||engine.hunter.planning||engine.finished)return;
    const target=engine.runners[0];if(!target||target.caught)return;
    engine.hunter.planning=true;const token=++engine.hunter.requestId,generation=engine.generation;
    requestRoute(engine.hunter.pos,target.pos,generation).then(route=>{if(engine.hunter.requestId!==token)return;engine.hunter.route=route.coords;engine.hunter.routeIndex=0}).catch(()=>{engine.hunter.replanAfter=4}).finally(()=>{if(engine.hunter.requestId===token)engine.hunter.planning=false});
  };

  const advance=(mover:{pos:LatLng;route:LatLng[];routeIndex:number},meters:number,map:LeafletMap)=>{
    let remaining=meters;
    while(remaining>0&&mover.routeIndex<mover.route.length-1){const next=mover.route[mover.routeIndex+1],segment=map.distance(mover.pos,next);if(segment<=remaining){mover.pos=next;mover.routeIndex++;remaining-=segment}else{const ratio=segment?remaining/segment:1;mover.pos=[mover.pos[0]+(next[0]-mover.pos[0])*ratio,mover.pos[1]+(next[1]-mover.pos[1])*ratio];remaining=0}}
    return mover.routeIndex>=mover.route.length-1;
  };

  const drawZones=(phase:number)=>{
    const L=leafletRef.current,map=mapRef.current;if(!L||!map)return;zoneLayers.current.forEach(x=>x.remove());zoneLayers.current=[];
    const current=ZONES[phase],next=ZONES[Math.min(phase+1,ZONES.length-1)];
    zoneLayers.current.push(L.circle(current.center,{radius:current.radius,color:"#2da66f",weight:3,fillColor:"#2da66f",fillOpacity:.07}).addTo(map).bindTooltip(`Aktív zóna: ${current.name}`));
    if(phase<ZONES.length-1)zoneLayers.current.push(L.circle(next.center,{radius:next.radius,color:"#ff7a38",weight:3,dashArray:"10 12",fillColor:"#ff7a38",fillOpacity:.05}).addTo(map).bindTooltip(`Következő zóna: ${next.name}`));
  };

  const setClose=(level:"none"|"near"|"critical")=>{const engine=engineRef.current,map=mapRef.current;if(!engine||!map||engine.closeLevel===level)return;engine.closeLevel=level;setCloseLevel(level);const focus=playerRole==="runner"?engine.runners[0]?.pos??engine.hunter.pos:engine.hunter.pos;if(level==="near")map.flyTo(focus,17,{duration:1});else if(level==="critical")map.flyTo(focus,18,{duration:.7});else map.flyTo(focus,14,{duration:1})};

  const captureRunner=(runner:Runner)=>{
    const engine=engineRef.current,L=leafletRef.current,map=mapRef.current;if(!engine||!L||!map||runner.caught)return;
    runner.caught=true;runner.marker.setOpacity(0);signalMarkers.current.get(runner.id)?.remove();signalMarkers.current.delete(runner.id);engine.captured++;engine.lockId=null;engine.lockEscape=0;setClose("none");
    const cuff=L.divIcon({className:"cuff-marker",html:"⛓",iconSize:[38,38],iconAnchor:[19,19]});const layer=L.marker(runner.pos,{icon:cuff,zIndexOffset:1200}).addTo(map);engine.layers.push({layer,expires:engine.simTime+25});
    setCaptureFlash(runner.name);window.setTimeout(()=>setCaptureFlash(null),2200);addFeed(`CSATT! ${runner.name} elfogva. (${engine.captured}/${CAPTURE_GOAL})`);
    if(engine.captured>=CAPTURE_GOAL){engine.finished=true;engine.paused=true;setPaused(true);setGameOver("hunter")}
  };

  const fireSignal=()=>{
    const engine=engineRef.current,L=leafletRef.current,map=mapRef.current;if(!engine||!L||!map)return;
    const alive=engine.runners.filter(r=>!r.caught);alive.forEach(r=>{signalMarkers.current.get(r.id)?.remove();const icon=L.divIcon({className:"ping-marker",html:`<span>${r.id+1}</span>`,iconSize:[28,28],iconAnchor:[14,14]});const layer=L.marker(r.pos,{icon,zIndexOffset:700}).addTo(map).bindTooltip(`M${r.id+1} utolsó ismert helye`);signalMarkers.current.set(r.id,layer);const held=r.holdForPing;r.holdForPing=false;r.holdDecided=false;if(held){r.route=[];r.routeIndex=0;r.replanAfter=randomBetween(2,8)}});
    addFeed(`Hivatalos jel: ${alive.length} menekülő pillanatnyi helye rögzítve.`);setCallAlert("HIVATALOS HELYZETJELENTÉS");window.setTimeout(()=>setCallAlert(null),2200);
  };

  const civilianReport=()=>{
    const engine=engineRef.current,L=leafletRef.current,map=mapRef.current;if(!engine||!L||!map)return;const alive=engine.runners.filter(r=>!r.caught);if(!alive.length)return;
    if(Math.random()<.72){const runner=alive[Math.floor(Math.random()*alive.length)],accurate=Math.random()<.7,center=accurate?offsetPoint(runner.pos,randomBetween(120,650)):offsetPoint(ZONES[engine.phase].center,ZONES[engine.phase].radius*.85),uncertainty=randomBetween(350,950);
      const layer=L.circle(center,{radius:uncertainty,color:"#f39a52",weight:2,dashArray:"5 8",fillColor:"#f39a52",fillOpacity:.08}).addTo(map).bindTooltip(`Civil jelentés: ${runner.vehicle}, ${directionOf(runner)}`);engine.layers.push({layer,expires:engine.simTime+100});const text=`Civil hívás: egy ${runner.vehicle} ${directionOf(runner)} tartott.`;addFeed(text);setCallAlert(text);window.setTimeout(()=>setCallAlert(null),3500);
    }else{const text="Figyelem: civilek jelentették az üldöző autódat a menekülőknek.";addFeed(text);setCallAlert(text);window.setTimeout(()=>setCallAlert(null),3500);alive.sort((a,b)=>map.distance(a.pos,engine.hunter.pos)-map.distance(b.pos,engine.hunter.pos)).slice(0,3).forEach(r=>{r.route=[];r.routeIndex=0;r.replanAfter=randomBetween(1,5);r.holdForPing=false;planRunner(r,true)})}
  };

  const advanceZone=()=>{
    const engine=engineRef.current;if(!engine)return;if(engine.phase>=ZONES.length-1){engine.zoneLeft=ZONE_SECONDS;return}engine.phase++;engine.zoneLeft=ZONE_SECONDS;drawZones(engine.phase);
    engine.runners.filter(r=>!r.caught).forEach((r,i)=>{r.exposed=!pointInZone(r.pos,engine.phase);r.marker.setOpacity(playerRole==="runner"&&r.id===0?1:r.exposed?1:0);r.route=[];r.routeIndex=0;r.replanAfter=i*1.5});
    addFeed(`Zónaváltás: ${ZONES[engine.phase].name}. A késők folyamatosan láthatók.`);
  };

  useEffect(()=>{
    if(!mapNode.current)return;disposed.current=false;const snapshots=signalMarkers.current;let timer:number|undefined,last=performance.now();
    void import("leaflet").then(L=>{
      if(disposed.current||!mapNode.current)return;leafletRef.current=L;
      const map=L.map(mapNode.current,{zoomControl:false,minZoom:8,maxZoom:18,maxBounds:[[43.45,16.05],[48.65,30.35]]}).setView(HUNTER_START,13);mapRef.current=map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);L.control.zoom({position:"bottomleft"}).addTo(map);
      const hunterIcon=L.divIcon({className:"token-wrap hunter-wrap",html:`<span class="hunter-token">⌖</span><b>${playerRole==="hunter"?"TE · ÜLDÖZŐ":"GÉPI ÜLDÖZŐ"}</b>`,iconSize:[76,58],iconAnchor:[38,27]});hunterMarker.current=L.marker(HUNTER_START,{icon:hunterIcon,zIndexOffset:1100}).addTo(map);
      const runnerIcon=(i:number)=>L.divIcon({className:"token-wrap runner-wrap",html:`<span>➤</span><b>${playerRole==="runner"&&i===0?"TE · MENEKÜLŐ":`M${i+1}`}</b>`,iconSize:[76,58],iconAnchor:[38,27]});
      const selectedRunnerStarts=playerRole==="runner"?RUNNER_STARTS.slice(0,1):RUNNER_STARTS;
      const runners:Runner[]=selectedRunnerStarts.map((pos,i)=>({id:i,name:playerRole==="runner"&&i===0?"Te":RUNNER_NAMES[i],pos,route:[],routeIndex:0,marker:L.marker(pos,{icon:runnerIcon(i),opacity:playerRole==="runner"&&i===0?1:0,zIndexOffset:900}).addTo(map),speed:20+Math.random()*2.5,caught:false,exposed:false,carLeft:CAR_SECONDS-randomBetween(0,55),switching:0,reserves:4,vehicle:VEHICLES[i%VEHICLES.length],planning:false,requestId:0,replanAfter:i*.7,holdForPing:false,holdDecided:false}));
      engineRef.current={simTime:0,gameLeft:GAME_SECONDS,zoneLeft:ZONE_SECONDS,signalLeft:SIGNAL_SECONDS,civilianLeft:randomBetween(70,130),phase:0,paused:false,timeScale:1,hunter:{pos:HUNTER_START,route:[],routeIndex:0,speed:24,requestId:0,planning:false,replanAfter:0},runners,lockId:null,lockEscape:0,closeLevel:"none",lastNearestId:null,lastNearestDistance:Infinity,lastHudAt:0,captured:0,finished:false,generation:Date.now(),layers:[]};drawZones(0);runners.forEach(r=>planRunner(r));if(playerRole==="runner")planHunter();
      map.on("click",async e=>{const engine=engineRef.current;if(!engine||engine.paused||engine.finished)return;const mover=playerRole==="hunter"?engine.hunter:engine.runners[0];if(!mover||mover.caught)return;const target:[number,number]=[e.latlng.lat,e.latlng.lng];if(map.distance(mover.pos,target)>12000){setRouteMessage("Egyszerre legfeljebb 12 km-es útszakaszt válassz");return}const requestId=++mover.requestId,generation=engine.generation;setRouteMessage(playerRole==="hunter"?"Üldözési útvonal tervezése…":"Menekülési útvonal tervezése…");try{const route=await requestRoute(mover.pos,target,generation);if(mover.requestId!==requestId)return;mover.route=route.coords;mover.routeIndex=0;hunterLine.current?.remove();hunterLine.current=L.polyline(route.coords,{color:playerRole==="hunter"?"#278fe0":"#ff8a45",weight:5,opacity:.85,dashArray:"8 9"}).addTo(map);setRouteMessage(`${(route.distance/1000).toFixed(1)} km-es útvonal · menet közben új irányt is választhatsz`)}catch{setRouteMessage("Erre most nem sikerült közúti útvonalat találni")}});

      timer=window.setInterval(()=>{
        const engine=engineRef.current;if(!engine||engine.paused||engine.finished)return;const now=performance.now(),realDt=Math.min(.5,(now-last)/1000);last=now;const dt=realDt*engine.timeScale;engine.simTime+=dt;engine.gameLeft-=dt;engine.zoneLeft-=dt;engine.signalLeft-=dt;engine.civilianLeft-=dt;
        if(engine.gameLeft<=0){engine.finished=true;engine.paused=true;setPaused(true);setGameOver("runners");return}if(engine.zoneLeft<=0)advanceZone();if(engine.signalLeft<=0){engine.signalLeft+=SIGNAL_SECONDS;fireSignal()}if(engine.civilianLeft<=0){engine.civilianLeft=randomBetween(80,145);civilianReport()}
        engine.layers=engine.layers.filter(item=>{if(item.expires<=engine.simTime){item.layer.remove();return false}return true});
        const alive=engine.runners.filter(r=>!r.caught);
        let nearest:Runner|null=null,nearestDistance=Infinity;for(const r of alive){const d=map.distance(engine.hunter.pos,r.pos);if(d<nearestDistance){nearest=r;nearestDistance=d}}
        if(engine.lockId===null&&nearest&&nearestDistance<=300){engine.lockId=nearest.id;engine.lockEscape=0;setClose("near");addFeed("Közeli hajsza! Egy menekülő 300 méteren belül van.")}
        let locked=engine.lockId===null?null:engine.runners[engine.lockId];let lockedDistance=locked&&!locked.caught?map.distance(engine.hunter.pos,locked.pos):Infinity;
        if(locked&&locked.caught){engine.lockId=null;locked=null;setClose("none")}else if(locked){if(lockedDistance>400)engine.lockEscape+=dt;else engine.lockEscape=0;if(engine.lockEscape>=5){engine.lockId=null;locked=null;engine.lockEscape=0;setClose("none");addFeed("A közeli menekülő lerázott.")}else setClose(lockedDistance<=150?"critical":"near")}
        const closeRatio=locked?Math.max(0,Math.min(1,(lockedDistance-50)/250)):1,hunterFactor=locked?.id!==undefined?(.72+.28*closeRatio):1;
        if(playerRole==="runner"){if(engine.hunter.replanAfter>0)engine.hunter.replanAfter-=dt;else if(!engine.hunter.route.length&&!engine.hunter.planning)planHunter()}
        if(engine.hunter.route.length){const done=advance(engine.hunter,engine.hunter.speed*hunterFactor*dt,map);hunterMarker.current?.setLatLng(engine.hunter.pos);if(done){engine.hunter.route=[];if(playerRole==="hunter"){hunterLine.current?.remove();hunterLine.current=null;setRouteMessage("Válassz új irányt a térképen")}else engine.hunter.replanAfter=1.5}}
        for(const r of alive){
          if(playerRole==="runner"&&r.id===0){const done=advance(r,r.speed*dt,map);r.marker.setLatLng(r.pos);if(done&&r.route.length){r.route=[];r.routeIndex=0;hunterLine.current?.remove();hunterLine.current=null;setRouteMessage("Válassz új menekülési irányt a térképen")}continue}
          if(r.switching>0){r.switching-=dt;if(r.switching<=0){r.carLeft=CAR_SECONDS;r.vehicle=VEHICLES[Math.floor(Math.random()*VEHICLES.length)];r.replanAfter=randomBetween(1,4)}continue}
          r.carLeft-=dt;if(r.carLeft<=0){r.route=[];r.routeIndex=0;const reserved=r.reserves>0&&Math.random()<.72;r.switching=reserved?randomBetween(7,14):randomBetween(25,70);if(reserved)r.reserves--;continue}
          if(engine.signalLeft<=20&&!r.holdDecided){r.holdDecided=true;r.holdForPing=Math.random()<.55}
          if(r.replanAfter>0){r.replanAfter-=dt;if(r.replanAfter<=0)planRunner(r);continue}if(r.holdForPing)continue;if(!r.route.length&&!r.planning){planRunner(r);continue}
          const factor=locked?.id===r.id?(.68+.32*closeRatio):1,done=advance(r,r.speed*factor*dt,map);r.marker.setLatLng(r.pos);
          if(r.exposed&&pointInZone(r.pos,engine.phase)){r.exposed=false;r.marker.setOpacity(0);addFeed("Egy késő menekülő beért a biztonságos zónába.")}
          if(done){r.route=[];r.routeIndex=0;r.replanAfter=randomBetween(5,18)}
        }
        if(locked&&!locked.caught){lockedDistance=map.distance(engine.hunter.pos,locked.pos);if(lockedDistance<=50)captureRunner(locked);else if(engine.simTime-engine.lastHudAt>.8)map.panTo(playerRole==="hunter"?engine.hunter.pos:locked.pos,{animate:false})}
        if(engine.simTime-engine.lastHudAt>=1){const trend=engine.lastNearestId===nearest?.id?(nearestDistance<engine.lastNearestDistance-25?"↓":nearestDistance>engine.lastNearestDistance+25?"↑":"→"):"→";engine.lastNearestId=nearest?.id??null;engine.lastNearestDistance=nearestDistance;engine.lastHudAt=engine.simTime;setHud({gameLeft:engine.gameLeft,zoneLeft:engine.zoneLeft,signalLeft:engine.signalLeft,phase:engine.phase,captured:engine.captured,alive:alive.length,nearest:Math.round(nearestDistance/50)*50,trend,current:ZONES[engine.phase].name,next:ZONES[Math.min(engine.phase+1,ZONES.length-1)].name})}
      },100);
    });
    return()=>{disposed.current=true;if(timer)window.clearInterval(timer);routeQueue.current=[];engineRef.current?.layers.forEach(x=>x.layer.remove());snapshots.forEach(marker=>marker.remove());snapshots.clear();mapRef.current?.remove();mapRef.current=null;engineRef.current=null};
    // A teljes szimuláció egyetlen, a komponenssel együtt élő motor; az állapotot refekből olvassa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const togglePause=()=>{const engine=engineRef.current;if(!engine||engine.finished)return;engine.paused=!engine.paused;setPaused(engine.paused)};
  const toggleSpeed=()=>{const engine=engineRef.current;if(!engine)return;const next=timeScale===1?20:1;engine.timeScale=next;setTimeScale(next);addFeed(next===1?"Valós idejű tempó visszaállítva.":"Tesztgyorsítás bekapcsolva (×20).")};
  const reload=()=>window.location.reload();

  return <main className={`page chase-${closeLevel}`}><section className="game">
    <header className="brandbar"><div className="brand-lockup"><span className="brandmark"><i>KE</i></span><div className="brandcopy"><strong>KAPJ EL, HA TUDSZ!</strong><small>GYAKORLÓ HAJSZA / {city.name.toUpperCase()}</small></div><span className="subtitle">Béta gyakorlópálya · {playerRole==="hunter"?"üldözői":"menekülői"} nézet</span></div><div className="top-actions"><span className={`live-state ${paused?"paused":""}`}><i/>{paused?"JÁTÉK SZÜNETEL":"GYAKORLÁS FUT"}</span><button onClick={onBack}><small>VISSZA</small>BEÁLLÍTÁSOK</button><button onClick={toggleSpeed} aria-pressed={timeScale>1} className={timeScale>1?"active":""}><small>SEBESSÉG</small>{timeScale>1?"TESZT ×20":"VALÓS IDŐ"}</button><button onClick={togglePause} aria-pressed={paused}><small>JÁTÉK</small>{paused?"FOLYTATÁS":"SZÜNET"}</button></div></header>
    <div className="game-layout">
      <div className="map-shell"><div ref={mapNode} className="real-map" aria-label={`${city.name} valós térképes gyakorló üldözése`}/><div className="map-grid" aria-hidden="true"/><div className="map-corners" aria-hidden="true"><i/><i/><i/><i/></div>
        <div className="map-hud signal"><div className="signal-orbit"><span className="pulse"/></div><div className="signal-copy"><span className="hud-kicker">SAT // PING</span><strong>HELYZETJEL <b>{formatTime(hud.signalLeft)}</b></strong><small>A következő pontos pillanatfelvételig</small><div className="signal-meter"><i style={{width:`${Math.max(0,Math.min(100,(1-hud.signalLeft/SIGNAL_SECONDS)*100))}%`}}/></div></div></div>
        {closeLevel!=="none"&&<div className={`close-banner ${closeLevel}`} role="alert"><strong>{closeLevel==="critical"?"VÉGHAJRÁ · 150 M":"KÖZELI HAJSZA · 300 M"}</strong><span>Az autók lelassultak</span></div>}
        {callAlert&&<div className="call-alert" role="status"><span>☎</span><div><b>BEJÖVŐ INFORMÁCIÓ</b><small>{callAlert}</small></div></div>}
        <div className="instruction"><span className="command-key">ÚTVONAL</span><span className="blue-dot"/><span>{routeMessage}</span></div>
        {captureFlash&&<div className="capture-flash" role="alert"><span>⛓</span><strong>CSATT! BILINCS</strong><small>{captureFlash} elfogva</small></div>}
        {gameOver&&<div className="result" role="dialog" aria-modal="true" aria-label="A hajsza végeredménye"><span className="eyebrow">A HAJSZA VÉGET ÉRT</span><h1>{(playerRole==="hunter"&&gameOver==="hunter")||(playerRole==="runner"&&gameOver==="runners")?"Nyertél.":"A gép nyert."}</h1><p>{gameOver==="hunter"?(playerRole==="hunter"?`Elfogtál ${CAPTURE_GOAL} menekülőt.`:"Az üldöző 50 méteren belülre ért."):(playerRole==="runner"?"Kitartottál a játékidő végéig.":`${hud.alive} menekülő szabadon maradt.`)}</p><button onClick={reload}>Új játék</button></div>}
      </div>
      <aside className="sidebar">
        <section className={`proximity panel ${closeLevel!=="none"?"danger":""}`}><div className="panel-heading"><span className="eyebrow">{playerRole==="hunter"?"LEGKÖZELEBBI MENEKÜLŐ":"AZ ÜLDÖZŐ TÁVOLSÁGA"}</span><b className="sensor-state"><i/>RADAR AKTÍV</b></div><div className="proximity-body"><div><div className="distance">{Number.isFinite(hud.nearest)?hud.nearest.toLocaleString("hu-HU"):"—"}<small>M</small><i>{hud.trend}</i></div><p>{closeLevel==="critical"?"Nagyon közel — válassz jól utcát!":closeLevel==="near"?"Közeli hajsza aktív.":playerRole==="hunter"?"Irány és személyazonosság rejtve.":"Tervezz előre, és tartsd a távolságot."}</p></div><div className="radar-visual" aria-hidden="true"><i/><i/><span/></div></div><div className="range-scale"><span>300 M · ZOOM</span><i/><span>50 M · BILINCS</span></div></section>
        <section className="score-row"><div className="stat-card captured"><i/><span>ELFOGVA</span><strong>{hud.captured}<small>/{CAPTURE_GOAL}</small></strong></div><div className="stat-card escaped"><i/><span>SZABADON</span><strong>{hud.alive}</strong></div><div className="stat-card clock"><i/><span>HÁTRALÉVŐ IDŐ</span><strong>{formatTime(hud.gameLeft)}</strong></div></section>
        <section className="zone-card panel"><div className="panel-heading"><span className="eyebrow">MOZGÓ JÁTÉKTÉR · {hud.phase+1}/{ZONES.length}</span><b className="zone-live"><i/>AKTÍV</b></div><div className="zone-route"><div><small>JELENLEGI ZÓNA</small><strong>{hud.current}</strong></div><span className="zone-arrow">→</span><div><small>KÖVETKEZŐ</small><strong>{hud.next}</strong></div></div><div className="zone-progress"><i style={{width:`${Math.max(0,Math.min(100,(1-hud.zoneLeft/ZONE_SECONDS)*100))}%`}}/></div><div className="zone-time"><span>Áthelyezésig</span><b>{formatTime(hud.zoneLeft)}</b></div></section>
        <section className="rules panel"><div><span className="rule-code">05</span><p><strong>AUTÓLIMIT</strong><small>5:00 után csere vagy stoppolás</small></p><i className="rule-status">KÖTELEZŐ</i></div><div><span className="rule-code">06</span><p><strong>HELYZETJEL</strong><small>Pontos, de csak pillanatfelvétel</small></p><i className="rule-status">PERCENKÉNT</i></div></section>
        <section className="intel panel"><div className="panel-heading"><span className="eyebrow">MŰVELETI NAPLÓ</span><b className="live-badge"><i/>ÉLŐ</b></div><div className="feed-list" aria-live="polite">{feed.map((item,i)=><p key={`${item}-${i}`} className={i===0?"latest":""}><i/><span>{item}</span></p>)}</div></section>
      </aside>
    </div>
    <footer className="statusbar"><div className="command-help"><span className="command-icon">{playerRole==="hunter"?"⌖":"➤"}</span><p><strong>Kattints az útra, és vezesd a {playerRole==="hunter"?"üldöző":"menekülő"} autót</strong><small>300 méternél közelít a kamera · 50 méternél automatikus elfogás</small></p></div><div className="legend"><span><i className={playerRole}/>{playerRole==="hunter"?"TE / ÜLDÖZŐ":"TE / MENEKÜLŐ"}</span><span><i className={playerRole==="hunter"?"runner":"hunter"}/>{playerRole==="hunter"?"MENEKÜLŐ":"GÉPI ÜLDÖZŐ"}</span><span><i className="zone"/>KÖVETKEZŐ ZÓNA</span></div></footer>
  </section></main>
}

function PracticeSetup({onBack,onStart}:{onBack:()=>void;onStart:(config:PracticeConfig)=>void}){
  const [country,setCountry]=useState<"hu"|"ro">("hu");
  const [cityId,setCityId]=useState("budapest");
  const [role,setRole]=useState<PracticeRole>("hunter");
  const cities=CITIES.filter(city=>cityCountry(city.id)===country);
  const chooseCountry=(next:"hu"|"ro")=>{setCountry(next);setCityId(next==="hu"?"budapest":"bucharest")};
  return <main className="page practice-setup-page"><section className="practice-setup panel">
    <button className="practice-back" type="button" onClick={onBack}>← VISSZA A KEZDŐLAPRA</button>
    <span className="eyebrow">GYAKORLÓ HAJSZA // BEÁLLÍTÁS</span>
    <h1>Hol és melyik oldalon játszol?</h1>
    <p>Válassz országot, várost és szerepet. A gép átveszi az ellenfeled irányítását.</p>
    <fieldset><legend>1. ORSZÁG</legend><div className="practice-choice-grid two">{COUNTRIES.map(item=><button type="button" key={item.id} className={country===item.id?"selected":""} aria-pressed={country===item.id} onClick={()=>chooseCountry(item.id)}><strong>{item.name}</strong><small>{item.id==="hu"?"Budapest":"12 választható város"}</small></button>)}</div></fieldset>
    <fieldset><legend>2. VÁROS</legend><label className="practice-city-select"><span>Gyakorlópálya</span><select value={cityId} onChange={event=>setCityId(event.target.value)}>{cities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></fieldset>
    <fieldset><legend>3. SZEREP</legend><div className="practice-choice-grid two"><button type="button" className={role==="hunter"?"selected hunter-choice":"hunter-choice"} aria-pressed={role==="hunter"} onClick={()=>setRole("hunter")}><strong>⌖ ÜLDÖZŐ VAGYOK</strong><small>A gépi menekülőket kutatod fel.</small></button><button type="button" className={role==="runner"?"selected runner-choice":"runner-choice"} aria-pressed={role==="runner"} onClick={()=>setRole("runner")}><strong>➤ MENEKÜLŐ VAGYOK</strong><small>A gépi üldöző elől menekülsz.</small></button></div></fieldset>
    <button className="practice-start" type="button" onClick={()=>onStart({cityId,role})}>GYAKORLÁS INDÍTÁSA</button>
  </section></main>
}

export default function Home(){
  const [practiceSetup,setPracticeSetup]=useState(false);
  const [practiceConfig,setPracticeConfig]=useState<PracticeConfig|null>(null);
  const [onlineGame,setOnlineGame]=useState<{session:RoomSession;room:RoomSnapshot}|null>(null);

  if(onlineGame)return <MultiplayerGame session={onlineGame.session} initialRoom={onlineGame.room} onExit={()=>setOnlineGame(null)}/>;
  if(practiceConfig)return <PracticeGame cityId={practiceConfig.cityId} playerRole={practiceConfig.role} onBack={()=>setPracticeConfig(null)}/>;
  if(practiceSetup)return <PracticeSetup onBack={()=>setPracticeSetup(false)} onStart={setPracticeConfig}/>;

  return <MultiplayerLobby
    onPractice={()=>setPracticeSetup(true)}
    onEnterGame={(session,room)=>setOnlineGame({session,room})}
  />;
}

