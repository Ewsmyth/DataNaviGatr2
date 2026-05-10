import { getValueByPath } from "../../queries/utils/queryTableUtils";
import { getRowIdentity } from "./geoSync";

/*
 * Converts query-result rows into map features.
 * Ingested data has evolved over time, so this file checks several possible
 * field shapes: normalized collection_location objects, direct latitude and
 * longitude fields, GeoJSON coordinate arrays, and location tracks.
 */

/*
 * Coerces strings and numbers into finite numbers for coordinate math.
 * Invalid values return null instead of NaN so callers can explicitly skip them.
 */
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/*
 * Validates latitude/longitude ranges before a point is accepted for mapping.
 */
function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/*
 * Reads a lat/lng pair from one location object.
 * The function accepts both latitude/longitude and shorter lat/lng/lon aliases
 * because different ingest sources use different naming conventions.
 */
function getLatLngFromLocation(location) {
  if (!location || typeof location !== "object") return null;

  const lat = toNumber(location.latitude ?? location.lat);
  const lng = toNumber(location.longitude ?? location.lng ?? location.lon);

  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/*
 * Searches a row across many possible latitude and longitude paths.
 * It returns the first valid pair, which lets older and newer record schemas map
 * without requiring a migration.
 */
function getLatLngFromPaths(row, latitudePaths, longitudePaths) {
  for (const latitudePath of latitudePaths) {
    const lat = toNumber(getValueByPath(row, latitudePath));
    if (lat === null) continue;

    for (const longitudePath of longitudePaths) {
      const lng = toNumber(getValueByPath(row, longitudePath));
      if (isValidLatLng(lat, lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

/*
 * Converts a GeoJSON-style [longitude, latitude] array into the Leaflet-friendly
 * { lat, lng } object used throughout the map code.
 */
function getLatLngFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lng = toNumber(coordinates[0]);
  const lat = toNumber(coordinates[1]);

  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/*
 * Finds the best single display point for a row.
 * Preferred order is normalized collection location, then known lat/lon paths,
 * then generic GeoJSON coordinate locations.
 */
function getPointFromRow(row) {
  const collectionLocation = getLatLngFromLocation(
    getValueByPath(row, "normalized.collection_location")
  );
  if (collectionLocation) return collectionLocation;

  const collectionLocationPaths = getLatLngFromPaths(
    row,
    [
      "normalized.collection_location.latitude",
      "normalized.collection_location.lat",
      "collection_location.latitude",
      "collection_location.lat",
      "latitude",
      "lat",
    ],
    [
      "normalized.collection_location.longitude",
      "normalized.collection_location.lng",
      "normalized.collection_location.lon",
      "collection_location.longitude",
      "collection_location.lng",
      "collection_location.lon",
      "longitude",
      "lng",
      "lon",
    ]
  );
  if (collectionLocationPaths) return collectionLocationPaths;

  const coordinatePaths = [
    "normalized.collection_geo.coordinates",
    "collection_geo.coordinates",
    "geo.coordinates",
    "geometry.coordinates",
    "coordinates",
  ];

  for (const coordinatePath of coordinatePaths) {
    const point = getLatLngFromCoordinates(getValueByPath(row, coordinatePath));
    if (point) {
      return point;
    }
  }

  return null;
}

/*
 * Extracts a row's movement/collection track when multiple location samples are
 * available. A track with fewer than two points is ignored by the map layer.
 */
function getTrackFromRow(row) {
  const track =
    getValueByPath(row, "normalized.collection_location_track") ||
    getValueByPath(row, "collection_location_track");
  if (!Array.isArray(track)) return [];

  return track
    .map((location) => getLatLngFromLocation(location) || getLatLngFromCoordinates(location))
    .filter(Boolean);
}

/*
 * Builds the full feature bundle consumed by GeoMap.
 * points become markers, tracks become polylines, and ignoredRowCount tells the
 * UI how many rows could not be mapped because no usable coordinates existed.
 */
export function buildGeoFeatures(rows) {
  const points = [];
  const tracks = [];
  let ignoredRowCount = 0;

  (rows || []).forEach((row, index) => {
    const rowId = getRowIdentity(row, index);
    const point = getPointFromRow(row);
    const track = getTrackFromRow(row);

    if (point) {
      points.push({
        rowId,
        row,
        lat: point.lat,
        lng: point.lng,
      });
    }

    if (track.length >= 2) {
      tracks.push({
        rowId,
        row,
        positions: track,
      });
    }

    if (!point && track.length < 2) {
      ignoredRowCount += 1;
    }
  });

  return {
    points,
    tracks,
    ignoredRowCount,
  };
}

/*
 * Ray-casting point-in-polygon test used by map rectangle/polygon/lasso
 * selection. The point is { lat, lng }; the polygon is an array of the same.
 */
export function pointInPolygon(point, polygon) {
  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}
