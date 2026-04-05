"""
  - Trains a Random Forest classifier on violation patterns
  - Predicts risk category (Low/Medium/High) and score
  - Exposes /predict endpoint for the Node.js backend to call
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
MODEL_PATH = 'risk_model.pkl'
SCORE_MODEL_PATH = 'score_model.pkl'


VIOLATIONS = {
    1: {'name': 'No Helmet',               'fine': 1000, 'severity': 2},
    2: {'name': 'Red Light Jump',           'fine': 5000, 'severity': 5},
    3: {'name': 'Speeding',                 'fine': 2000, 'severity': 3},
    4: {'name': 'Using Phone While Driving','fine': 5000, 'severity': 4},
}


def build_features(driver_record: dict) -> np.ndarray:
    """
    Convert driver violation history into ML features.

    Args:
        driver_record: {
            'total_violations': int,
            'no_helmet_count': int,
            'red_light_count': int,
            'speeding_count': int,
            'phone_count': int,
            'days_since_first': int,
            'days_since_last': int,
        }

    Returns:
        numpy array of features
    """
    tv = driver_record.get('total_violations', 0)
    no_helmet = driver_record.get('no_helmet_count', 0)
    red_light = driver_record.get('red_light_count', 0)
    speeding = driver_record.get('speeding_count', 0)
    phone = driver_record.get('phone_count', 0)
    days_first = driver_record.get('days_since_first', 0)
    days_last = driver_record.get('days_since_last', 0)

    # Derived features
    severity_sum = (no_helmet * 2) + (red_light * 5) + (speeding * 3) + (phone * 4)
    rule_score = severity_sum + (tv * 2)  # matches existing formula
    recency_factor = max(0, 1 - (days_last / 365))  # how recent
    frequency_rate = tv / max(days_first, 1) * 30   # violations per month

    features = np.array([
        tv, no_helmet, red_light, speeding, phone,
        severity_sum, rule_score, recency_factor,
        frequency_rate, days_since_last if (days_since_last := days_last) < 365 else 365,
        min(rule_score / 30, 1.0)  # normalized score
    ])
    return features.reshape(1, -1)


#training data generation - 2000 samples randomly generated
def generate_training_data(n_samples=2000):
    """Generate realistic synthetic driver records for training."""
    np.random.seed(42)
    records = []

    for _ in range(n_samples):
        # Randomly assign driver profile (most are low risk)
        profile = np.random.choice(['low', 'medium', 'high'], p=[0.6, 0.3, 0.1])

        if profile == 'low':
            tv = np.random.randint(0, 3)
            no_helmet = np.random.randint(0, 2)
            red_light = 0
            speeding = np.random.randint(0, 2)
            phone = 0
        elif profile == 'medium':
            tv = np.random.randint(2, 6)
            no_helmet = np.random.randint(0, 3)
            red_light = np.random.randint(0, 2)
            speeding = np.random.randint(0, 2)
            phone = np.random.randint(0, 2)
        else:  # high
            tv = np.random.randint(5, 15)
            no_helmet = np.random.randint(0, 5)
            red_light = np.random.randint(1, 4)
            speeding = np.random.randint(1, 4)
            phone = np.random.randint(1, 4)

        days_first = np.random.randint(30, 730)
        days_last = np.random.randint(0, min(days_first, 180))

        severity_sum = (no_helmet * 2) + (red_light * 5) + (speeding * 3) + (phone * 4)
        rule_score = severity_sum + (tv * 2)
        recency = max(0, 1 - (days_last / 365))
        freq_rate = tv / max(days_first, 1) * 30

        # True label from rule-based formula (ground truth)
        if rule_score <= 5:
            label = 'Low'
        elif rule_score <= 15:
            label = 'Medium'
        else:
            label = 'High'

        records.append({
            'total_violations': tv,
            'no_helmet_count': no_helmet,
            'red_light_count': red_light,
            'speeding_count': speeding,
            'phone_count': phone,
            'severity_sum': severity_sum,
            'rule_score': rule_score,
            'recency_factor': recency,
            'frequency_rate': freq_rate,
            'days_since_last': min(days_last, 365),
            'normalized_score': min(rule_score / 30, 1.0),
            'risk_category': label,
            'risk_score': rule_score
        })

    return pd.DataFrame(records)


# train the model
def train_model():
    
    df = generate_training_data(2000)

    feature_cols = [
        'total_violations', 'no_helmet_count', 'red_light_count',
        'speeding_count', 'phone_count', 'severity_sum', 'rule_score',
        'recency_factor', 'frequency_rate', 'days_since_last', 'normalized_score'
    ]

    X = df[feature_cols].values
    y_cat = df['risk_category'].values
    y_score = df['risk_score'].values

    # Label encode
    le = LabelEncoder()
    y_encoded = le.fit_transform(y_cat)

    X_train, X_test, y_train, y_test = train_test_split(X, y_encoded, test_size=0.2, random_state=42)

    # Classification model
    clf = RandomForestClassifier(n_estimators=100, max_depth=8, random_state=42)
    clf.fit(X_train, y_train)
    print("Classification Report:")
    print(classification_report(y_test, clf.predict(X_test), target_names=le.classes_))

    # Regression model for fine-grained score
    reg = GradientBoostingRegressor(n_estimators=100, max_depth=4, random_state=42)
    reg.fit(X, y_score)

    # Save models
    joblib.dump({'model': clf, 'label_encoder': le, 'feature_cols': feature_cols}, MODEL_PATH)
    joblib.dump(reg, SCORE_MODEL_PATH)
    print(f"\n✅ Models saved: {MODEL_PATH}, {SCORE_MODEL_PATH}")
    return clf, le, reg, feature_cols


#predict the o/p the risk score
def predict(driver_record: dict):
    """Make a risk prediction for a driver."""
    try:
        bundle = joblib.load(MODEL_PATH)
        clf = bundle['model']
        le = bundle['label_encoder']
        reg = joblib.load(SCORE_MODEL_PATH)

        features = build_features(driver_record)
        cat_encoded = clf.predict(features)[0]
        category = le.inverse_transform([cat_encoded])[0]
        score = max(0, round(reg.predict(features)[0]))

        return {
            'risk_category': category,
            'risk_score': score,
            'confidence': float(clf.predict_proba(features).max()),
            'model_version': 'v1.0-rf'
        }
    except FileNotFoundError:
        # Fall back to rule-based if model not trained yet
        tv = driver_record.get('total_violations', 0)
        severity = (
            driver_record.get('no_helmet_count', 0) * 2 +
            driver_record.get('red_light_count', 0) * 5 +
            driver_record.get('speeding_count', 0) * 3 +
            driver_record.get('phone_count', 0) * 4
        )
        score = severity + (tv * 2)
        cat = 'Low' if score <= 5 else 'Medium' if score <= 15 else 'High'
        return {
            'risk_category': cat,
            'risk_score': score,
            'confidence': 1.0,
            'model_version': 'rule-based-fallback'
        }


#flask api
@app.route('/health', methods=['GET'])
def health():
    model_ready = os.path.exists(MODEL_PATH)
    return jsonify({
        'status': 'ok',
        'service': 'TrafficGuard Risk Model',
        'model_ready': model_ready,
        'port': 8001
    })


@app.route('/predict', methods=['POST'])
def predict_endpoint():
    """
    POST /predict
    Body: {
        "total_violations": 4,
        "no_helmet_count": 1,
        "red_light_count": 2,
        "speeding_count": 1,
        "phone_count": 0,
        "days_since_first": 120,
        "days_since_last": 14
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    result = predict(data)
    return jsonify(result)


@app.route('/train', methods=['POST'])
def train_endpoint():
    """Trigger model retraining (admin only in production)."""
    try:
        train_model()
        return jsonify({'success': True, 'message': 'Model retrained'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("\n TrafficGuard Risk Model Service")

    # Train model on first run if not exists
    if not os.path.exists(MODEL_PATH):
        print("No model found — training now...")
        train_model()
    else:
        print(f" Loaded existing model from {MODEL_PATH}")

    print("Starting API on port 8001...\n")
    app.run(host='0.0.0.0', port=8001, debug=False)