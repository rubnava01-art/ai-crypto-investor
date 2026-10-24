"""Test fixtures: isolated SQLite DB + seeded admin user."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DB_FD, DB_PATH = tempfile.mkstemp(suffix=".db")
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"

from app.core.security import hash_password  # noqa: E402
from app.database import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.tables import Base, User  # noqa: E402

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session")
def app():
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    if db.query(User).filter(User.username == "admin").count() == 0:
        db.add(User(username="admin", password_hash=hash_password("secret"), is_admin=True))
        db.commit()
    db.close()
    application = create_app()

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    application.dependency_overrides[get_db] = override_get_db
    return application


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_headers(app):
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "secret"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin_headers(auth_headers):
    """Shared admin headers — modules must reuse these instead of logging
    in again: the login endpoint is rate-limited (10/min per IP) across
    the whole suite, and every extra per-module login eats that budget."""
    return auth_headers


@pytest.fixture(scope="session")
def viewer_headers(app, auth_headers):
    """Shared read-only ('prueba') user, created + logged in exactly once
    per suite run (see admin_headers note about the login budget)."""
    with TestClient(app) as c:
        r = c.post(
            "/api/users",
            json={"username": "suiteviewer", "password": "viewerpass", "role": "prueba"},
            headers=auth_headers,
        )
        assert r.status_code in (201, 409), r.text
        r = c.post("/api/auth/login", json={"username": "suiteviewer", "password": "viewerpass"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
