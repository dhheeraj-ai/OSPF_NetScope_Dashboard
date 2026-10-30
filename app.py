import asyncio
import csv
import threading

from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify

from mcp_server.bridge import PTBridge


app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "experiments.csv"

FIELDS = [
    "timestamp",
    "scenario",
    "link_status",
    "sent",
    "received",
    "packet_loss_pct",
    "recovery_seconds",
    "notes",
]

# Packet Tracer bridge runs on a dedicated asyncio event loop.
pt_bridge = PTBridge()
pt_loop = asyncio.new_event_loop()

pt_thread = None
pt_started = threading.Event()
pt_start_error = None
pt_start_lock = threading.Lock()


def ensure_data_file():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    if not DATA_FILE.exists():
        with DATA_FILE.open(
            "w", newline="", encoding="utf-8"
        ) as f:
            csv.DictWriter(f, fieldnames=FIELDS).writeheader()


def read_records():
    ensure_data_file()

    with DATA_FILE.open(
        "r", newline="", encoding="utf-8"
    ) as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        for key in (
            "sent",
            "received",
            "packet_loss_pct",
            "recovery_seconds",
        ):
            try:
                row[key] = float(row[key] or 0)
            except (TypeError, ValueError):
                row[key] = 0

    return rows


def _pt_worker():
    global pt_start_error

    asyncio.set_event_loop(pt_loop)

    try:
        pt_loop.run_until_complete(pt_bridge.start())
    except Exception as exc:
        pt_start_error = str(exc)
        pt_started.set()
        return

    pt_started.set()
    pt_loop.run_forever()


def ensure_pt_bridge():
    global pt_thread

    with pt_start_lock:
        if pt_thread is None:
            pt_thread = threading.Thread(
                target=_pt_worker,
                daemon=True,
                name="PacketTracerBridge",
            )
            pt_thread.start()

    if not pt_started.wait(timeout=5):
        return False, "Packet Tracer bridge startup timed out."

    if pt_start_error:
        return False, pt_start_error

    return True, None


async def call_pt_tool(tool_name, arguments):
    # Wait briefly for the Packet Tracer extension to connect.
    if not pt_bridge.is_connected:
        await pt_bridge.wait_until_connected(timeout=30)

    return await pt_bridge.call_tool(tool_name, arguments)


def get_pt_tool_result(tool_name, arguments=None):
    ok, error = ensure_pt_bridge()

    if not ok:
        return None, error, 503

    try:
        future = asyncio.run_coroutine_threadsafe(
            call_pt_tool(tool_name, arguments or {}),
            pt_loop,
        )

        result = future.result(timeout=40)
        return result, None, 200

    except FutureTimeoutError:
        return None, "Packet Tracer request timed out.", 504

    except Exception as exc:
        return None, str(exc), 502


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/experiments")
def experiments():
    return jsonify(read_records())


@app.post("/api/experiments")
def add_experiment():
    data = request.get_json(silent=True) or {}

    try:
        sent = int(data.get("sent", 4))
        received = int(data.get("received", 4))
        recovery = float(data.get("recovery_seconds", 0) or 0)

        if sent < 1 or received < 0 or received > sent or recovery < 0:
            raise ValueError

    except (TypeError, ValueError):
        return jsonify({
            "error": (
                "Enter valid values: sent >= 1, "
                "0 <= received <= sent, recovery >= 0."
            )
        }), 400

    loss = round((sent - received) * 100 / sent, 2)

    row = {
        "timestamp": datetime.now().astimezone().strftime(
            "%Y-%m-%d %H:%M:%S"
        ),
        "scenario": str(data.get("scenario", "Manual test"))[:80],
        "link_status": str(data.get("link_status", "Unknown"))[:40],
        "sent": sent,
        "received": received,
        "packet_loss_pct": loss,
        "recovery_seconds": recovery,
        "notes": str(data.get("notes", ""))[:300],
    }

    ensure_data_file()

    with DATA_FILE.open(
        "a", newline="", encoding="utf-8"
    ) as f:
        csv.DictWriter(f, fieldnames=FIELDS).writerow(row)

    return jsonify(row), 201


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "mode": "local experiment log with Packet Tracer bridge integration",
    })


@app.get("/api/pt/status")
def packet_tracer_status():
    ok, error = ensure_pt_bridge()

    if not ok:
        return jsonify({
            "connected": False,
            "error": error,
        }), 503

    return jsonify({
        "connected": pt_bridge.is_connected,
        "host": "127.0.0.1",
        "port": 7531,
    })


@app.get("/api/network")
def packet_tracer_network():
    result, error, status_code = get_pt_tool_result(
        "getNetwork",
        {},
    )

    if error:
        return jsonify({
            "success": False,
            "error": error,
        }), status_code

    return jsonify({
        "success": True,
        "network": result,
    })


@app.get("/api/pt/simulation")
def packet_tracer_simulation():
    result, error, status_code = get_pt_tool_result(
        "getSimulationStatus",
        {},
    )

    if error:
        return jsonify({
            "success": False,
            "error": error,
        }), status_code

    return jsonify({
        "success": True,
        "simulation": result,
    })


@app.get("/api/pt/pdu-results")
def packet_tracer_pdu_results():
    result, error, status_code = get_pt_tool_result(
        "getPduResults",
        {},
    )

    if error:
        return jsonify({
            "success": False,
            "error": error,
        }), status_code

    return jsonify({
        "success": True,
        "results": result,
    })


if __name__ == "__main__":
    ensure_data_file()

    # Disable Flask's reloader so it doesn't start the bridge twice.
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=False,
    )