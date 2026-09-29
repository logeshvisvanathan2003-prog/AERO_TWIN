"""
End-to-end API test (SQLite, no external services).  Run:  cd backend && python -m pytest -q tests
(or simply: python tests/test_api.py)
"""
import os, sys, time
os.environ.update(DATABASE_URL="sqlite:///./test_api.db", SECRET_KEY="test-secret", SEED_DEMO_OPERATORS="true",
                  INGEST_KEY="ingest-key", ADMIN_PASSWORD="Admin@12345")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
if os.path.exists("test_api.db"):
    os.remove("test_api.db")

from fastapi.testclient import TestClient
from app.main import app


def H(tok):
    return {"authorization": f"Bearer {tok}"}


def test_full_flow():
    with TestClient(app) as c:
        # --- no public registration, no anonymous data
        assert c.post("/api/auth/register", json={}).status_code in (404, 405)
        assert c.get("/api/fleet").status_code == 401
        assert c.get("/api/state").status_code == 401
        assert c.get("/health").json()["status"] == "ok"

        # --- admin bootstrap: forced password change
        r = c.post("/api/auth/login", json={"login_id": "admin", "password": "Admin@12345"})
        assert r.status_code == 200, r.text
        tok = r.json()["operator"]["token"]
        assert r.json()["operator"]["must_change_password"] is True
        assert c.get("/api/admin/operators", headers=H(tok)).status_code == 403     # blocked until changed
        r = c.post("/api/auth/change-password", headers=H(tok), json={"current_password": "Admin@12345", "new_password": "weak"})
        assert r.status_code == 400
        r = c.post("/api/auth/change-password", headers=H(tok), json={"current_password": "Admin@12345", "new_password": "NewAdmin#2026x"})
        assert r.status_code == 200, r.text
        adm = r.json()["operator"]["token"]
        assert c.get("/api/admin/operators", headers=H(tok)).status_code == 401    # old token revoked

        # --- admin creates drone + operator
        r = c.post("/api/admin/drones", headers=H(adm), json={"tail_number": "tail-09", "name": "Test drone"})
        assert r.status_code == 200, r.text
        r = c.post("/api/admin/operators", headers=H(adm), json={"login_id": "opr-9", "full_name": "Test Op", "drones": ["TAIL-09"]})
        assert r.status_code == 200, r.text
        temp = r.json()["temporary_password"]
        oid = r.json()["operator"]["id"]
        assert c.post("/api/admin/operators", headers=H(adm), json={"login_id": "OPR-9", "full_name": "dup"}).status_code == 409

        # --- operator first login -> forced change -> scoped access
        r = c.post("/api/auth/login", json={"login_id": "OPR-9", "password": temp}); assert r.status_code == 200
        t1 = r.json()["operator"]["token"]
        assert c.get("/api/fleet", headers=H(t1)).status_code == 403
        r = c.post("/api/auth/change-password", headers=H(t1), json={"current_password": temp, "new_password": "Operator#9999"})
        op = r.json()["operator"]["token"]
        fleet = c.get("/api/fleet", headers=H(op)).json()
        assert [d["tail_number"] for d in fleet] == ["TAIL-09"]

        # --- operator restrictions
        assert c.get("/api/state?tail=TAIL-01", headers=H(op)).status_code == 403
        assert c.post("/api/command?tail=TAIL-09", headers=H(op), json={"cmd": "inject", "mode": "ring_wear", "value": .5}).status_code == 403
        assert c.get("/api/admin/overview", headers=H(op)).status_code == 403
        assert c.get("/api/notifications", headers=H(op)).status_code == 403
        assert c.post(f"/api/fleet/{fleet[0]['id']}/action", headers=H(op), json={"action": "ground"}).status_code == 403
        assert c.post("/api/admin/operators", headers=H(op), json={"login_id": "X1", "full_name": "x"}).status_code == 403

        # --- twin runs; operator gets only own drone
        time.sleep(2.5)
        assert c.get("/api/state", headers=H(op)).json()["tail"] == "TAIL-09"
        assert c.post("/api/mission/simulate", headers=H(op), json={"altitude_m": 3000, "duration_h": 1}).status_code == 200
        assert c.post("/api/mission/simulate", headers=H(op), json={"tail": "TAIL-01", "duration_h": 1}).status_code == 403
        assert "Live Health" in c.get("/api/report", headers=H(op)).text

        # --- websocket: ticket, scope
        tk = c.post("/api/auth/ws-ticket", headers=H(op)).json()["ticket"]
        with c.websocket_connect(f"/ws/telemetry?tail=TAIL-09&ticket={tk}&backfill=1") as ws:
            assert ws.receive_json()["tail"] == "TAIL-09"
        tk = c.post("/api/auth/ws-ticket", headers=H(op)).json()["ticket"]
        try:
            with c.websocket_connect(f"/ws/telemetry?tail=TAIL-01&ticket={tk}") as ws:
                ws.receive_text()
            assert False, "operator must not open another drone's stream"
        except Exception:
            pass

        # --- admin commands work + notify
        r = c.post("/api/command?tail=TAIL-09", headers=H(adm), json={"cmd": "inject", "mode": "ignition_wear", "value": 0.9})
        assert r.json()["ok"]
        time.sleep(3)
        n = c.get("/api/notifications", headers=H(adm)).json()
        assert any(x["category"] == "ALERT" for x in n), n[:3]
        assert any(x["category"] == "USER" for x in n)
        s = c.get("/api/notifications/summary", headers=H(adm)).json(); assert s["unread"] > 0
        assert c.post("/api/notifications/read", headers=H(adm), json={"all": True}).json()["ok"]
        assert c.get("/api/notifications/summary", headers=H(adm)).json()["unread"] == 0
        for _ in range(30):                                         # operator sees own drone's alerts
            al = c.get("/api/alerts", headers=H(op)).json()
            if al: break
            time.sleep(1)
        assert al and all(a["tail_number"] == "TAIL-09" for a in al), al
        assert c.post(f"/api/alerts/{al[0]['id']}/ack", headers=H(op)).json()["ok"]

        # --- fleet order pins status; reassign drone; disable revokes
        eid = fleet[0]["id"]
        assert c.post(f"/api/fleet/{eid}/action", headers=H(adm), json={"action": "ground", "note": "test"}).json()["status"] == "grounded"
        r = c.patch(f"/api/admin/operators/{oid}", headers=H(adm), json={"drones": ["TAIL-01", "TAIL-02"]}); assert r.status_code == 200
        assert len(c.get("/api/fleet", headers=H(op)).json()) == 2
        assert c.patch(f"/api/admin/operators/{oid}", headers=H(adm), json={"active": False}).status_code == 200
        assert c.get("/api/fleet", headers=H(op)).status_code == 401
        assert c.post("/api/auth/login", json={"login_id": "OPR-9", "password": "Operator#9999"}).status_code == 403

        # --- self-protection
        me = c.get("/api/auth/me", headers=H(adm)).json()["operator"]["id"]
        assert c.delete(f"/api/admin/operators/{me}", headers=H(adm)).status_code == 400
        assert c.patch(f"/api/admin/operators/{me}", headers=H(adm), json={"active": False}).status_code == 400

        # --- lockout
        for _ in range(5):
            c.post("/api/auth/login", json={"login_id": "OPR-01", "password": "wrong"})
        assert c.post("/api/auth/login", json={"login_id": "OPR-01", "password": "Operator@123"}).status_code == 423

        # --- CAN ingest
        r = c.post("/api/admin/drones", headers=H(adm), json={"tail_number": "CAN-1", "data_source": "live_can"}); assert r.status_code == 200
        sample = {"rpm": 4500, "throttle": .7, "alt_m": 3000, "oat_c": 5, "cht": 140, "egt": 780, "oil_p": 3.5, "oil_t": 95,
                  "fuel_flow": 18, "vib": 1.2, "bus_v": 13.8}
        assert c.post("/api/ingest/CAN-1", json=sample).status_code == 401
        r = c.post("/api/ingest/CAN-1", json=sample, headers={"x-ingest-key": "ingest-key"}); assert r.status_code == 200, r.text
        assert c.post("/api/ingest/TAIL-01", json=sample, headers={"x-ingest-key": "ingest-key"}).status_code == 404
        assert c.get("/api/state?tail=CAN-1", headers=H(adm)).json()["source"] == "live_can"


if __name__ == "__main__":
    test_full_flow(); print("ALL API TESTS PASSED")
