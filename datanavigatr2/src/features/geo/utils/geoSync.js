import { getValueByPath } from "../../queries/utils/queryTableUtils";

/*
 * Browser-to-browser-tab synchronization primitives for GeoNaviGatr.
 * The query table writes the current query rows into sessionStorage and sends
 * BroadcastChannel messages; the map page reads the stored snapshot and listens
 * for selection/state updates without needing a backend round trip.
 */

export const GEO_SYNC_CHANNEL = "geonavigatr2-sync";
export const GEO_STATE_MESSAGE = "geo-query-state";
export const GEO_STATE_REQUEST_MESSAGE = "geo-query-state-request";
export const GEO_SELECTION_MESSAGE = "geo-selection";

const GEO_STATE_STORAGE_PREFIX = "geonavigatr2:query:";

/*
 * Builds the sessionStorage key used for one query's geo snapshot.
 * Keeping the query id in the key lets multiple query result sets exist in the
 * same browser session without overwriting each other.
 */
export function getGeoStateStorageKey(queryId) {
  return `${GEO_STATE_STORAGE_PREFIX}${queryId}`;
}

/*
 * Produces a stable row id used by both the table and the map.
 * It tries durable database/source identifiers first and only falls back to the
 * row index when no id-like field is available.
 */
export function getRowIdentity(row, index = 0) {
  const candidates = [
    row?._id,
    getValueByPath(row, "normalized.source_fingerprint"),
    getValueByPath(row, "normalized.source_record_id"),
    getValueByPath(row, "normalized.source_record_id_string"),
    row?.id,
  ];

  const value = candidates.find((candidate) => candidate !== null && candidate !== undefined && candidate !== "");
  return String(value ?? `row-${index}`);
}

/*
 * Stores a query's rows for the map page.
 * The returned payload is also the shape sent over BroadcastChannel, so callers
 * can write once and broadcast the exact same state object.
 */
export function writeGeoQueryState(query, rows) {
  if (!query?.id) return null;

  const payload = {
    queryId: query.id,
    queryName: query.name,
    resultCount: query.resultCount,
    rows,
    updatedAt: Date.now(),
  };

  try {
    sessionStorage.setItem(getGeoStateStorageKey(query.id), JSON.stringify(payload));
  } catch {}

  return payload;
}

/*
 * Reads the last stored map-ready query snapshot.
 * Any storage or JSON parsing failure is treated as a missing state because the
 * map can always request a fresh state from the query table.
 */
export function readGeoQueryState(queryId) {
  if (!queryId) return null;

  try {
    const rawState = sessionStorage.getItem(getGeoStateStorageKey(queryId));
    return rawState ? JSON.parse(rawState) : null;
  } catch {
    return null;
  }
}

/*
 * Sends a one-off cross-tab message.
 * BroadcastChannel instances are opened, used, and closed immediately so the
 * app does not leak channel handles as users switch queries.
 */
export function postGeoMessage(message) {
  if (!message) return;

  try {
    const channel = new BroadcastChannel(GEO_SYNC_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {}
}
