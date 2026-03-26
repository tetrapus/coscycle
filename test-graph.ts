import fs from 'fs';
import { buildGraphFromGeoJSON } from './src/utils/graph';
import { aStarSearch } from './src/utils/astar';

const geoJSONData = JSON.parse(fs.readFileSync('./public/sydney_bicycle_network.json', 'utf8'));
const graph = buildGraphFromGeoJSON(geoJSONData);

// Just grab two random nodes that are far apart
const nodes = Array.from(graph.nodes.keys());
const startId = nodes[100];
const endId = nodes[500];

const safeRoute = aStarSearch(startId, endId, graph, 'safe');

if (safeRoute) {
  let whiteCount = 0;
  let totalCount = 0;
  
  const facilityCounts: any = {};
  for(let e of safeRoute.edges) {
      facilityCounts[e.facility] = (facilityCounts[e.facility] || 0) + 1;
  }
  console.log("Safe Route Facilities Traverse:", facilityCounts);
  
  // mock getSegments
  function getSegments(route: any) {
    if (!route.edges || route.edges.length === 0) return [];
    const segments: any[] = [];
    let currentFacility = route.edges[0].facility;
    let currentCoords: any[] = [route.path[0], route.path[1]];
    
    for (let i = 1; i < route.edges.length; i++) {
      const edge = route.edges[i];
      if (edge.facility === currentFacility) {
        currentCoords.push(route.path[i+1]);
      } else {
        segments.push({ facility: currentFacility, coords: currentCoords });
        currentFacility = edge.facility;
        currentCoords = [route.path[i], route.path[i+1]];
      }
    }
    segments.push({ facility: currentFacility, coords: currentCoords });
    return segments;
  }
  
  const segments = getSegments(safeRoute);
  console.log("Segments count:", segments.length);
  for(let seg of segments) {
      console.log(`Segment: ${seg.facility} -> ${seg.coords.length} coords`);
  }

} else {
    console.log("No route found between selected nodes.");
}
