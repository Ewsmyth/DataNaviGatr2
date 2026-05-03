import { getValueByPath } from "../../queries/utils/queryTableUtils";
import { getRowIdentity } from "./geoSync";

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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

function getLatLngFromLocation(location) {
  if (!location || typeof location !== "object") return null;

  const lat = toNumber(location.latitude ?? location.lat);
  const lng = toNumber(location.longitude ?? location.lng ?? location.lon);

  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

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

function getLatLngFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lng = toNumber(coordinates[0]);
  const lat = toNumber(coordinates[1]);

  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

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

function getTrackFromRow(row) {
  const track =
    getValueByPath(row, "normalized.collection_location_track") ||
    getValueByPath(row, "collection_location_track");
  if (!Array.isArray(track)) return [];

  return track
    .map((location) => getLatLngFromLocation(location) || getLatLngFromCoordinates(location))
    .filter(Boolean);
}

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
