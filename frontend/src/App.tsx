import { useState, useRef, useCallback } from "react";
import Tesseract from "tesseract.js";

type Source = { engine: string; words: number; avg_conf: number };

type OCRResult = {
  text: string;
  word_count: number;
  avg_confidence: number;
  sources: Source[];
  engine: string;
  duration_ms: number;
};

type Stage =
  | { type: "idle" }
  | { type: "browser"; progress: number }
  | { type: "merging" }
  | { type: "done"; result: OCRResult }
  | { type: "error"; message: string };

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const [dragging, setDragging] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageSrc(e.target?.result as string);
      setStage({ type: "idle" });
      setShowBreakdown(false);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) loadImage(file);
  }, []);

  const runUnifiedOCR = async () => {
    if (!imageSrc) return;
    const t0 = performance.now();

    // Phase 1 — Tesseract.js in browser
    setStage({ type: "browser", progress: 0 });
    let jsWords: object[] = [];
    try {
      const { data } = await Tesseract.recognize(imageSrc, "eng", {
        logger: ({ progress }) =>
          setStage({ type: "browser", progress: Math.round(progress * 100) }),
      });
      jsWords = (data.words ?? []).map((w) => ({
        text: w.text,
        confidence: w.confidence,
        bbox: w.bbox,
      }));
    } catch {
      // Non-fatal: still send to server without JS words
    }

    // Phase 2 — Send to Python server for unified merge
    setStage({ type: "merging" });
    try {
      const res = await fetch("/ocr-api/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageSrc, js_words: jsWords }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setStage({
        type: "done",
        result: { ...json, duration_ms: Math.round(performance.now() - t0) },
      });
    } catch (err) {
      setStage({ type: "error", message: String(err) });
    }
  };

  const copyText = () => {
    if (stage.type !== "done") return;
    navigator.clipboard.writeText(stage.result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isRunning = stage.type === "browser" || stage.type === "merging";

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            <path d="M11 8v6M8 11h6"/>
          </svg>
        </div>
        <div>
          <h1 style={styles.title}>UnifiedOCR</h1>
          <p style={styles.subtitle}>Ensemble engine — Tesseract.js + pytesseract fused into one</p>
        </div>
        <div style={styles.pills}>
          <Pill label="Tesseract.js" color="#818cf8" />
          <Plus />
          <Pill label="pytesseract" color="#34d399" />
          <Arrow />
          <Pill label="Unified" color="#f59e0b" bold />
        </div>
      </header>

      <main style={styles.main}>
        {/* ── Upload zone ── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isRunning && fileRef.current?.click()}
          style={{
            ...styles.dropzone,
            borderColor: dragging ? "#818cf8" : "#2d3748",
            background: dragging ? "rgba(129,140,248,0.06)" : "#131720",
            cursor: isRunning ? "default" : "pointer",
          }}
        >
          {imageSrc ? (
            <img src={imageSrc} alt="Source" style={styles.preview} />
          ) : (
            <>
              <div style={styles.uploadIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p style={styles.uploadLabel}>Drop an image or <span style={{ color: "#818cf8" }}>click to browse</span></p>
              <p style={styles.uploadMeta}>PNG · JPG · BMP · TIFF</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImage(f); }} />
        </div>

        {/* ── Action bar ── */}
        {imageSrc && (
          <div style={styles.actionRow}>
            <button onClick={() => { setImageSrc(null); setStage({ type: "idle" }); }} style={styles.btnSecondary}>
              Clear
            </button>
            <button onClick={runUnifiedOCR} disabled={isRunning} style={{ ...styles.btnPrimary, opacity: isRunning ? 0.6 : 1 }}>
              {isRunning ? <Spinner /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              )}
              {stage.type === "browser" ? `Browser OCR… ${(stage as { type: "browser"; progress: number }).progress}%`
                : stage.type === "merging" ? "Merging engines…"
                : "Extract with UnifiedOCR"}
            </button>
          </div>
        )}

        {/* ── Progress steps ── */}
        {(stage.type === "browser" || stage.type === "merging") && (
          <div style={styles.steps}>
            <Step done={stage.type === "merging"} active={stage.type === "browser"} label="Tesseract.js (browser)" color="#818cf8" />
            <div style={styles.stepLine} />
            <Step done={false} active={stage.type === "merging"} label="Merging + cleaning (server)" color="#34d399" />
            <div style={styles.stepLine} />
            <Step done={false} active={false} label="Unified result" color="#f59e0b" />
          </div>
        )}

        {/* ── Result ── */}
        {stage.type === "done" && (
          <div style={styles.resultCard}>
            {/* Result header */}
            <div style={styles.resultHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={styles.successDot} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>Unified Result</span>
                <span style={styles.engineBadge}>{stage.result.engine}</span>
              </div>
              <button onClick={copyText} style={styles.copyBtn}>
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>

            {/* Stats row */}
            <div style={styles.statsRow}>
              <Stat label="Words" value={String(stage.result.word_count)} />
              <Stat label="Confidence" value={`${stage.result.avg_confidence}%`} accent />
              <Stat label="Time" value={`${stage.result.duration_ms}ms`} />
              <Stat label="Passes" value={String(stage.result.sources.length)} />
            </div>

            {/* Confidence bar */}
            <div style={styles.confBarWrap}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Ensemble confidence</span>
                <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>{stage.result.avg_confidence}%</span>
              </div>
              <div style={styles.confBarBg}>
                <div style={{
                  ...styles.confBarFill,
                  width: `${stage.result.avg_confidence}%`,
                  background: stage.result.avg_confidence > 70
                    ? "linear-gradient(90deg,#34d399,#10b981)"
                    : stage.result.avg_confidence > 40
                    ? "linear-gradient(90deg,#f59e0b,#d97706)"
                    : "linear-gradient(90deg,#f87171,#ef4444)",
                }} />
              </div>
            </div>

            {/* Text output */}
            <pre style={styles.textOutput}>
              {stage.result.text || <span style={{ color: "#475569", fontStyle: "italic" }}>No text detected in this image.</span>}
            </pre>

            {/* Engine breakdown (expandable) */}
            {stage.result.sources.length > 0 && (
              <div>
                <button onClick={() => setShowBreakdown(!showBreakdown)} style={styles.breakdownToggle}>
                  {showBreakdown ? "▾" : "▸"} Engine breakdown ({stage.result.sources.length} passes)
                </button>
                {showBreakdown && (
                  <div style={styles.breakdown}>
                    {stage.result.sources.map((s, i) => (
                      <div key={i} style={styles.breakdownRow}>
                        <span style={styles.breakdownEngine}>{s.engine}</span>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>{s.words} words</span>
                        <div style={{ flex: 1, height: 4, background: "#1e2533", borderRadius: 2, marginLeft: 10 }}>
                          <div style={{ height: 4, width: `${s.avg_conf}%`, background: "#818cf8", borderRadius: 2 }} />
                        </div>
                        <span style={{ color: "#818cf8", fontSize: 12, fontWeight: 600, minWidth: 40, textAlign: "right" }}>{s.avg_conf}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {stage.type === "error" && (
          <div style={styles.errorCard}>
            <strong style={{ color: "#fca5a5" }}>Extraction failed</strong>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>{stage.message}</p>
          </div>
        )}

        {/* ── Empty ── */}
        {!imageSrc && stage.type === "idle" && (
          <div style={styles.empty}>
            <p style={{ color: "#475569", fontSize: 15 }}>Upload an image to begin unified OCR extraction</p>
            <p style={{ color: "#334155", fontSize: 13, marginTop: 8 }}>
              Both engines run in parallel — their outputs are merged into a single high-accuracy result
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Small components ──

function Pill({ label, color, bold }: { label: string; color: string; bold?: boolean }) {
  return (
    <span style={{ background: `${color}18`, color, border: `1px solid ${color}33`, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: bold ? 700 : 500, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
function Plus() { return <span style={{ color: "#475569", fontSize: 13 }}>+</span>; }
function Arrow() { return <span style={{ color: "#475569", fontSize: 13 }}>→</span>; }

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite", marginRight: 8 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

function Step({ done, active, label, color }: { done: boolean; active: boolean; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 110 }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: done ? color : active ? `${color}33` : "#1e2533",
        border: `2px solid ${done || active ? color : "#2d3748"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.3s",
      }}>
        {done ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : active ? <Spinner /> : null}
      </div>
      <span style={{ fontSize: 11, color: done || active ? color : "#475569", textAlign: "center" }}>{label}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "10px 0" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? "#f59e0b" : "#f1f5f9" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0c1118", color: "#e2e8f0", fontFamily: "'Inter', -apple-system, sans-serif" },
  header: { background: "#111827", borderBottom: "1px solid #1f2937", padding: "16px 28px", display: "flex", alignItems: "center", gap: 14 },
  logo: { width: 38, height: 38, background: "linear-gradient(135deg,#818cf8,#6366f1)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.3px" },
  subtitle: { margin: 0, fontSize: 12, color: "#4b5563" },
  pills: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  main: { maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 20 },
  dropzone: { border: "2px dashed #2d3748", borderRadius: 16, padding: 28, textAlign: "center", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 180 },
  uploadIcon: { marginBottom: 12 },
  uploadLabel: { fontSize: 15, color: "#94a3b8", margin: 0 },
  uploadMeta: { fontSize: 12, color: "#374151", marginTop: 6 },
  preview: { maxHeight: 260, maxWidth: "100%", borderRadius: 10, objectFit: "contain" },
  actionRow: { display: "flex", gap: 10, justifyContent: "flex-end" },
  btnPrimary: { display: "flex", alignItems: "center", background: "linear-gradient(135deg,#6366f1,#818cf8)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s" },
  btnSecondary: { background: "transparent", color: "#64748b", border: "1px solid #1f2937", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer" },
  steps: { display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0, padding: "8px 0" },
  stepLine: { flex: 1, height: 2, background: "#1f2937", marginTop: 14 },
  resultCard: { background: "#111827", border: "1px solid #1f2937", borderRadius: 16, overflow: "hidden" },
  resultHeader: { padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "space-between" },
  successDot: { width: 8, height: 8, borderRadius: "50%", background: "#34d399" },
  engineBadge: { fontSize: 11, background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b33", borderRadius: 20, padding: "2px 8px" },
  copyBtn: { background: "transparent", border: "1px solid #1f2937", borderRadius: 8, color: "#94a3b8", cursor: "pointer", padding: "5px 12px", fontSize: 12 },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, borderBottom: "1px solid #1f2937" },
  confBarWrap: { padding: "14px 20px", borderBottom: "1px solid #1f2937" },
  confBarBg: { height: 6, background: "#1e2533", borderRadius: 3, overflow: "hidden" },
  confBarFill: { height: "100%", borderRadius: 3, transition: "width 0.8s ease" },
  textOutput: { margin: 0, padding: "18px 20px", whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 13, lineHeight: 1.7, color: "#cbd5e1", maxHeight: 360, overflowY: "auto", borderBottom: "1px solid #1f2937" },
  breakdownToggle: { background: "transparent", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 12, padding: "12px 20px", width: "100%", textAlign: "left" },
  breakdown: { padding: "0 20px 16px" },
  breakdownRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  breakdownEngine: { fontSize: 11, color: "#64748b", minWidth: 200 },
  errorCard: { background: "#1c1117", border: "1px solid #7f1d1d", borderRadius: 12, padding: 20 },
  empty: { textAlign: "center", padding: "32px 0" },
};
