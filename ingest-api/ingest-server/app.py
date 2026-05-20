import json
import math
import os
import re
import hashlib
import csv
from io import StringIO
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path

import jwt
from flask_cors import CORS
from flask import Flask, jsonify, request
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from werkzeug.utils import secure_filename

"""
Standalone ingest API.

This service accepts admin-authenticated JSON uploads, stages files, validates
collector/organization/default-location metadata, normalizes each record into a
consistent Mongo document, and inserts records into the ingest collection.
"""

app = Flask(__name__)
CORS(app, origins=[os.getenv("CORS_ORIGIN", "*")])

UPLOAD_TMP_DIR = os.getenv("UPLOAD_TMP_DIR", "/tmp/ingest_uploads")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://admin:password@mongodb:27017/?authSource=admin")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "ingestion_db")
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME", "records")
CELL_SURVEY_DB_NAME = os.getenv("CELL_SURVEY_DB_NAME", "cell_survey")
CELL_SURVEY_COLLECTION_NAME = os.getenv("CELL_SURVEY_COLLECTION_NAME", "records")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "120"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))
BATCH_SIZE = int(os.getenv("INGEST_BATCH_SIZE", "1000"))

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

os.makedirs(UPLOAD_TMP_DIR, exist_ok=True)

mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB_NAME]
mongo_collection = mongo_db[MONGO_COLLECTION_NAME]
cell_survey_db = mongo_client[CELL_SURVEY_DB_NAME]
cell_survey_collection = cell_survey_db[CELL_SURVEY_COLLECTION_NAME]


def _get_bearer_token():
    """Extract the Bearer token from the Authorization header, if present."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    return auth_header.split(" ", 1)[1].strip()


def admin_token_required(fn):
    """Require a valid access token with the admin role for ingest operations."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not JWT_SECRET_KEY:
            return jsonify({"error": "Ingest authentication is not configured."}), 503

        token = _get_bearer_token()
        if not token:
            return jsonify({"error": "Admin authentication required."}), 401

        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        except Exception:
            return jsonify({"error": "Invalid or expired token."}), 401

        if payload.get("type") != "access":
            return jsonify({"error": "Invalid token type."}), 401

        if "admin" not in (payload.get("roles") or []):
            return jsonify({"error": "Admin role required."}), 403

        return fn(*args, **kwargs)

    return wrapper


def allowed_file(filename: str) -> bool:
    """Return True when an uploaded filename maps to a known ingest type."""
    return recognize_file_type(filename) is not None


def get_file_extension(filename: str) -> str:
    """Return a normalized lowercase file extension, including the leading dot."""
    return Path(filename or "").suffix.lower()


def recognize_file_type(filename: str):
    """Map known file extensions to ingest domains."""
    extension = get_file_extension(filename)
    if extension == ".json":
        return "cellular_collect"
    if extension in (".gns", ".g3ns"):
        return "cellular_survey"
    return None


def validate_collector_code(value: str) -> str:
    """Normalize and validate the two-character collector code."""
    value = (value or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2}", value):
        raise ValueError("Collector Code must be exactly 2 alphanumeric characters.")
    return value


def validate_organization_code(value: str) -> str:
    """Normalize and validate the five-character organization code."""
    value = (value or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{5}", value):
        raise ValueError("Organization Code must be exactly 5 alphanumeric characters.")
    return value


def get_file_timestamp(uploaded_file) -> datetime:
    """
    Try to derive a timestamp for filename generation.

    Browsers generally do not provide original filesystem creation time in a reliable way.
    So for an HTTP upload, the practical fallback is current UTC time.
    """
    return datetime.now(timezone.utc)


def build_base_filename(org_code: str, collector_code: str, ts: datetime) -> str:
    """Create the stable prefix used for staged ingest filenames."""
    return f"{org_code}_{collector_code}_{ts.strftime('%Y-%m-%d_%H-%M-%S')}"


def get_unique_filename(base_name: str, extension: str = ".json") -> str:
    """
    Avoid duplicates by using a 2-digit suffix starting at 01.
    Only increments when a collision exists in the temp directory.
    """
    for i in range(1, 100):
        candidate = f"{base_name}_{i:02d}{extension}"
        candidate_path = Path(UPLOAD_TMP_DIR) / candidate
        if not candidate_path.exists():
            return candidate
    raise RuntimeError("Could not generate a unique filename after 99 attempts.")


def stage_uploaded_file(uploaded_file, new_filename: str) -> Path:
    """Save one Werkzeug uploaded file into the temporary ingest directory."""
    staged_path = Path(UPLOAD_TMP_DIR) / new_filename
    uploaded_file.save(staged_path)
    return staged_path


def normalize_ingest_payload(parsed_json):
    """Ensure uploaded JSON is represented as a list of record dictionaries."""
    if isinstance(parsed_json, dict):
        return [parsed_json]
    if isinstance(parsed_json, list):
        if not all(isinstance(item, dict) for item in parsed_json):
            raise ValueError("JSON array must contain only objects.")
        return parsed_json
    raise ValueError("JSON must be an object or an array of objects.")


def parse_float(value, label):
    """Parse a required numeric input and include the field label in errors."""
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number.")


def parse_int(value, label):
    """Parse a required integer input and include the field label in errors."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a whole number.")


def parse_altitude(values):
    """Parse optional altitude, defaulting to zero meters when omitted."""
    altitude = values.get("altitude")
    if altitude is None or str(altitude).strip() == "":
        return 0.0
    return parse_float(altitude, "Altitude")


def validate_lat_lon(latitude, longitude):
    """Validate decimal latitude and longitude bounds."""
    if not -90 <= latitude <= 90:
        raise ValueError("Latitude must be between -90 and 90.")
    if not -180 <= longitude <= 180:
        raise ValueError("Longitude must be between -180 and 180.")


def parse_dms(value, label):
    """Parse a degrees/minutes/seconds coordinate with optional N/S/E/W suffix."""
    text = str(value or "").strip().upper()
    direction_match = re.search(r"([NSEW])$", text)
    direction = direction_match.group(1) if direction_match else ""
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", text)
    if not numbers:
        raise ValueError(f"{label} must include degrees.")

    degrees = float(numbers[0])
    minutes = float(numbers[1]) if len(numbers) > 1 else 0.0
    seconds = float(numbers[2]) if len(numbers) > 2 else 0.0
    if minutes < 0 or minutes >= 60 or seconds < 0 or seconds >= 60:
        raise ValueError(f"{label} minutes and seconds must be less than 60.")

    sign = -1 if degrees < 0 else 1
    if direction in ("S", "W"):
        sign = -1
    if direction in ("N", "E"):
        sign = 1

    return sign * (abs(degrees) + (minutes / 60) + (seconds / 3600))


def utm_to_lat_lon(zone, hemisphere, easting, northing):
    """Convert UTM coordinates to decimal latitude/longitude."""
    if not 1 <= zone <= 60:
        raise ValueError("UTM zone must be between 1 and 60.")

    hemisphere = str(hemisphere or "").strip().upper()
    if hemisphere not in ("N", "S"):
        raise ValueError("UTM hemisphere must be N or S.")

    a = 6378137.0
    eccentricity_squared = 0.00669438
    k0 = 0.9996
    eccentricity_prime_squared = eccentricity_squared / (1 - eccentricity_squared)
    e1 = (1 - math.sqrt(1 - eccentricity_squared)) / (
        1 + math.sqrt(1 - eccentricity_squared)
    )

    x = easting - 500000.0
    y = northing
    if hemisphere == "S":
        y -= 10000000.0

    longitude_origin = (zone - 1) * 6 - 180 + 3
    m = y / k0
    mu = m / (
        a
        * (
            1
            - eccentricity_squared / 4
            - 3 * eccentricity_squared**2 / 64
            - 5 * eccentricity_squared**3 / 256
        )
    )

    phi1_rad = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
    )

    n1 = a / math.sqrt(1 - eccentricity_squared * math.sin(phi1_rad) ** 2)
    t1 = math.tan(phi1_rad) ** 2
    c1 = eccentricity_prime_squared * math.cos(phi1_rad) ** 2
    r1 = (
        a
        * (1 - eccentricity_squared)
        / (1 - eccentricity_squared * math.sin(phi1_rad) ** 2) ** 1.5
    )
    d = x / (n1 * k0)

    latitude = phi1_rad - (
        n1
        * math.tan(phi1_rad)
        / r1
        * (
            d**2 / 2
            - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * eccentricity_prime_squared)
            * d**4
            / 24
            + (
                61
                + 90 * t1
                + 298 * c1
                + 45 * t1**2
                - 252 * eccentricity_prime_squared
                - 3 * c1**2
            )
            * d**6
            / 720
        )
    )
    longitude = (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (
            5
            - 2 * c1
            + 28 * t1
            - 3 * c1**2
            + 8 * eccentricity_prime_squared
            + 24 * t1**2
        )
        * d**5
        / 120
    ) / math.cos(phi1_rad)

    return math.degrees(latitude), longitude_origin + math.degrees(longitude)


def mgrs_to_utm(mgrs_value):
    """Parse an MGRS coordinate into UTM zone, hemisphere, easting, and northing."""
    text = re.sub(r"\s+", "", str(mgrs_value or "").upper())
    match = re.fullmatch(r"(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)", text)
    if not match:
        raise ValueError("MGRS must look like 51QYU0700046000.")

    zone = int(match.group(1))
    band = match.group(2)
    square = match.group(3)
    digits = match.group(4)
    if len(digits) % 2 != 0 or len(digits) > 10:
        raise ValueError("MGRS numeric precision must have an even number of digits up to 10.")

    easting_letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    northing_letters = "ABCDEFGHJKLMNPQRSTUV"
    set_column = (zone - 1) % 3
    easting_sets = ("ABCDEFGH", "JKLMNPQR", "STUVWXYZ")
    column = easting_sets[set_column].index(square[0]) + 1
    easting = column * 100000.0

    row = northing_letters.index(square[1])
    northing = row * 100000.0
    if zone % 2 == 0:
        northing = ((row + 5) % 20) * 100000.0

    precision = len(digits) // 2
    if precision:
        scale = 10 ** (5 - precision)
        easting += int(digits[:precision]) * scale
        northing += int(digits[precision:]) * scale

    band_min_lat = "CDEFGHJKLMNPQRSTUVWX".index(band) * 8 - 80
    hemisphere = "N" if band >= "N" else "S"
    min_northing = 0 if hemisphere == "N" else 10000000
    band_min_northing = lat_to_utm_northing(band_min_lat, zone)
    if hemisphere == "S":
        band_min_northing += 10000000

    while northing < band_min_northing:
        northing += 2000000
    if hemisphere == "S" and northing < min_northing:
        northing += 10000000

    return zone, hemisphere, easting, northing


def lat_to_utm_northing(latitude, zone):
    """Approximate UTM northing at a latitude for MGRS band alignment."""
    central_meridian = math.radians((zone - 1) * 6 - 180 + 3)
    lat_rad = math.radians(latitude)
    lon_rad = central_meridian
    a = 6378137.0
    eccentricity_squared = 0.00669438
    k0 = 0.9996
    eccentricity_prime_squared = eccentricity_squared / (1 - eccentricity_squared)
    n = a / math.sqrt(1 - eccentricity_squared * math.sin(lat_rad) ** 2)
    t = math.tan(lat_rad) ** 2
    c = eccentricity_prime_squared * math.cos(lat_rad) ** 2
    longitude_delta = math.cos(lat_rad) * (lon_rad - central_meridian)
    m = a * (
        (1 - eccentricity_squared / 4 - 3 * eccentricity_squared**2 / 64 - 5 * eccentricity_squared**3 / 256)
        * lat_rad
        - (3 * eccentricity_squared / 8 + 3 * eccentricity_squared**2 / 32 + 45 * eccentricity_squared**3 / 1024)
        * math.sin(2 * lat_rad)
        + (15 * eccentricity_squared**2 / 256 + 45 * eccentricity_squared**3 / 1024)
        * math.sin(4 * lat_rad)
        - (35 * eccentricity_squared**3 / 3072) * math.sin(6 * lat_rad)
    )
    return k0 * (
        m
        + n
        * math.tan(lat_rad)
        * (
            longitude_delta**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * longitude_delta**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * eccentricity_prime_squared)
            * longitude_delta**6
            / 720
        )
    )


def lat_lon_alt_to_ecef(latitude, longitude, altitude):
    """Convert WGS84 latitude/longitude/altitude into ECEF x/y/z meters."""
    a = 6378137.0
    eccentricity_squared = 6.69437999014e-3
    lat_rad = math.radians(latitude)
    lon_rad = math.radians(longitude)
    prime_vertical_radius = a / math.sqrt(
        1 - eccentricity_squared * math.sin(lat_rad) ** 2
    )

    return {
        "ecef_x": (prime_vertical_radius + altitude)
        * math.cos(lat_rad)
        * math.cos(lon_rad),
        "ecef_y": (prime_vertical_radius + altitude)
        * math.cos(lat_rad)
        * math.sin(lon_rad),
        "ecef_z": (
            prime_vertical_radius * (1 - eccentricity_squared) + altitude
        )
        * math.sin(lat_rad),
    }


def build_default_location(default_location_payload, record_time=None):
    """
    Convert the optional default GPS form payload into a normalized location.

    Supports decimal degrees, DMS, UTM, and MGRS, then adds ECEF coordinates so
    downstream table/map views can use the same location shape as uploaded data.
    """
    if not default_location_payload:
        return None

    payload_type = str(default_location_payload.get("type") or "").strip()
    values = default_location_payload.get("values")
    if not isinstance(values, dict):
        raise ValueError("Default GPS values are required.")

    altitude = parse_altitude(values)
    if payload_type == "decimal_degrees":
        latitude = parse_float(values.get("latitude"), "Latitude")
        longitude = parse_float(values.get("longitude"), "Longitude")
    elif payload_type == "dms":
        latitude = parse_dms(values.get("latitude"), "Latitude")
        longitude = parse_dms(values.get("longitude"), "Longitude")
    elif payload_type == "utm":
        latitude, longitude = utm_to_lat_lon(
            parse_int(values.get("zone"), "UTM zone"),
            values.get("hemisphere"),
            parse_float(values.get("easting"), "UTM easting"),
            parse_float(values.get("northing"), "UTM northing"),
        )
    elif payload_type == "mgrs":
        latitude, longitude = utm_to_lat_lon(*mgrs_to_utm(values.get("mgrs")))
    else:
        raise ValueError("Default GPS type must be latitude/longitude, DMS, UTM, or MGRS.")

    validate_lat_lon(latitude, longitude)
    location = {
        "altitude": altitude,
        "latitude": latitude,
        "longitude": longitude,
        "time": record_time or datetime.now(timezone.utc).isoformat(),
    }
    location.update(lat_lon_alt_to_ecef(latitude, longitude, altitude))
    return location


def parse_default_location_payload(raw_value):
    """Parse and validate the default_location multipart field."""
    if not raw_value:
        return None
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        raise ValueError("Default GPS payload must be valid JSON.")
    if not isinstance(payload, dict):
        raise ValueError("Default GPS payload must be an object.")
    build_default_location(payload)
    return payload


def document_has_locations(doc):
    """Return True when an uploaded source record already has location samples."""
    locations = doc.get("locations")
    return isinstance(locations, list) and any(isinstance(item, dict) for item in locations)


def first_dict(value):
    """Return the first dict from a list, or an empty dict for missing data."""
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return value[0]
    return {}


def copy_keys(source, keys):
    """Copy selected keys from one dict when they exist."""
    return {key: source[key] for key in keys if key in source}


def build_collection_location(location):
    """Build the explicit collection-platform location object stored in normalized rows."""
    if not location:
        return None

    collection_location = copy_keys(
        location,
        [
            "latitude",
            "longitude",
            "altitude",
            "ecef_x",
            "ecef_y",
            "ecef_z",
            "time",
        ],
    )
    collection_location["meaning"] = "collector_system_location"
    collection_location["note"] = (
        "This is the collection platform/system location, not the tower, "
        "phone, subscriber, or emitting-device location."
    )
    return collection_location


def build_collection_geo(location):
    """Build a GeoJSON point from a collection location."""
    if not location:
        return None

    latitude = location.get("latitude")
    longitude = location.get("longitude")
    if latitude is None or longitude is None:
        return None

    return {
        "type": "Point",
        "coordinates": [longitude, latitude],
    }


def build_collection_location_track(locations):
    """Convert multiple source locations into a normalized collection track."""
    track = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        track_location = build_collection_location(location)
        if track_location:
            track.append(track_location)
    return track


def build_source_fingerprint(doc):
    """Hash the source record contents to produce a stable dedupe/audit identifier."""
    payload = json.dumps(doc, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_survey_scalar(value):
    """Convert simple survey cell values while preserving empty cells as None."""
    if value is None:
        return None

    text = str(value).strip()
    if text == "":
        return None

    if re.fullmatch(r"[-+]?\d+", text):
        try:
            return int(text)
        except ValueError:
            return text

    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)", text):
        try:
            return float(text)
        except ValueError:
            return text

    return text


def parse_survey_metadata_row(row):
    """Convert one pre-FIELDS metadata row into a key/value pair when possible."""
    if not row:
        return None, None

    first = (row[0] or "").strip()
    if not first:
        return None, None

    if len(row) > 1:
        value = ",".join(item for item in row[1:] if item is not None).strip()
        return first, parse_survey_scalar(value)

    if ":" in first:
        key, value = first.split(":", 1)
        return key.strip(), parse_survey_scalar(value)

    return first, True


def unique_survey_field_name(field_name, seen_counts):
    """Return a Mongo-safe field key while preserving duplicate survey columns."""
    base_name = field_name or "_blank_field"
    seen_counts[base_name] = seen_counts.get(base_name, 0) + 1
    if seen_counts[base_name] == 1:
        return base_name
    return f"{base_name}__{seen_counts[base_name]}"


def build_survey_field_maps(fields, values):
    """
    Build complete typed/raw field maps for a REC row.

    Every declared FIELDS column is present in both maps. If a row is short, the
    missing column is stored as None in the typed map and "" in the raw map. Any
    duplicate field names receive a __2/__3 suffix so data is not overwritten.
    """
    typed_fields = {}
    raw_fields = {}
    seen_counts = {}

    for index, field_name in enumerate(fields):
        field_key = unique_survey_field_name(field_name, seen_counts)
        raw_value = values[index] if index < len(values) else ""
        raw_fields[field_key] = raw_value
        typed_fields[field_key] = parse_survey_scalar(raw_value)

    extra_values = values[len(fields):]
    if extra_values:
        raw_fields["_extra_values"] = extra_values
        typed_fields["_extra_values"] = [
            parse_survey_scalar(value) for value in extra_values
        ]

    return typed_fields, raw_fields


def parse_cellular_survey(text, source_filename):
    """
    Parse .gns/.g3ns cellular survey files.

    The sample files use CSV-like rows with free-form metadata before a FIELDS
    row and REC rows afterwards. Each REC becomes one Mongo document.
    """
    metadata = {}
    fields = None
    records = []

    reader = csv.reader(StringIO(text))
    for line_number, row in enumerate(reader, start=1):
        if not row or all(not str(item).strip() for item in row):
            continue

        row_type = (row[0] or "").strip()
        if row_type == "FIELDS":
            fields = [field.strip() for field in row[1:]]
            continue

        if row_type == "REC":
            if not fields:
                raise ValueError("Survey file has REC rows before a FIELDS row.")

            values = row[1:]
            typed_fields, raw_fields = build_survey_field_maps(fields, values)

            records.append(
                build_cellular_survey_document(
                    typed_fields=typed_fields,
                    raw_fields=raw_fields,
                    declared_fields=fields,
                    row_values=values,
                    metadata=metadata,
                    source_filename=source_filename,
                    source_line_number=line_number,
                )
            )
            continue

        key, value = parse_survey_metadata_row(row)
        if key:
            metadata[key] = value

    if fields is None:
        raise ValueError("Survey file must include a FIELDS row.")

    return records


def build_cellular_survey_document(
    typed_fields,
    raw_fields,
    declared_fields,
    row_values,
    metadata,
    source_filename,
    source_line_number,
):
    """Build one Mongo-ready cellular survey record from a parsed REC row."""
    latitude = typed_fields.get("LAT")
    longitude = typed_fields.get("LON")
    altitude = typed_fields.get("ALT")
    collection_location = None
    collection_geo = None

    if isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)):
        altitude_value = altitude if isinstance(altitude, (int, float)) else 0.0
        collection_location = {
            "latitude": float(latitude),
            "longitude": float(longitude),
            "altitude": float(altitude_value),
            "time": typed_fields.get("SYS_DATE_TIME"),
            "meaning": "collector_system_location",
            "note": (
                "This is the collection platform/system location, not the tower, "
                "phone, subscriber, or emitting-device location."
            ),
        }
        collection_location.update(
            lat_lon_alt_to_ecef(
                collection_location["latitude"],
                collection_location["longitude"],
                collection_location["altitude"],
            )
        )
        collection_geo = {
            "type": "Point",
            "coordinates": [collection_location["longitude"], collection_location["latitude"]],
        }

    protocol = str(metadata.get("PROTOCOL") or metadata.get("Technology") or "").upper()
    document = {
        "record_type": "cellular_survey",
        "source_format": "cellular_survey_file",
        "source_filename": source_filename,
        "source_line_number": source_line_number,
        "survey_metadata": dict(metadata),
        "survey_columns": list(declared_fields),
        "survey_values": [parse_survey_scalar(value) for value in row_values],
        "survey_raw_values": list(row_values),
        "survey_fields": typed_fields,
        "survey_raw_fields": raw_fields,
        "survey_protocol": protocol or None,
        "system": metadata.get("SYSTEM") or metadata.get("System"),
        "collection_type": metadata.get("COLLECTION_TYPE"),
        "scan_time": typed_fields.get("SYS_DATE_TIME"),
        "gps_lock": typed_fields.get("GPS_LOCK"),
        "mcc": typed_fields.get("MCC"),
        "mnc": typed_fields.get("MNC"),
        "lac": typed_fields.get("LAC"),
        "cid": typed_fields.get("CID"),
        "tac": typed_fields.get("TAC"),
        "eci": typed_fields.get("ECI"),
        "band": typed_fields.get("BAND"),
        "arfcn": typed_fields.get("ARFCN"),
        "earfcn": typed_fields.get("EARFCN"),
        "pci": typed_fields.get("PCI"),
        "bsic": typed_fields.get("BSIC"),
        "rssi": typed_fields.get("RSSI"),
        "rsrp": typed_fields.get("RSRP"),
        "rsrq": typed_fields.get("RSRQ"),
        "collection_location": collection_location,
        "collection_geo": collection_geo,
        "collection_location_meaning": "collector_system_location",
        "collection_location_warning": (
            "Collection location is the collection platform/system location. "
            "It is not the tower, phone, subscriber, or emitting-device location."
        ),
    }
    document["source_fingerprint"] = build_source_fingerprint(document)
    return {key: value for key, value in document.items() if value is not None}


def normalize_gsm_document(doc):
    """Normalize a GSM export record into the flattened fields used by search/table/map views."""
    attachments = doc.get("attachments") if isinstance(doc.get("attachments"), list) else []
    primary_attachment = first_dict(attachments)
    body = primary_attachment.get("body") if isinstance(primary_attachment.get("body"), dict) else {}

    locations = doc.get("locations") if isinstance(doc.get("locations"), list) else []
    collection_location_source = first_dict(locations)
    collection_location = build_collection_location(collection_location_source)
    collection_geo = build_collection_geo(collection_location_source)
    collection_location_track = build_collection_location_track(locations)

    normalized = {
        "record_type": "gsm_event",
        "source_format": "gsm_json_export",
        "source_record_id": doc.get("id"),
        "source_record_id_string": doc.get("id_string"),
        "source_fingerprint": build_source_fingerprint(doc),
        "collector_id": doc.get("collector_id"),
        "platform_id": doc.get("platform_id"),
        "signal_type": doc.get("signal_type"),
        "status": doc.get("status"),
        "start_time": doc.get("start_time"),
        "end_time": doc.get("end_time"),
        "frequency": doc.get("frequency"),
        "bandwidth": doc.get("bandwidth"),
        "rssi": doc.get("rssi"),
        "attachment_id": primary_attachment.get("id"),
        "intercept_id": primary_attachment.get("intercept_id"),
        "attachment_source": primary_attachment.get("source"),
        "intercept_type": body.get("intercept_type"),
        "message_type": body.get("message_type"),
        "mobile_identity": body.get("mobile_identity"),
        "mobile_identity_type": body.get("mobile_identity_type"),
        "mobile_country": body.get("mobile_country"),
        "mcc": body.get("MCC"),
        "mnc": body.get("MNC"),
        "lac": body.get("LAC"),
        "cid": body.get("CID"),
        "arfcn": body.get("ARFCN"),
        "arfcn_c0": body.get("ARFCN_C0"),
        "arfcns": body.get("ARFCNs"),
        "neighbors": body.get("neighbors"),
        "timeslot": body.get("timeslot"),
        "sub_slot": body.get("sub_slot"),
        "timing_advance": body.get("timing_advance"),
        "cipher_key_sequence": body.get("cipher_key_sequence"),
        "service_type": body.get("service_type"),
        "bsic": body.get("BSIC"),
        "ncc": body.get("NCC"),
        "bcc": body.get("BCC"),
        "t3212": body.get("T3212"),
        "t3212_value": body.get("T3212_VAL"),
        "crh": body.get("CRH"),
        "crh_value": body.get("CRH_VAL"),
        "cro": body.get("CRO"),
        "cro_value": body.get("CRO_VAL"),
        "collection_location": collection_location,
        "collection_geo": collection_geo,
        "collection_location_track": collection_location_track,
        "collection_location_count": len(collection_location_track),
        "collection_location_meaning": "collector_system_location",
        "collection_location_warning": (
            "Collection location is the collection platform/system location. "
            "It is not the tower, phone, subscriber, or emitting-device location."
        ),
    }

    return {key: value for key, value in normalized.items() if value is not None}


def normalize_document(doc):
    """Dispatch record normalization by signal type, falling back to a minimal record."""
    signal_type = str(doc.get("signal_type") or "").upper()
    if signal_type == "GSM":
        return normalize_gsm_document(doc)

    return {
        "record_type": "unknown_event",
        "source_fingerprint": build_source_fingerprint(doc),
        "signal_type": doc.get("signal_type"),
    }


def add_default_location_if_missing(doc, default_location_payload):
    """Attach the default GPS location only when the source record has no locations."""
    if not default_location_payload or document_has_locations(doc):
        return doc

    enriched_doc = dict(doc)
    default_location = build_default_location(
        default_location_payload,
        record_time=doc.get("start_time") or doc.get("end_time"),
    )
    default_location["source"] = "ingest_default_gps"
    enriched_doc["locations"] = [default_location]
    return enriched_doc


def enrich_documents(
    documents,
    final_filename,
    collector_code,
    organization_code,
    default_location_payload=None,
):
    """Yield Mongo-ready documents with normalized data and ingest metadata attached."""
    ingested_at = datetime.now(timezone.utc).isoformat()

    for doc in documents:
        enriched_doc = add_default_location_if_missing(doc, default_location_payload)
        enriched_doc["normalized"] = normalize_document(enriched_doc)
        enriched_doc["_ingest"] = {
            "source_filename": final_filename,
            "collector_code": collector_code,
            "organization_code": organization_code,
            "ingested_at": ingested_at,
            "pipeline": "ingest-api",
            "recognized_file_type": "cellular_collect",
            "target_database": MONGO_DB_NAME,
            "target_collection": MONGO_COLLECTION_NAME,
        }
        if default_location_payload and not document_has_locations(doc):
            enriched_doc["_ingest"]["default_gps_applied"] = True
        yield enriched_doc


def enrich_survey_documents(documents, final_filename, collector_code, organization_code):
    """Yield cellular survey documents with ingest metadata attached."""
    ingested_at = datetime.now(timezone.utc).isoformat()

    for doc in documents:
        enriched_doc = dict(doc)
        enriched_doc["_ingest"] = {
            "source_filename": final_filename,
            "collector_code": collector_code,
            "organization_code": organization_code,
            "ingested_at": ingested_at,
            "pipeline": "ingest-api",
            "recognized_file_type": "cellular_survey",
            "target_database": CELL_SURVEY_DB_NAME,
            "target_collection": CELL_SURVEY_COLLECTION_NAME,
        }
        yield enriched_doc


def insert_documents(documents, collection=None):
    """Insert documents into Mongo in batches and return the inserted count."""
    target_collection = collection or mongo_collection
    inserted_count = 0
    batch = []

    for document in documents:
        batch.append(document)
        if len(batch) >= BATCH_SIZE:
            result = target_collection.insert_many(batch, ordered=False)
            inserted_count += len(result.inserted_ids)
            batch = []

    if batch:
        result = target_collection.insert_many(batch, ordered=False)
        inserted_count += len(result.inserted_ids)

    return inserted_count


@app.get("/")
def service_info():
    """Small root endpoint describing the ingest service."""
    return jsonify({
        "service": "ingest-api",
        "status": "ok",
        "health": "/api/health",
        "upload": "/api/ingest/upload",
    }), 200


@app.get("/api/health")
@app.get("/api/ingest/health")
def health():
    """Health endpoint that verifies MongoDB connectivity."""
    try:
        mongo_client.admin.command("ping")
        mongo_ok = True
    except Exception as exc:
        return jsonify({
            "status": "error",
            "mongo": False,
            "error": str(exc),
        }), 500

    return jsonify({
        "status": "ok",
        "mongo": mongo_ok,
        "database": MONGO_DB_NAME,
        "collection": MONGO_COLLECTION_NAME,
        "cell_survey_database": CELL_SURVEY_DB_NAME,
        "cell_survey_collection": CELL_SURVEY_COLLECTION_NAME,
    }), 200


@app.post("/api/upload")
@app.post("/api/ingest/upload")
@admin_token_required
def upload_files():
    """Upload, stage, recognize, normalize, and insert one or more ingest files."""
    try:
        collector_code = validate_collector_code(request.form.get("collector_code"))
        organization_code = validate_organization_code(request.form.get("organization_code"))
        default_location_payload = parse_default_location_payload(
            request.form.get("default_location")
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded."}), 400

    results = []

    for uploaded_file in files:
        original_name = uploaded_file.filename or ""
        safe_original_name = secure_filename(original_name)

        if not safe_original_name:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": "Invalid filename.",
            })
            continue

        if not allowed_file(safe_original_name):
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": "Only .json, .gns, and .g3ns files are allowed.",
            })
            continue

        staged_path = None
        try:
            file_type = recognize_file_type(safe_original_name)
            extension = get_file_extension(safe_original_name)
            ts = get_file_timestamp(uploaded_file)
            base_name = build_base_filename(organization_code, collector_code, ts)
            final_filename = get_unique_filename(base_name, extension)

            staged_path = stage_uploaded_file(uploaded_file, final_filename)

            with staged_path.open("rb") as f:
                raw = f.read()

            text = raw.decode("utf-8-sig")
            if file_type == "cellular_collect":
                parsed = json.loads(text)
                documents = normalize_ingest_payload(parsed)
                target_database = MONGO_DB_NAME
                target_collection = MONGO_COLLECTION_NAME
                inserted_count = insert_documents(
                    enrich_documents(
                        documents=documents,
                        final_filename=final_filename,
                        collector_code=collector_code,
                        organization_code=organization_code,
                        default_location_payload=default_location_payload,
                    )
                )
            elif file_type == "cellular_survey":
                documents = parse_cellular_survey(text, final_filename)
                target_database = CELL_SURVEY_DB_NAME
                target_collection = CELL_SURVEY_COLLECTION_NAME
                inserted_count = insert_documents(
                    enrich_survey_documents(
                        documents=documents,
                        final_filename=final_filename,
                        collector_code=collector_code,
                        organization_code=organization_code,
                    ),
                    collection=cell_survey_collection,
                )
            else:
                raise ValueError("Unrecognized file type.")

            results.append({
                "original_name": original_name,
                "final_filename": final_filename,
                "recognized_file_type": file_type,
                "database": target_database,
                "collection": target_collection,
                "status": "success",
                "inserted_count": inserted_count,
            })

        except UnicodeDecodeError:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": "Could not decode file as UTF-8/UTF-8-SIG.",
            })
        except json.JSONDecodeError as exc:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": f"Invalid JSON: {str(exc)}",
            })
        except ValueError as exc:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": str(exc),
            })
        except PyMongoError as exc:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": f"MongoDB error: {str(exc)}",
            })
        except Exception as exc:
            results.append({
                "original_name": original_name,
                "status": "error",
                "error": str(exc),
            })
        finally:
            if staged_path and staged_path.exists():
                try:
                    staged_path.unlink()
                except Exception:
                    pass

    success_count = sum(1 for item in results if item["status"] == "success")
    return jsonify({
        "message": f"Processed {len(results)} file(s).",
        "successful": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }), 200


@app.post("/api/ingest/final")
@admin_token_required
def final_ingest():
    """Legacy single-file ingest endpoint kept for older clients."""
    if "file" not in request.files:
        return jsonify({"error": "No file field named 'file' found in request."}), 400

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "":
        return jsonify({"error": "No file selected."}), 400

    collector_code = (request.form.get("collector_code") or "").strip().upper()
    organization_code = (request.form.get("organization_code") or "").strip().upper()
    final_filename = (request.form.get("final_filename") or "").strip()

    try:
        default_location_payload = parse_default_location_payload(
            request.form.get("default_location")
        )
        raw = uploaded_file.read()
        text = raw.decode("utf-8-sig")
        parsed = json.loads(text)
        documents = normalize_ingest_payload(parsed)

        inserted_count = insert_documents(
            enrich_documents(
                documents=documents,
                final_filename=final_filename or uploaded_file.filename,
                collector_code=collector_code,
                organization_code=organization_code,
                default_location_payload=default_location_payload,
            )
        )

        return jsonify({
            "message": "JSON ingested successfully",
            "database": MONGO_DB_NAME,
            "collection": MONGO_COLLECTION_NAME,
            "filename": final_filename or uploaded_file.filename,
            "inserted_count": inserted_count,
        }), 200

    except UnicodeDecodeError:
        return jsonify({"error": "Could not decode file as UTF-8/UTF-8-SIG."}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except PyMongoError as exc:
        return jsonify({"error": f"MongoDB error: {str(exc)}"}), 500
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"Invalid JSON: {str(exc)}"}), 400
    except Exception as exc:
        return jsonify({"error": f"Unexpected error: {str(exc)}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
