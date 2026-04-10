import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from ocr_library import extract_from_base64

app = Flask(__name__)
CORS(app)

# Make sure Python can find ocr_library in the same directory
import sys
sys.path.insert(0, os.path.dirname(__file__))


@app.route("/ocr-api/health")
def health():
    return jsonify({"status": "ok", "engine": "unified (Tesseract.js + pytesseract)"})


@app.route("/ocr-api/unified", methods=["POST"])
def unified_extract():
    """
    Accepts:
      image    — base64-encoded image (with or without data: prefix)
      js_words — optional list of Tesseract.js word objects from the browser
      lang     — optional Tesseract language code (default: eng)
    """
    try:
        data = request.get_json(force=True)
        if not data or "image" not in data:
            return jsonify({"error": "Missing 'image' field"}), 400

        result = extract_from_base64(
            b64_image=data["image"],
            js_words=data.get("js_words"),
            lang=data.get("lang", "eng"),
        )
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"[UnifiedOCR] Starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
