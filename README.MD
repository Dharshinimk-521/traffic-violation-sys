# 🛡 TrafficGuard

### AI Traffic Violation & Driver Analytics System

> AI-powered traffic enforcement platform combining computer vision, machine learning risk scoring, and a real-time officer dashboard.



## 📁 Project Structure

```bash
traffic-violation-system/
├── login/
│   ├── login.html
│   ├── style.css
│   └── script.js
│
├── officer/
│   ├── officer.html
│   ├── style1.css
│   └── script1.js
│
├── api-server/
│   ├── server.js
│   ├── .env
│   └── package.json
│
├── plate-service/
│   ├── app.py
│   ├── risk_model.py
│   ├── riskmodel.py
│   ├── risk_model.pkl
│   └── score_model.pkl
│
└── database/
    └── schema.sql
```

---

##  System Flow

```
CCTV Feed (Simulated)
        ↓
OpenCV + EasyOCR — plate detection + violation classification
        ↓
Auto-insert into Supabase (vehicles + violation_records)
        ↓
Officer logs in → reviews → approves / rejects
        ↓
Fine generated → SMS sent → payment tracked
        ↓
ML model updates risk score → dashboard updated
```

---

##  Tech Stack

| Layer           | Tech                    |
| --------------- | ----------------------- |
| Frontend        | HTML, CSS, Vanilla JS   |
| Auth + Database | Supabase (PostgreSQL)   |
| API Server      | Node.js                 |
| Computer Vision | Python, OpenCV, EasyOCR |
| ML Risk Model   | scikit-learn            |
| SMS             | Twilio (simulated)      |

---

## 🗄️ Database

7 tables:

`vehicles` · `violations_master` · `violation_records` · `payments` · `sms_logs` · `risk_predictions` · `user_roles`

---

## 🎥 Computer Vision

`plate-service/app.py` (Port 8000)

| Violation      | Severity | Fine   |
| -------------- | -------- | ------ |
| No Helmet      | 2        | ₹500   |
| Speeding       | 3        | ₹1,000 |
| Using Phone    | 4        | ₹1,500 |
| Red Light Jump | 5        | ₹2,000 |

---

## 🤖 Risk Model

```
risk_score = Σ(severity) + (total_violations × 2)
```

| Range | Level  |
| ----- | ------ |
| 0–5   | Low    |
| 6–15  | Medium |
| 16+   | High   |

---

## 🖥 API Server

| Method | Route              | Description                        |
| ------ | ------------------ | ---------------------------------- |
| GET    | /health            | Health check                       |
| GET    | /violations        | List violations                    |
| POST   | /approve-violation | Approve + fine + SMS + risk update |
| POST   | /reject-violation  | Reject violation                   |
| POST   | /create-violation  | Insert violation                   |
| POST   | /send-warning      | Manual SMS                         |

---

## 🖥 Frontend

* Login → Supabase Auth
* Dashboard → Approve / Reject + Risk View

---

## 🚀 Run

```bash
cd api-server
npm install
node server.js

cd ../plate-service
python app.py
python risk_model.py

cd ..
npx serve .
```

---

## 🗺 Roadmap

* [ ] Live CCTV
* [ ] Real SMS
* [ ] Payments
* [ ] Admin panel
* [ ] Mobile app

---

