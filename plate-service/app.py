"""
TrafficGuard — Plate Detection Service
Python Flask → Port 8000
Uses OpenCV + EasyOCR for license plate recognition
"""

from flask import Flask, request, jsonify
import cv2
import numpy as np
import easyocr
import re
import base64
import os

app = Flask(__name__)

# Initialize OCR reader (runs once on startup)
# Loads English model - ~300MB download on first run
reader = easyocr.Reader(['en'], gpu=False)

# Indian plate pattern: 2 letters + 2 digits + 2 letters + 4 digits
# e.g., TN09AB1234
PLATE_PATTERN = re.compile(r'^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$')

def preprocess_image(img):
    """Enhance image for better OCR accuracy."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Denoise
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    # Adaptive threshold
    thresh = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 11, 2
    )
    return thresh

def extract_plate_region(img):
    """Find potential license plate region using contours."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 100, 200)

    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    plate_contour = None
    for c in contours:
        perimeter = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.018 * perimeter, True)
        if len(approx) == 4:
            plate_contour = approx
            break

    if plate_contour is not None:
        x, y, w, h = cv2.boundingRect(plate_contour)
        # Plate aspect ratio filter: width should be ~4x height
        if 2 < (w / max(h, 1)) < 6:
            return img[y:y+h, x:x+w]

    return img  # return full image if no plate region found

def clean_plate_text(raw_text):
    """Clean OCR output to match Indian plate format."""
    # Remove spaces, special chars
    cleaned = re.sub(r'[^A-Z0-9]', '', raw_text.upper())
    return cleaned

def validate_plate(plate):
    """Check if plate matches Indian format."""
    return bool(PLATE_PATTERN.match(plate))

def detect_plate_from_array(img_array):
    """Main detection pipeline."""
    # Try to extract plate region first
    plate_region = extract_plate_region(img_array)

    # Preprocess
    processed = preprocess_image(plate_region)

    # Run OCR
    results = reader.readtext(processed)

    best_plate = None
    best_confidence = 0.0

    for (bbox, text, confidence) in results:
        cleaned = clean_plate_text(text)
        # Try various splits in case OCR merges/splits chars
        candidates = [
            cleaned,
            cleaned[:2] + '0' + cleaned[2:] if len(cleaned) == 9 else cleaned,
        ]
        for candidate in candidates:
            if validate_plate(candidate) and confidence > best_confidence:
                best_plate = candidate
                best_confidence = confidence

    return best_plate, round(best_confidence, 3)


# ============================================
# ROUTES
# ============================================

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'TrafficGuard Plate Service',
        'port': 8000,
        'ocr_ready': True
    })


@app.route('/detect-plate', methods=['POST'])
def detect_plate():
    """
    Accept image as:
    - Base64 encoded JSON: { "image_b64": "..." }
    - Multipart file: field 'image'
    """
    try:
        # --- Base64 input ---
        if request.content_type == 'application/json':
            data = request.get_json()
            if not data or 'image_b64' not in data:
                return jsonify({'error': 'image_b64 field required'}), 400

            img_bytes = base64.b64decode(data['image_b64'])
            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        # --- File upload input ---
        elif 'image' in request.files:
            file = request.files['image']
            img_bytes = file.read()
            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        else:
            return jsonify({'error': 'Provide image as JSON base64 or multipart file'}), 400

        if img is None:
            return jsonify({'error': 'Could not decode image'}), 400

        # Run detection
        plate, confidence = detect_plate_from_array(img)

        if plate:
            return jsonify({
                'success': True,
                'plate_number': plate,
                'confidence': confidence,
                'valid_format': validate_plate(plate)
            })
        else:
            return jsonify({
                'success': False,
                'plate_number': None,
                'confidence': 0.0,
                'message': 'No valid plate detected'
            })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/detect-simulation', methods=['POST'])
def detect_simulation():
    """
    Simulated detection for testing without actual CCTV feed.
    Body: { "scenario": "no_helmet" | "red_light" | "speeding" | "phone" }
    Returns mock plate + violation data.
    """
    data = request.get_json() or {}
    scenario = data.get('scenario', 'no_helmet')

    mock_data = {
        'no_helmet': {'plate': 'TN09AB1234', 'violation_id': 1, 'confidence': 0.94},
        'red_light':  {'plate': 'TN22CD5678', 'violation_id': 2, 'confidence': 0.97},
        'speeding':   {'plate': 'TN01EF9012', 'violation_id': 3, 'confidence': 0.88},
        'phone':      {'plate': 'TN33GH3456', 'violation_id': 4, 'confidence': 0.91},
    }

    result = mock_data.get(scenario, mock_data['no_helmet'])

    return jsonify({
        'success': True,
        'simulated': True,
        'plate_number': result['plate'],
        'violation_id': result['violation_id'],
        'confidence': result['confidence'],
        'scenario': scenario
    })


if __name__ == '__main__':
    print("\n🎥 TrafficGuard Plate Detection Service starting on port 8000...")
    app.run(host='0.0.0.0', port=8000, debug=False)