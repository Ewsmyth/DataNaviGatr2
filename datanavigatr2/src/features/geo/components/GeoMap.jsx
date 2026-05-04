import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildGeoFeatures, pointInPolygon } from "../utils/geoFeatures";
import {
  GEO_SELECTION_MESSAGE,
  GEO_STATE_MESSAGE,
  GEO_STATE_REQUEST_MESSAGE,
  GEO_SYNC_CHANNEL,
  postGeoMessage,
} from "../utils/geoSync";
import "./GeoMap.css";

const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const MARKER_CLUSTER_CSS_URL =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
const MARKER_CLUSTER_DEFAULT_CSS_URL =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
const LEAFLET_DRAW_CSS_URL =
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css";
const LEAFLET_SCRIPT_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const MARKER_CLUSTER_SCRIPT_URL =
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js";
const LEAFLET_DRAW_SCRIPT_URL =
  "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js";

function loadStylesheet(url) {
  const existing = document.querySelector(`link[href="${url}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = resolve;
    link.onerror = reject;
    document.head.appendChild(link);
  });
}

function loadScript(url) {
  const existing = document.querySelector(`script[src="${url}"]`);
  if (existing) {
    return existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function loadLeafletRuntime() {
  await Promise.all([
    loadStylesheet(LEAFLET_CSS_URL),
    loadStylesheet(MARKER_CLUSTER_CSS_URL),
    loadStylesheet(MARKER_CLUSTER_DEFAULT_CSS_URL),
    loadStylesheet(LEAFLET_DRAW_CSS_URL),
  ]);
  await loadScript(LEAFLET_SCRIPT_URL);
  await loadScript(MARKER_CLUSTER_SCRIPT_URL);
  await loadScript(LEAFLET_DRAW_SCRIPT_URL);

  const L = window.L;
  if (!L) {
    throw new Error("Leaflet failed to load.");
  }

  return L;
}

function flattenLatLngs(latLngs) {
  if (!Array.isArray(latLngs)) return [];
  if (latLngs.length === 0) return [];
  if (latLngs[0]?.lat !== undefined) return latLngs;
  return flattenLatLngs(latLngs[0]);
}

function getSelectionMode(event) {
  const originalEvent = event?.originalEvent || event;
  return originalEvent?.ctrlKey || originalEvent?.metaKey ? "add" : "replace";
}

function GeoMap({ queryId, initialState, onStateRequest }) {
  const [geoState, setGeoState] = useState(initialState);
  const [selectedRowIds, setSelectedRowIds] = useState(() => new Set());
  const [leafletReady, setLeafletReady] = useState(Boolean(window.L));
  const [mapReady, setMapReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(window.L || null);
  const clusterLayerRef = useRef(null);
  const trackLayerRef = useRef(null);
  const drawnLayerRef = useRef(null);
  const markersByRowIdRef = useRef(new Map());
  const tracksByRowIdRef = useRef(new Map());
  const lassoStateRef = useRef({
    enabled: false,
    drawing: false,
    points: [],
    layer: null,
  });

  const rows = geoState?.rows || [];
  const features = useMemo(() => buildGeoFeatures(rows), [rows]);

  useEffect(() => {
    let isCancelled = false;

    loadLeafletRuntime()
      .then((L) => {
        if (isCancelled) return;
        leafletRef.current = L;
        setLeafletReady(true);
        setRuntimeError("");
      })
      .catch(() => {
        if (!isCancelled) {
          setRuntimeError("Map libraries could not be loaded.");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    setGeoState(initialState);
  }, [initialState]);

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

      channel.postMessage({
        type: GEO_STATE_REQUEST_MESSAGE,
        queryId,
      });
    } catch {}

    onStateRequest?.();

    return () => {
      channel?.close();
    };
  }, [queryId, onStateRequest]);

  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || mapRef.current) return;

    const L = leafletRef.current || window.L;
    if (!L) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      preferCanvas: true,
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 19,
    }).addTo(map);

    const trackLayer = L.layerGroup().addTo(map);
    const drawnLayer = L.featureGroup().addTo(map);

    const drawControl = new L.Control.Draw({
      edit: false,
      draw: {
        marker: false,
        circlemarker: false,
        circle: false,
        polyline: false,
        rectangle: {
          shapeOptions: { color: "#f59e0b", weight: 2 },
        },
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: "#f59e0b", weight: 2 },
        },
      },
    });
    map.addControl(drawControl);

    const lassoControl = L.control({ position: "topleft" });
    lassoControl.onAdd = () => {
      const button = L.DomUtil.create("button", "geo-lasso-control");
      button.type = "button";
      button.title = "Freeform lasso selection";
      button.textContent = "LS";
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, "click", () => {
        const lassoState = lassoStateRef.current;
        lassoState.enabled = !lassoState.enabled;
        button.classList.toggle("active", lassoState.enabled);
        map.dragging[lassoState.enabled ? "disable" : "enable"]();
      });
      return button;
    };
    lassoControl.addTo(map);

    mapRef.current = map;
    clusterLayerRef.current = clusterLayer;
    trackLayerRef.current = trackLayer;
    drawnLayerRef.current = drawnLayer;
    setMapReady(true);

    requestAnimationFrame(() => map.invalidateSize());
    window.setTimeout(() => map.invalidateSize(), 250);

    function selectByPolygon(latLngs, mode = "replace") {
      if (latLngs.length < 3) return;
      const nextSelection =
        mode === "add" ? new Set(selectedRowIdsRef.current) : new Set();

      featuresRef.current.points.forEach((point) => {
        if (pointInPolygon(point, latLngs)) {
          nextSelection.add(point.rowId);
        }
      });

      setSelectedRowIds(nextSelection);
      postGeoMessage({
        type: GEO_SELECTION_MESSAGE,
        queryId,
        rowIds: Array.from(nextSelection),
      });
    }

    map.on(L.Draw.Event.CREATED, (event) => {
      drawnLayer.clearLayers();
      drawnLayer.addLayer(event.layer);

      if (event.layer instanceof L.Rectangle) {
        const bounds = event.layer.getBounds();
        const nextSelection =
          getSelectionMode(event) === "add"
            ? new Set(selectedRowIdsRef.current)
            : new Set();

        featuresRef.current.points.forEach((point) => {
          if (bounds.contains([point.lat, point.lng])) {
            nextSelection.add(point.rowId);
          }
        });

        setSelectedRowIds(nextSelection);
        postGeoMessage({
          type: GEO_SELECTION_MESSAGE,
          queryId,
          rowIds: Array.from(nextSelection),
        });
        return;
      }

      selectByPolygon(flattenLatLngs(event.layer.getLatLngs()), getSelectionMode(event));
    });

    map.on("mousedown", (event) => {
      const lassoState = lassoStateRef.current;
      if (!lassoState.enabled) return;
      lassoState.drawing = true;
      lassoState.points = [event.latlng];
      lassoState.layer?.remove();
      lassoState.layer = L.polyline(lassoState.points, {
        color: "#f59e0b",
        weight: 2,
      }).addTo(map);
    });

    map.on("mousemove", (event) => {
      const lassoState = lassoStateRef.current;
      if (!lassoState.enabled || !lassoState.drawing) return;
      lassoState.points.push(event.latlng);
      lassoState.layer.setLatLngs(lassoState.points);
    });

    map.on("mouseup", (event) => {
      const lassoState = lassoStateRef.current;
      if (!lassoState.enabled || !lassoState.drawing) return;
      lassoState.drawing = false;
      lassoState.points.push(event.latlng);
      const polygon = [...lassoState.points, lassoState.points[0]];
      selectByPolygon(polygon, getSelectionMode(event));
    });

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [leafletReady, queryId]);

  const featuresRef = useRef(features);
  const selectedRowIdsRef = useRef(selectedRowIds);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    selectedRowIdsRef.current = selectedRowIds;
  }, [selectedRowIds]);

  useEffect(() => {
    if (!mapReady) return;

    const map = mapRef.current;
    const L = leafletRef.current || window.L;
    const clusterLayer = clusterLayerRef.current;
    const trackLayer = trackLayerRef.current;
    if (!L || !map || !clusterLayer || !trackLayer) return;

    map.invalidateSize();
    clusterLayer.clearLayers();
    trackLayer.clearLayers();
    markersByRowIdRef.current.clear();
    tracksByRowIdRef.current.clear();

    features.tracks.forEach((track) => {
      const polyline = L.polyline(track.positions, {
        color: "#2563eb",
        opacity: 0.74,
        weight: 3,
      }).addTo(trackLayer);
      tracksByRowIdRef.current.set(track.rowId, polyline);
    });

    features.points.forEach((point) => {
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: "geo-point-marker",
          html: "",
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });

      marker.on("click", (event) => {
        const selectionMode = getSelectionMode(event);
        const nextSelection =
          selectionMode === "add" ? new Set(selectedRowIdsRef.current) : new Set();

        if (selectionMode === "add") {
          if (nextSelection.has(point.rowId)) {
            nextSelection.delete(point.rowId);
          } else {
            nextSelection.add(point.rowId);
          }
        } else {
          nextSelection.clear();
          nextSelection.add(point.rowId);
        }

        setSelectedRowIds(nextSelection);
        postGeoMessage({
          type: GEO_SELECTION_MESSAGE,
          queryId,
          rowIds: Array.from(nextSelection),
        });
      });

      clusterLayer.addLayer(marker);
      markersByRowIdRef.current.set(point.rowId, marker);
    });

    const bounds = [];
    features.points.forEach((point) => bounds.push([point.lat, point.lng]));
    features.tracks.forEach((track) => {
      track.positions.forEach((position) => bounds.push([position.lat, position.lng]));
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 13,
      });
    }
  }, [features, mapReady, queryId]);

  useEffect(() => {
    markersByRowIdRef.current.forEach((marker, rowId) => {
      const element = marker.getElement();
      if (!element) return;
      element.classList.toggle("geo-point-selected", selectedRowIds.has(rowId));
    });

    tracksByRowIdRef.current.forEach((track, rowId) => {
      track.setStyle({
        color: selectedRowIds.has(rowId) ? "#f59e0b" : "#2563eb",
        weight: selectedRowIds.has(rowId) ? 5 : 3,
      });
    });
  }, [selectedRowIds]);

  const hasGeoData = features.points.length > 0 || features.tracks.length > 0;

  return (
    <div className="geo-map-shell">
      <header className="geo-map-header">
        <div className="geo-map-title-wrap">
          <h1 className="geo-map-title">GeoNaviGatr2</h1>
          <div className="geo-map-subtitle">
            {geoState?.queryName || "Waiting for query data"}
          </div>
        </div>

        <div className="geo-map-stats" aria-label="Map statistics">
          <span className="geo-map-pill">{features.points.length} points</span>
          <span className="geo-map-pill">{features.tracks.length} tracks</span>
          <span className="geo-map-pill">{selectedRowIds.size} selected</span>
          {features.ignoredRowCount > 0 && (
            <span className="geo-map-pill">{features.ignoredRowCount} ignored</span>
          )}
        </div>
      </header>

      <main className="geo-map-body">
        <div className="geo-map-canvas" ref={mapContainerRef} />

        {!hasGeoData && (
          <div className="geo-map-empty">
            <h2>{runtimeError || "No mapped rows"}</h2>
            <p>
              {runtimeError
                ? "GeoNaviGatr2 needs network access for the current OpenStreetMap prototype."
                : "GeoNaviGatr2 is listening for the active query. Rows without valid collection coordinates are ignored."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default GeoMap;
