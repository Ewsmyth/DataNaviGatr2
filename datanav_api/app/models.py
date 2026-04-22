import uuid
from datetime import datetime, timezone
from .database import db


def utcnow():
    return datetime.now(timezone.utc)


user_roles = db.Table(
    "user_roles",
    db.Column("user_id", db.String(36), db.ForeignKey("users.id"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id"), primary_key=True),
)


class User(db.Model):
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

    def has_role(self, role_name: str) -> bool:
        return any(role.name == role_name for role in self.roles)

    def role_names(self):
        return sorted(role.name for role in self.roles)

    def to_dict(self):
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
        return {
            "id": self.id,
            "name": self.name,
            "queries": [query.to_summary_dict() for query in self.saved_queries],
        }


class SavedQuery(db.Model):
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
        return {
            "id": self.id,
            "name": self.name,
            "creator": self.creator.username if self.creator else "unknown",
            "resultCount": self.result_count,
            "createdAt": self.created_at.date().isoformat() if self.created_at else None,
            "tableData": [],
        }

    def to_detail_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "creator": self.creator.username if self.creator else "unknown",
            "resultCount": self.result_count,
            "createdAt": self.created_at.date().isoformat() if self.created_at else None,
            "tableData": [item.preview_json for item in self.result_items],
            "templateId": self.template_id,
            "parameters": self.parameters_json,
            "mongoCollection": self.mongo_collection,
            "translatedFilter": self.translated_filter_json,
            "translatedProjection": self.translated_projection_json,
            "translatedSort": self.translated_sort_json,
            "snapshotCreatedAt": self.snapshot_created_at.isoformat() if self.snapshot_created_at else None,
        }


class SavedQueryResult(db.Model):
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