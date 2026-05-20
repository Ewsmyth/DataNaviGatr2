#!/usr/bin/env python3
"""Refine cellular tower estimates from accumulated survey records in MongoDB."""

from __future__ import annotations

import argparse
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from pymongo import MongoClient, UpdateOne


DEFAULT_MONGO_URI = "mongodb://admin:password@mongodb:27017/?authSource=admin"
SURVEY_DB_NAME = os.getenv("CELL_SURVEY_DB_NAME", "cell_survey")
SURVEY_COLLECTION_NAME = os.getenv("CELL_SURVEY_COLLECTION_NAME", "records")
TOWERS_COLLECTION_NAME = os.getenv("CELL_TOWERS_COLLECTION_NAME", "towers")
EARTH_METERS_PER_DEGREE_LAT = 110_540.0
GSM_TA_METERS = 554.0
LTE_TA_METERS = 78.125


@dataclass(frozen=True)
class Observation:
    source_id: str
    protocol: str
    mcc: str
    mnc: str
    area: str
    cell: str
    channel: str
    lat: float
    lon: float
    alt: float
    rssi: float | None
    ta: float | None
    observed_at: str | None
    x: float = 0.0
    y: float = 0.0


@dataclass(frozen=True)
class Candidate:
    x: float
    y: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Estimate/refine cellular tower locations from all accumulated "
            "cell_survey.records survey observations."
        )
    )
    parser.add_argument(
        "--mongo-uri",
        default=os.getenv("MONGO_URI", DEFAULT_MONGO_URI),
        help="MongoDB URI. Defaults to MONGO_URI or the ingest service default.",
    )
    parser.add_argument("--db", default=SURVEY_DB_NAME, help="Survey Mongo database.")
    parser.add_argument(
        "--survey-collection",
        default=SURVEY_COLLECTION_NAME,
        help="Collection containing survey records.",
    )
    parser.add_argument(
        "--towers-collection",
        default=TOWERS_COLLECTION_NAME,
        help="Collection receiving tower estimates.",
    )
    parser.add_argument(
        "--grid-size",
        type=int,
        default=91,
        help="Candidate grid cells per side. Default: 91.",
    )
    parser.add_argument(
        "--min-observations",
        type=int,
        default=3,
        help="Minimum usable observations required to estimate a tower.",
    )
    parser.add_argument(
        "--tower-id",
        help=(
            "Optional canonical tower id to process, e.g. "
            "GSM:515:03:21241:20454:695."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate estimates and print them without writing towers.",
    )
    return parser.parse_args()


def to_float(value: Any) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_part(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def canonical_from_doc(doc: dict[str, Any]) -> tuple[str, str, str, str, str, str] | None:
    fields = doc.get("survey_fields") if isinstance(doc.get("survey_fields"), dict) else {}
    protocol = clean_part(doc.get("survey_protocol") or fields.get("PROTOCOL")).upper()

    mcc = clean_part(doc.get("mcc") or fields.get("MCC"))
    mnc = clean_part(doc.get("mnc") or fields.get("MNC"))

    if protocol == "LTE" or doc.get("eci") is not None or fields.get("ECI") is not None:
        area = clean_part(doc.get("tac") or fields.get("TAC"))
        cell = clean_part(doc.get("eci") or fields.get("ECI"))
        channel = clean_part(doc.get("earfcn") or fields.get("EARFCN"))
        protocol = "LTE"
    else:
        area = clean_part(doc.get("lac") or fields.get("LAC"))
        cell = clean_part(doc.get("cid") or fields.get("CID"))
        channel = clean_part(doc.get("arfcn") or fields.get("ARFCN"))
        protocol = protocol or "GSM"

    if not all((mcc, mnc, area, cell, channel)):
        return None

    return protocol, mcc, mnc, area, cell, channel


def tower_id(parts: tuple[str, str, str, str, str, str]) -> str:
    return ":".join(parts)


def observation_from_doc(doc: dict[str, Any]) -> Observation | None:
    parts = canonical_from_doc(doc)
    if not parts:
        return None

    location = doc.get("collection_location")
    fields = doc.get("survey_fields") if isinstance(doc.get("survey_fields"), dict) else {}
    if not isinstance(location, dict):
        return None

    lat = to_float(location.get("latitude"))
    lon = to_float(location.get("longitude"))
    alt = to_float(location.get("altitude")) or 0.0
    if lat is None or lon is None or (lat == 0.0 and lon == 0.0):
        return None

    protocol, mcc, mnc, area, cell, channel = parts
    return Observation(
        source_id=str(doc.get("_id")),
        protocol=protocol,
        mcc=mcc,
        mnc=mnc,
        area=area,
        cell=cell,
        channel=channel,
        lat=lat,
        lon=lon,
        alt=alt,
        rssi=to_float(doc.get("rssi") or fields.get("RSSI") or fields.get("RSRP")),
        ta=to_float(fields.get("TA")),
        observed_at=clean_part(doc.get("scan_time") or fields.get("SYS_DATE_TIME")) or None,
    )


def project_observations(observations: list[Observation]) -> tuple[list[Observation], float, float]:
    origin_lat = sum(obs.lat for obs in observations) / len(observations)
    origin_lon = sum(obs.lon for obs in observations) / len(observations)
    meters_per_degree_lon = 111_320.0 * math.cos(math.radians(origin_lat))

    projected = [
        Observation(
            **{
                **obs.__dict__,
                "x": (obs.lon - origin_lon) * meters_per_degree_lon,
                "y": (obs.lat - origin_lat) * EARTH_METERS_PER_DEGREE_LAT,
            }
        )
        for obs in observations
    ]
    return projected, origin_lat, origin_lon


def unproject(x: float, y: float, origin_lat: float, origin_lon: float) -> tuple[float, float]:
    meters_per_degree_lon = 111_320.0 * math.cos(math.radians(origin_lat))
    return (
        origin_lat + y / EARTH_METERS_PER_DEGREE_LAT,
        origin_lon + x / meters_per_degree_lon,
    )


def timing_advance_distance(obs: Observation) -> tuple[float, float] | None:
    if obs.ta is None or obs.ta < 0:
        return None

    unit = LTE_TA_METERS if obs.protocol == "LTE" else GSM_TA_METERS
    distance = obs.ta * unit
    sigma = max(unit * 0.75, 60.0)
    return distance, sigma


def rssi_weight(obs: Observation, strongest_rssi: float | None) -> float:
    if obs.rssi is None or strongest_rssi is None:
        return 1.0
    return max(0.08, 10 ** ((obs.rssi - strongest_rssi) / 10.0))


def score_candidate(candidate_x: float, candidate_y: float, observations: list[Observation]) -> float:
    rssi_values = [obs.rssi for obs in observations if obs.rssi is not None]
    strongest = max(rssi_values) if rssi_values else None
    fallback_sigma = max(survey_span_m(observations) / 8.0, 80.0)
    score = 0.0

    for obs in observations:
        distance = math.hypot(candidate_x - obs.x, candidate_y - obs.y)
        weight = rssi_weight(obs, strongest)
        ta_ring = timing_advance_distance(obs)
        if ta_ring:
            ring_distance, sigma = ta_ring
            score += weight * math.exp(-0.5 * ((distance - ring_distance) / sigma) ** 2)
        else:
            score += weight * math.exp(-0.5 * (distance / fallback_sigma) ** 2)

    return score


def survey_span_m(observations: list[Observation]) -> float:
    xs = [obs.x for obs in observations]
    ys = [obs.y for obs in observations]
    return max(max(xs) - min(xs), max(ys) - min(ys), 1.0)


def build_candidates(observations: list[Observation], grid_size: int) -> list[Candidate]:
    if grid_size < 21:
        raise ValueError("--grid-size must be at least 21.")

    xs = [obs.x for obs in observations]
    ys = [obs.y for obs in observations]
    ta_distances = [
        distance
        for obs in observations
        for distance, _sigma in [timing_advance_distance(obs) or (0.0, 0.0)]
        if distance > 0
    ]
    padding = max(250.0, survey_span_m(observations) * 0.35, max(ta_distances, default=0.0))
    min_x = min(xs) - padding
    max_x = max(xs) + padding
    min_y = min(ys) - padding
    max_y = max(ys) + padding
    step_x = (max_x - min_x) / (grid_size - 1)
    step_y = (max_y - min_y) / (grid_size - 1)
    candidates = []

    for row in range(grid_size):
        y = min_y + row * step_y
        for col in range(grid_size):
            x = min_x + col * step_x
            candidates.append(Candidate(x=x, y=y, score=score_candidate(x, y, observations)))

    total_score = sum(candidate.score for candidate in candidates)
    if total_score <= 0:
        raise ValueError("Candidate score was zero; cannot estimate tower.")

    return [
        Candidate(x=candidate.x, y=candidate.y, score=candidate.score / total_score)
        for candidate in candidates
    ]


def confidence_cells(candidates: list[Candidate], probability: float = 0.80) -> list[Candidate]:
    selected = []
    mass = 0.0
    for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
        selected.append(candidate)
        mass += candidate.score
        if mass >= probability:
            break
    return selected


def weighted_center(candidates: list[Candidate]) -> tuple[float, float]:
    total = sum(candidate.score for candidate in candidates)
    return (
        sum(candidate.x * candidate.score for candidate in candidates) / total,
        sum(candidate.y * candidate.score for candidate in candidates) / total,
    )


def estimate_radius(center_x: float, center_y: float, selected: list[Candidate]) -> float:
    total = sum(candidate.score for candidate in selected)
    variance = sum(
        candidate.score * ((candidate.x - center_x) ** 2 + (candidate.y - center_y) ** 2)
        for candidate in selected
    ) / total
    return math.sqrt(max(variance, 1.0))


def estimate_tower(observations: list[Observation], grid_size: int) -> dict[str, Any]:
    projected, origin_lat, origin_lon = project_observations(observations)
    candidates = build_candidates(projected, grid_size)
    selected = confidence_cells(candidates)
    best = max(candidates, key=lambda candidate: candidate.score)
    best_lat, best_lon = unproject(best.x, best.y, origin_lat, origin_lon)
    center_x, center_y = weighted_center(selected)
    center_lat, center_lon = unproject(center_x, center_y, origin_lat, origin_lon)
    rssi_values = [obs.rssi for obs in observations if obs.rssi is not None]
    ta_values = [obs.ta for obs in observations if obs.ta is not None]

    return {
        "estimated_location": {
            "type": "Point",
            "coordinates": [best_lon, best_lat],
        },
        "estimated_latitude": best_lat,
        "estimated_longitude": best_lon,
        "best_candidate": {
            "type": "Point",
            "coordinates": [best_lon, best_lat],
            "probability": best.score,
        },
        "probability_center": {
            "type": "Point",
            "coordinates": [center_lon, center_lat],
        },
        "confidence_radius_m": estimate_radius(best.x, best.y, selected),
        "confidence_probability": 0.80,
        "observation_count": len(observations),
        "timing_advance_observation_count": len(ta_values),
        "rssi_min": min(rssi_values) if rssi_values else None,
        "rssi_max": max(rssi_values) if rssi_values else None,
        "timing_advance_min": min(ta_values) if ta_values else None,
        "timing_advance_max": max(ta_values) if ta_values else None,
        "first_observed_at": min((obs.observed_at for obs in observations if obs.observed_at), default=None),
        "last_observed_at": max((obs.observed_at for obs in observations if obs.observed_at), default=None),
        "source_record_ids": [obs.source_id for obs in observations],
    }


def iter_survey_observations(collection, tower_filter: str | None) -> Iterable[Observation]:
    query = {"record_type": "cellular_survey", "collection_location.latitude": {"$exists": True}}
    projection = {
        "survey_protocol": 1,
        "survey_fields": 1,
        "collection_location": 1,
        "mcc": 1,
        "mnc": 1,
        "lac": 1,
        "cid": 1,
        "tac": 1,
        "eci": 1,
        "arfcn": 1,
        "earfcn": 1,
        "rssi": 1,
        "rsrp": 1,
        "scan_time": 1,
    }

    for doc in collection.find(query, projection):
        observation = observation_from_doc(doc)
        if not observation:
            continue
        if tower_filter and tower_id(
            (
                observation.protocol,
                observation.mcc,
                observation.mnc,
                observation.area,
                observation.cell,
                observation.channel,
            )
        ) != tower_filter:
            continue
        yield observation


def group_observations(observations: Iterable[Observation]) -> dict[str, list[Observation]]:
    grouped: dict[str, list[Observation]] = {}
    for observation in observations:
        key = tower_id(
            (
                observation.protocol,
                observation.mcc,
                observation.mnc,
                observation.area,
                observation.cell,
                observation.channel,
            )
        )
        grouped.setdefault(key, []).append(observation)
    return grouped


def build_tower_document(tower_key: str, observations: list[Observation], estimate: dict[str, Any]) -> dict[str, Any]:
    representative = observations[0]
    now = datetime.now(timezone.utc).isoformat()
    return {
        "tower_id": tower_key,
        "tower_model": "single_gci_cell",
        "protocol": representative.protocol,
        "mcc": representative.mcc,
        "mnc": representative.mnc,
        "area_code": representative.area,
        "cell_id": representative.cell,
        "channel": representative.channel,
        "updated_at": now,
        "estimator": {
            "name": "cellular_survey_tower_parser",
            "version": "1",
            "inputs": ["RSSI", "TA", "collection_location"],
            "notes": (
                "One tower document represents one full GCI/cell. Estimates are "
                "recomputed from all matching survey observations on each run."
            ),
        },
        **estimate,
    }


def ensure_indexes(survey_collection, towers_collection) -> None:
    survey_collection.create_index([("record_type", 1), ("mcc", 1), ("mnc", 1)])
    towers_collection.create_index("tower_id", unique=True)
    towers_collection.create_index([("estimated_location", "2dsphere")])


def main() -> None:
    args = parse_args()
    client = MongoClient(args.mongo_uri)
    db = client[args.db]
    survey_collection = db[args.survey_collection]
    towers_collection = db[args.towers_collection]
    ensure_indexes(survey_collection, towers_collection)

    grouped = group_observations(iter_survey_observations(survey_collection, args.tower_id))
    operations = []
    skipped = 0

    for key, observations in sorted(grouped.items()):
        if len(observations) < args.min_observations:
            skipped += 1
            continue

        estimate = estimate_tower(observations, args.grid_size)
        tower_doc = build_tower_document(key, observations, estimate)
        operations.append(
            UpdateOne(
                {"tower_id": key},
                {
                    "$set": tower_doc,
                    "$setOnInsert": {"created_at": tower_doc["updated_at"]},
                },
                upsert=True,
            )
        )

        print(
            f"{key}: {estimate['observation_count']} observations, "
            f"{estimate['estimated_latitude']:.7f}, "
            f"{estimate['estimated_longitude']:.7f}, "
            f"radius {estimate['confidence_radius_m']:.1f} m"
        )

    if args.dry_run:
        print(f"Dry run: {len(operations)} tower estimate(s), {skipped} skipped.")
        return

    if operations:
        result = towers_collection.bulk_write(operations, ordered=False)
        print(
            f"Upserted {result.upserted_count}, modified {result.modified_count}; "
            f"{skipped} tower group(s) skipped."
        )
    else:
        print(f"No tower estimates written; {skipped} tower group(s) skipped.")


if __name__ == "__main__":
    main()
