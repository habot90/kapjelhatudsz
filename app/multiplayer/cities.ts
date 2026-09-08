import { VERIFIED_ROAD_STARTS } from "./road-starts";
export type MapPoint = { lat: number; lng: number };
export type ChaseZone = MapPoint & { name: string; radius: number };

export const DEFAULT_CITY_ID = "budapest";
export const COUNTRIES = [
  { id: "hu", name: "Magyarország" },
  { id: "ro", name: "Románia" },
] as const;
export function cityCountry(id: string) { return id === "budapest" ? "hu" : "ro"; }
// Coarse safety envelope shared by map navigation and server validation.
// Timed chase zones remain city-specific; this is not a national border polygon.
export const GAME_BOUNDS = { south: 43.45, north: 48.65, west: 16.05, east: 30.35 } as const;

// Approximate gameplay centres, not administrative city boundaries.
export const CITIES = [
  { id: "budapest", name: "Budapest", lat: 47.4979, lng: 19.0548 },
  { id: "bucharest", name: "Bukarest / București", lat: 44.4268, lng: 26.1025 },
  { id: "arad", name: "Arad", lat: 46.175, lng: 21.312 },
  { id: "cluj", name: "Kolozsvár / Cluj-Napoca", lat: 46.77, lng: 23.59 },
  { id: "oradea", name: "Nagyvárad / Oradea", lat: 47.057, lng: 21.928 },
  { id: "timisoara", name: "Temesvár / Timișoara", lat: 45.754, lng: 21.225 },
  { id: "brasov", name: "Brassó / Brașov", lat: 45.65, lng: 25.6 },
  { id: "targu-mures", name: "Marosvásárhely / Târgu Mureș", lat: 46.545, lng: 24.563 },
  { id: "sibiu", name: "Nagyszeben / Sibiu", lat: 45.793, lng: 24.151 },
  { id: "satu-mare", name: "Szatmárnémeti / Satu Mare", lat: 47.79, lng: 22.88 },
  { id: "miercurea-ciuc", name: "Csíkszereda / Miercurea Ciuc", lat: 46.36, lng: 25.8 },
  { id: "iasi", name: "Iași", lat: 47.163, lng: 27.588 },
  { id: "constanta", name: "Konstanca / Constanța", lat: 44.18, lng: 28.64 },
] as const;

export function getCity(id: unknown) {
  return CITIES.find((city) => city.id === id);
}

export function offsetPoint(center: MapPoint, north: number, east: number): MapPoint {
  return { lat: center.lat + north / 111320, lng: center.lng + east / (111320 * Math.cos(center.lat * Math.PI / 180)) };
}

export function getCityZones(id: string): ChaseZone[] {
  const city = getCity(id);
  if (!city) throw new Error("Unknown city");
  if (id === "bucharest") return [
    { name: "Bukarest központ", lat: 44.4268, lng: 26.1025, radius: 6500 },
    { name: "Pipera–Voluntari", lat: 44.489, lng: 26.125, radius: 6000 },
    { name: "Pantelimon", lat: 44.445, lng: 26.205, radius: 5600 },
    { name: "Popești-Leordeni", lat: 44.374, lng: 26.17, radius: 5200 },
    { name: "Berceni", lat: 44.37, lng: 26.095, radius: 4700 },
    { name: "Drumul Taberei", lat: 44.42, lng: 26.01, radius: 4200 },
    { name: "Chitila", lat: 44.505, lng: 25.985, radius: 3600 },
    { name: "Otopeni finálé", lat: 44.55, lng: 26.072, radius: 2600 },
  ];
  const stages = [
    [0, 0, 6500, "induló zóna"], [1100, 0, 6000, "észak"],
    [800, 1000, 5500, "északkelet"], [0, 1200, 5000, "kelet"],
    [-900, 600, 4400, "dél"], [-700, -700, 3800, "délnyugat"],
    [400, -800, 3200, "nyugat"], [0, 0, 2600, "finálé"],
  ] as const;
  return stages.map(([north, east, radius, name]) => ({ ...offsetPoint(city, north, east), radius, name: `${city.name.split(" / ")[0]} · ${name}` }));
}

export function getStartSeeds(id: string): MapPoint[] {
  const city = getCity(id);
  if (!city) throw new Error("Unknown city");
  // Keep the coastal city's initial ring on land, away from the harbour/sea.
  const center = id === "constanta" ? offsetPoint(city, 0, -2200) : city;
  return [center, ...Array.from({ length: 10 }, (_, i) => {
    const angle = i * Math.PI * 2 / 10;
    return offsetPoint(center, Math.cos(angle) * 2700, Math.sin(angle) * 2700);
  })];
}

export async function roadStarts(id: string, request?: typeof fetch): Promise<MapPoint[]> {
  if (!request) {
    const verified = VERIFIED_ROAD_STARTS[id];
    if (!verified || verified.length !== 11) throw new Error("No verified road starts");
    return verified.map((point) => ({ ...point }));
  }
  return Promise.all(getStartSeeds(id).map(async (point) => {
    const response = await request(`https://router.project-osrm.org/nearest/v1/driving/${point.lng},${point.lat}?number=1`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Road service unavailable");
    const data = await response.json() as { code?: string; waypoints?: { distance: number; location: number[] }[] };
    const waypoint = data.waypoints?.[0];
    if (data.code !== "Ok" || !waypoint || !Number.isFinite(waypoint.distance) || waypoint.distance > 500 || waypoint.location.length !== 2 || !waypoint.location.every(Number.isFinite)) {
      throw new Error("No nearby road start");
    }
    return { lat: waypoint.location[1], lng: waypoint.location[0] };
  }));
}
