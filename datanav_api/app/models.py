import uuid
from datetime import datetime, timezone
from .database import db

"""
SQLAlchemy data model for the main DataNaviGatr API.

Postgres stores application metadata: users, roles, project/folder organization,
saved query definitions, snapshots of query results, audit records, and table
layout preferences. Raw/normalized ingest records live in MongoDB, not here.
"""

def utcnow():
    """Return a timezone-aware UTC timestamp for model default values."""
    return datetime.now(timezone.utc)


user_roles = db.Table(
    "user_roles",
    db.Column("user_id", db.String(36), db.ForeignKey("users.id"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id"), primary_key=True),
)


class User(db.Model):
    """Application account with role assignments and owned workspaces."""
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.Text, nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    last_login_at = db.Column(db.DateTime(timezone=True), nullable=True)

    roles = db.relationship(
        "Role",
        secondary=user_roles,
        back_populates="users",
        lazy="joined",
    )

    projects = db.relationship(
        "Project",
        back_populates="owner",
        lazy=True,
        cascade="all, delete-orphan"
    )

    query_runs = db.relationship(
        "QueryRun",
        back_populates="user",
        lazy=True,
        cascade="all, delete-orphan"
    )

    table_layouts = db.relationship(
        "TableLayout",
        back_populates="user",
        lazy=True,
        cascade="all, delete-orphan"
    )

    def has_role(self, role_name: str) -> bool:
        """Return True when the user has the named role."""
        return any(role.name == role_name for role in self.roles)

    def role_names(self):
        """Return role names sorted for stable API responses and tokens."""
        return sorted(role.name for role in self.roles)

    def to_dict(self):
        """Serialize safe user fields for API responses."""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "roles": self.role_names(),
        }


class Role(db.Model):
    """Named permission role such as admin, auditor, or user."""
    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(32), unique=True, nullable=False)

    users = db.relationship(
        "User",
        secondary=user_roles,
        back_populates="roles",
        lazy="selectin",
    )


class Project(db.Model):
    """Top-level user-owned container for folders and saved queries."""
    __tablename__ = "projects"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    owner_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    owner = db.relationship("User", back_populates="projects")

    folders = db.relationship(
        "Folder",
        back_populates="project",
        lazy=True,
        cascade="all, delete-orphan"
    )

    saved_queries = db.relationship(
        "SavedQuery",
        back_populates="project",
        lazy=True,
        cascade="all, delete-orphan"
    )

    def to_dict(self):
        """Serialize the project tree shape expected by the React sidebar."""
        return {
            "id": self.id,
            "name": self.name,
            "isOpen": True,
            "queries": [
                query.to_summary_dict()
                for query in self.saved_queries
                if query.folder_id is None
            ],
            "folders": [folder.to_dict() for folder in self.folders],
        }


class Folder(db.Model):
    """Project sub-container that groups saved queries."""
    __tablename__ = "folders"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    project_id = db.Column(db.String(36), db.ForeignKey("projects.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    project = db.relationship("Project", back_populates="folders")

    saved_queries = db.relationship(
        "SavedQuery",
        back_populates="folder",
        lazy=True,
        cascade="all, delete-orphan"
    )

    def to_dict(self):
        """Serialize a folder and its saved query summaries."""
        return {
            "id": self.id,
            "name": self.name,
            "queries": [query.to_summary_dict() for query in self.saved_queries],
        }


class SavedQuery(db.Model):
    """Saved query definition plus metadata about its stored result snapshot."""
    __tablename__ = "saved_queries"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(255), nullable=False)
    creator_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    project_id = db.Column(db.String(36), db.ForeignKey("projects.id"), nullable=False)
    folder_id = db.Column(db.String(36), db.ForeignKey("folders.id"), nullable=True)

    template_id = db.Column(db.String(100), nullable=True)
    parameters_json = db.Column(db.JSON, nullable=False, default=dict)

    mongo_collection = db.Column(db.String(255), nullable=True)
    translated_filter_json = db.Column(db.JSON, nullable=True)
    translated_projection_json = db.Column(db.JSON, nullable=True)
    translated_sort_json = db.Column(db.JSON, nullable=True)

    result_count = db.Column(db.Integer, nullable=False, default=0)
    snapshot_created_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    project = db.relationship("Project", back_populates="saved_queries")
    folder = db.relationship("Folder", back_populates="saved_queries")
    creator = db.relationship("User")

    result_items = db.relationship(
        "SavedQueryResult",
        back_populates="saved_query",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="SavedQueryResult.position",
    )

    def to_summary_dict(self):
        """Return lightweight metadata for project/folder query lists."""
        return {
            "id": self.id,
            "name": self.name,
            "creator": self.creator.username if self.creator else "unknown",
            "resultCount": self.result_count,
            "createdAt": self.created_at.date().isoformat() if self.created_at else None,
            "tableData": [],
        }

    def to_detail_dict(self, include_table_data=True):
        """
        Return full query metadata and optionally include all saved result rows.

        The API can omit tableData for large queries and let the frontend page
        through SavedQueryResult rows separately.
        """
        detail = {
            "id": self.id,
            "name": self.name,
            "creator": self.creator.username if self.creator else "unknown",
            "resultCount": self.result_count,
            "createdAt": self.created_at.date().isoformat() if self.created_at else None,
            "tableData": [],
            "templateId": self.template_id,
            "parameters": self.parameters_json,
            "mongoCollection": self.mongo_collection,
            "translatedFilter": self.translated_filter_json,
            "translatedProjection": self.translated_projection_json,
            "translatedSort": self.translated_sort_json,
            "snapshotCreatedAt": self.snapshot_created_at.isoformat() if self.snapshot_created_at else None,
        }

        if include_table_data:
            detail["tableData"] = [item.preview_json for item in self.result_items]

        return detail


class SavedQueryResult(db.Model):
    """One persisted preview row from a saved query result snapshot."""
    __tablename__ = "saved_query_results"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    saved_query_id = db.Column(
        db.String(36),
        db.ForeignKey("saved_queries.id"),
        nullable=False,
        index=True
    )
    mongo_id = db.Column(db.String(255), nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False)
    preview_json = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    saved_query = db.relationship("SavedQuery", back_populates="result_items")


class QueryRun(db.Model):
    """Audit trail entry for a query execution."""
    __tablename__ = "query_runs"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    saved_query_id = db.Column(db.String(36), db.ForeignKey("saved_queries.id"), nullable=True)

    query_name = db.Column(db.String(255), nullable=False)
    parameters_json = db.Column(db.JSON, nullable=False, default=dict)

    mongo_collection = db.Column(db.String(255), nullable=True)
    translated_filter_json = db.Column(db.JSON, nullable=True)
    translated_projection_json = db.Column(db.JSON, nullable=True)
    translated_sort_json = db.Column(db.JSON, nullable=True)

    result_count = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(32), nullable=False, default="completed")
    auditor_state = db.Column(db.String(32), nullable=False, default="unreviewed")
    auditor_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    user = db.relationship("User", back_populates="query_runs")

    def to_dict(self):
        """Serialize query-run details for the auditing modal."""
        return {
            "id": self.id,
            "query_name": self.query_name,
            "parameters": self.parameters_json,
            "mongo_collection": self.mongo_collection,
            "translated_filter": self.translated_filter_json,
            "translated_projection": self.translated_projection_json,
            "translated_sort": self.translated_sort_json,
            "result_count": self.result_count,
            "status": self.status,
            "auditor_state": self.auditor_state,
            "auditor_notes": self.auditor_notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user": self.user.to_dict() if self.user else None,
        }


class TableLayout(db.Model):
    """User-saved ordered list of visible table columns."""
    __tablename__ = "table_layouts"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    columns_json = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    user = db.relationship("User", back_populates="table_layouts")

    def to_dict(self):
        """Serialize a saved table layout for QueryTable."""
        columns = []
        column_widths = {}

        for item in self.columns_json or []:
            if isinstance(item, dict):
                key = str(item.get("key") or "").strip()
                if not key:
                    continue
                columns.append(key)
                width = item.get("width")
                if isinstance(width, (int, float)):
                    column_widths[key] = width
            else:
                columns.append(str(item))

        return {
            "id": self.id,
            "name": self.name,
            "columns": columns,
            "columnWidths": column_widths,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
