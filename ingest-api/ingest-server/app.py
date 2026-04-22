import json
import os
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path

from flask_cors import CORS
from flask import Flask, jsonify, request
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app, origins=[os.getenv("CORS_ORIGIN", "*")])

UPLOAD_TMP_DIR = os.getenv("UPLOAD_TMP_DIR", "/tmp/ingest_uploads")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://admin:password@mongodb:27017/?authSource=admin")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "ingestion_db")
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME", "records")
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "120"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))
BATCH_SIZE = int(os.getenv("INGEST_BATCH_SIZE", "1000"))

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

os.makedirs(UPLOAD_TMP_DIR, exist_ok=True)

mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB_NAME]
mongo_collection = mongo_db[MONGO_COLLECTION_NAME]


def allowed_file(filename: str) -> bool:
    return filename.lower().endswith(".json")


def validate_collector_code(value: str) -> str:
    value = (value or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2}", value):
        raise ValueError("Collector Code must be exactly 2 alphanumeric characters.")
    return value


def validate_organization_code(value: str) -> str:
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
    staged_path = Path(UPLOAD_TMP_DIR) / new_filename
    uploaded_file.save(staged_path)
    return staged_path


def normalize_ingest_payload(parsed_json):
    if isinstance(parsed_json, dict):
        return [parsed_json]
    if isinstance(parsed_json, list):
        if not all(isinstance(item, dict) for item in parsed_json):
            raise ValueError("JSON array must contain only objects.")
        return parsed_json
    raise ValueError("JSON must be an object or an array of objects.")


def first_dict(value):
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return value[0]
    return {}


def copy_keys(source, keys):
    return {key: source[key] for key in keys if key in source}


def build_collection_location(location):
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
    track = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        track_location = build_collection_location(location)
        if track_location:
            track.append(track_location)
    return track


def build_source_fingerprint(doc):
    payload = json.dumps(doc, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_gsm_document(doc):
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
    signal_type = str(doc.get("signal_type") or "").upper()
    if signal_type == "GSM":
        return normalize_gsm_document(doc)

    return {
        "record_type": "unknown_event",
        "source_fingerprint": build_source_fingerprint(doc),
        "signal_type": doc.get("signal_type"),
    }


def enrich_documents(documents, final_filename, collector_code, organization_code):
    ingested_at = datetime.now(timezone.utc).isoformat()

    for doc in documents:
        enriched_doc = dict(doc)
        enriched_doc["normalized"] = normalize_document(doc)
        enriched_doc["_ingest"] = {
            "source_filename": final_filename,
            "collector_code": collector_code,
            "organization_code": organization_code,
            "ingested_at": ingested_at,
            "pipeline": "ingest-api",
        }
        yield enriched_doc


def insert_documents(documents):
    inserted_count = 0
    batch = []

    for document in documents:
        batch.append(document)
        if len(batch) >= BATCH_SIZE:
            result = mongo_collection.insert_many(batch, ordered=False)
            inserted_count += len(result.inserted_ids)
            batch = []

    if batch:
        result = mongo_collection.insert_many(batch, ordered=False)
        inserted_count += len(result.inserted_ids)

    return inserted_count


@app.get("/")
def service_info():
    return jsonify({
        "service": "ingest-api",
        "status": "ok",
        "health": "/api/health",
        "upload": "/api/ingest/upload",
    }), 200


@app.get("/api/health")
@app.get("/api/ingest/health")
def health():
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
    }), 200


@app.post("/api/upload")
@app.post("/api/ingest/upload")
def upload_files():
    try:
        collector_code = validate_collector_code(request.form.get("collector_code"))
        organization_code = validate_organization_code(request.form.get("organization_code"))
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
                "error": "Only .json files are allowed.",
            })
            continue

        staged_path = None
        try:
            ts = get_file_timestamp(uploaded_file)
            base_name = build_base_filename(organization_code, collector_code, ts)
            final_filename = get_unique_filename(base_name, ".json")

            staged_path = stage_uploaded_file(uploaded_file, final_filename)

            with staged_path.open("rb") as f:
                raw = f.read()

            text = raw.decode("utf-8-sig")
            parsed = json.loads(text)
            documents = normalize_ingest_payload(parsed)
            inserted_count = insert_documents(
                enrich_documents(
                    documents=documents,
                    final_filename=final_filename,
                    collector_code=collector_code,
                    organization_code=organization_code,
                )
            )

            results.append({
                "original_name": original_name,
                "final_filename": final_filename,
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
def final_ingest():
    if "file" not in request.files:
        return jsonify({"error": "No file field named 'file' found in request."}), 400

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "":
        return jsonify({"error": "No file selected."}), 400

    collector_code = (request.form.get("collector_code") or "").strip().upper()
    organization_code = (request.form.get("organization_code") or "").strip().upper()
    final_filename = (request.form.get("final_filename") or "").strip()

    try:
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
