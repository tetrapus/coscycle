import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline, Marker, Popup, useMapEvents, useMap, CircleMarker } from 'react-leaflet';
import proj4 from 'proj4';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// @ts-ignore
import 'leaflet-polylinedecorator';
import { buildGraphFromGeoJSON, GeoGraph, type Coordinate, haversineDistance } from '../utils/graph';
import { findComparativeRoutes, distanceToRoute, type PathResult } from '../utils/astar';

// Fix for default marker icons in react-leaflet
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const startIcon = new L.Icon({
  ...L.Icon.Default.prototype.options,
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
});

const endIcon = new L.Icon({
  ...L.Icon.Default.prototype.options,
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
});

proj4.defs("EPSG:3308", "+proj=lcc +lat_1=-30.75 +lat_2=-35.75 +lat_0=-33.25 +lon_0=147.0 +x_0=9300000 +y_0=4500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

const convertGeoJSON = (data: any) => {
  const converted = JSON.parse(JSON.stringify(data));
  converted.features.forEach((feature: any) => {
    if (feature.geometry) {
      if (feature.geometry.type === "LineString") {
        feature.geometry.coordinates = feature.geometry.coordinates.map((coord: number[]) => proj4("EPSG:3308", "WGS84", coord));
      } else if (feature.geometry.type === "MultiLineString") {
        feature.geometry.coordinates = feature.geometry.coordinates.map((line: number[][]) =>
          line.map((coord: number[]) => proj4("EPSG:3308", "WGS84", coord))
        );
      }
    }
  });
  return converted;
};

// Map styling logic based on the user's specific mappings
const getPathStyle = (facility: string): { color: string, weight: number, dashArray?: string } => {
  switch (facility) {
    case 'Separated Path':
    case 'Bicycle Path':
      return { color: '#228B22', weight: 5 }; // slightly dark green (Protected)
    case 'Shared Use Path':
    case 'Shared Zone':
      return { color: '#87CEFA', weight: 5 }; // light blue
    case 'Quietway':
    case 'Mixed Traffic':
      return { color: '#D3D3D3', weight: 3.5 }; // light grey
    case 'Bicycle Lane':
    case 'Contra-flow Permitted':
      return { color: '#FFFFFF', weight: 4 }; // white
    case 'High-speed Shoulder':
      return { color: '#FFFFFF', weight: 1.5, dashArray: '4, 6' }; // thin dashed white line
    case 'Vehicle (motor) Only':
      return { color: '#DC143C', weight: 3 }; // crimson red
    case 'Jump connection':
      return { color: '#ff8c00', weight: 3, dashArray: '4, 4' }; // orange
    case 'Snapped connector':
      return { color: 'transparent', weight: 0 }; // explicitly hide structural 1m micro-snaps
    default:
      return { color: '#a854f7', weight: 3 }; // purple (General road, Bus Lanes, Parking)
  }
};

function getSegments(route: PathResult) {
  if (!route.edges || route.edges.length === 0) return [];
  const segments: { facility: string; coords: Coordinate[] }[] = [];
  let currentFacility = route.edges[0].facility;
  let currentCoords: Coordinate[] = [route.path[0], route.path[1]];

  for (let i = 1; i < route.edges.length; i++) {
    const edge = route.edges[i];
    if (edge.facility === currentFacility) {
      currentCoords.push(route.path[i + 1]);
    } else {
      segments.push({ facility: currentFacility, coords: currentCoords });
      currentFacility = edge.facility;
      currentCoords = [route.path[i], route.path[i + 1]];
    }
  }
  segments.push({ facility: currentFacility, coords: currentCoords });
  return segments;
}

const MapLegend: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const categories = [
    { label: 'Protected Cycleway', color: '#228B22' },
    { label: 'Shared Path', color: '#87CEFA' },
    { label: 'Bicycle Lane', color: '#FFFFFF' },
    { label: 'Quiet Street', color: '#D3D3D3' },
    { label: 'Road Shoulder', color: '#FFFFFF', isThin: true, isDashed: true },
    { label: 'General / Bus Road', color: '#a854f7' },
    { label: 'Cycling Excluded', color: '#DC143C' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 30, right: 20, zIndex: 1000,
      background: 'rgba(25, 25, 25, 0.85)', padding: expanded ? '15px 20px' : '10px',
      borderRadius: '12px', color: '#fff', border: '1px solid #444',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)', cursor: expanded ? 'default' : 'pointer',
      backdropFilter: 'blur(10px)', fontFamily: 'Inter, system-ui, sans-serif'
    }} onClick={() => !expanded && setExpanded(true)}>
      {!expanded ? (
        <div style={{ fontSize: '1.2rem', padding: '0 5px', color: '#ddd' }} title="Legend">📍</div>
      ) : (
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            style={{ position: 'absolute', top: -5, right: -10, background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.1rem' }}>
            ×
          </button>
          {categories.map(c => (
            <div key={c.label} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{
                width: '20px', height: '0',
                borderBottom: `${(c as any).isThin ? '1.5px' : '3px'} ${(c as any).isDashed ? 'dashed' : 'solid'} ${c.color}`,
                marginRight: '12px'
              }}></div>
              <span style={{ fontSize: '0.85rem', color: '#e0e0e0', fontWeight: 500 }}>{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Component to dynamically mount one-way arrows on paths
const OnewayDecorators: React.FC<{ geoData: any }> = ({ geoData }) => {
  const map = useMap();
  useEffect(() => {
    if (!geoData || !(L as any).polylineDecorator) return;
    const decoratorGroup = L.layerGroup().addTo(map);

    const oneWayFeatures = geoData.features.filter((f: any) => f.properties?.oneway === 'Yes' || f.properties?.oneway === 'Contra-flow Permitted');

    L.geoJSON({ type: 'FeatureCollection', features: oneWayFeatures } as any, {
      onEachFeature: (feature, layer) => {
        const style = getPathStyle(feature.properties.facility);
        (L as any).polylineDecorator(layer as L.Polyline, {
          patterns: [
            {
              offset: '50%',
              repeat: '75px', // more frequent arrows
              symbol: (L as any).Symbol.arrowHead({
                pixelSize: 6, // smaller
                polygon: false,
                pathOptions: { stroke: true, color: style.color, weight: 2, opacity: 1 }
              })
            }
          ]
        }).addTo(decoratorGroup);
      }
    });

    return () => {
      decoratorGroup.remove();
    };
  }, [geoData, map]);
  return null;
};

// Component to handle map clicks
const MapClickHandler: React.FC<{
  onMapClick: (latlng: L.LatLng) => void;
}> = ({ onMapClick }) => {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    },
  });
  return null;
};

const MapRenderer: React.FC = () => {
  const [geoData, setGeoData] = useState<any>(null);
  const [graph, setGraph] = useState<GeoGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [startPoint, setStartPoint] = useState<Coordinate | null>(null);
  const [endPoint, setEndPoint] = useState<Coordinate | null>(null);
  const [routes, setRoutes] = useState<PathResult[] | null>(null);

  // UI State
  const [routePanelExpanded, setRoutePanelExpanded] = useState<boolean>(true);
  const [overflowOpen, setOverflowOpen] = useState<boolean>(false);

  // GPS State
  const [gpsEnabled, setGpsEnabled] = useState<boolean>(true);
  const [baseUserLocation, setBaseUserLocation] = useState<Coordinate | null>(null);
  const [gpsOffset, setGpsOffset] = useState<Coordinate>([0, 0]);
  const [lastRoutedLocation, setLastRoutedLocation] = useState<Coordinate | null>(null);

  const userLocation: Coordinate | null = baseUserLocation
    ? [baseUserLocation[0] + gpsOffset[0], baseUserLocation[1] + gpsOffset[1]]
    : null;

  // Geolocation watch
  useEffect(() => {
    if (!gpsEnabled) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c: Coordinate = [pos.coords.longitude, pos.coords.latitude];
        setBaseUserLocation(c);
      },
      (err) => console.error("Geolocation error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [gpsEnabled]);

  // GPS Manual Arrow Key Spoofer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gpsEnabled || !baseUserLocation) return;
      const LAT_METER = 0.00000898;
      const LON_METER = 0.0000108;

      setGpsOffset(prev => {
        const k = e.key.toLowerCase();
        if (k === 'w') return [prev[0], prev[1] + LAT_METER * 2];
        if (k === 's') return [prev[0], prev[1] - LAT_METER * 2];
        if (k === 'a') return [prev[0] - LON_METER * 2, prev[1]];
        if (k === 'd') return [prev[0] + LON_METER * 2, prev[1]];
        return prev;
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gpsEnabled, baseUserLocation]);

  // Sync userLocation to startPoint and reroute if off-path
  useEffect(() => {
    if (!gpsEnabled || !userLocation) return;

    // Initial tracking placement
    if (!startPoint) {
      setStartPoint(userLocation);
      setLastRoutedLocation(userLocation);
      return;
    }

    if (lastRoutedLocation) {
      const distFromLast = haversineDistance(userLocation[0], userLocation[1], lastRoutedLocation[0], lastRoutedLocation[1]);
      if (distFromLast >= 10) {
        // Are we off-route?
        let minRouteDist = Infinity;
        if (routes) {
          for (const route of routes) {
            const d = distanceToRoute(userLocation, route.path);
            if (d < minRouteDist) minRouteDist = d;
          }
        }

        // If not on ANY route (dist > 10m)
        if (minRouteDist > 10 || !routes) {
          setStartPoint(userLocation);
          setLastRoutedLocation(userLocation);
        }
      }
    }
  }, [userLocation, gpsEnabled, startPoint, lastRoutedLocation, routes]);

  useEffect(() => {
    fetch('/sydney_bicycle_network.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load map data. The filtered JSON file might be missing.');
        return res.json();
      })
      .then(data => {
        const wgs84Data = convertGeoJSON(data);
        setGeoData(wgs84Data);
        const g = buildGraphFromGeoJSON(wgs84Data);
        setGraph(g);
      })
      .catch(err => {
        console.error("Error loading geojson: ", err);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (startPoint && endPoint && graph) {
      setTimeout(() => {
        const results = findComparativeRoutes(startPoint, endPoint, graph);
        if (results && results.length > 0) {
          setRoutes(results);
          setError(null);
        } else {
          setRoutes(null);
          setError("Could not find a valid bike route between these points on the network.");
          setTimeout(() => setError(null), 3000);
        }
      }, 50);
    } else {
      setRoutes(null);
    }
  }, [startPoint, endPoint, graph]);

  const handleMapClick = (latlng: L.LatLng) => {
    const c: Coordinate = [latlng.lng, latlng.lat]; // GeoJSON format [lon,lat]

    // If GPS is actively tracking, map clicks only set the destination pin
    if (gpsEnabled) {
      setEndPoint(c);
    } else {
      if (!startPoint) {
        setStartPoint(c);
        setError(null);
      } else if (!endPoint) {
        setEndPoint(c);
      } else {
        setStartPoint(c);
        setEndPoint(null);
        setRoutes(null);
      }
    }
  };

  const clearPins = () => {
    setStartPoint(null);
    setEndPoint(null);
    setRoutes(null);
    setError(null);
    setLastRoutedLocation(null);
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* UI Overlay */}
      <div style={{
        position: 'absolute', top: 20, right: 20, zIndex: 1000,
        background: 'rgba(25, 25, 25, 0.85)', padding: routePanelExpanded ? '15px 20px' : '10px 15px',
        borderRadius: '12px', color: '#fff', border: '1px solid #444',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)', maxWidth: '300px',
        backdropFilter: 'blur(10px)',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setRoutePanelExpanded(!routePanelExpanded)}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#bbb', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {routePanelExpanded ? '▼' : '▶'} {routes ? 'Navigation Dashboard' : 'Route Planner'}
          </div>
          <div>
            <button
              onClick={(e) => { e.stopPropagation(); setOverflowOpen(!overflowOpen); }}
              style={{ background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}
            >
              ⋮
            </button>
          </div>
        </div>

        {overflowOpen && (
          <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px' }}>
              <input
                type="checkbox"
                checked={gpsEnabled}
                onChange={e => {
                  setGpsEnabled(e.target.checked);
                  if (!e.target.checked && startPoint === userLocation) {
                    setStartPoint(null);
                  } else if (e.target.checked) {
                    setGpsOffset([0, 0]);
                  }
                }}
                style={{ width: '14px', height: '14px', cursor: 'pointer' }}
              />
              Track My Location
            </label>
            <button
              onClick={(e) => { e.stopPropagation(); clearPins(); setOverflowOpen(false); }}
              style={{ background: 'rgba(220, 20, 60, 0.3)', border: '1px solid rgba(220, 20, 60, 0.5)', color: '#ffb3b3', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', width: '100%', transition: 'all 0.2s' }}
            >
              Clear Route & Pins
            </button>
          </div>
        )}

        {routePanelExpanded && (
          <div style={{ marginTop: '15px' }}>
            {!startPoint && !gpsEnabled && <p style={{ margin: 0, fontSize: '0.9rem', color: '#999' }}>Click on the map to drop a <b>Start</b> pin.</p>}
            {startPoint && !endPoint && <p style={{ margin: 0, fontSize: '0.9rem', color: '#999' }}>Click the map to place an <b>End</b> pin.</p>}

            {routes && routes.length > 0 && (
              <div>
                {routes[0] && (
                  <p style={{ margin: '8px 0', fontSize: '0.95rem', color: '#fff', fontWeight: 600 }}>
                    <span style={{ color: '#fff', marginRight: '5px' }}>▬</span> {routes[0].label || 'Safest Route'}: {(routes[0].distance / 1000).toFixed(2)} km <br />
                    <span style={{ opacity: 0.8, fontSize: '0.85em' }}>Cost: {(routes[0].cost / 1000).toFixed(2)} | Time: {Math.round(routes[0].timeSeconds / 60)} min</span>
                  </p>
                )}
                {routes[1] && (
                  <p style={{ margin: '8px 0', fontSize: '0.95rem', color: '#ddd', fontWeight: 500 }}>
                    <span style={{ color: '#fff', marginRight: '5px', letterSpacing: '2px' }}>---</span> {routes[1].label || 'Shortest Path'}: {(routes[1].distance / 1000).toFixed(2)} km <br />
                    <span style={{ opacity: 0.8, fontSize: '0.85em' }}>Time: {Math.round(routes[1].timeSeconds / 60)} min</span>
                  </p>
                )}
                {routes[2] && (
                  <p style={{ margin: '8px 0', fontSize: '0.95rem', color: '#ccc', fontWeight: 500 }}>
                    <span style={{ color: '#fff', marginRight: '5px' }}>═</span> {routes[2].label || 'Quickest Route'}: {(routes[2].distance / 1000).toFixed(2)} km <br />
                    <span style={{ opacity: 0.8, fontSize: '0.85em' }}>Time: {Math.round(routes[2].timeSeconds / 60)} min</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <MapLegend />

      {error && (
        <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, background: 'rgba(239, 68, 68, 0.95)', padding: '1rem 1.5rem', borderRadius: '8px', color: 'white', fontWeight: 500, backdropFilter: 'blur(5px)' }}>
          {error}
        </div>
      )}

      <MapContainer
        center={[-33.8688, 151.2093]}
        zoom={14}
        style={{ height: '100%', width: '100%', zIndex: 1 }}
      >
        <MapClickHandler onMapClick={handleMapClick} />

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {/* 1. Fastest Route (Route 2) - Outer Casing drawn BELOW base map */}
        {routes && routes[2] && getSegments(routes[2]).map((seg, i) => (
          <Polyline
            key={`r2-outer-${i}`}
            positions={seg.coords.map(c => [c[1], c[0]])}
            color={getPathStyle(seg.facility).color}
            weight={getPathStyle(seg.facility).weight + 5}
            opacity={1.0} lineCap="round" lineJoin="round"
          />
        ))}

        {/* 1. Fastest Route (Route 2) - Outer Casing drawn BELOW base map */}
        {routes && routes[2] && getSegments(routes[2]).map((seg, i) => (
          <Polyline
            key={`r2-outer-${i}-${routes[2].distance.toFixed(0)}-${seg.facility.replace(/\s+/g, '')}`}
            positions={seg.coords.map(c => [c[1], c[0]])}
            color={getPathStyle(seg.facility).color}
            weight={getPathStyle(seg.facility).weight + 8}
            opacity={1.0} lineCap="round" lineJoin="round"
          />
        ))}

        {/* 2. Base GeoJSON Map */}
        {geoData && (
          <>
            <GeoJSON
              data={geoData}
              interactive={false}
              style={(feature) => {
                const s = getPathStyle(feature?.properties?.facility);
                return {
                  color: s.color,
                  weight: s.weight,
                  opacity: routes ? 0.33 : 0.66,
                  dashArray: s.dashArray
                };
              }}
            />
            <OnewayDecorators geoData={geoData} />
          </>
        )}

        {/* 3. Fastest Route (Route 2) - Inner Pure Black Mask drawn continuously to fix intersection curves */}
        {routes && routes[2] && (
          <Polyline
            key={`r2-inner-${routes[2].distance.toFixed(0)}`}
            positions={routes[2].path.map(c => [c[1], c[0]])}
            color="#000000"
            weight={8}
            opacity={1.0}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* 4. Safest Route (Route 0) - Thinned down to fit cleanly */}
        {routes && routes[0] && getSegments(routes[0]).map((seg, i) => {
          const style = getPathStyle(seg.facility);
          return (
            <Polyline
              key={`r0-${i}-${routes[0].distance.toFixed(0)}-${seg.facility.replace(/\s+/g, '')}`}
              positions={seg.coords.map(c => [c[1], c[0]])}
              color={style.color}
              weight={Math.max(2, style.weight - 1)}
              opacity={1.0}
              lineCap="round"
              lineJoin="round"
            />
          );
        })}

        {/* 5. Shortest Route (Route 1) - Dotted */}
        {routes && routes[1] && getSegments(routes[1]).map((seg, i) => {
          const style = getPathStyle(seg.facility);
          return (
            <Polyline
              key={`r1-${i}-${routes[1].distance.toFixed(0)}-${seg.facility.replace(/\s+/g, '')}`}
              positions={seg.coords.map(c => [c[1], c[0]])}
              color={style.color}
              weight={Math.max(1, style.weight - 1.5)}
              opacity={1.0}
              lineCap="round"
              lineJoin="round"
              dashArray="4, 10"
            />
          );
        })}

        {/* Markers for Pins */}
        {startPoint && (
          <Marker position={[startPoint[1], startPoint[0]]} icon={startIcon}>
            <Popup>Start Location</Popup>
          </Marker>
        )}

        {endPoint && (
          <Marker position={[endPoint[1], endPoint[0]]} icon={endIcon}>
            <Popup>Destination</Popup>
          </Marker>
        )}

        {userLocation && gpsEnabled && (
          <CircleMarker
            center={[userLocation[1], userLocation[0]]}
            radius={6}
            pathOptions={{ color: 'white', fillColor: '#00f2fe', fillOpacity: 1, weight: 2 }}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default MapRenderer;
