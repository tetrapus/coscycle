import { describe, it, expect } from 'vitest';
import { buildGraphFromGeoJSON, haversineDistance } from './graph';
import { findComparativeRoutes } from './astar';

describe('Routing Utilities', () => {
  const dummyGeoJSON = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [151.0, -33.0],
            [151.1, -33.0],
            [151.1, -33.1]
          ]
        }
      },
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [151.0, -33.0],
            [151.0, -33.1],
            [151.1, -33.1]
          ]
        }
      }
    ]
  };

  it('builds a graph correctly from GeoJSON', () => {
    const graph = buildGraphFromGeoJSON(dummyGeoJSON);

    expect(graph.nodes.size).toBe(4);

    const startNodeEdges = graph.edges.get('151.000000,-33.000000');
    expect(startNodeEdges).toBeDefined();
    expect(startNodeEdges?.length).toBe(2);
  });

  it('finds path using A* search', () => {
    const graph = buildGraphFromGeoJSON(dummyGeoJSON);

    // Pick start & end points that aren't EXACTLY on the nodes to test findClosestNode
    const start: [number, number] = [151.0001, -33.0001];
    const end: [number, number] = [151.0999, -33.0999];

    const results = findComparativeRoutes(start, end, graph);
    const result = results.length > 0 ? results[0] : null;
    // Should snap to [151.0, -33.0] and [151.1, -33.1]
    expect(result).toBeDefined();
    expect(result?.path.length).toBeGreaterThan(0);
    expect(result?.path[0]).toEqual([151.0, -33.0]);
    expect(result?.path[result!.path.length - 1]).toEqual([151.1, -33.1]);
    expect(result?.distance).toBeGreaterThan(0);
  });

  it('calculates reasonable haversine distance', () => {
    const dist = haversineDistance(151.0, -33.0, 151.0, -34.0);
    // 1 degree of latitude is roughly 111km
    expect(dist).toBeGreaterThan(110000);
    expect(dist).toBeLessThan(112000);
  });
});
