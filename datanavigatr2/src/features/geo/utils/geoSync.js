import { getValueByPath } from "../../queries/utils/queryTableUtils";

export const GEO_SYNC_CHANNEL = "geonavigatr2-sync";
export const GEO_STATE_MESSAGE = "geo-query-state";
export const GEO_STATE_REQUEST_MESSAGE = "geo-query-state-request";
export const GEO_SELECTION_MESSAGE = "geo-selection";

const GEO_STATE_STORAGE_PREFIX = "geonavigatr2:query:";

export function getGeoStateStorageKey(queryId) {
  return `${GEO_STATE_STORAGE_PREFIX}${queryId}`;
}

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

export function readGeoQueryState(queryId) {
  if (!queryId) return null;

  try {
    const rawState = sessionStorage.getItem(getGeoStateStorageKey(queryId));
    return rawState ? JSON.parse(rawState) : null;
  } catch {
    return null;
  }
}

export function postGeoMessage(message) {
  if (!message) return;

  try {
    const channel = new BroadcastChannel(GEO_SYNC_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {}
}
