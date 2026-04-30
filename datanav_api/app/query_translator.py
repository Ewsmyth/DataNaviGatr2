from datetime import datetime, timezone
import re


JSON_FIELD_PATHS = {
    "signal_type": ["signal_type"],
    "tags": ["tags"],
    "start_time": ["start_time"],
    "end_time": ["end_time"],
    "message_type": ["message_type", "attachments.body.message_type"],
    "mobile_identity_type": ["mobile_identity_type", "attachments.body.mobile_identity_type"],
    "mobile_identity": ["mobile_identity", "attachments.body.mobile_identity"],
    "mobile_country": ["mobile_country", "attachments.body.mobile_country"],
    "intercept_type": ["intercept_type", "attachments.body.intercept_type"],
    "reject_cause": ["reject_cause", "attachments.body.reject_cause"],
    "reject_cause_id": ["reject_cause_id", "attachments.body.reject_cause_id"],
    "center_frequency": ["center_frequency", "frequency"],
    "frequency": ["frequency", "center_frequency"],
    "bandwidth": ["bandwidth"],
    "duration": ["duration"],
    "rssi": ["rssi"],
    "MCC": ["MCC", "attachments.body.MCC"],
    "MNC": ["MNC", "attachments.body.MNC"],
    "LAC": ["LAC", "attachments.body.LAC"],
    "CID": ["CID", "attachments.body.CID"],
    "ARFCN": ["ARFCN", "attachments.body.ARFCN"],
    "ARFCN_C0": ["ARFCN_C0", "attachments.body.ARFCN_C0"],
    "timeslot": ["timeslot", "attachments.body.timeslot"],
    "sub_slot": ["sub_slot", "attachments.body.sub_slot"],
    "timing_advance": ["timing_advance", "attachments.body.timing_advance"],
    "T3212": ["T3212", "attachments.body.T3212", "attachments.body.T3212_VAL"],
    "CRH": ["CRH", "attachments.body.CRH", "attachments.body.CRH_VAL"],
    "BSIC": ["BSIC", "attachments.body.BSIC"],
    "NCC": ["NCC", "attachments.body.NCC"],
    "BCC": ["BCC", "attachments.body.BCC"],
    "service_type": ["service_type", "attachments.body.service_type"],
    "status": ["status"],
    "collector_id": ["collector_id"],
    "platform_id": ["platform_id"],
}


DEFAULT_DYNAMIC_KEYS = [
    "_id",
    "id",
    "id_string",
    "start_time",
    "end_time",
    "duration",
    "signal_type",
    "status",
    "tags",
    "frequency",
    "center_frequency",
    "bandwidth",
    "rssi",
    "collector_id",
    "platform_id",
    "message_type",
    "intercept_type",
    "mobile_identity_type",
    "mobile_identity",
    "mobile_country",
    "mobile_network",
    "reject_cause",
    "reject_cause_id",
    "service_type",
    "MCC",
    "MNC",
    "LAC",
    "CID",
    "ARFCN",
    "ARFCN_C0",
    "timeslot",
    "sub_slot",
    "timing_advance",
    "cipher_key_sequence",
    "T3212",
    "CRH",
    "BSIC",
    "NCC",
    "BCC",
    "files",
    "geos",
    "lobs",
    "rssis",
    "attachments",
]


def parse_tags(value):
    if not value:
        return []
    return [tag.strip() for tag in str(value).split(",") if tag.strip()]


def parse_float(value):
    if value in [None, ""]:
        return None
    return float(value)


def parse_int(value):
    if value in [None, ""]:
        return None
    return int(value)


def parse_datetime_local(value):
    """
    React datetime-local usually arrives like:
    2026-04-11T13:45

    We convert it to an ISO string in UTC if possible.
    If parsing fails, return the original value so the API still works.
    """
    if not value:
        return None

    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return value


def parse_result_limit(value):
    allowed_limits = {1000, 5000, 10000, 20000, 40000, 50000, 100000}

    if value in [None, ""]:
        return 1000

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 1000

    return parsed if parsed in allowed_limits else 1000


def build_wildcard_filter(value):
    """
    Supports:
      310*   -> starts with 310
      *310   -> ends with 310
      *310*  -> contains 310
      310    -> exact match
    """
    if value is None:
        return None

    raw = str(value).strip()
    if not raw:
        return None

    has_prefix_wild = raw.startswith("*")
    has_suffix_wild = raw.endswith("*")

    core = raw.strip("*")
    if not core:
        return None

    escaped = re.escape(core)

    if has_prefix_wild and has_suffix_wild:
        pattern = escaped
    elif has_suffix_wild:
        pattern = f"^{escaped}"
    elif has_prefix_wild:
        pattern = f"{escaped}$"
    else:
        # no wildcard = exact match
        pattern = f"^{escaped}$"

    return {
        "$regex": pattern,
        "$options": "i",
    }


def _unique_list(values):
    seen = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen


def _merge_value(existing, incoming):
    if incoming in [None, "", [], {}]:
        return existing
    if existing in [None, "", [], {}]:
        return incoming
    if existing == incoming:
        return existing
    if isinstance(existing, list):
        return _unique_list(existing + ([incoming] if not isinstance(incoming, list) else incoming))
    if isinstance(incoming, list):
        return _unique_list(([existing] if not isinstance(existing, list) else existing) + incoming)
    return _unique_list([existing, incoming])


def _parse_any_datetime(value):
    if not value:
        return None

    candidate = str(value).strip()
    if not candidate:
        return None

    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(candidate)
    except Exception:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_number(value):
    if value in [None, ""]:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        text = str(value).strip()
        if text == "":
            return None
        if "." in text:
            return float(text)
        return int(text)
    except Exception:
        return value


def normalize_mongo_document(doc: dict):
    """
    Normalize raw JSON exports into a flatter shape that preserves all original data
    while keeping backwards-compatible field names used by the UI.
    """
    normalized = {}

    for key, value in (doc or {}).items():
        normalized[key] = value

    attachments = doc.get("attachments") or []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        body = attachment.get("body") or {}
        if not isinstance(body, dict):
            continue

        for key, value in body.items():
            if key == "neighbors" and isinstance(value, list):
                normalized[key] = value
                continue
            normalized[key] = _merge_value(normalized.get(key), value)

    if "frequency" in normalized and "center_frequency" not in normalized:
        normalized["center_frequency"] = normalized["frequency"]
    elif "center_frequency" in normalized and "frequency" not in normalized:
        normalized["frequency"] = normalized["center_frequency"]

    start_dt = _parse_any_datetime(normalized.get("start_time"))
    end_dt = _parse_any_datetime(normalized.get("end_time"))
    if start_dt and end_dt and "duration" not in normalized:
        normalized["duration"] = (end_dt - start_dt).total_seconds()

    for key in [
        "frequency",
        "center_frequency",
        "bandwidth",
        "rssi",
        "duration",
        "collector_id",
        "platform_id",
        "reject_cause_id",
        "LAC",
        "CID",
        "ARFCN",
        "ARFCN_C0",
        "timeslot",
        "sub_slot",
        "timing_advance",
        "T3212",
        "CRH",
        "BSIC",
        "NCC",
        "BCC",
        "cipher_key_sequence",
    ]:
        if key in normalized:
            normalized[key] = _coerce_number(normalized[key])

    if "_id" in normalized:
        normalized["_id"] = str(normalized["_id"])

    ordered = {}
    for key in DEFAULT_DYNAMIC_KEYS:
        if key in normalized:
            ordered[key] = normalized[key]
    for key in sorted(normalized.keys()):
        if key not in ordered:
            ordered[key] = normalized[key]
    return ordered


def _or_across_paths(paths, condition):
    if not paths:
        return {}
    clauses = [{path: condition} for path in paths]
    if len(clauses) == 1:
        return clauses[0]
    return {"$or": clauses}


def _merge_clause(target, clause):
    if not clause:
        return
    if "$and" not in target:
        target["$and"] = []
    target["$and"].append(clause)


def _numeric_variants(raw_value, width=None):
    values = []
    if raw_value in [None, ""]:
        return values

    text = str(raw_value).strip()
    if text:
        values.append(text)
        if width:
            values.append(text.zfill(width))

    try:
        number = int(text)
        values.append(number)
        values.append(str(number))
        if width:
            values.append(str(number).zfill(width))
    except Exception:
        pass

    return _unique_list(values)


def _build_numericish_match(paths, raw_value, width=None):
    variants = _numeric_variants(raw_value, width=width)
    if not variants:
        return None
    return _or_across_paths(paths, {"$in": variants})


def _build_string_match(paths, raw_value):
    if raw_value in [None, ""]:
        return None
    value = str(raw_value).strip()
    if not value:
        return None
    return _or_across_paths(paths, value)


def _build_regex_match(paths, raw_value):
    wildcard = build_wildcard_filter(raw_value)
    if not wildcard:
        return None
    return _or_across_paths(paths, wildcard)


def _build_range_match(paths, minimum=None, maximum=None):
    if minimum is None and maximum is None:
        return None

    condition = {}
    if minimum is not None:
        condition["$gte"] = minimum
    if maximum is not None:
        condition["$lte"] = maximum

    return _or_across_paths(paths, condition)


def _escape_regex(value):
    return re.escape(str(value).strip())


def _is_safe_custom_field(field):
    if not field:
        return False
    return all(segment and not segment.startswith("$") for segment in str(field).split("."))


def _build_custom_condition(rule):
    field = str(rule.get("column") or "").strip()
    operator = rule.get("operator") or "contains"
    value = rule.get("value")
    column_type = rule.get("columnType") or "text"

    if not _is_safe_custom_field(field):
        return None

    if operator == "is_empty":
        return {"$or": [{field: {"$exists": False}}, {field: None}, {field: ""}]}

    if operator == "is_not_empty":
        return {"$and": [{field: {"$exists": True}}, {field: {"$nin": [None, ""]}}]}

    if value in [None, ""]:
        return None

    text_value = str(value).strip()
    if not text_value:
        return None

    if operator in ["equals", "not_equals"] and column_type == "number":
        match_value = _coerce_number(text_value)
    else:
        match_value = text_value

    if operator == "equals":
        return {field: match_value}
    if operator == "not_equals":
        return {field: {"$ne": match_value}}
    if operator == "contains":
        return {field: {"$regex": _escape_regex(text_value), "$options": "i"}}
    if operator == "not_contains":
        return {field: {"$not": {"$regex": _escape_regex(text_value), "$options": "i"}}}
    if operator == "starts_with":
        return {field: {"$regex": f"^{_escape_regex(text_value)}", "$options": "i"}}
    if operator == "ends_with":
        return {field: {"$regex": f"{_escape_regex(text_value)}$", "$options": "i"}}
    if operator in ["greater_than", "less_than"]:
        match_value = _coerce_number(text_value) if column_type == "number" else text_value
        mongo_operator = "$gt" if operator == "greater_than" else "$lt"
        return {field: {mongo_operator: match_value}}

    return None


def _build_custom_group(group):
    if not isinstance(group, dict):
        return None

    rules = group.get("rules") or []
    clauses = []

    for rule in rules:
        if not isinstance(rule, dict):
            continue

        if rule.get("type") == "group":
            clause = _build_custom_group(rule)
        else:
            clause = _build_custom_condition(rule)

        if clause:
            clauses.append(clause)

    if not clauses:
        return None

    if len(clauses) == 1:
        return clauses[0]

    operator = "$or" if group.get("operator") == "or" else "$and"
    return {operator: clauses}


def _finalize_filter(mongo_filter):
    clauses = mongo_filter.get("$and", [])
    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return mongo_filter


def build_signal_search(parameters: dict):
    mongo_filter = {}

    result_limit = parse_result_limit(parameters.get("result_limit"))

    signal_type = parameters.get("signal_type")
    _merge_clause(mongo_filter, _build_string_match(JSON_FIELD_PATHS["signal_type"], signal_type))

    tags = parse_tags(parameters.get("tags"))
    if tags:
        _merge_clause(mongo_filter, _or_across_paths(JSON_FIELD_PATHS["tags"], {"$in": tags}))

    freq_min = parse_float(parameters.get("center_frequency_min"))
    freq_max = parse_float(parameters.get("center_frequency_max"))
    _merge_clause(
        mongo_filter,
        _build_range_match(JSON_FIELD_PATHS["center_frequency"], minimum=freq_min, maximum=freq_max),
    )

    start_time = parse_datetime_local(parameters.get("start_time"))
    end_time = parse_datetime_local(parameters.get("end_time"))
    _merge_clause(
        mongo_filter,
        _build_range_match(JSON_FIELD_PATHS["start_time"], minimum=start_time, maximum=end_time),
    )

    return {
        "collection": "records",
        "filter": _finalize_filter(mongo_filter),
        "projection": None,
        "sort": [("start_time", -1)],
        "limit": result_limit,
    }


def build_device_lookup(parameters: dict):
    mongo_filter = {}

    result_limit = parse_result_limit(parameters.get("result_limit"))

    mobile_identity_type = parameters.get("mobile_identity_type")
    _merge_clause(
        mongo_filter,
        _build_string_match(JSON_FIELD_PATHS["mobile_identity_type"], mobile_identity_type),
    )

    mobile_identity = parameters.get("mobile_identity")
    _merge_clause(
        mongo_filter,
        _build_regex_match(JSON_FIELD_PATHS["mobile_identity"], mobile_identity),
    )

    _merge_clause(mongo_filter, _build_numericish_match(JSON_FIELD_PATHS["MCC"], parameters.get("MCC"), width=3))
    _merge_clause(mongo_filter, _build_numericish_match(JSON_FIELD_PATHS["MNC"], parameters.get("MNC"), width=2))
    _merge_clause(mongo_filter, _build_numericish_match(JSON_FIELD_PATHS["LAC"], parameters.get("LAC")))
    _merge_clause(mongo_filter, _build_numericish_match(JSON_FIELD_PATHS["CID"], parameters.get("CID")))

    return {
        "collection": "records",
        "filter": _finalize_filter(mongo_filter),
        "projection": None,
        "sort": [("start_time", -1)],
        "limit": result_limit,
    }


def build_reject_cause_analysis(parameters: dict):
    mongo_filter = {}

    result_limit = parse_result_limit(parameters.get("result_limit"))

    message_type = parameters.get("message_type")
    _merge_clause(mongo_filter, _build_string_match(JSON_FIELD_PATHS["message_type"], message_type))

    reject_cause = parameters.get("reject_cause")
    if reject_cause:
        _merge_clause(
            mongo_filter,
            _or_across_paths(
                JSON_FIELD_PATHS["reject_cause"],
                {
                    "$regex": str(reject_cause).strip(),
                    "$options": "i",
                },
            ),
        )

    _merge_clause(
        mongo_filter,
        _build_numericish_match(JSON_FIELD_PATHS["reject_cause_id"], parameters.get("reject_cause_id")),
    )

    intercept_type = parameters.get("intercept_type")
    _merge_clause(mongo_filter, _build_string_match(JSON_FIELD_PATHS["intercept_type"], intercept_type))

    duration_min = parse_float(parameters.get("duration_min"))
    _merge_clause(mongo_filter, _build_range_match(JSON_FIELD_PATHS["duration"], minimum=duration_min))

    rssi_min = parse_float(parameters.get("rssi_min"))
    _merge_clause(mongo_filter, _build_range_match(JSON_FIELD_PATHS["rssi"], minimum=rssi_min))

    return {
        "collection": "records",
        "filter": _finalize_filter(mongo_filter),
        "projection": None,
        "sort": [("start_time", -1)],
        "limit": result_limit,
    }


def build_custom_query_builder(parameters: dict):
    mongo_filter = {}

    result_limit = parse_result_limit(parameters.get("result_limit"))

    start_time = parse_datetime_local(parameters.get("start_time"))
    end_time = parse_datetime_local(parameters.get("end_time"))
    _merge_clause(
        mongo_filter,
        _build_range_match(["normalized.start_time"], minimum=start_time, maximum=end_time),
    )

    custom_filter = _build_custom_group(parameters.get("custom_filter") or {})
    _merge_clause(mongo_filter, custom_filter)

    return {
        "collection": "records",
        "filter": _finalize_filter(mongo_filter),
        "projection": None,
        "sort": [("normalized.start_time", -1)],
        "limit": result_limit,
    }


TRANSLATORS = {
    "custom-query-builder": build_custom_query_builder,
    "signal-search": build_signal_search,
    "device-lookup": build_device_lookup,
    "reject-cause-analysis": build_reject_cause_analysis,
}


def translate_query(template_id: str, parameters: dict):
    translator = TRANSLATORS.get(template_id)
    if not translator:
        raise ValueError(f"Unsupported template_id: {template_id}")
    return translator(parameters or {})
