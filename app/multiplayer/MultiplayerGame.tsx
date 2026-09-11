"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker, Polyline } from "leaflet";
import { getRoom, patchRoom, RoomApiError } from "./room-client";
import type { ConnectionState, RoomSession, RoomSnapshot } from "./types";
import styles from "./MultiplayerGame.module.css";
import { GAME_BOUNDS, getCity, getCityZones } from "./cities";

type LatLng = [number, number];
type RouteState = { coords: LatLng[]; index: number };
type HandoffCandidate = { point: LatLng; distance: number };
type AlertState = { kind: "signal" | "civilian" | "capture" | "info"; title: string; detail: string } | null;

const SESSION_KEY = "kapj-el-ha-tudsz.room-session.v1";
const HUNTER_SPEED = 24;
const RUNNER_SPEED = 21;
const ZONE_SECONDS = 15 * 60;

export type MultiplayerGameProps = {
  session: RoomSession;
  initialRoom: RoomSnapshot;
  onExit: () => void;
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function newerSnapshot(current: RoomSnapshot, next: RoomSnapshot): boolean {
  if (next.revision !== current.revision) return next.revision > current.revision;
  return Date.parse(next.serverNow) >= Date.parse(current.serverNow);
}

function advanceRoute(
  route: RouteState,
  position: LatLng,
  meters: number,
  map: LeafletMap,
): { position: LatLng; finished: boolean } {
  let nextPosition = position;
  let remaining = meters;
  while (remaining > 0 && route.index < route.coords.length - 1) {
    const target = route.coords[route.index + 1];
    const segment = map.distance(nextPosition, target);
    if (segment <= remaining) {
      nextPosition = target;
      route.index += 1;
      remaining -= segment;
    } else {
      const ratio = segment > 0 ? remaining / segment : 1;
      nextPosition = [
        nextPosition[0] + (target[0] - nextPosition[0]) * ratio,
        nextPosition[1] + (target[1] - nextPosition[1]) * ratio,
      ];
      remaining = 0;
    }
  }
  return { position: nextPosition, finished: route.index >= route.coords.length - 1 };
}

function roleLabel(role: "hunter" | "runner"): string {
  return role === "hunter" ? "ÜLDÖZŐ" : "MENEKÜLŐ";
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "online") return "KAPCSOLÓDVA";
  if (connection === "connecting") return "KAPCSOLÓDÁS";
  if (connection === "reconnecting") return "ÚJRACSATLAKOZÁS";
  return "KAPCSOLAT NÉLKÜL";
}

function shouldUseMobileMapMode(): boolean {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const limitedCpu = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  return coarsePointer || appleMobile || limitedCpu;
}

export default function MultiplayerGame({ session, initialRoom, onExit }: MultiplayerGameProps) {
  const [room, setRoom] = useState(initialRoom);
  const ZONES = useMemo(() => getCityZones(room.cityId).map((zone) => ({ ...zone, center: [zone.lat, zone.lng] as LatLng })), [room.cityId]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [routeMessage, setRouteMessage] = useState("Kattints egy közeli útra az induláshoz");
  const [alert, setAlert] = useState<AlertState>(null);
  const [clockNow, setClockNow] = useState(() => Date.parse(initialRoom.serverNow));
  const [leaving, setLeaving] = useState(false);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [handoffCandidates, setHandoffCandidates] = useState<HandoffCandidate[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [cameraFollowing, setCameraFollowing] = useState(true);

  const roomRef = useRef(initialRoom);
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const selfMarkerRef = useRef<Marker | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const zoneLayersRef = useRef<Circle[]>([]);
  const signalMarkersRef = useRef(new Map<string, Marker>());
  const civilianMarkersRef = useRef(new Map<string, Marker>());
  const exposedMarkersRef = useRef(new Map<string, Marker>());
  const lastExitMarkersRef = useRef(new Map<string, Marker>());
  const routeRef = useRef<RouteState>({ coords: [], index: 0 });
  const localPositionRef = useRef<LatLng | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const serverOffsetRef = useRef(0);
  const lastSignalIndexRef = useRef(initialRoom.game?.signalIndex ?? 0);
  const lastCivilianIndexRef = useRef(initialRoom.game?.civilianReportIndex ?? 0);
  const lastCapturedCountRef = useRef(initialRoom.game?.capturedCount ?? 0);
  const lastSentPositionRef = useRef<LatLng | null>(null);
  const lastServerWriteAtRef = useRef(0);
  const lastRoomRenderAtRef = useRef(0);
  const sendBusyRef = useRef(false);
  const lastCloseLevelRef = useRef<"none" | "near" | "critical">("none");
  const mobileMapModeRef = useRef(false);
  const cameraFollowingRef = useRef(true);
  const mountedRef = useRef(true);
  const planRouteRef = useRef<(target: LatLng) => void>(() => undefined);

  const me = useMemo(
    () => room.players.find((player) => player.id === room.meId) ?? null,
    [room],
  );
  const role = me?.role ?? "runner";

  const pauseCameraFollowing = useCallback(() => {
    if (!cameraFollowingRef.current) return;
    cameraFollowingRef.current = false;
    setCameraFollowing(false);
  }, []);

  const returnToCar = useCallback(() => {
    cameraFollowingRef.current = true;
    setCameraFollowing(true);
    const map = mapRef.current;
    const position = localPositionRef.current;
    if (!map || !position) return;
    const nearestDistance = roomRef.current.game?.nearestOpponentMeters;
    let minimumZoom = mobileMapModeRef.current ? 16 : 14;
    if (nearestDistance !== null && nearestDistance !== undefined && nearestDistance <= 300) minimumZoom = 17;
    if (nearestDistance !== null && nearestDistance !== undefined && nearestDistance <= 150) minimumZoom = 18;
    map.setView(position, Math.max(map.getZoom(), minimumZoom), {
      animate: !mobileMapModeRef.current,
    });
  }, []);

  const acceptSnapshot = useCallback((next: RoomSnapshot) => {
    if (!mountedRef.current) return;
    const currentRoom = roomRef.current;
    if (!newerSnapshot(currentRoom, next)) return;
    const nextServerOffset = Date.parse(next.serverNow) - Date.now();
    serverOffsetRef.current = serverOffsetRef.current * 0.35 + nextServerOffset * 0.65;
    if (next.revision === currentRoom.revision && Date.now() - lastRoomRenderAtRef.current < 5000) {
      roomRef.current = next;
      return;
    }
    const previousSignal = lastSignalIndexRef.current;
    const incomingSignal = next.game?.signalIndex ?? 0;
    if (incomingSignal > previousSignal) {
      lastSignalIndexRef.current = incomingSignal;
      const incomingMe = next.players.find((player) => player.id === next.meId);
      setAlert({
        kind: "signal",
        title: "HELYZETJEL ÉRKEZETT",
        detail: incomingMe?.role === "hunter"
          ? "A menekülők pillanatnyi helye rögzítve. A jelölők innen már nem mozognak."
          : "Az üldöző pillanatnyi helye rögzítve. A jelölő innen már nem mozog.",
      });
      const signalPoints = next.players
        .filter((player) => player.signalPosition)
        .map((player) => [player.signalPosition!.lat, player.signalPosition!.lng] as LatLng);
      const ownPoint = localPositionRef.current;
      if (incomingMe?.role === "hunter" && mapRef.current && signalPoints.length) {
        const wasFollowing = cameraFollowingRef.current;
        cameraFollowingRef.current = false;
        setCameraFollowing(false);
        if (wasFollowing) {
          mapRef.current.fitBounds(ownPoint ? [ownPoint, ...signalPoints] : signalPoints, {
            padding: [60, 60],
            maxZoom: 13,
            animate: !mobileMapModeRef.current,
          });
        }
      }
    }
    const incomingCivilian = next.game?.civilianReportIndex ?? 0;
    if (incomingCivilian > lastCivilianIndexRef.current) {
      lastCivilianIndexRef.current = incomingCivilian;
      const report = next.players.find((player) => player.civilianReport)?.civilianReport;
      setAlert({
        kind: "civilian",
        title: "CIVIL BEJELENTÉS",
        detail: report?.accuracy === "misleading"
          ? "A bejelentés gyanús és akár félrevezető is lehet."
          : report?.accuracy === "uncertain"
            ? "A helyszín bizonytalan; kezeld keresési körzetként."
            : "A bejelentő határozott helyszínt adott meg.",
      });
    }
    const incomingCaptured = next.game?.capturedCount ?? 0;
    if (incomingCaptured > lastCapturedCountRef.current) {
      setAlert({
        kind: "capture",
        title: "CSATT! BILINCS",
        detail: `Új elfogás történt. Eredmény: ${incomingCaptured}/${next.game?.captureGoal ?? incomingCaptured}.`,
      });
    }
    lastCapturedCountRef.current = incomingCaptured;
    const ownPosition = next.players.find((player) => player.id === next.meId)?.position;
    if (!localPositionRef.current && ownPosition) {
      localPositionRef.current = [ownPosition.lat, ownPosition.lng];
      lastSentPositionRef.current = [ownPosition.lat, ownPosition.lng];
      selfMarkerRef.current?.setLatLng([ownPosition.lat, ownPosition.lng]);
      mapRef.current?.setView([ownPosition.lat, ownPosition.lng], mobileMapModeRef.current ? 16 : 14);
    }
    roomRef.current = next;
    lastRoomRenderAtRef.current = Date.now();
    setRoom(next);
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    mountedRef.current = true;
    serverOffsetRef.current = Date.parse(initialRoom.serverNow) - Date.now();
    const own = initialRoom.players.find((player) => player.id === initialRoom.meId)?.position;
    if (own) {
      localPositionRef.current = [own.lat, own.lng];
      lastSentPositionRef.current = [own.lat, own.lng];
    }
    return () => {
      mountedRef.current = false;
    };
  }, [initialRoom]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await getRoom(session);
        if (stopped) return;
        failures = 0;
        acceptSnapshot(next);
        setConnection("online");
        const recentlyUpdatedByMovement = Date.now() - lastServerWriteAtRef.current < 2500;
        timer = setTimeout(poll, recentlyUpdatedByMovement ? 6000 : 3000);
      } catch {
        if (stopped) return;
        failures += 1;
        setConnection(failures >= 3 ? "offline" : "reconnecting");
        timer = setTimeout(poll, Math.min(12_000, 1000 * 2 ** Math.min(failures, 4)));
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [acceptSnapshot, session]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now() + serverOffsetRef.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(() => setAlert(null), 4200);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const startedAtMs = room.startedAt ? Date.parse(room.startedAt) : clockNow;
  const elapsedSeconds = Math.max(0, (clockNow - startedAtMs) / 1000);
  const gameDuration = room.game?.durationSeconds ?? 7200;
  const nextSignalAtMs = room.game?.nextSignalAt ? Date.parse(room.game.nextSignalAt) : null;
  const nextCivilianAtMs = room.game?.nextCivilianReportAt ? Date.parse(room.game.nextCivilianReportAt) : null;
  const gameClock = {
    gameLeft: Math.max(0, gameDuration - elapsedSeconds),
    signalLeft: nextSignalAtMs === null ? 0 : Math.max(0, (nextSignalAtMs - clockNow) / 1000),
    civilianLeft: nextCivilianAtMs === null ? 0 : Math.max(0, (nextCivilianAtMs - clockNow) / 1000),
    phase: Math.min(ZONES.length - 1, Math.floor(elapsedSeconds / ZONE_SECONDS)),
    zoneLeft: Math.max(0, ZONE_SECONDS - (elapsedSeconds % ZONE_SECONDS)),
  };

  useEffect(() => {
    let disposed = false;
    let animationFrame = 0;
    let lastFrame = performance.now();
    let lastCameraFollow = 0;
    let resizeTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mapContainer: HTMLElement | null = null;
    let handleMapInteraction: (() => void) | null = null;
    let handleMapTouch: ((event: TouchEvent) => void) | null = null;
    let handleMapControlClick: ((event: MouseEvent) => void) | null = null;
    let handleMapKeydown: ((event: KeyboardEvent) => void) | null = null;
    const signalMarkers = signalMarkersRef.current;
    const civilianMarkers = civilianMarkersRef.current;
    const exposedMarkers = exposedMarkersRef.current;
    const lastExitMarkers = lastExitMarkersRef.current;
    void import("leaflet").then((L) => {
      if (disposed || !mapNodeRef.current) return;
      leafletRef.current = L;
      const mobileMapMode = shouldUseMobileMapMode();
      mobileMapModeRef.current = mobileMapMode;
      const frameInterval = mobileMapMode ? 50 : 1000 / 30;
      const firstZone = getCityZones(roomRef.current.cityId)[0];
      const initialPosition = localPositionRef.current ?? [firstZone.lat, firstZone.lng];
      const map = L.map(mapNodeRef.current, {
        zoomControl: false,
        minZoom: 8,
        maxZoom: 18,
        maxBounds: [[GAME_BOUNDS.south, GAME_BOUNDS.west], [GAME_BOUNDS.north, GAME_BOUNDS.east]],
        preferCanvas: true,
        zoomAnimation: !mobileMapMode,
        fadeAnimation: !mobileMapMode,
        markerZoomAnimation: !mobileMapMode,
        inertia: !mobileMapMode,
      }).setView(initialPosition, mobileMapMode ? 16 : 14);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        keepBuffer: mobileMapMode ? 1 : 2,
        updateWhenIdle: true,
        updateWhenZooming: false,
      }).addTo(map);
      L.control.zoom({ position: "bottomleft" }).addTo(map);
      mapContainer = map.getContainer();
      handleMapInteraction = () => pauseCameraFollowing();
      handleMapTouch = (event: TouchEvent) => {
        if (event.touches.length > 1) pauseCameraFollowing();
      };
      handleMapControlClick = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".leaflet-control-zoom")) pauseCameraFollowing();
      };
      handleMapKeydown = (event: KeyboardEvent) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "="].includes(event.key)) {
          pauseCameraFollowing();
        }
      };
      map.on("dragstart", handleMapInteraction);
      map.on("boxzoomstart", handleMapInteraction);
      mapContainer.addEventListener("wheel", handleMapInteraction, { passive: true });
      mapContainer.addEventListener("dblclick", handleMapInteraction, { passive: true });
      mapContainer.addEventListener("touchstart", handleMapTouch, { passive: true });
      mapContainer.addEventListener("click", handleMapControlClick, true);
      mapContainer.addEventListener("keydown", handleMapKeydown);
      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            map.invalidateSize({ pan: false, debounceMoveend: true });
          }, 180);
        });
        resizeObserver.observe(mapNodeRef.current);
      }

      const markerRole = roomRef.current.players.find((player) => player.id === roomRef.current.meId)?.role ?? "runner";
      const selfIcon = L.divIcon({
        className: `online-token-wrap online-${markerRole}-wrap`,
        html: `<span class="online-token">${markerRole === "hunter" ? "◎" : "◆"}</span><b>TE</b>`,
        iconSize: [58, 58],
        iconAnchor: [29, 29],
      });
      selfMarkerRef.current = L.marker(initialPosition, { icon: selfIcon, zIndexOffset: 1200 }).addTo(map);
      setMapReady(true);

      map.on("click", (event) => planRouteRef.current([event.latlng.lat, event.latlng.lng]));
      const animate = (frameTime: number) => {
        animationFrame = requestAnimationFrame(animate);
        if (document.hidden) {
          lastFrame = frameTime;
          return;
        }
        if (frameTime - lastFrame < frameInterval) return;
        const dt = Math.min(0.25, Math.max(0, (frameTime - lastFrame) / 1000));
        lastFrame = frameTime;
        const currentRoom = roomRef.current;
        const currentMe = currentRoom.players.find((player) => player.id === currentRoom.meId);
        const currentPosition = localPositionRef.current;
        if (
          currentPosition
          && routeRef.current.coords.length > 1
          && currentRoom.status === "playing"
          && currentMe
          && !currentMe.caught
          && (currentMe.role === "hunter" || currentMe.vehicle?.state === "driving")
        ) {
          const baseSpeed = currentMe.role === "hunter" ? HUNTER_SPEED : RUNNER_SPEED;
          const nearestDistance = currentRoom.game?.nearestOpponentMeters;
          const closeRatio = nearestDistance !== null && nearestDistance !== undefined && nearestDistance <= 300
            ? Math.max(0, Math.min(1, (nearestDistance - 50) / 250))
            : 1;
          const speed = baseSpeed * (0.72 + 0.28 * closeRatio);
          const advanced = advanceRoute(routeRef.current, currentPosition, speed * dt, map);
          localPositionRef.current = advanced.position;
          selfMarkerRef.current?.setLatLng(advanced.position);
          if (cameraFollowingRef.current && frameTime - lastCameraFollow >= 500) {
            map.panInside(advanced.position, { padding: [90, 90], animate: false });
            lastCameraFollow = frameTime;
          }
          if (advanced.finished) {
            routeRef.current = { coords: [], index: 0 };
            routeLineRef.current?.remove();
            routeLineRef.current = null;
            setRouteMessage("Megérkeztél · válassz új útpontot");
          }
        }
      };
      animationFrame = requestAnimationFrame(animate);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      if (mapContainer && handleMapInteraction) {
        mapContainer.removeEventListener("wheel", handleMapInteraction);
        mapContainer.removeEventListener("dblclick", handleMapInteraction);
      }
      if (mapRef.current && handleMapInteraction) {
        mapRef.current.off("dragstart", handleMapInteraction);
        mapRef.current.off("boxzoomstart", handleMapInteraction);
      }
      if (mapContainer && handleMapTouch) mapContainer.removeEventListener("touchstart", handleMapTouch);
      if (mapContainer && handleMapControlClick) mapContainer.removeEventListener("click", handleMapControlClick, true);
      if (mapContainer && handleMapKeydown) mapContainer.removeEventListener("keydown", handleMapKeydown);
      routeAbortRef.current?.abort();
      signalMarkers.forEach((marker) => marker.remove());
      signalMarkers.clear();
      civilianMarkers.forEach((marker) => marker.remove());
      civilianMarkers.clear();
      exposedMarkers.forEach((marker) => marker.remove());
      exposedMarkers.clear();
      lastExitMarkers.forEach((marker) => marker.remove());
      lastExitMarkers.clear();
      zoneLayersRef.current.forEach((layer) => layer.remove());
      zoneLayersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, [pauseCameraFollowing]);

  const planRoute = useCallback(async (target: LatLng) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const from = localPositionRef.current;
    const currentRoom = roomRef.current;
    const currentMe = currentRoom.players.find((player) => player.id === currentRoom.meId);
    if (!map || !L || !from || currentRoom.status !== "playing" || !currentMe || currentMe.caught) return;
    if (currentMe.role === "runner" && currentMe.vehicle?.state !== "driving") {
      setRouteMessage("Autó nélkül nem mozoghatsz");
      return;
    }
    if (map.distance(from, target) > 12_000) {
      setRouteMessage("Egyszerre legfeljebb 12 km-es útszakaszt válassz");
      return;
    }
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setRouteMessage("Közúti útvonal tervezése…");
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${target[1]},${target[0]}?overview=simplified&geometries=geojson`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("route");
      const data = await response.json() as { routes?: Array<{ distance?: number; geometry?: { coordinates?: [number, number][] } }> };
      const found = data.routes?.[0];
      const rawCoordinates = found?.geometry?.coordinates;
      if (!rawCoordinates?.length) throw new Error("route");
      const coords = rawCoordinates.map(([lng, lat]) => [lat, lng] as LatLng);
      routeRef.current = { coords: [from, ...coords], index: 0 };
      if (currentMe.role === "runner") {
        const startedAt = currentRoom.startedAt ? Date.parse(currentRoom.startedAt) : Date.now();
        const phase = Math.min(getCityZones(currentRoom.cityId).length - 1, Math.floor(Math.max(0, Date.now() + serverOffsetRef.current - startedAt) / (ZONE_SECONDS * 1000)));
        const zone = getCityZones(currentRoom.cityId)[phase];
        const usable = coords.filter((point) => map.distance(from, point) >= 120 && map.distance(point, [zone.lat, zone.lng]) <= zone.radius);
        const indexes = usable.length ? [0.25, 0.55, 0.85].map((ratio) => Math.min(usable.length - 1, Math.floor((usable.length - 1) * ratio))) : [];
        const unique = indexes.map((index) => usable[index]).filter((point, index, all) => all.findIndex((item) => item[0] === point[0] && item[1] === point[1]) === index);
        setHandoffCandidates(unique.map((point) => ({ point, distance: Math.round(map.distance(from, point)) })));
      }
      routeLineRef.current?.remove();
      routeLineRef.current = L.polyline(routeRef.current.coords, {
        color: currentMe.role === "hunter" ? "#36bffa" : "#ff8a45",
        weight: mobileMapModeRef.current ? 4 : 5,
        opacity: 0.9,
        dashArray: mobileMapModeRef.current ? undefined : "8 9",
      }).addTo(map);
      setRouteMessage(`${((found?.distance ?? 0) / 1000).toFixed(1)} km · útközben bármikor válthatsz irányt`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRouteMessage("Erre most nem sikerült közúti útvonalat találni");
    }
  }, []);

  useEffect(() => {
    planRouteRef.current = (target) => void planRoute(target);
  }, [planRoute]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    zoneLayersRef.current.forEach((layer) => layer.remove());
    zoneLayersRef.current = [];
    const current = ZONES[gameClock.phase];
    const next = ZONES[Math.min(gameClock.phase + 1, ZONES.length - 1)];
    zoneLayersRef.current.push(
      L.circle(current.center, {
        radius: current.radius,
        color: "#40d98a",
        fillColor: "#40d98a",
        fillOpacity: 0.06,
        weight: 3,
      }).addTo(map).bindTooltip(`Aktív zóna: ${current.name}`),
    );
    if (gameClock.phase < ZONES.length - 1) {
      zoneLayersRef.current.push(
        L.circle(next.center, {
          radius: next.radius,
          color: "#ff8a45",
          fillColor: "#ff8a45",
          fillOpacity: 0.035,
          weight: 2,
          dashArray: "10 12",
        }).addTo(map).bindTooltip(`Következő zóna: ${next.name}`),
      );
    }
  }, [gameClock.phase, mapReady, ZONES]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const visibleSignals = room.players.filter((player) => player.signalPosition);
    const visibleIds = new Set(visibleSignals.map((player) => player.id));
    signalMarkersRef.current.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.remove();
        signalMarkersRef.current.delete(id);
      }
    });
    visibleSignals.forEach((player, index) => {
      const position = player.signalPosition;
      if (!position) return;
      const existing = signalMarkersRef.current.get(player.id);
      if (existing) {
        existing.setLatLng([position.lat, position.lng]);
        return;
      }
      const icon = L.divIcon({
        className: `online-signal-wrap online-signal-${player.role}`,
        html: `<span>${player.role === "hunter" ? "◎" : index + 1}</span><i></i>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      const marker = L.marker([position.lat, position.lng], { icon, zIndexOffset: 900 })
        .addTo(map)
        .bindTooltip(`${player.nickname} · utolsó 10 perces hivatalos jel`);
      signalMarkersRef.current.set(player.id, marker);
    });
  }, [mapReady, room.players, room.game?.signalIndex]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const reports = room.players.filter((player) => player.civilianReport);
    civilianMarkersRef.current.forEach((marker) => marker.remove());
    civilianMarkersRef.current.clear();
    reports.forEach((player) => {
      const report = player.civilianReport;
      if (!report) return;
      const icon = L.divIcon({
        className: `online-civilian-wrap online-civilian-${report.accuracy}`,
        html: `<span>☎</span><i></i>`,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
      const accuracy = report.accuracy === "confirmed"
        ? "határozott"
        : report.accuracy === "uncertain"
          ? "bizonytalan"
          : "gyanús";
      const marker = L.marker([report.lat, report.lng], { icon, zIndexOffset: 875 })
        .addTo(map)
        .bindTooltip(`Civil bejelentés · ${accuracy} · ${player.role === "hunter" ? "üldöző" : "menekülő"}`);
      civilianMarkersRef.current.set(player.id, marker);
    });
  }, [mapReady, room.players, room.game?.civilianReportIndex]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const exposedPlayers = room.players.filter(
      (player) => player.id !== room.meId && player.liveTracked && player.position && !player.caught,
    );
    const exposedIds = new Set(exposedPlayers.map((player) => player.id));
    exposedMarkersRef.current.forEach((marker, id) => {
      if (!exposedIds.has(id)) {
        marker.remove();
        exposedMarkersRef.current.delete(id);
      }
    });
    exposedPlayers.forEach((player) => {
      const position = player.position;
      if (!position) return;
      const existing = exposedMarkersRef.current.get(player.id);
      if (existing) {
        existing.setLatLng([position.lat, position.lng]);
        return;
      }
      const icon = L.divIcon({
        className: "online-exposed-wrap",
        html: '<span>!</span><i></i>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      const marker = L.marker([position.lat, position.lng], { icon, zIndexOffset: 1050 })
        .addTo(map)
        .bindTooltip(`${player.nickname} · ${player.exposed ? "zónán kívül" : "túlidős autó"}, élő helyzet`);
      exposedMarkersRef.current.set(player.id, marker);
    });
  }, [mapReady, room.meId, room.players]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const visible = room.players.filter((player) => player.lastExitPosition && !player.caught);
    const visibleIds = new Set(visible.map((player) => player.id));
    lastExitMarkersRef.current.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.remove();
        lastExitMarkersRef.current.delete(id);
      }
    });
    visible.forEach((player) => {
      const position = player.lastExitPosition;
      if (!position) return;
      const existing = lastExitMarkersRef.current.get(player.id);
      if (existing) {
        existing.setLatLng([position.lat, position.lng]);
        return;
      }
      const icon = L.divIcon({
        className: "online-exit-wrap",
        html: "<span>▣</span>",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      const marker = L.marker([position.lat, position.lng], { icon, zIndexOffset: 980 })
        .addTo(map)
        .bindTooltip(`${player.nickname} · kiszállás utolsó ismert helye`);
      lastExitMarkersRef.current.set(player.id, marker);
    });
  }, [mapReady, room.players]);

  useEffect(() => {
    const distance = room.game?.nearestOpponentMeters;
    const map = mapRef.current;
    const own = localPositionRef.current;
    const previousLevel = lastCloseLevelRef.current;
    let nextLevel: "none" | "near" | "critical" = "none";
    if (distance !== null && distance !== undefined) {
      if (distance <= 150 || (previousLevel === "critical" && distance <= 180)) nextLevel = "critical";
      else if (distance <= 300 || (previousLevel !== "none" && distance <= 360)) nextLevel = "near";
    }
    if (!map || !own || nextLevel === lastCloseLevelRef.current) return;
    lastCloseLevelRef.current = nextLevel;
    if (!cameraFollowingRef.current) return;
    let targetZoom = mobileMapModeRef.current ? 16 : 14;
    if (nextLevel === "near") targetZoom = 17;
    if (nextLevel === "critical") targetZoom = 18;
    if (mobileMapModeRef.current) map.setView(own, targetZoom, { animate: false });
    else map.flyTo(own, targetZoom, { duration: 0.8 });
  }, [mapReady, room.game?.nearestOpponentMeters]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const currentRoom = roomRef.current;
      const currentMe = currentRoom.players.find((player) => player.id === currentRoom.meId);
      const position = localPositionRef.current;
      if (!position || !currentMe || currentRoom.status !== "playing" || currentMe.caught || sendBusyRef.current) return;
      if (currentMe.role === "runner" && currentMe.vehicle?.state !== "driving") return;
      const previous = lastSentPositionRef.current;
      const moved = !previous || mapRef.current?.distance(previous, position) !== 0;
      if (!moved && Date.now() - lastServerWriteAtRef.current < 6000) return;
      sendBusyRef.current = true;
      try {
        const next = moved
          ? await patchRoom(session, { action: "position", lat: position[0], lng: position[1] })
          : await patchRoom(session, { action: "heartbeat" });
        lastSentPositionRef.current = position;
        lastServerWriteAtRef.current = Date.now();
        acceptSnapshot(next);
        setConnection("online");
      } catch (error) {
        setConnection("reconnecting");
        if (error instanceof RoomApiError && error.code === "MOVEMENT_TOO_FAST") {
          routeRef.current = { coords: [], index: 0 };
          routeLineRef.current?.remove();
          routeLineRef.current = null;
          setRouteMessage("A szerver túl nagy ugrást állított meg · az útvonal újraszinkronizálva");
          try {
            const fresh = await getRoom(session);
            const own = fresh.players.find((player) => player.id === fresh.meId)?.position;
            if (own) {
              localPositionRef.current = [own.lat, own.lng];
              selfMarkerRef.current?.setLatLng([own.lat, own.lng]);
              lastSentPositionRef.current = [own.lat, own.lng];
            }
            acceptSnapshot(fresh);
          } catch {
            setConnection("offline");
          }
        }
      } finally {
        sendBusyRef.current = false;
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [acceptSnapshot, session]);

  useEffect(() => {
    if (me?.caught || (me?.role === "runner" && me.vehicle?.state !== "driving")) {
      routeRef.current = { coords: [], index: 0 };
      routeLineRef.current?.remove();
      routeLineRef.current = null;
    }
  }, [me?.caught, me?.role, me?.vehicle?.state]);

  const handleVehicleAction = async (action: "exit" | "prearranged" | "hitchhike") => {
    if (vehicleBusy) return;
    setVehicleBusy(true);
    if (action === "exit") {
      routeRef.current = { coords: [], index: 0 };
      routeLineRef.current?.remove();
      routeLineRef.current = null;
      setRouteMessage("Kiszálltál · válassz új autót");
    }
    try {
      const next = action === "exit"
        ? await patchRoom(session, { action: "exit_vehicle" })
        : await patchRoom(session, { action: "start_vehicle_switch", kind: action });
      acceptSnapshot(next);
      setAlert(action === "exit"
        ? { kind: "info", title: "KISZÁLLTÁL", detail: "Az utolsó helyed 60 másodpercig látható az üldözőnek." }
        : { kind: "info", title: action === "prearranged" ? "AUTÓ ÁTVÉTELE" : "STOPPOLÁS", detail: "Maradj egy helyben a visszaszámláló végéig." });
    } catch (error) {
      setAlert({ kind: "info", title: "AUTÓVÁLTÁS SIKERTELEN", detail: error instanceof Error ? error.message : "Próbáld újra." });
    } finally {
      setVehicleBusy(false);
    }
  };

  const handleHandoffSelection = async (point: LatLng) => {
    if (vehicleBusy) return;
    setVehicleBusy(true);
    try {
      const next = await patchRoom(session, { action: "select_handoff", lat: point[0], lng: point[1] });
      acceptSnapshot(next);
      setAlert({ kind: "info", title: "ÁTADÁSI PONT RÖGZÍTVE", detail: "Érj 75 méteren belülre, majd szállj ki az autóból." });
    } catch (error) {
      setAlert({ kind: "info", title: "A PONT NEM HASZNÁLHATÓ", detail: error instanceof Error ? error.message : "Válassz másik közúti pontot." });
    } finally {
      setVehicleBusy(false);
    }
  };

  const handleLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await patchRoom(session, { action: "leave" });
    } catch {
      // A helyi munkamenetet akkor is lezárjuk, ha a kapcsolat éppen megszakadt.
    }
    try {
      window.localStorage.removeItem(SESSION_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // A kilépés memóriában ettől még megtörténik.
    }
    onExit();
  };

  const nearest = room.game?.nearestOpponentMeters;
  const closeLevel = nearest !== null && nearest !== undefined && nearest <= 300
    ? (nearest <= 150 ? "critical" : "near")
    : "none";
  const activeZone = ZONES[gameClock.phase];
  const nextZone = ZONES[Math.min(gameClock.phase + 1, ZONES.length - 1)];
  const winner = room.game?.winner;
  const runnerCount = room.players.filter((player) => player.role === "runner").length;
  const vehicle = me?.vehicle;
  const vehicleLeft = vehicle?.expiresAt ? Math.max(0, (Date.parse(vehicle.expiresAt) - clockNow) / 1000) : 0;
  const switchLeft = vehicle?.switchEndsAt ? Math.max(0, (Date.parse(vehicle.switchEndsAt) - clockNow) / 1000) : 0;
  const vehicleWarning = vehicle?.overdue ? "overdue" : vehicleLeft <= 10 ? "danger" : vehicleLeft <= 30 ? "warning" : "normal";
  const civilianTarget = room.players.find((player) => player.civilianReport) ?? null;
  const civilianReport = civilianTarget?.civilianReport ?? null;
  const officialSignals = room.players.filter((player) => player.signalPosition);
  const focusPoints = (points: LatLng[], maxZoom = 15) => {
    const map = mapRef.current;
    if (!map || !points.length) return;
    pauseCameraFollowing();
    if (points.length === 1) map.setView(points[0], maxZoom, { animate: !mobileMapModeRef.current });
    else map.fitBounds(points, { padding: [55, 55], maxZoom, animate: !mobileMapModeRef.current });
  };
  const focusCivilianReport = () => {
    if (!civilianReport) {
      setAlert({ kind: "info", title: "NINCS FRISS BEJELENTÉS", detail: "A következő civil hívás 30–60 másodpercen belül várható." });
      return;
    }
    focusPoints([[civilianReport.lat, civilianReport.lng]], 16);
  };
  const focusOfficialSignal = () => {
    const points = officialSignals.map((player) => [player.signalPosition!.lat, player.signalPosition!.lng] as LatLng);
    if (!points.length) {
      setAlert({ kind: "info", title: "NINCS HIVATALOS JEL", detail: "A pontos pillanatkép 10 percenként érkezik." });
      return;
    }
    focusPoints(points, 14);
  };
  const focusActiveZone = () => focusPoints([activeZone.center], 13);

  return (
    <main className={`${styles.page} ${styles[`role_${role}`]} ${styles[`close_${closeLevel}`]}`}>
      <section className={styles.gameFrame}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>KE</span>
            <span className={styles.brandCopy}>
              <strong>KAPJ EL, HA TUDSZ!</strong>
              <small>KÖZÖS TÉRKÉP / {getCity(room.cityId)?.name}</small>
            </span>
          </div>
          <div className={styles.headerStatus}>
            <span className={`${styles.connection} ${styles[`connection_${connection}`]}`}><i />{connectionLabel(connection)}</span>
            <span className={styles.roomCode}><small>SZOBA</small>{room.code}</span>
            <button type="button" onClick={handleLeave} disabled={leaving}>{leaving ? "KILÉPÉS…" : "KILÉPÉS"}</button>
          </div>
        </header>

        <div className={styles.layout}>
          <section className={styles.mapPanel}>
            <div ref={mapNodeRef} className={styles.map} aria-label={`${city.name} közös hajszatérképe`} />
            <div className={styles.mapGrid} aria-hidden="true" />
            <div className={styles.mapCorners} aria-hidden="true"><i /><i /><i /><i /></div>

            <button
              type="button"
              className={`${styles.followButton} ${cameraFollowing ? styles.followActive : styles.followPaused}`}
              onClick={cameraFollowing ? pauseCameraFollowing : returnToCar}
              aria-pressed={cameraFollowing}
              aria-label={cameraFollowing ? "Szabad térképnézet bekapcsolása" : "Visszatérés a saját autóhoz és a kamerakövetés bekapcsolása"}
              title={cameraFollowing ? "Szabad térképnézet" : "Vissza az autóhoz"}
            >
              <span>⌖</span>
              <span><small>{cameraFollowing ? "KAMERA" : "AUTÓD TOVÁBB HALAD"}</small><strong>{cameraFollowing ? "SZABAD NÉZET" : "VISSZA AZ AUTÓHOZ"}</strong></span>
            </button>

            <div className={styles.roleCard}>
              <span className={styles.roleGlyph}>{role === "hunter" ? "◎" : "◆"}</span>
              <span><small>A SZEREPED</small><strong>{roleLabel(role)}</strong></span>
            </div>

            <div className={styles.signalHud}>
              <span className={styles.signalPulse} />
              <span><small>{role === "hunter" ? "MENEKÜLŐK HIVATALOS JELE" : "ÜLDÖZŐ HIVATALOS JELE"}</small><strong>{formatTime(gameClock.signalLeft)}</strong></span>
              <div><i style={{ width: `${Math.max(0, Math.min(100, 100 - gameClock.signalLeft / (room.game?.signalEverySeconds ?? 600) * 100))}%` }} /></div>
            </div>

            <div className={styles.civilianHud}>
              <span>☎</span>
              <span><small>KÖVETKEZŐ CIVIL HÍVÁS</small><strong>{formatTime(gameClock.civilianLeft)}</strong></span>
            </div>

            {closeLevel !== "none" && (
              <div className={`${styles.closeAlert} ${styles[`closeAlert_${closeLevel}`]}`} role="alert">
                <strong>{closeLevel === "critical" ? "VÉGHAJRÁ" : "KÖZELI HAJSZA"}</strong>
                <span>Az ellenfél {Math.round(nearest ?? 0)} méteren belül van</span>
              </div>
            )}

            {alert && (
              <div className={`${styles.eventAlert} ${styles[`event_${alert.kind}`]}`} role="status">
                <span>{alert.kind === "signal" ? "⌁" : alert.kind === "civilian" ? "☎" : alert.kind === "capture" ? "⛓" : "!"}</span>
                <div><strong>{alert.title}</strong><small>{alert.detail}</small></div>
              </div>
            )}

            <div className={styles.routeBar}>
              <span>ÚTVONAL</span><i /><p>{me?.caught ? "Elfogtak · a jármű nem mozgatható" : routeMessage}</p>
            </div>

            {me?.caught && room.status === "playing" && (
              <div className={styles.caughtOverlay} role="dialog" aria-label="Elfogtak">
                <span>⛓</span><strong>CSATT! ELFOGTAK.</strong>
                <small>A közös játszma folytatódik; a csapat állapotát továbbra is látod.</small>
              </div>
            )}

            {room.status === "finished" && (
              <div className={styles.finishOverlay} role="dialog" aria-modal="true" aria-label="A hajsza végeredménye">
                <span className={styles.kicker}>A KÖZÖS HAJSZA VÉGET ÉRT</span>
                <h1>{winner === "hunter" ? "Az üldöző nyert." : "A menekülők kitartottak."}</h1>
                <p>{winner === "hunter" ? `${room.game?.capturedCount ?? 0} menekülő került bilincsbe.` : "Lejárt a játékidő, mielőtt teljesült volna az elfogási cél."}</p>
                <button type="button" onClick={handleLeave}>VISSZA A FŐMENÜBE</button>
              </div>
            )}
          </section>

          <aside className={styles.sidebar}>
            <section className={`${styles.panel} ${styles.operationsPanel} ${role === "hunter" ? styles.hunterOperations : styles.runnerOperations}`}>
              <div className={styles.panelHead}>
                <span>{role === "hunter" ? "ÜLDÖZŐI PARANCSKÖZPONT" : "MENEKÜLÉSI TERV"}</span>
                <b><i />TÁVOLSÁG REJTVE</b>
              </div>
              <div className={styles.intelStatus}>
                <span>{civilianReport ? "☎" : "…"}</span>
                <p>
                  <strong>{civilianReport ? `CIVIL JELENTÉS · ${civilianReport.accuracy === "confirmed" ? "HATÁROZOTT" : civilianReport.accuracy === "uncertain" ? "BIZONYTALAN" : "GYANÚS"}` : "NINCS AKTÍV CIVIL JELENTÉS"}</strong>
                  <small>{civilianTarget ? `${civilianTarget.role === "hunter" ? "Az üldözőt" : "Egy menekülőt"} látták ezen a környéken. A hívás lehet pontatlan vagy hamis.` : "Új bejelentés 30–60 másodpercenként érkezhet."}</small>
                </p>
              </div>
              <div className={styles.strategyButtons}>
                <button type="button" onClick={focusCivilianReport}><span>☎</span><strong>{role === "hunter" ? "CIVIL NYOM" : "VESZÉLYJEL"}</strong><small>TÉRKÉPEN</small></button>
                <button type="button" onClick={focusOfficialSignal}><span>⌁</span><strong>HIVATALOS JEL</strong><small>10 PERCES</small></button>
                <button type="button" onClick={focusActiveZone}><span>▱</span><strong>{role === "hunter" ? "KERESÉSI ZÓNA" : "MENEKÜLÉSI ZÓNA"}</strong><small>AKTÍV</small></button>
              </div>
              <p className={styles.captureRule}>Az ellenfél távolsága és iránya rejtett. 50 méteren belül az elfogás automatikus.</p>
            </section>

            <section className={styles.stats}>
              <div><small>HÁTRALÉVŐ IDŐ</small><strong>{formatTime(gameClock.gameLeft)}</strong></div>
              <div><small>ELFOGVA</small><strong>{room.game?.capturedCount ?? 0}<i>/{room.game?.captureGoal ?? Math.min(4, runnerCount)}</i></strong></div>
            </section>

            {role === "runner" && vehicle && (
              <section className={`${styles.panel} ${styles.vehiclePanel} ${styles[`vehicle_${vehicle.state}`]} ${styles[`vehicle_${vehicleWarning}`]}`}>
                <div className={styles.panelHead}>
                  <span>AUTÓ · {String(vehicle.cycle + 1).padStart(2, "0")}</span>
                  <b><i />{vehicle.overdue ? "ÉLŐBEN LÁTHATÓ" : vehicle.state === "driving" ? "MENETBEN" : "MOZDULATLAN"}</b>
                </div>
                {vehicle.state === "driving" ? (
                  <>
                    <div className={styles.vehicleClock}>{vehicle.overdue ? "TÚLIDŐ" : formatTime(vehicleLeft)}</div>
                    <p>{vehicle.overdue ? "Az üldöző folyamatosan lát, amíg ki nem szállsz." : vehicleWarning === "danger" ? "10 másodpercen belül cserélj autót!" : vehicleWarning === "warning" ? "Hamarosan autót kell cserélned." : "Öt perc után az üldöző élőben látni fog."}</p>
                    {vehicleLeft <= 60 && !vehicle.overdue && (
                      <div className={styles.handoffChoices}>
                        <small>VÁLASSZ ÁTADÁSI PONTOT</small>
                        {handoffCandidates.length ? (
                          <div>{handoffCandidates.map((candidate, index) => {
                            const point = candidate.point;
                            const selected = vehicle.handoffPoint && Math.abs(vehicle.handoffPoint.lat - point[0]) < 0.00001 && Math.abs(vehicle.handoffPoint.lng - point[1]) < 0.00001;
                            return <button type="button" key={`${point[0]}-${point[1]}`} className={selected ? styles.handoffSelected : ""} disabled={vehicleBusy} onClick={() => void handleHandoffSelection(point)}>{String.fromCharCode(65 + index)}<span>{candidate.distance} m</span></button>;
                          })}</div>
                        ) : <p>Jelölj ki előbb egy közúti útvonalat.</p>}
                      </div>
                    )}
                    <button type="button" className={styles.exitVehicleButton} disabled={vehicleBusy} onClick={() => void handleVehicleAction("exit")}>KISZÁLLOK</button>
                  </>
                ) : vehicle.state === "dismounted" ? (
                  <>
                    <div className={styles.vehicleClock}>ÁLLSZ</div>
                    <p>Gyalogos mozgás nincs. Válaszd ki a következő autót.</p>
                    <div className={styles.switchButtons}>
                      <button type="button" disabled={vehicleBusy || !vehicle.handoffPoint} onClick={() => void handleVehicleAction("prearranged")}><strong>EGYEZTETETT AUTÓ</strong><small>{vehicle.handoffPoint ? "10 MÁSODPERC" : "NINCS KIJELÖLT PONT"}</small></button>
                      <button type="button" disabled={vehicleBusy} onClick={() => void handleVehicleAction("hitchhike")}><strong>STOPPOLOK</strong><small>25–45 MÁSODPERC</small></button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.vehicleClock}>{formatTime(switchLeft)}</div>
                    <p>{vehicle.switchKind === "prearranged" ? "Az előre egyeztetett autó átvétele folyamatban." : "Vársz a következő stoppolt autóra."}</p>
                    <div className={styles.switchProgress}><i style={{ width: `${Math.max(0, Math.min(100, vehicle.switchKind === "prearranged" ? (1 - switchLeft / 10) * 100 : (1 - switchLeft / 45) * 100))}%` }} /></div>
                  </>
                )}
              </section>
            )}

            <section className={`${styles.panel} ${styles.zonePanel}`}>
              <div className={styles.panelHead}><span>MOZGÓ JÁTÉKTÉR · {gameClock.phase + 1}/{ZONES.length}</span><b className={styles.green}><i />AKTÍV</b></div>
              <div className={styles.zoneRoute}>
                <div><small>JELENLEGI</small><strong>{activeZone.name}</strong></div>
                <span>→</span>
                <div><small>KÖVETKEZŐ</small><strong>{nextZone.name}</strong></div>
              </div>
              <div className={styles.zoneMeter}><i style={{ width: `${Math.max(0, Math.min(100, 100 - gameClock.zoneLeft / ZONE_SECONDS * 100))}%` }} /></div>
              <p><span>Zónaváltásig</span><b>{formatTime(gameClock.zoneLeft)}</b></p>
            </section>

            <section className={`${styles.panel} ${styles.signalPanel}`}>
              <div className={styles.panelHead}><span>HELYZETJEL</span><b><i />#{room.game?.signalIndex ?? 0}</b></div>
              <div className={styles.signalRule}>
                <span>10</span>
                <p><strong>10 PERCENKÉNTI PILLANATKÉP</strong><small>{role === "hunter" ? "A menekülők jelölője megjelenik, majd a következő jelig ott marad." : "Az üldöző jelölője megjelenik, majd a következő jelig ott marad."}</small></p>
              </div>
            </section>

            <section className={`${styles.panel} ${styles.rosterPanel}`}>
              <div className={styles.panelHead}><span>JÁTÉKOSOK</span><b>{room.players.filter((player) => player.connected).length}/{room.players.length} ONLINE</b></div>
              <div className={styles.roster}>
                {room.players.map((player) => (
                  <div key={player.id} className={`${player.id === room.meId ? styles.isMe : ""} ${player.caught ? styles.isCaught : ""}`}>
                    <span className={player.role === "hunter" ? styles.hunterDot : styles.runnerDot}>{player.role === "hunter" ? "⌖" : "➤"}</span>
                    <p><strong>{player.nickname}{player.id === room.meId ? " · TE" : ""}</strong><small>{roleLabel(player.role)}{player.caught ? " · ELFOGVA" : player.exposed ? " · ZÓNÁN KÍVÜL" : ""}</small></p>
                    <i className={player.connected ? styles.onlineDot : styles.offlineDot} title={player.connected ? "Online" : "Kapcsolat nélkül"} />
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}


