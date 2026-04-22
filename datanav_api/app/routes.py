from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

from .database import db
from .models import (
    Folder,
    Project,
    QueryRun,
    Role,
    SavedQuery,
    SavedQueryResult,
    User,
)
from .security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

api_bp = Blueprint("api", __name__)


def _get_bearer_token():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    return auth_header.split(" ", 1)[1].strip()


def token_required(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _get_bearer_token()
        if not token:
            return jsonify({"error": "Authentication required."}), 401

        try:
            payload = decode_token(token, current_app.config["JWT_SECRET_KEY"])
        except Exception:
            return jsonify({"error": "Invalid or expired token."}), 401

        if payload.get("type") != "access":
            return jsonify({"error": "Invalid token type."}), 401

        user_id = payload.get("sub")
        user = User.query.filter_by(id=user_id).first()

        if not user:
            return jsonify({"error": "User not found."}), 404

        if not user.is_active:
            return jsonify({"error": "User account is inactive."}), 403

        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def require_role(role_name):
    from functools import wraps

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = getattr(g, "current_user", None)
            if not user:
                return jsonify({"error": "Authentication required."}), 401
            if not user.has_role(role_name):
                return jsonify({"error": f"{role_name} role required."}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


@api_bp.route("/api/health", methods=["GET"])
def health():
    from .mongo import ping_mongo
    from sqlalchemy import text

    postgres_ok = False
    mongo_ok = False

    try:
        db.session.execute(text("SELECT 1"))
        postgres_ok = True
    except Exception:
        postgres_ok = False

    try:
        ping_mongo()
        mongo_ok = True
    except Exception:
        mongo_ok = False

    status_code = 200 if postgres_ok and mongo_ok else 503

    return jsonify({
        "status": "ok" if status_code == 200 else "degraded",
        "postgres": postgres_ok,
        "mongo": mongo_ok,
    }), status_code


@api_bp.route("/api/auth/register", methods=["POST"])
def register():
    payload = request.get_json() or {}
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not username or not email or not password:
        return jsonify({"error": "Username, email, and password are required."}), 400

    existing_user = User.query.filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing_user:
        return jsonify({"error": "Username or email already exists."}), 409

    user_role = Role.query.filter_by(name="user").first()

    new_user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )

    if user_role:
        new_user.roles.append(user_role)

    db.session.add(new_user)
    db.session.commit()

    return jsonify({
        "message": "User created successfully.",
        "user": new_user.to_dict(),
    }), 201


@api_bp.route("/api/auth/login", methods=["POST"])
def login():
    payload = request.get_json() or {}
    identifier = (payload.get("identifier") or "").strip()
    password = payload.get("password") or ""

    if not identifier or not password:
        return jsonify({"error": "Identifier and password are required."}), 400

    user = User.query.filter(
        (User.username == identifier) | (User.email == identifier.lower())
    ).first()

    if not user or not verify_password(password, user.password_hash):
        return jsonify({"error": "Invalid credentials."}), 401

    if not user.is_active:
        return jsonify({"error": "User account is inactive."}), 403

    user.last_login_at = datetime.now(timezone.utc)
    db.session.commit()

    access_token = create_access_token(
        user_id=user.id,
        secret=current_app.config["JWT_SECRET_KEY"],
        expires_minutes=current_app.config["ACCESS_TOKEN_EXPIRES_MINUTES"],
    )

    refresh_token = create_refresh_token(
        user_id=user.id,
        secret=current_app.config["JWT_SECRET_KEY"],
        expires_days=current_app.config["REFRESH_TOKEN_EXPIRES_DAYS"],
    )

    response = jsonify({
        "message": "Login successful.",
        "token_type": "Bearer",
        "access_token": access_token,
        "user": user.to_dict(),
    })

    response.set_cookie(
        "refresh_token",
        refresh_token,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite=current_app.config["COOKIE_SAMESITE"],
        max_age=current_app.config["REFRESH_TOKEN_EXPIRES_DAYS"] * 24 * 60 * 60,
    )

    return response, 200


@api_bp.route("/api/auth/refresh", methods=["POST"])
def refresh():
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        return jsonify({"error": "Refresh token missing."}), 401

    try:
        payload = decode_token(refresh_token, current_app.config["JWT_SECRET_KEY"])
    except Exception:
        return jsonify({"error": "Invalid or expired refresh token."}), 401

    if payload.get("type") != "refresh":
        return jsonify({"error": "Invalid token type."}), 401

    user = User.query.filter_by(id=payload.get("sub")).first()
    if not user or not user.is_active:
        return jsonify({"error": "User not found or inactive."}), 401

    access_token = create_access_token(
        user_id=user.id,
        secret=current_app.config["JWT_SECRET_KEY"],
        expires_minutes=current_app.config["ACCESS_TOKEN_EXPIRES_MINUTES"],
    )

    return jsonify({
        "message": "Token refreshed.",
        "token_type": "Bearer",
        "access_token": access_token,
        "user": user.to_dict(),
    }), 200


@api_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    response = jsonify({"message": "Logged out successfully."})
    response.delete_cookie("refresh_token")
    return response, 200


@api_bp.route("/api/auth/me", methods=["GET"])
@token_required
def me():
    return jsonify({"user": g.current_user.to_dict()}), 200


@api_bp.route("/api/projects", methods=["GET"])
@token_required
@require_role("user")
def list_projects():
    projects = Project.query.filter_by(owner_id=g.current_user.id).all()
    return jsonify({"projects": [project.to_dict() for project in projects]}), 200


@api_bp.route("/api/projects", methods=["POST"])
@token_required
@require_role("user")
def create_project():
    payload = request.get_json() or {}
    name = (payload.get("name") or "").strip()

    if not name:
        return jsonify({"error": "Project name is required."}), 400

    project = Project(name=name, owner_id=g.current_user.id)
    db.session.add(project)
    db.session.commit()

    return jsonify({
        "message": "Project created successfully.",
        "project": project.to_dict(),
    }), 201


@api_bp.route("/api/projects/<project_id>/folders", methods=["POST"])
@token_required
@require_role("user")
def create_folder(project_id):
    payload = request.get_json() or {}
    name = (payload.get("name") or "").strip()

    project = Project.query.filter_by(id=project_id, owner_id=g.current_user.id).first()
    if not project:
        return jsonify({"error": "Project not found."}), 404

    if not name:
        return jsonify({"error": "Folder name is required."}), 400

    folder = Folder(name=name, project_id=project.id)
    db.session.add(folder)
    db.session.commit()

    return jsonify({
        "message": "Folder created successfully.",
        "folder": folder.to_dict(),
    }), 201


@api_bp.route("/api/queries", methods=["POST"])
@token_required
@require_role("user")
def create_query():
    from .mongo import get_mongo_db
    from .query_translator import normalize_mongo_document, translate_query

    payload = request.get_json() or {}

    name = (payload.get("queryName") or "").strip()
    template_id = payload.get("templateId")
    parameters = payload.get("parameters") or {}
    project_id = payload.get("projectId")
    folder_id = payload.get("folderId")

    if not name:
        return jsonify({"error": "Query name is required."}), 400
    if not template_id:
        return jsonify({"error": "Template ID is required."}), 400
    if not project_id:
        return jsonify({"error": "Project ID is required."}), 400

    project = Project.query.filter_by(id=project_id, owner_id=g.current_user.id).first()
    if not project:
        return jsonify({"error": "Project not found."}), 404

    folder = None
    if folder_id:
        folder = Folder.query.filter_by(id=folder_id, project_id=project.id).first()
        if not folder:
            return jsonify({"error": "Folder not found."}), 404

    try:
        translated = translate_query(template_id, parameters)

        collection_name = translated["collection"]
        mongo_filter = translated.get("filter", {})
        projection = translated.get("projection")
        sort = translated.get("sort") or []
        limit = int(translated.get("limit", 1000))

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Failed to translate query: {str(exc)}"}), 400

    try:
        db_mongo = get_mongo_db()
        cursor = db_mongo[collection_name].find(mongo_filter, projection)

        if sort:
            cursor = cursor.sort(sort)

        cursor = cursor.limit(limit)

        results = []
        for doc in cursor:
            results.append(normalize_mongo_document(doc))

        saved_query = SavedQuery(
            name=name,
            creator_id=g.current_user.id,
            project_id=project.id,
            folder_id=folder.id if folder else None,
            template_id=template_id,
            parameters_json=parameters,
            mongo_collection=collection_name,
            translated_filter_json=mongo_filter,
            translated_projection_json=projection,
            translated_sort_json=[list(item) for item in sort],
            result_count=len(results),
            snapshot_created_at=datetime.now(timezone.utc),
        )
        db.session.add(saved_query)
        db.session.flush()

        for idx, row in enumerate(results):
            db.session.add(
                SavedQueryResult(
                    saved_query_id=saved_query.id,
                    mongo_id=row["_id"],
                    position=idx,
                    preview_json=row,
                )
            )

        query_run = QueryRun(
            user_id=g.current_user.id,
            saved_query_id=saved_query.id,
            query_name=name,
            parameters_json=parameters,
            mongo_collection=collection_name,
            translated_filter_json=mongo_filter,
            translated_projection_json=projection,
            translated_sort_json=[list(item) for item in sort],
            result_count=len(results),
            status="completed",
        )
        db.session.add(query_run)
        db.session.commit()

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Failed to execute and save query: {str(exc)}"}), 500

    return jsonify({
        "message": f"Query saved and executed successfully. {len(results)} results found.",
        "query": saved_query.to_summary_dict(),
        "query_run": query_run.to_dict(),
    }), 201


@api_bp.route("/api/queries/<query_id>", methods=["GET"])
@token_required
@require_role("user")
def get_saved_query(query_id):
    saved_query = (
        SavedQuery.query
        .join(Project, SavedQuery.project_id == Project.id)
        .filter(
            SavedQuery.id == query_id,
            Project.owner_id == g.current_user.id
        )
        .first()
    )

    if not saved_query:
        return jsonify({"error": "Query not found."}), 404

    return jsonify({
        "query": saved_query.to_detail_dict()
    }), 200


@api_bp.route("/api/admin/users", methods=["GET"])
@token_required
@require_role("admin")
def list_users():
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify({"users": [user.to_dict() for user in users]}), 200


@api_bp.route("/api/admin/users", methods=["POST"])
@token_required
@require_role("admin")
def admin_create_user():
    payload = request.get_json() or {}
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role_names = payload.get("roles") or ["user"]

    if not username or not email or not password:
        return jsonify({"error": "Username, email, and password are required."}), 400

    existing_user = User.query.filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing_user:
        return jsonify({"error": "Username or email already exists."}), 409

    roles = Role.query.filter(Role.name.in_(role_names)).all()
    if len(roles) != len(set(role_names)):
        return jsonify({"error": "One or more roles are invalid."}), 400

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )
    user.roles = roles

    db.session.add(user)
    db.session.commit()

    return jsonify({
        "message": "User created successfully.",
        "user": user.to_dict(),
    }), 201


@api_bp.route("/api/admin/users/<user_id>", methods=["PATCH"])
@token_required
@require_role("admin")
def admin_update_user(user_id):
    payload = request.get_json() or {}
    is_active = payload.get("is_active")

    user = User.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"error": "User not found."}), 404

    if is_active is not None:
        user.is_active = bool(is_active)

    db.session.commit()

    return jsonify({
        "message": "User updated successfully.",
        "user": user.to_dict(),
    }), 200


@api_bp.route("/api/admin/users/<user_id>", methods=["DELETE"])
@token_required
@require_role("admin")
def admin_delete_user(user_id):
    user = User.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"error": "User not found."}), 404

    db.session.delete(user)
    db.session.commit()

    return jsonify({"message": "User deleted successfully."}), 200


@api_bp.route("/api/admin/users/<user_id>/roles", methods=["PATCH"])
@token_required
@require_role("admin")
def admin_update_roles(user_id):
    payload = request.get_json() or {}
    role_names = payload.get("roles") or []

    user = User.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"error": "User not found."}), 404

    roles = Role.query.filter(Role.name.in_(role_names)).all()
    if len(roles) != len(set(role_names)):
        return jsonify({"error": "One or more roles are invalid."}), 400

    user.roles = roles
    db.session.commit()

    return jsonify({
        "message": "Roles updated successfully.",
        "user": user.to_dict(),
    }), 200


@api_bp.route("/api/auditing/query-runs", methods=["GET"])
@token_required
@require_role("auditor")
def list_query_runs():
    query_runs = QueryRun.query.order_by(QueryRun.created_at.desc()).all()
    return jsonify({"query_runs": [query_run.to_dict() for query_run in query_runs]}), 200


@api_bp.route("/api/auditing/query-runs/<run_id>", methods=["PATCH"])
@token_required
@require_role("auditor")
def update_query_run_review(run_id):
    payload = request.get_json() or {}
    auditor_state = payload.get("auditor_state")
    auditor_notes = payload.get("auditor_notes") or ""

    if auditor_state not in ["approved", "flagged", "unreviewed"]:
        return jsonify({"error": "Invalid auditor state."}), 400

    query_run = QueryRun.query.filter_by(id=run_id).first()
    if not query_run:
        return jsonify({"error": "Query run not found."}), 404

    query_run.auditor_state = auditor_state
    query_run.auditor_notes = auditor_notes
    db.session.commit()

    return jsonify({
        "message": "Query run updated successfully.",
        "query_run": query_run.to_dict(),
    }), 200


@api_bp.route("/api/data/query", methods=["POST"])
@token_required
@require_role("user")
def run_mongo_query():
    from .mongo import get_mongo_db

    payload = request.get_json() or {}
    collection_name = (payload.get("collection") or "").strip()
    mongo_filter = payload.get("filter") or {}
    projection = payload.get("projection")
    limit = int(payload.get("limit", 100))

    if not collection_name:
        return jsonify({"error": "Collection is required."}), 400

    if not isinstance(mongo_filter, dict):
        return jsonify({"error": "Filter must be a JSON object."}), 400

    if projection is not None and not isinstance(projection, dict):
        return jsonify({"error": "Projection must be a JSON object."}), 400

    if limit < 1 or limit > 1000:
        return jsonify({"error": "Limit must be between 1 and 1000."}), 400

    db_mongo = get_mongo_db()
    cursor = db_mongo[collection_name].find(mongo_filter, projection).limit(limit)

    results = []
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        results.append(doc)

    query_run = QueryRun(
        user_id=g.current_user.id,
        query_name=f"Mongo query on {collection_name}",
        parameters_json={
            "collection": collection_name,
            "filter": mongo_filter,
            "projection": projection,
            "limit": limit,
        },
        result_count=len(results),
        status="completed",
    )
    db.session.add(query_run)
    db.session.commit()

    return jsonify({
        "count": len(results),
        "results": results,
        "query_run": query_run.to_dict(),
    }), 200
