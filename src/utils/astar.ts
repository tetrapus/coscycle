import { GeoGraph, type Coordinate, type Edge, haversineDistance } from './graph';

export type RouteType = 'safe' | 'short' | 'fast';

export interface PathResult {
  path: Coordinate[];
  distance: number;
  cost: number;
  timeSeconds: number;
  nodeIds: string[];
  edges: Edge[];
  label?: string;
}

function distanceToSegment(p: Coordinate, v: Coordinate, w: Coordinate): number {
  const latScale = Math.cos(p[1] * Math.PI / 180);
  const metersP = [0, 0];
  const metersV = [(v[0] - p[0]) * 111320 * latScale, (v[1] - p[1]) * 111320];
  const metersW = [(w[0] - p[0]) * 111320 * latScale, (w[1] - p[1]) * 111320];

  const l2 = Math.pow(metersV[0] - metersW[0], 2) + Math.pow(metersV[1] - metersW[1], 2);
  if (l2 === 0) return Math.sqrt(metersV[0]*metersV[0] + metersV[1]*metersV[1]);

  let t = ((metersP[0] - metersV[0]) * (metersW[0] - metersV[0]) + (metersP[1] - metersV[1]) * (metersW[1] - metersV[1])) / l2;
  t = Math.max(0, Math.min(1, t));

  const proj = [
    metersV[0] + t * (metersW[0] - metersV[0]),
    metersV[1] + t * (metersW[1] - metersV[1])
  ];

  return Math.sqrt(Math.pow(metersP[0] - proj[0], 2) + Math.pow(metersP[1] - proj[1], 2));
}

export function distanceToRoute(p: Coordinate, path: Coordinate[]): number {
  if (!path || path.length === 0) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegment(p, path[i], path[i+1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function findClosestNode(coord: Coordinate, graph: GeoGraph): string | null {
  let closestId: string | null = null;
  let minDistance = Infinity;

  graph.nodes.forEach((nodeCoord, id) => {
    const dist = haversineDistance(coord[0], coord[1], nodeCoord[0], nodeCoord[1]);
    if (dist < minDistance) {
      minDistance = dist;
      closestId = id;
    }
  });

  return closestId;
}

export function aStarSearch(startId: string, endId: string, graph: GeoGraph, routeType: RouteType = 'safe'): PathResult | null {
  const openSet = new Set<string>();
  openSet.add(startId);

  const cameFrom = new Map<string, string>();

  const gScore = new Map<string, number>();
  gScore.set(startId, 0);

  const realDistance = new Map<string, number>();
  realDistance.set(startId, 0);
  
  const realTime = new Map<string, number>();
  realTime.set(startId, 0);

  const fScore = new Map<string, number>();
  const endNodeCoord = graph.nodes.get(endId)!;
  const startNodeCoord = graph.nodes.get(startId)!;
  
  const getHeuristic = (coord: Coordinate) => {
    const hDist = haversineDistance(coord[0], coord[1], endNodeCoord[0], endNodeCoord[1]);
    if (routeType === 'safe') return hDist * 0.1;
    if (routeType === 'short') return hDist * 1.0;
    if (routeType === 'fast') return hDist / (25 / 3.6); // max 25kmph mapping
    return 0;
  };

  fScore.set(startId, getHeuristic(startNodeCoord));

  while (openSet.size > 0) {
    let currentId = '';
    let lowestFScore = Infinity;
    
    for (const id of openSet) {
      const score = fScore.get(id) ?? Infinity;
      if (score < lowestFScore) {
        lowestFScore = score;
        currentId = id;
      }
    }

    if (currentId === endId) {
      const path: Coordinate[] = [];
      const nodeIds: string[] = [];
      const routeEdges: Edge[] = [];
      let current: string | undefined = currentId;
      while (current) {
        path.unshift(graph.nodes.get(current)!);
        nodeIds.unshift(current);
        
        const prev = cameFrom.get(current);
        if (prev) {
          const edge = graph.edges.get(prev)?.find(e => e.targetId === current);
          if (edge) routeEdges.unshift(edge);
        }

        current = prev;
      }
      return { path, distance: realDistance.get(endId)!, cost: gScore.get(endId)!, timeSeconds: realTime.get(endId)!, nodeIds, edges: routeEdges };
    }

    openSet.delete(currentId);

    const edges = graph.edges.get(currentId) || [];
    for (const edge of edges) {
      if (edge.cost === Infinity) continue; // Skip cycling-excluded roads

      let edgeCost = edge.cost;
      if (routeType === 'short') {
        edgeCost = edge.facility === 'Jump connection' ? edge.distance * 2.0 : edge.distance;
      } else if (routeType === 'fast') {
        edgeCost = edge.distance / (edge.speedKmph / 3.6);
      }

      const neighborId = edge.targetId;
      const tentativeGScore = (gScore.get(currentId) ?? Infinity) + edgeCost;

      if (tentativeGScore < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeGScore);
        realDistance.set(neighborId, (realDistance.get(currentId) ?? 0) + edge.distance);
        realTime.set(neighborId, (realTime.get(currentId) ?? 0) + (edge.distance / (edge.speedKmph / 3.6)));
        
        const neighborCoord = graph.nodes.get(neighborId)!;
        fScore.set(neighborId, tentativeGScore + getHeuristic(neighborCoord));
        
        openSet.add(neighborId);
      }
    }
  }

  return null; // Path not found
}

export function findComparativeRoutes(startCoord: Coordinate, endCoord: Coordinate, graph: GeoGraph): PathResult[] {
  const startId = findClosestNode(startCoord, graph);
  const endId = findClosestNode(endCoord, graph);

  if (!startId || !endId) return [];

  const results: PathResult[] = [];
  
  const safeRoute = aStarSearch(startId, endId, graph, 'safe');
  if (safeRoute) results.push(safeRoute);

  const shortRoute = aStarSearch(startId, endId, graph, 'short');
  if (shortRoute) results.push(shortRoute);

  const fastRoute = aStarSearch(startId, endId, graph, 'fast');
  if (fastRoute) results.push(fastRoute);

  labelRoutes(results);

  return results;
}

function labelRoutes(routes: PathResult[]) {
  const routeStreetDistances = routes.map(route => {
    const distances = new Map<string, number>();
    for (const edge of route.edges) {
      if (edge.name && edge.name !== 'Unknown Road' && edge.name !== 'Connection') {
        const titleCase = edge.name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        distances.set(titleCase, (distances.get(titleCase) || 0) + edge.distance);
      }
    }
    return distances;
  });

  routes.forEach((route, i) => {
    let longestUniqueStreet = '';
    let maxDist = 0;

    const myStreets = routeStreetDistances[i];
    
    for (const [street, dist] of myStreets.entries()) {
      let isUnique = true;
      for (let j = 0; j < routes.length; j++) {
        if (i !== j && routeStreetDistances[j].has(street)) {
          isUnique = false;
          break;
        }
      }
      
      if (isUnique && dist > maxDist) {
        maxDist = dist;
        longestUniqueStreet = street;
      }
    }

    if (longestUniqueStreet) {
      route.label = `Via ${longestUniqueStreet}`;
    } else {
      let mostSimilarIndex = -1;
      let maxSharedDist = 0;
      
      for (let j = 0; j < routes.length; j++) {
        if (i === j) continue;
        let sharedDist = 0;
        for (const [street, dist] of myStreets.entries()) {
          if (routeStreetDistances[j].has(street)) {
            sharedDist += Math.min(dist, routeStreetDistances[j].get(street)!);
          }
        }
        if (sharedDist > maxSharedDist) {
          maxSharedDist = sharedDist;
          mostSimilarIndex = j;
        }
      }
      
      if (mostSimilarIndex === 0) route.label = 'Similar to Safest Route';
      else if (mostSimilarIndex === 1) route.label = 'Similar to Shortest Path';
      else if (mostSimilarIndex === 2) route.label = 'Similar to Quickest Route';
      else route.label = 'Alternative Route';
    }
  });
}
