# OCRTextract

> High-accuracy text extraction library with ensemble OCR processing and intelligent result merging.

```bash
pip install OCRTextract
```

---

## Quick start

```python
from ocrtextract import OCRTextract

ocr = OCRTextract()
result = ocr.extract("invoice.png")

print(result.text)
print(result.confidence)   # 0–100
print(result.word_count)
```

---

## Features

- **Ensemble processing** — multiple OCR passes with different segmentation strategies, results merged by confidence
- **Intelligent merging** — word-level bounding box voting picks the best detection for every region
- **Auto preprocessing** — contrast enhancement, sharpening, and resolution scaling applied before extraction
- **Noise cleaning** — removes stray symbols, repeated OCR artifacts, and normalizes whitespace
- **Language support** — any language supported by the Tesseract engine (`eng`, `fra`, `deu`, `chi_sim`, etc.)
- **Web UI** — browser-based interface with real-time confidence meter and per-pass breakdown

---

## Installation

**Requirements:** Python 3.8+, Tesseract binary

```bash
# 1. Install the Tesseract binary (required)
# macOS
brew install tesseract

# Ubuntu / Debian
sudo apt install tesseract-ocr

# Windows — download installer from:
# https://github.com/UB-Mannheim/tesseract/wiki

# 2. Install OCRTextract
pip install OCRTextract
```

---

## Usage

### Basic extraction

```python
from ocrtextract import OCRTextract

ocr = OCRTextract()

# From file path
result = ocr.extract("document.png")

# From PIL Image
from PIL import Image
img = Image.open("scan.tiff")
result = ocr.extract(img)

print(result.text)
print(f"Confidence: {result.confidence}%")
print(f"Words detected: {result.word_count}")
```

### Language selection

```python
result = ocr.extract("french_document.png", lang="fra")
result = ocr.extract("chinese_doc.png", lang="chi_sim")
```

### Detailed per-pass breakdown

```python
result = ocr.extract("report.jpg")

for source in result.sources:
    print(f"{source['engine']}: {source['words']} words @ {source['avg_conf']}% confidence")
```

### Batch processing

```python
import os
from ocrtextract import OCRTextract

ocr = OCRTextract()
folder = "scans/"

for filename in os.listdir(folder):
    if filename.endswith((".png", ".jpg", ".tiff")):
        result = ocr.extract(os.path.join(folder, filename))
        print(f"{filename}: {result.word_count} words, {result.confidence}% confidence")
        print(result.text)
        print("---")
```

---

## API reference

### `OCRTextract()`

Creates an OCRTextract instance. No arguments required.

---

### `ocr.extract(source, lang="eng")`

Run ensemble OCR on an image.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `str` or `PIL.Image` | File path or PIL Image object |
| `lang` | `str` | Tesseract language code (default: `"eng"`) |

**Returns:** `OCRResult`

---

### `OCRResult`

| Attribute | Type | Description |
|-----------|------|-------------|
| `.text` | `str` | Extracted and cleaned text |
| `.confidence` | `float` | Ensemble confidence score (0–100) |
| `.word_count` | `int` | Number of words detected |
| `.sources` | `list[dict]` | Per-pass breakdown with engine, words, avg_conf |
| `.engine` | `str` | Always `"OCRTextract"` |

---

## REST API (server mode)

Start the extraction server:

```bash
python -m ocrtextract.server --port 5001
```

### `POST /extract`

```bash
curl -X POST http://localhost:5001/extract \
  -H "Content-Type: application/json" \
  -d '{"image": "<base64-encoded-image>", "lang": "eng"}'
```

**Response:**
```json
{
  "text": "Extracted text content...",
  "confidence": 87.4,
  "word_count": 42,
  "engine": "OCRTextract",
  "sources": [
    { "engine": "pass/auto-layout",   "words": 38, "avg_conf": 85.1 },
    { "engine": "pass/single-block",  "words": 41, "avg_conf": 86.7 },
    { "engine": "pass/single-column", "words": 37, "avg_conf": 84.9 }
  ]
}
```

---

## Web interface

```bash
# Start the server
python -m ocrtextract.server

# In another terminal, start the frontend
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:5173` — drag and drop an image to extract text with live confidence scoring.

---

## How OCRTextract works

OCRTextract runs multiple OCR passes internally, each tuned for a different document layout, then merges the results:

```
Input image
    │
    ├── Pass 1: auto page layout
    ├── Pass 2: single text block
    └── Pass 3: single column
          │
          ▼
    Bounding box IoU grouping
          │
          ▼
    Confidence-weighted voting
          │
          ▼
    Text reconstruction + noise cleaning
          │
          ▼
    OCRResult
```

For each detected word region, the version with the **highest confidence score** across all passes wins. This makes OCRTextract significantly more robust than any single-pass approach, especially on mixed-layout documents, scanned PDFs, and low-quality images.

---

## License

MIT © 2025 OCRTextract

---

## Contributing

Pull requests welcome. Please open an issue first to discuss what you'd like to change.
