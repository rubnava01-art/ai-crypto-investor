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
