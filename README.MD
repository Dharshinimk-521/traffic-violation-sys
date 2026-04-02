````markdown
# 🛡 TrafficGuard — AI Traffic Violation & Driver Analytics System

> AI-powered traffic enforcement platform combining computer vision,
> machine learning risk scoring, and a real-time officer dashboard.

---

## 📁 Project Structure

```
traffic-violation-system/
├── login/                        # Officer login portal
│   ├── login.html
│   ├── style.css
│   └── script.js
│
├── officer/                      # Officer dashboard
│   ├── officer.html
│   ├── style1.css
│   └── script1.js
│
├── api-server/                   # Node.js REST API (Port 5000)
│   ├── server.js
│   ├── .env
│   └── package.json
│
├── plate-service/                # Python CV + ML services
│   ├── app.py                    # Plate detection (Port 8000)
│   ├── risk_model.py             # Risk scoring API (Port 8001)
│   ├── riskmodel.py              # Model training script
│   ├── risk_model.pkl
│   └── score_model.pkl
│
└── database/
    └── schema.sql
```

---

## 🔄 System Flow

```
CCTV Feed (Simulated)
        ↓
OpenCV + EasyOCR — plate detection + violation classification
        ↓
Auto-insert into Supabase (vehicles + violation_records)
        ↓
Officer logs in → reviews evidence → approves / rejects
        ↓
Fine generated → SMS sent to owner → payment tracked
        ↓
ML model recalculates risk score → dashboard updated
```

---

## ⚙️ Tech Stack

| Layer           | Tech                                   |
| --------------- | -------------------------------------- |
| Frontend        | HTML, CSS, Vanilla JS                  |
| Auth + Database | Supabase (PostgreSQL)                  |
| API Server      | Node.js                                |
| Computer Vision | Python, OpenCV, EasyOCR                |
| ML Risk Model   | scikit-learn (trained on Google Colab) |
| SMS             | Twilio (simulated in dev)              |

---

## 🗄️ Database

7 tables managed via Supabase:
`vehicles` · `violations_master` · `violation_records` · `payments` · `sms_logs` · `risk_predictions` · `user_roles`

Run `database/schema.sql` in the Supabase SQL editor to set up all tables.

---

## 🎥 Computer Vision (`plate-service/app.py`)

Accepts simulated CCTV frames → extracts plate via EasyOCR → classifies violation → auto-inserts into Supabase.

**Violations detected:**

| Violation      | Severity | Fine   |
| -------------- | -------- | ------ |
| No Helmet      | 2        | ₹500   |
| Speeding       | 3        | ₹1,000 |
| Using Phone    | 4        | ₹1,500 |
| Red Light Jump | 5        | ₹2,000 |

---

## 🤖 Risk Model (`plate-service/risk_model.py`)

Trained via Google Colab → downloaded as `.pkl` → runs as Flask API on Port 8001. Called automatically after every approval.

```
risk_score = Σ(severity per violation) + (total_violations × 2)

0–5   → Low    6–15  → Medium    16+  → High (auto SMS warning)
```

---

## 🖥️ API Server (`api-server/server.js`)

Handles business logic between frontend and Supabase.

| Method | Route                | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/health`            | Health check                       |
| GET    | `/violations`        | List violations                    |
| POST   | `/approve-violation` | Approve + fine + SMS + risk update |
| POST   | `/reject-violation`  | Reject violation                   |
| POST   | `/create-violation`  | Insert new violation               |
| POST   | `/send-warning`      | Manual SMS trigger                 |

---

## 🖥️ Frontend

**Login** — Supabase Auth → role check → redirects officer to dashboard or admin panel.

**Officer Dashboard** — two tabs:

- **Violations** — live table, filter by status, one-click approve/reject, evidence modal
- **Risk Scores** — cards per driver, high risk triggers pulsing ⚠ alert + warning modal

---

## 🚀 Running the Full System

```bash
# 1. Database
# Paste database/schema.sql into Supabase SQL Editor and run

# 2. API Server
cd api-server
npm install
node server.js          # → http://localhost:5000

# 3. Plate Detection
cd plate-service
pip install flask opencv-python easyocr numpy scikit-learn pandas joblib
python app.py           # → http://localhost:8000

# 4. Risk Model
python risk_model.py    # → http://localhost:8001

# 5. Frontend
cd ..
npx serve .
# → http://localhost:3000/login/login.html
```

---

## 🗺️ Roadmap

- [ ] Live CCTV stream (replace simulated input)
- [ ] Twilio live SMS
- [ ] Online payment gateway
- [ ] Admin dashboard
- [ ] Mobile app for field officers
````
