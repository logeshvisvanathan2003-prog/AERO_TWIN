"""Portals + self-registration.  Run: cd backend && python -m pytest -q tests/test_register.py"""
import os, sys
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_reg.db")
os.environ.setdefault("SECRET_KEY", "test-secret")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
if os.path.exists("test_reg.db"):
    os.remove("test_reg.db")

from fastapi.testclient import TestClient
from app import config as C
from app.main import app
from app.routes import auth as auth_routes

OP = dict(login_id="opr-77", full_name="Test Operator", password="Passw0rd99", email="a@b.in")


def test_portals_and_registration():
    C.ADMIN_REGISTRATION_KEY = "invite-key-123"          # works whichever test file loaded the app first
    auth_routes._HITS.clear()
    with TestClient(app) as c:
        # operator registers -> gets a token, no drones
        r = c.post("/api/auth/register/operator", json=OP)
        assert r.status_code == 200, r.text
        o = r.json()["operator"]
        assert o["role"] == "operator" and o["login_id"] == "OPR-77" and o["drones"] == [] and o["token"]
        # a brand-new operator has no drones: the data endpoints must answer cleanly (this was a 500 on PostgreSQL)
        oh = {"authorization": f"Bearer {o['token']}"}
        assert c.get("/api/fleet", headers=oh).json() == []
        assert c.get("/api/alerts", headers=oh).status_code == 200
        assert c.get("/api/state", headers=oh).status_code == 404
        # duplicate / weak / bad id
        assert c.post("/api/auth/register/operator", json=OP).status_code == 409
        assert c.post("/api/auth/register/operator", json={**OP, "login_id": "x2", "password": "short"}).status_code == 400
        assert c.post("/api/auth/register/operator", json={**OP, "login_id": "bad id!"}).status_code == 400
        # an operator can NOT sneak in as admin through the operator endpoint
        r = c.post("/api/auth/register/operator", json={**OP, "login_id": "OPR-78", "role": "admin"})
        assert r.json()["operator"]["role"] == "operator"

        # admin register: wrong key rejected, right key works
        ADM = dict(login_id="adm-02", full_name="Second Admin", password="Passw0rd99")
        assert c.post("/api/auth/register/admin", json={**ADM, "registration_key": "nope"}).status_code == 403
        assert c.post("/api/auth/register/admin", json={**ADM}).status_code == 422          # key required
        r = c.post("/api/auth/register/admin", json={**ADM, "registration_key": "invite-key-123"})
        assert r.status_code == 200, r.text
        assert r.json()["operator"]["role"] == "admin"
        tok = r.json()["operator"]["token"]
        assert c.get("/api/admin/operators", headers={"authorization": f"Bearer {tok}"}).status_code == 200

        # portal enforcement on sign-in
        L = lambda i, p, portal: c.post("/api/auth/login", json={"login_id": i, "password": p, "portal": portal})
        assert L("OPR-77", "Passw0rd99", "operator").status_code == 200
        assert L("OPR-77", "Passw0rd99", "admin").status_code == 403
        assert L("ADM-02", "Passw0rd99", "admin").status_code == 200
        assert L("ADM-02", "Passw0rd99", "operator").status_code == 403
        assert L("ADM-02", "wrong-pass1", "admin").status_code == 401
        assert c.post("/api/auth/login", json={"login_id": "ADM-02", "password": "Passw0rd99"}).status_code == 200  # portal optional

        # 5 wrong keys -> that IP is locked out from trying more
        for _ in range(5):
            c.post("/api/auth/register/admin", json={**ADM, "login_id": "zz1", "registration_key": "bad"})
        assert c.post("/api/auth/register/admin", json={**ADM, "login_id": "zz2", "registration_key": "invite-key-123"}).status_code == 429