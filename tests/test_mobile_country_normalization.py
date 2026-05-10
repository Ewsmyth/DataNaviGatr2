import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]


class StubFlask:
    def __init__(self, *args, **kwargs):
        self.config = {}

    def get(self, *args, **kwargs):
        return self._decorator

    def post(self, *args, **kwargs):
        return self._decorator

    def route(self, *args, **kwargs):
        return self._decorator

    @staticmethod
    def _decorator(func):
        return func


class StubMongoClient:
    def __init__(self, *args, **kwargs):
        pass

    def __getitem__(self, name):
        return self


def install_ingest_import_stubs():
    flask = types.ModuleType("flask")
    flask.Flask = StubFlask
    flask.jsonify = lambda *args, **kwargs: args[0] if args else kwargs
    flask.request = types.SimpleNamespace()
    sys.modules.setdefault("flask", flask)

    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda *args, **kwargs: None
    sys.modules.setdefault("flask_cors", flask_cors)

    pymongo = types.ModuleType("pymongo")
    pymongo.MongoClient = StubMongoClient
    sys.modules.setdefault("pymongo", pymongo)

    pymongo_errors = types.ModuleType("pymongo.errors")
    pymongo_errors.PyMongoError = Exception
    sys.modules.setdefault("pymongo.errors", pymongo_errors)

    jwt = types.ModuleType("jwt")
    jwt.decode = lambda *args, **kwargs: {}
    sys.modules.setdefault("jwt", jwt)

    werkzeug_utils = types.ModuleType("werkzeug.utils")
    werkzeug_utils.secure_filename = lambda filename: filename
    sys.modules.setdefault("werkzeug.utils", werkzeug_utils)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


install_ingest_import_stubs()

ingest_app = load_module(
    "ingest_server_app",
    ROOT / "ingest-api" / "ingest-server" / "app.py",
)
query_translator = load_module(
    "query_translator",
    ROOT / "datanav_api" / "app" / "query_translator.py",
)


class MobileCountryNormalizationTest(unittest.TestCase):
    def test_ingest_normalizes_mobile_country_from_attachment_body(self):
        normalized = ingest_app.normalize_document({
            "id": 101,
            "signal_type": "GSM",
            "attachments": [
                {
                    "id": 202,
                    "body": {
                        "mobile_country": "United States",
                        "MCC": "310",
                    },
                }
            ],
        })

        self.assertEqual(normalized["mobile_country"], "United States")
        self.assertEqual(normalized["mcc"], "310")

    def test_api_backfills_nested_normalized_mobile_country_for_existing_records(self):
        row = query_translator.normalize_mongo_document({
            "_id": "abc123",
            "normalized": {
                "record_type": "gsm_event",
            },
            "attachments": [
                {
                    "body": {
                        "mobile_country": "United States",
                    },
                }
            ],
        })

        self.assertEqual(row["mobile_country"], "United States")
        self.assertEqual(row["normalized"]["mobile_country"], "United States")

    def test_api_creates_nested_normalized_mobile_country_when_missing(self):
        row = query_translator.normalize_mongo_document({
            "_id": "abc123",
            "attachments": [
                {
                    "body": {
                        "mobile_country": "United States",
                    },
                }
            ],
        })

        self.assertEqual(row["normalized"]["mobile_country"], "United States")


if __name__ == "__main__":
    unittest.main()
