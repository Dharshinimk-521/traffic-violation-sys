"""
TrafficGuard — CCTV Feed Simulator
===================================
Simulates CCTV camera feeds that detect traffic violations.

This script:
1. Generates synthetic "CCTV frames" with embedded license plates
2. Sends frames to the Plate Detection Service (port 8000)
3. On successful detection, calls the Node.js API (port 5000) to create a violation
4. Runs in a loop to simulate continuous monitoring

Usage:
    python simulator.py                  # Interactive mode — one violation at a time
    python simulator.py --auto           # Auto mode — generates violations every 30s
    python simulator.py --auto --interval 10  # Auto mode with custom interval
    python simulator.py --batch 5        # Generate 5 violations at once
"""

import requests
import random
import time
import json
import argparse
import sys
from datetime import datetime

# ============================================
# CONFIGURATION
# ============================================

PLATE_SERVICE_URL = "http://localhost:8000"
NODE_API_URL = "http://localhost:5000"

# Sample Indian license plates (Tamil Nadu format)
SAMPLE_PLATES = [
    {"plate": "TN09AB1234", "owner": "Rajesh Kumar",      "phone": "+919876543210"},
    {"plate": "TN22CD5678", "owner": "Priya Sharma",      "phone": "+919876543211"},
    {"plate": "TN01EF9012", "owner": "Arun Venkatesh",    "phone": "+919876543212"},
    {"plate": "TN33GH3456", "owner": "Meena Lakshmi",     "phone": "+919876543213"},
    {"plate": "TN10JK7890", "owner": "Suresh Babu",       "phone": "+919876543214"},
    {"plate": "TN45LM2345", "owner": "Divya Rajan",       "phone": "+919876543215"},
    {"plate": "TN07NP6789", "owner": "Karthik Subramani", "phone": "+919876543216"},
    {"plate": "TN18QR0123", "owner": "Lakshmi Narayanan", "phone": "+919876543217"},
    {"plate": "TN29ST4567", "owner": "Vikram Singh",      "phone": "+919876543218"},
    {"plate": "TN36UV8901", "owner": "Anitha Devi",       "phone": "+919876543219"},
]

# Violation types (must match violations_master table IDs)
VIOLATIONS = {
    1: {"name": "No Helmet",                "fine": 500,  "severity": 2, "scenario": "no_helmet"},
    2: {"name": "Red Light Jump",           "fine": 2000, "severity": 5, "scenario": "red_light"},
    3: {"name": "Speeding",                 "fine": 1000, "severity": 3, "scenario": "speeding"},
    4: {"name": "Using Phone While Driving","fine": 1500, "severity": 4, "scenario": "phone"},
}

# CCTV camera locations (simulated)
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
# CORE FUNCTIONS
# ============================================

def check_services():
    """Verify that both backend services are running."""
    services_ok = True

    # Check Plate Service
    try:
        r = requests.get(f"{PLATE_SERVICE_URL}/health", timeout=3)
        data = r.json()
        print(f"  ✅ Plate Service (:{data.get('port', 8000)}) — {data.get('status')}")
    except Exception:
        print(f"  ❌ Plate Service (localhost:8000) — NOT RUNNING")
        print(f"     → Start it: cd plate-service && python app.py")
        services_ok = False

    # Check Node API
    try:
        r = requests.get(f"{NODE_API_URL}/health", timeout=3)
        data = r.json()
        print(f"  ✅ Node API (:{5000}) — {data.get('status')}")
    except Exception:
        print(f"  ❌ Node API (localhost:5000) — NOT RUNNING")
        print(f"     → Start it: cd api-server && node server.js")
        services_ok = False

    return services_ok


def simulate_cctv_detection():
    """
    Simulate a CCTV camera capturing a traffic violation.
    
    In production, this would:
    1. Read a frame from an RTSP/IP camera stream
    2. Run YOLO/custom model for violation detection
    3. Extract the license plate region
    4. Run OCR on the plate
    
    For simulation, we pick a random plate + violation and call
    the plate service's simulation endpoint.
    """
    # Pick random vehicle and violation
    vehicle = random.choice(SAMPLE_PLATES)
    violation_id = random.choice(list(VIOLATIONS.keys()))
    violation = VIOLATIONS[violation_id]
    camera = random.choice(CAMERA_LOCATIONS)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"\n{'='*60}")
    print(f"📹 CCTV CAPTURE — {camera}")
    print(f"   Time: {timestamp}")
    print(f"   Plate Detected: {vehicle['plate']}")
    print(f"   Violation: {violation['name']}")
    print(f"{'='*60}")

    # Step 1: Call plate detection service (simulation mode)
    print(f"\n  [1/3] Sending to Plate Detection Service...")
    try:
        plate_resp = requests.post(
            f"{PLATE_SERVICE_URL}/detect-simulation",
            json={"scenario": violation["scenario"]},
            timeout=10
        )
        plate_data = plate_resp.json()

        if plate_data.get("success"):
            print(f"        ✅ Plate detected: {vehicle['plate']} (confidence: {plate_data.get('confidence', 0.0):.0%})")
        else:
            # Even if simulation endpoint returns a different plate,
            # we use our known plate for the demo
            print(f"        ⚠  Using known plate: {vehicle['plate']}")

    except requests.ConnectionError:
        print(f"        ⚠  Plate service offline — using direct plate: {vehicle['plate']}")
    except Exception as e:
        print(f"        ⚠  Plate service error: {e} — continuing with known plate")

    # Step 2: Create violation in Supabase via Node.js API
    print(f"  [2/3] Creating violation record in database...")
    try:
        create_resp = requests.post(
            f"{NODE_API_URL}/create-violation",
            json={
                "plate_number": vehicle["plate"],
                "owner_name": vehicle["owner"],
                "phone_number": vehicle["phone"],
                "violation_id": violation_id,
                "detected_by_ai": True,
                "evidence_url": f"cctv://{camera.split('·')[0].strip()}/{timestamp.replace(' ', '_')}.jpg"
            },
            timeout=10
        )
        create_data = create_resp.json()

        if create_data.get("success"):
            print(f"        ✅ Violation record created!")
            print(f"           Record ID : {create_data.get('record_id')}")
            print(f"           Violation  : {create_data.get('violation')}")
            print(f"           Fine       : ₹{create_data.get('fine', 0):,}")
            print(f"           Status     : {create_data.get('status')}")
            return {
                "success": True,
                "record_id": create_data.get("record_id"),
                "plate": vehicle["plate"],
                "owner": vehicle["owner"],
                "violation": violation["name"],
                "fine": create_data.get("fine"),
                "camera": camera
            }
        else:
            print(f"        ❌ Failed: {create_data.get('error', 'Unknown error')}")
            return {"success": False, "error": create_data.get("error")}

    except requests.ConnectionError:
        print(f"        ❌ Node API not reachable. Is server.js running?")
        return {"success": False, "error": "Node API offline"}
    except Exception as e:
        print(f"        ❌ Error: {e}")
        return {"success": False, "error": str(e)}


def simulate_batch(count):
    """Generate multiple violations at once."""
    print(f"\n🎥 Generating {count} simulated violations...\n")
    results = {"success": 0, "failed": 0, "records": []}

    for i in range(count):
        print(f"\n--- Violation {i+1}/{count} ---")
        result = simulate_cctv_detection()
        if result.get("success"):
            results["success"] += 1
            results["records"].append(result)
        else:
            results["failed"] += 1
        
        if i < count - 1:
            time.sleep(1)  # Small delay between violations

    print(f"\n{'='*60}")
    print(f"📊 BATCH COMPLETE")
    print(f"   Created: {results['success']} | Failed: {results['failed']}")
    print(f"{'='*60}")
    return results


def auto_mode(interval):
    """Continuously generate violations at a set interval."""
    print(f"\n🔄 AUTO MODE — Generating violations every {interval} seconds")
    print(f"   Press Ctrl+C to stop\n")
    
    count = 0
    try:
        while True:
            count += 1
            print(f"\n{'─'*40}")
            print(f"  Auto-detection #{count}")
            simulate_cctv_detection()
            print(f"\n  ⏳ Next detection in {interval}s...")
            time.sleep(interval)
    except KeyboardInterrupt:
        print(f"\n\n🛑 Stopped after {count} detections.")


def interactive_mode():
    """Manual mode — officer triggers detections one at a time."""
    print(f"""
╔══════════════════════════════════════════════╗
║  🎥 TrafficGuard — CCTV Simulator           ║
║  Interactive Mode                            ║
╚══════════════════════════════════════════════╝

Commands:
  [Enter]  →  Simulate a random CCTV detection
  b <n>    →  Batch generate n violations
  s        →  Show current violation stats
  q        →  Quit
""")

    while True:
        try:
            cmd = input("\n🎯 Press Enter to detect (or type command): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n\n👋 Exiting simulator.")
            break

        if cmd == "q" or cmd == "quit":
            print("👋 Exiting simulator.")
            break
        elif cmd.startswith("b "):
            try:
                n = int(cmd.split()[1])
                simulate_batch(n)
            except (ValueError, IndexError):
                print("Usage: b <number>  (e.g., b 5)")
        elif cmd == "s":
            show_stats()
        else:
            simulate_cctv_detection()
            print(f"\n  [3/3] ✅ Violation is now visible in the Officer Dashboard.")
            print(f"        → Open the dashboard and refresh to see it in the queue.")


def show_stats():
    """Fetch and display current violation stats from the API."""
    try:
        r = requests.get(f"{NODE_API_URL}/violations", timeout=5)
        data = r.json()
        violations = data.get("violations", [])
        
        pending = sum(1 for v in violations if v.get("status") == "pending")
        approved = sum(1 for v in violations if v.get("status") == "approved")
        rejected = sum(1 for v in violations if v.get("status") == "rejected")
        total_fines = sum(v.get("fine_amount", 0) for v in violations if v.get("status") == "approved")

        print(f"\n📊 Current Stats:")
        print(f"   Total Violations : {len(violations)}")
        print(f"   Pending          : {pending}")
        print(f"   Approved         : {approved}")
        print(f"   Rejected         : {rejected}")
        print(f"   Total Fines      : ₹{total_fines:,}")

        # Risk scores
        r2 = requests.get(f"{NODE_API_URL}/risk-scores", timeout=5)
        risk_data = r2.json()
        drivers = risk_data.get("drivers", [])
        high_risk = [d for d in drivers if d.get("risk_category") == "High"]
        if high_risk:
            print(f"\n   ⚠ HIGH RISK DRIVERS ({len(high_risk)}):")
            for d in high_risk:
                print(f"     • {d['plate_number']} ({d['owner_name']}) — Score: {d['risk_score']}")
    except Exception as e:
        print(f"   ❌ Could not fetch stats: {e}")


# ============================================
# ENTRY POINT
# ============================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TrafficGuard CCTV Simulator")
    parser.add_argument("--auto", action="store_true", help="Auto-generate violations continuously")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between auto detections (default: 30)")
    parser.add_argument("--batch", type=int, help="Generate N violations at once")
    parser.add_argument("--skip-check", action="store_true", help="Skip service health check")
    args = parser.parse_args()

    print("\n🛡  TrafficGuard — CCTV Feed Simulator")
    print("─" * 40)

    # Health check
    if not args.skip_check:
        print("\nChecking services...")
        services_ok = check_services()
        if not services_ok:
            print("\n⚠  Some services are offline. The simulator can still run")
            print("   but violations may not be saved to the database.")
            try:
                input("\nPress Enter to continue anyway, or Ctrl+C to exit...")
            except (EOFError, KeyboardInterrupt):
                sys.exit(0)

    if args.batch:
        simulate_batch(args.batch)
    elif args.auto:
        auto_mode(args.interval)
    else:
        interactive_mode()