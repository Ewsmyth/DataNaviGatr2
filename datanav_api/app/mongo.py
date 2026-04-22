import os
from pymongo import MongoClient
from pymongo.errors import PyMongoError

_mongo_client = None


def get_mongo_client():
    global _mongo_client
    if _mongo_client is None:
        mongo_uri = os.getenv(
            "MONGO_URI",
            "mongodb://admin:password@mongodb:27017/ingestion_db?authSource=admin"
        )
        _mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    return _mongo_client


def get_mongo_db():
    client = get_mongo_client()
    db_name = os.getenv("MONGO_DB_NAME", "ingestion_db")
    return client[db_name]


def ping_mongo():
    client = get_mongo_client()
    client.admin.command("ping")
    return True