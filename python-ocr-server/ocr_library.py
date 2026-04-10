"""
UnifiedOCR — Ensemble OCR library combining Tesseract.js + pytesseract.

Strategy:
  1. Run pytesseract in three passes (different PSM configs) to get word-level
     detections with bounding boxes and confidence scores.
  2. Accept optional Tesseract.js word-level data from the browser.
  3. Merge all detections using confidence-weighted voting: words that overlap
     spatially compete; the highest-confidence version wins.
  4. Reconstruct clean, normalized text from the winning detections.
  5. Compute a blended quality score across all sources.
"""

import re
import io
import base64
import pytesseract
from PIL import Image, ImageFilter, ImageEnhance


# Tesseract page-segmentation modes to run in parallel passes
_PASSES = [
    {"config": "--oem 1 --psm 3", "label": "auto-layout"},   # Fully automatic page segmentation, LSTM
    {"config": "--oem 1 --psm 6", "label": "single-block"},  # Uniform block of text
    {"config": "--oem 1 --psm 4", "label": "single-column"}, # Single column
]


def _preprocess(image: Image.Image) -> Image.Image:
    """Sharpen and enhance contrast to boost OCR accuracy."""
    img = image.convert("L")                          # grayscale
    img = ImageEnhance.Contrast(img).enhance(1.8)
    img = img.filter(ImageFilter.SHARPEN)
    # Scale up small images so Tesseract has more pixels to work with
    w, h = img.size
    if w < 800:
        scale = 800 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


def _run_pytesseract_pass(image: Image.Image, config: str) -> list[dict]:
    """Run one pytesseract pass; return list of word dicts."""
    data = pytesseract.image_to_data(
        image, config=config, output_type=pytesseract.Output.DICT
    )
    words = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        conf = int(data["conf"][i])
        if not text or conf < 0:
            continue
        words.append({
            "text": text,
            "conf": conf,
            "x": data["left"][i],
            "y": data["top"][i],
            "w": data["width"][i],
            "h": data["height"][i],
            "line_num": data["line_num"][i],
            "block_num": data["block_num"][i],
            "par_num": data["par_num"][i],
        })
    return words


def _iou(a: dict, b: dict) -> float:
    """Intersection-over-union for two bounding boxes."""
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = ax1 + a["w"], ay1 + a["h"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = bx1 + b["w"], by1 + b["h"]
    inter_w = max(0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0, min(ay2, by2) - max(ay1, by1))
    inter = inter_w * inter_h
    if inter == 0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union else 0.0


def _merge_word_lists(all_word_lists: list[list[dict]]) -> list[dict]:
    """
    Merge multiple word detection lists into one via greedy IoU matching.
    For each group of overlapping detections, keep the one with highest confidence.
    Unmatched words are kept as-is.
    """
    merged: list[dict] = []

    for word_list in all_word_lists:
        for word in word_list:
            matched = False
            for m in merged:
                if _iou(word, m) > 0.4:
                    if word["conf"] > m["conf"]:
                        m.update(word)
                    matched = True
                    break
            if not matched:
                merged.append(dict(word))

    # Sort by reading order: top-to-bottom, left-to-right
    merged.sort(key=lambda w: (w["y"] // 20, w["x"]))
    return merged


def _reconstruct_text(words: list[dict]) -> str:
    """Reconstruct paragraph text from sorted word list, inserting newlines."""
    if not words:
        return ""
    lines: list[list[str]] = []
    current_line: list[str] = []
    prev_y = words[0]["y"]

    for w in words:
        if abs(w["y"] - prev_y) > 15:
            if current_line:
                lines.append(current_line)
            current_line = [w["text"]]
        else:
            current_line.append(w["text"])
        prev_y = w["y"]

    if current_line:
        lines.append(current_line)

    return "\n".join(" ".join(line) for line in lines)


def _clean_text(text: str) -> str:
    """Remove common OCR noise and normalize whitespace."""
    # Remove isolated special chars that are almost never real words
    text = re.sub(r"(?<!\w)[|}{\\/<>@#$%^*~`](?!\w)", "", text)
    # Collapse multiple spaces
    text = re.sub(r" {2,}", " ", text)
    # Collapse 3+ repeated same character (OCR artifact e.g. "lllll")
    text = re.sub(r"(.)\1{3,}", r"\1\1", text)
    # Trim blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _js_words_to_internal(js_words: list[dict]) -> list[dict]:
    """Convert Tesseract.js word format to internal format."""
    result = []
    for w in js_words:
        bbox = w.get("bbox", {})
        result.append({
            "text": w.get("text", "").strip(),
            "conf": int(float(w.get("confidence", 0))),
            "x": bbox.get("x0", 0),
            "y": bbox.get("y0", 0),
            "w": max(1, bbox.get("x1", 1) - bbox.get("x0", 0)),
            "h": max(1, bbox.get("y1", 1) - bbox.get("y0", 0)),
            "line_num": 0,
            "block_num": 0,
            "par_num": 0,
        })
    return [w for w in result if w["text"]]


class UnifiedOCR:
    """
    Public interface for the ensemble OCR library.

    Usage:
        ocr = UnifiedOCR()
        result = ocr.extract(image_pil, js_words=[...])
        print(result["text"])
    """

    def extract(
        self,
        image: Image.Image,
        js_words: list[dict] | None = None,
        lang: str = "eng",
    ) -> dict:
        """
        Run all OCR engines, merge, clean and return a unified result.

        Args:
            image:    PIL Image to analyse.
            js_words: Optional word list from Tesseract.js (browser).
            lang:     Tesseract language code.

        Returns dict with keys:
            text            — final cleaned text
            word_count      — number of words
            avg_confidence  — blended confidence 0-100
            sources         — per-engine breakdown [{engine, words, avg_conf}]
            engine          — "unified (Tesseract.js + pytesseract)"
        """
        preprocessed = _preprocess(image)

        # --- pytesseract multi-pass ---
        py_results: list[list[dict]] = []
        for p in _PASSES:
            try:
                words = _run_pytesseract_pass(preprocessed, f"{p['config']} -l {lang}")
                py_results.append(words)
            except Exception:
                pass

        # --- Tesseract.js words from browser (optional) ---
        js_result: list[dict] = []
        if js_words:
            js_result = _js_words_to_internal(js_words)

        # --- Merge everything ---
        all_lists = py_results + ([js_result] if js_result else [])
        if not all_lists:
            return {"text": "", "word_count": 0, "avg_confidence": 0,
                    "sources": [], "engine": "unified"}

        merged = _merge_word_lists(all_lists)

        raw_text = _reconstruct_text(merged)
        clean = _clean_text(raw_text)

        confs = [w["conf"] for w in merged if w["conf"] > 0]
        avg_conf = round(sum(confs) / len(confs), 1) if confs else 0.0

        # --- Per-source breakdown ---
        def source_stats(words: list[dict], label: str) -> dict:
            c = [w["conf"] for w in words if w["conf"] > 0]
            return {
                "engine": label,
                "words": len(words),
                "avg_conf": round(sum(c) / len(c), 1) if c else 0,
            }

        sources = []
        for i, (p, w) in enumerate(zip(_PASSES, py_results)):
            sources.append(source_stats(w, f"pass/{p['label']}"))
        if js_result:
            sources.append(source_stats(js_result, "pass/browser-wasm"))

        return {
            "text": clean,
            "word_count": len(clean.split()) if clean else 0,
            "avg_confidence": avg_conf,
            "confidence": avg_conf,
            "sources": sources,
            "engine": "OCRTextract",
        }


# Module-level singleton
_ocr = UnifiedOCR()


def extract_from_base64(b64_image: str, js_words: list[dict] | None = None, lang: str = "eng") -> dict:
    """Convenience function: decode base64 image and run unified OCR."""
    if b64_image.startswith("data:"):
        b64_image = b64_image.split(",", 1)[1]
    image_bytes = base64.b64decode(b64_image)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return _ocr.extract(image, js_words=js_words, lang=lang)
