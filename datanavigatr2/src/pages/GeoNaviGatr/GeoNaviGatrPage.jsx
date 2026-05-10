import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import GeoMap from "../../features/geo/components/GeoMap";
import {
  GEO_STATE_MESSAGE,
  GEO_STATE_REQUEST_MESSAGE,
  GEO_SYNC_CHANNEL,
  postGeoMessage,
  readGeoQueryState,
  writeGeoQueryState,
} from "../../features/geo/utils/geoSync";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL ?? "";
const QUERY_RESULTS_BATCH_SIZE = 250;

/*
 * Route wrapper for GeoMap.
 * It prefers query rows sent by an already-open QueryTable through
 * sessionStorage/BroadcastChannel, but can fall back to loading the saved query
 * directly from the API when the map route is refreshed or opened standalone.
 */
function GeoNaviGatrPage() {
  const { queryId } = useParams();
  const [geoState, setGeoState] = useState(() => readGeoQueryState(queryId));
  const [loadMessage, setLoadMessage] = useState("");

  /*
   * Asks any open QueryTable window/tab to resend the current rows for this
   * query. This keeps the map in sync without polling the backend.
   */
  const requestCurrentState = useCallback(() => {
    postGeoMessage({
      type: GEO_STATE_REQUEST_MESSAGE,
      queryId,
    });
  }, [queryId]);

  /*
   * Fallback loader for direct map visits. It mirrors QueryWorkspacePage's
   * batched result loading and then writes the same geo state shape used by the
   * cross-tab sync path.
   */
  useEffect(() => {
    const storedState = readGeoQueryState(queryId);
    if (storedState) {
      setGeoState(storedState);
    }
  }, [queryId]);

  useEffect(() => {
    let channel;

    try {
      channel = new BroadcastChannel(GEO_SYNC_CHANNEL);
      channel.onmessage = (event) => {
        const message = event.data || {};
        if (message.queryId !== queryId) return;

        if (message.type === GEO_STATE_MESSAGE) {
          setGeoState(message.payload);
        }
      };
    } catch {}

    requestCurrentState();

    return () => {
      channel?.close();
    };
  }, [queryId, requestCurrentState]);

  useEffect(() => {
    let isCancelled = false;

    async function loadFallbackQuery() {
      if (geoState && Array.isArray(geoState.rows)) return;

      const accessToken = sessionStorage.getItem("accessToken") || "";
      if (!accessToken || !queryId) return;

      setLoadMessage("Loading query results for GeoNaviGatr2...");

      try {
        const queryResponse = await fetch(`${API_BASE_URL}/api/queries/${queryId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const queryData = await queryResponse.json();
        if (!queryResponse.ok) {
          throw new Error(queryData.error || "Failed to load query.");
        }

        const query = {
          ...queryData.query,
          tableData: [],
        };

        const totalResults = Number(query.resultCount || 0);
        const rows = [];
        let nextOffset = 0;

        while (nextOffset < totalResults) {
          const resultsResponse = await fetch(
            `${API_BASE_URL}/api/queries/${queryId}/results?offset=${nextOffset}&limit=${QUERY_RESULTS_BATCH_SIZE}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );

          const resultsData = await resultsResponse.json();
          if (!resultsResponse.ok) {
            throw new Error(resultsData.error || "Failed to load query results.");
          }

          const newRows = resultsData.results || [];
          rows.push(...newRows);
          nextOffset = resultsData.nextOffset ?? nextOffset + newRows.length;

          if (!resultsData.hasMore || newRows.length === 0) {
            break;
          }
        }

        if (!isCancelled) {
          const payload = writeGeoQueryState(query, rows);
          setGeoState(payload);
          setLoadMessage("");
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadMessage(error.message || "Failed to load query results.");
        }
      }
    }

    loadFallbackQuery();

    return () => {
      isCancelled = true;
    };
  }, [geoState, queryId]);

  return (
    <>
      <GeoMap
        queryId={queryId}
        initialState={geoState}
        onStateRequest={requestCurrentState}
      />
      {loadMessage && (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 1000,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--panel)",
            color: "var(--text)",
            boxShadow: "var(--shadow)",
            fontSize: "0.84rem",
          }}
        >
          {loadMessage}
        </div>
      )}
    </>
  );
}

export default GeoNaviGatrPage;
