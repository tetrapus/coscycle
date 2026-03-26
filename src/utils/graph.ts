export type Coordinate = [number, number]; // [lon, lat]

export interface Edge {
  targetId: string;
  distance: number;
  cost: number;
  originalCost: number;
  speedKmph: number;
  facility: string;
  name: string;
}

export function getFacilitySpeedKmph(facility: string): number {
  switch (facility) {
    case 'Separated Path':
    case 'Bicycle Path':
      return 25;
    case 'Shared Use Path':
    case 'Shared Zone':
      return 10;
    case 'Bicycle Lane':
    case 'Contra-flow Permitted':
    case 'Quietway':
    case 'Mixed Traffic':
      return 20;
    case 'Jump connection':
      return 2;
    default:
      return 15; // General / Bus road / Shoulder / Snapped Connector
  }
}

export function getFacilityMultiplier(facility: string): number {
  switch (facility) {
    case 'Separated Path':
    case 'Bicycle Path':
      return 0.3;
    case 'Shared Use Path':
    case 'Shared Zone':
      return 0.4;
    case 'Bicycle Lane':
    case 'Contra-flow Permitted':
      return 0.5;
    case 'Quietway':
    case 'Mixed Traffic':
      return 0.75;
    case 'High-speed Shoulder':
      return 1.0;
    case 'Vehicle (motor) Only':
      return Infinity;
    case 'Jump connection':
      return 2.0;
    default:
      return 1.0; // General / Bus road
  }
}

export class GeoGraph {
  public edges: Map<string, Edge[]> = new Map();
  public nodes: Map<string, Coordinate> = new Map();

  addNode(id: string, coord: Coordinate) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, coord);
      this.edges.set(id, []);
    }
  }

  addEdge(sourceId: string, targetId: string, distance: number, facility: string = 'General road', directed: boolean = false, name: string = 'Unknown Road') {
    const cost = distance * getFacilityMultiplier(facility);
    const speedKmph = getFacilitySpeedKmph(facility);

    // Avoid duplicate edges or keep the cheapest one
    const existingSource = this.edges.get(sourceId)?.find(e => e.targetId === targetId);
    if (!existingSource) {
      this.edges.get(sourceId)?.push({ targetId, distance, cost, originalCost: cost, speedKmph, facility, name });
    } else if (cost < existingSource.cost) {
      existingSource.cost = cost;
      existingSource.distance = distance;
      existingSource.originalCost = cost;
      existingSource.speedKmph = speedKmph;
      existingSource.facility = facility;
      existingSource.name = name;
    }

    if (!directed) {
      const existingTarget = this.edges.get(targetId)?.find(e => e.targetId === sourceId);
      if (!existingTarget) {
        this.edges.get(targetId)?.push({ targetId: sourceId, distance, cost, originalCost: cost, speedKmph, facility, name });
      } else if (cost < existingTarget.cost) {
        existingTarget.cost = cost;
        existingTarget.distance = distance;
        existingTarget.originalCost = cost;
        existingTarget.speedKmph = speedKmph;
        existingTarget.facility = facility;
        existingTarget.name = name;
      }
    }
  }
}

// Haversine distance in meters
export function haversineDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function buildGraphFromGeoJSON(geoJSON: any): GeoGraph {
  const graph = new GeoGraph();

  if (!geoJSON || !geoJSON.features) return graph;

  // 1. First pass: Add all explicit edges from LineStrings
  geoJSON.features.forEach((feature: any) => {
    if (feature.geometry && (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
      const isMulti = feature.geometry.type === 'MultiLineString';
      const lines = isMulti ? feature.geometry.coordinates : [feature.geometry.coordinates];
      const facility = feature.properties?.facility || 'General road';
      const isOneWay = feature.properties?.oneway === 'Yes' || feature.properties?.oneway === 'Contra-flow Permitted';
      const name = feature.properties?.name || 'Unknown Road';

      lines.forEach((line: Coordinate[]) => {
        for (let i = 0; i < line.length - 1; i++) {
          const coord1 = line[i];
          const coord2 = line[i + 1];
          // Keep 6 decimal places to avoid duplicate nodes for identical coords
          const id1 = `${coord1[0].toFixed(6)},${coord1[1].toFixed(6)}`;
          const id2 = `${coord2[0].toFixed(6)},${coord2[1].toFixed(6)}`;

          graph.addNode(id1, coord1);
          graph.addNode(id2, coord2);

          const dist = haversineDistance(coord1[0], coord1[1], coord2[0], coord2[1]);
          graph.addEdge(id1, id2, dist, facility, isOneWay, name);
        }
      });
    }
  });

  // 2. Second pass: Spatial snapping to connect disjoint network segments
  const maxSnapDistance = 80; // meters
  const regularSnapDistance = 1.5; // meters (tightened to prevent jumping over structured curves)
  const gridSize = 0.001; // Roughly 100 meters
  const grid = new Map<string, string[]>();

  graph.nodes.forEach((coord, id) => {
    const gridX = Math.floor(coord[0] / gridSize);
    const gridY = Math.floor(coord[1] / gridSize);
    const key = `${gridX},${gridY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(id);
  });

  const processed = new Set<string>();

  graph.nodes.forEach((coord1, id1) => {
    processed.add(id1);
    const gridX = Math.floor(coord1[0] / gridSize);
    const gridY = Math.floor(coord1[1] / gridSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        const candidates = grid.get(key) || [];

        for (const id2 of candidates) {
          if (!processed.has(id2)) {
            const coord2 = graph.nodes.get(id2)!;
            const dist = haversineDistance(coord1[0], coord1[1], coord2[0], coord2[1]);

            if (dist > 0 && dist <= maxSnapDistance) {
              const facility = dist <= regularSnapDistance ? 'Snapped connector' : 'Jump connection';
              graph.addEdge(id1, id2, dist, facility, false, 'Connection');
            }
          }
        }
      }
    }
  });

  return graph;
}
