#!/usr/bin/env python3
"""
AeroTwin-DT edge gateway — reads engine data from SocketCAN and pushes 1 Hz samples to the backend.

    pip install python-can requests
    sudo ip link set can0 up type can bitrate 250000
    python can_gateway.py --url https://YOUR.onrender.com --tail TAIL-07 --key <INGEST_KEY> --channel can0
    python can_gateway.py --url http://localhost:8000 --tail CAN-1 --key k --demo      # no hardware: synthetic data

EDIT `DECODE` to match your ECU/FADEC DBC: arbitration-id -> list of (signal, start_byte, length_bytes, scale, offset, signed).
The mapping below is an EXAMPLE layout, not a real Rotax/FADEC spec.
"""
import argparse, math, struct, time
import requests

DECODE = {
    0x100: [("rpm", 0, 2, 1.0, 0, False), ("throttle", 2, 1, 0.4 / 100, 0, False), ("map_kpa", 3, 2, 0.1, 0, False)],
    0x101: [("cht", 0, 2, 0.1, 0, True), ("egt", 2, 2, 0.5, 0, False), ("oil_t", 4, 2, 0.1, 0, True), ("oil_p", 6, 2, 0.001, 0, False)],
    0x102: [("fuel_flow", 0, 2, 0.01, 0, False), ("bus_v", 2, 2, 0.01, 0, False), ("alt_i", 4, 2, 0.1, 0, True), ("soc", 6, 1, 0.01, 0, False)],
    0x103: [("vib", 0, 2, 0.001, 0, False), ("vib_1x", 2, 2, 0.001, 0, False), ("vib_half", 4, 2, 0.001, 0, False), ("inj_act", 6, 2, 0.01, 0, True)],
    0x104: [("alt_m", 0, 2, 1.0, 0, True), ("oat_c", 2, 2, 0.1, 0, True), ("tas_ms", 4, 2, 0.1, 0, False)],
}


def decode(msg_id, data, out):
    for name, start, ln, scale, off, signed in DECODE.get(msg_id, []):
        raw = int.from_bytes(data[start:start + ln], "little", signed=signed)
        out[name] = raw * scale + off


def demo_sample(t):
    return {"rpm": 4500 + 300 * math.sin(t / 20), "throttle": 0.7, "alt_m": 3000, "oat_c": 6, "tas_ms": 52,
            "cht": 140 + 5 * math.sin(t / 30), "egt": 780, "oil_p": 3.4, "oil_t": 96, "fuel_flow": 18.2,
            "vib": 1.3, "bus_v": 13.8, "soc": 0.95}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True); ap.add_argument("--tail", required=True); ap.add_argument("--key", required=True)
    ap.add_argument("--channel", default="can0"); ap.add_argument("--period", type=float, default=1.0)
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    sample, bus = {}, None
    if not a.demo:
        import can
        bus = can.interface.Bus(channel=a.channel, interface="socketcan")
    nxt, t0 = time.time(), time.time()
    while True:
        if bus:
            msg = bus.recv(timeout=0.2)
            if msg:
                decode(msg.arbitration_id, bytes(msg.data), sample)
        else:
            sample = demo_sample(time.time() - t0); time.sleep(0.2)
        if time.time() >= nxt and sample:
            nxt = time.time() + a.period
            try:
                r = requests.post(f"{a.url.rstrip('/')}/api/ingest/{a.tail}", json=sample, headers={"X-Ingest-Key": a.key}, timeout=5)
                if r.status_code != 200:
                    print("ingest rejected:", r.status_code, r.text)
            except requests.RequestException as e:
                print("ingest error:", e)


if __name__ == "__main__":
    main()
