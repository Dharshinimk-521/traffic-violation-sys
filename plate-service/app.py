"""
TrafficGuard — Violation Simulation Service (No OCR)
=====================================================
Python Flask → Port 8000

Simplified version WITHOUT OpenCV/EasyOCR.
Only simulation endpoints for generating mock CCTV violations.

Endpoints:
  GET  /health              — Service health check
  POST /detect-simulation   — Returns mock plate + violation data
  POST /generate-violation  — Detect + create violation in one call
  POST /bulk-seed           — Seed many violations for dashboard testing

Requirements:
  pip install flask requests
"""

from flask import Flask, request, jsonify
import random
import time
import requests
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('SimService')

NODE_API_URL = "http://localhost:5000"

# ============================================
# SAMPLE DATA
# ============================================

SAMPLE_VEHICLES = [
    {"plate": "TN09AB1234", "owner": "Rajesh Kumar",       "phone": "+919876543210"},
    {"plate": "TN22CD5678", "owner": "Priya Sharma",       "phone": "+919876543211"},
    {"plate": "TN01EF9012", "owner": "Arun Venkatesh",     "phone": "+919876543212"},
    {"plate": "TN33GH3456", "owner": "Meena Lakshmi",      "phone": "+919876543213"},
    {"plate": "TN10JK7890", "owner": "Suresh Babu",        "phone": "+919876543214"},
    {"plate": "TN45LM2345", "owner": "Divya Rajan",        "phone": "+919876543215"},
    {"plate": "TN07NP6789", "owner": "Karthik Subramani",  "phone": "+919876543216"},
    {"plate": "TN18QR0123", "owner": "Lakshmi Narayanan",  "phone": "+919876543217"},
    {"plate": "TN29ST4567", "owner": "Vikram Singh",       "phone": "+919876543218"},
    {"plate": "TN36UV8901", "owner": "Anitha Devi",        "phone": "+919876543219"},
    {"plate": "TN14WX3456", "owner": "Mohammed Farooq",    "phone": "+919876543220"},
    {"plate": "TN50YZ7890", "owner": "Deepa Chandran",     "phone": "+919876543221"},
]

VIOLATIONS = {
    1: {"name": "No Helmet",                 "scenario": "no_helmet"},
    2: {"name": "Red Light Jump",            "scenario": "red_light"},
    3: {"name": "Speeding",                  "scenario": "speeding"},
    4: {"name": "Using Phone While Driving", "scenario": "phone"},
}

CAMERA_LOCATIONS = [
    "CAM-01 · Anna Salai Junction",
    "CAM-02 · T. Nagar Signal",
    "CAM-03 · Adyar Bridge",
    "CAM-04 · Guindy Flyover",
    "CAM-05 · Velachery Main Road",
    "CAM-06 · Tambaram NH45",
    "CAM-07 · Porur Junction",
    "CAM-08 · Chromepet Bypass",
]


# ============================================
# ROUTES
# ============================================

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'TrafficGuard Simulation Service',
        'port': 8000,
        'mode': 'simulation-only (no OCR)'
    })


@app.route('/detect-simulation', methods=['POST'])
def detect_simulation():
    """
    Simulated CCTV detection.
    Body (optional): { "scenario": "no_helmet" | "red_light" | "speeding" | "phone" }
    """
    data = request.get_json() or {}
    scenario = data.get('scenario', None)

    vehicle = random.choice(SAMPLE_VEHICLES)

    if scenario:
        violation_id = next(
            (k for k, v in VIOLATIONS.items() if v["scenario"] == scenario), 1
        )
    else:
        violation_id = random.choice(list(VIOLATIONS.keys()))

    violation = VIOLATIONS[violation_id]
    camera = random.choice(CAMERA_LOCATIONS)

    logger.info(f"Simulation: {vehicle['plate']} — {violation['name']} at {camera}")

    return jsonify({
        'success': True,
        'simulated': True,
        'plate_number': vehicle['plate'],
        'owner_name': vehicle['owner'],
        'phone_number': vehicle['phone'],
        'violation_id': violation_id,
        'violation_name': violation['name'],
        'camera': camera,
        'confidence': round(random.uniform(0.85, 0.99), 2)
    })


@app.route('/generate-violation', methods=['POST'])
def generate_violation():
    """
    Generate one violation and push it to the Node.js API.
    Combines detect-simulation + create-violation in one call.
    Body (optional): { "scenario": "no_helmet" | "red_light" | "speeding" | "phone" }
    """
    data = request.get_json() or {}
    scenario = data.get('scenario', None)

    vehicle = random.choice(SAMPLE_VEHICLES)

    if scenario:
        violation_id = next(
            (k for k, v in VIOLATIONS.items() if v["scenario"] == scenario), 1
        )
    else:
        violation_id = random.choice(list(VIOLATIONS.keys()))

    violation = VIOLATIONS[violation_id]
    camera = random.choice(CAMERA_LOCATIONS)

    try:
        resp = requests.post(
            f"{NODE_API_URL}/create-violation",
            json={
                "plate_number": vehicle["plate"],
                "owner_name": vehicle["owner"],
                "phone_number": vehicle["phone"],
                "violation_id": violation_id,
                "detected_by_ai": True,
                "evidence_url": f"cctv://{camera.split('·')[0].strip()}/frame.jpg"
            },
            timeout=10
        )
        result = resp.json()

        if result.get("success"):
            logger.info(f"Created: {vehicle['plate']} — {violation['name']} — ₹{result.get('fine')}")
            return jsonify({
                'success': True,
                'plate_number': vehicle['plate'],
                'owner_name': vehicle['owner'],
                'violation': violation['name'],
                'fine': result.get('fine'),
                'record_id': result.get('record_id'),
                'camera': camera
            })
        else:
            return jsonify({'success': False, 'error': result.get('error')}), 500

    except requests.ConnectionError:
        return jsonify({'success': False, 'error': 'Node.js API not running on port 5000'}), 503
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/bulk-seed', methods=['POST'])
def bulk_seed():
    """
    Seed multiple violations for testing the officer dashboard.
    Body: { "count": 15 }   (default: 10, max: 50)
    All appear as 'pending' in the dashboard — ready for approve/reject.
    """
    data = request.get_json() or {}
    count = min(data.get('count', 10), 50)

    results = {"created": 0, "failed": 0, "records": []}

    for i in range(count):
        vehicle = random.choice(SAMPLE_VEHICLES)
        violation_id = random.choice(list(VIOLATIONS.keys()))
        violation = VIOLATIONS[violation_id]
        camera = random.choice(CAMERA_LOCATIONS)

        try:
            resp = requests.post(
                f"{NODE_API_URL}/create-violation",
                json={
                    "plate_number": vehicle["plate"],
                    "owner_name": vehicle["owner"],
                    "phone_number": vehicle["phone"],
                    "violation_id": violation_id,
                    "detected_by_ai": random.choice([True, True, True, False]),
                    "evidence_url": f"cctv://{camera.split('·')[0].strip()}/frame_{i}.jpg"
                },
                timeout=10
            )
            result = resp.json()
            if result.get("success"):
                results["created"] += 1
                results["records"].append({
                    "plate": vehicle["plate"],
                    "owner": vehicle["owner"],
                    "violation": violation["name"],
                    "fine": result.get("fine"),
                    "record_id": result.get("record_id")
                })
            else:
                results["failed"] += 1
        except Exception:
            results["failed"] += 1

        time.sleep(0.3)

    logger.info(f"Bulk seed: {results['created']} created, {results['failed']} failed")

    return jsonify({
        'success': True,
        'message': f"Seeded {results['created']} violations ({results['failed']} failed)",
        'created': results['created'],
        'failed': results['failed'],
        'records': results['records']
    })


if __name__ == '__main__':
    print("\n🎥 TrafficGuard — Simulation Service (No OCR)")
    print(f"   Port: 8000")
    print(f"   Endpoints:")
    print(f"     GET  /health")
    print(f"     POST /detect-simulation")
    print(f"     POST /generate-violation")
    print(f"     POST /bulk-seed")
    print(f"\n   Quick seed 15 violations:")
    print(f"   curl -X POST http://localhost:8000/bulk-seed -H 'Content-Type: application/json' -d '{{\"count\": 15}}'")
    print()
    app.run(host='0.0.0.0', port=8000, debug=False)