import os
from flask import Flask
from flask_cors import CORS
import time
from sqlalchemy.exc import OperationalError
from .database import db
from .models import Role, User
from .routes import api_bp
from .security import hash_password
from .mongo import ping_mongo


def seed_roles_and_default_admin(app):
    roles_by_name = {}
    for role_name in ["admin", "auditor", "user"]:
        role = Role.query.filter_by(name=role_name).first()
        if not role:
            role = Role(name=role_name)
            db.session.add(role)
        roles_by_name[role_name] = role
    db.session.commit()

    admin_username = app.config["DEFAULT_ADMIN_USERNAME"]
    admin_email = app.config["DEFAULT_ADMIN_EMAIL"]
    admin_password = app.config["DEFAULT_ADMIN_PASSWORD"]

    existing_admin = User.query.filter_by(username=admin_username).first()
    if existing_admin:
        admin_role = roles_by_name["admin"]
        if existing_admin.roles != [admin_role]:
            existing_admin.roles = [admin_role]
            db.session.commit()
        return

    default_admin = User(
        username=admin_username,
        email=admin_email,
        password_hash=hash_password(admin_password),
        is_active=True,
    )
    default_admin.roles.append(roles_by_name["admin"])

    db.session.add(default_admin)
    db.session.commit()
    print(f"Admin user created. Username: {admin_username}")


def create_app():
    app = Flask(__name__)

    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "change_this_secret_key")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://datanav_user:password@postgres:5432/datanav",
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "change_this_jwt_secret")
    app.config["ACCESS_TOKEN_EXPIRES_MINUTES"] = int(os.getenv("ACCESS_TOKEN_EXPIRES_MINUTES", 15))
    app.config["REFRESH_TOKEN_EXPIRES_DAYS"] = int(os.getenv("REFRESH_TOKEN_EXPIRES_DAYS", 7))
    app.config["COOKIE_SECURE"] = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    app.config["COOKIE_SAMESITE"] = os.getenv("COOKIE_SAMESITE", "Lax")
    app.config["DEFAULT_ADMIN_USERNAME"] = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
    app.config["DEFAULT_ADMIN_EMAIL"] = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@local")
    app.config["DEFAULT_ADMIN_PASSWORD"] = os.getenv("DEFAULT_ADMIN_PASSWORD", "ChangeMe123!")

    db.init_app(app)
    CORS(
        app,
        supports_credentials=True,
        origins=[os.getenv("CORS_ORIGIN", "http://localhost:3000")]
    )

    app.config["MONGO_URI"] = os.getenv(
        "MONGO_URI",
        "mongodb://admin:password@mongodb:27017/ingestion_db?authSource=admin",
    )
    app.config["MONGO_DB_NAME"] = os.getenv("MONGO_DB_NAME", "ingestion_db")

    app.register_blueprint(api_bp)

    with app.app_context():
        retries = 10
        for i in range(retries):
            try:
                db.create_all()
                seed_roles_and_default_admin(app)
                break
            except OperationalError as e:
                print(f"DB not ready, retrying ({i+1}/{retries})...")
                time.sleep(2)
        else:
            raise Exception("Database not available after retries")

        try:
            ping_mongo()
            print("MongoDB connection successful.")
        except Exception as e:
            print(f"MongoDB connection failed: {e}")
            raise

    return app
