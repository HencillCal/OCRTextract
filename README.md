# OCRTextract

> Unified OCR library combining **Tesseract.js** (browser/WebAssembly) and **pytesseract** (Python) into a single ensemble engine for high-accuracy text extraction.

## How it works

Instead of picking one OCR engine, OCRTextract runs both simultaneously and merges their outputs using a confidence-weighted voting algorithm at the word level — where one engine fails, the other compensates.

```
Image → Tesseract.js (browser)  ──┐
                                   ├── IoU-based merge → Unified text
Image → pytesseract × 3 passes  ──┘
```

### Ensemble pipeline

1. **Tesseract.js** runs in the browser via WebAssembly — zero server round-trip, returns word-level bounding boxes + confidence scores
2. **pytesseract** runs 3 server-side passes with different page-segmentation modes:
   - `--psm 3` auto layout (default)
   - `--psm 6` single uniform block
   - `--psm 4` single column
3. All word detections are grouped by bounding box overlap (IoU > 0.4)
4. For each overlapping group, the word with the **highest confidence score** wins
5. Results are reconstructed in reading order and post-processed to remove OCR noise

---

## Stack

| Layer | Technology |
|-------|-----------|
| Browser OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) (WebAssembly) |
| Server OCR | [pytesseract](https://github.com/madmaze/pytesseract) + Pillow |
| OCR backend | Python Tesseract engine (via system binary) |
| Server | Python Flask + flask-cors |
| Frontend | React + Vite + TypeScript |
| Merge algo | IoU bounding-box voting + confidence weighting |

---

## Project structure

```
OCRTextract/
├── python-ocr-server/
│   ├── ocr_library.py     # UnifiedOCR class — the core ensemble library
│   ├── server.py          # Flask API server (/ocr-api/unified endpoint)
│   └── requirements.txt
└── artifacts/ocr-app/     # React + Vite frontend
    └── src/
        ├── App.tsx        # Main OCR UI
        └── index.css
```

---

## API

### `POST /ocr-api/unified`

```json
{
  "image": "<base64-encoded image>",
  "js_words": [{ "text": "hello", "confidence": 95, "bbox": { "x0": 10, "y0": 20, "x1": 60, "y1": 40 } }],
  "lang": "eng"
}
```

**Response:**
```json
{
  "text": "Extracted and merged text...",
  "word_count": 42,
  "avg_confidence": 87.4,
  "sources": [
    { "engine": "pytesseract/auto-layout", "words": 38, "avg_conf": 85.1 },
    { "engine": "pytesseract/single-block", "words": 41, "avg_conf": 86.7 },
    { "engine": "pytesseract/single-column", "words": 37, "avg_conf": 84.9 },
    { "engine": "tesseract.js/browser",     "words": 40, "avg_conf": 88.3 }
  ],
  "engine": "unified (Tesseract.js + pytesseract)"
}
```

---

## Python library usage

```python
from ocr_library import UnifiedOCR
from PIL import Image

ocr = UnifiedOCR()
image = Image.open("document.png")
result = ocr.extract(image)

print(result["text"])
print(f"Confidence: {result['avg_confidence']}%")
print(f"Words: {result['word_count']}")
```

---

## Setup

```bash
# Python server
pip install flask flask-cors pytesseract Pillow
# Install Tesseract binary (macOS)
brew install tesseract
# Install Tesseract binary (Ubuntu/Debian)
apt install tesseract-ocr

python python-ocr-server/server.py

# Frontend (separate terminal)
pnpm install
pnpm --filter @workspace/ocr-app run dev
```

---

## License

MIT
