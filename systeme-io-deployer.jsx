import { useState, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// FIX #4: RANKFLOWHUB_URLS is now the single source of truth.
//         ReferenceTab reads from here — no duplicate local array.
// ═══════════════════════════════════════════════════════════════════
const RANKFLOWHUB_URLS = [
  { label: "Opt-in / Lead Funnel",        url: "https://nicholasmarimba.systeme.io/start" },
  { label: "AI SEO Mastery System $197",  url: "https://nicholasmarimba.systeme.io/ai-seo-mastery" },
  { label: "AI Operator System $97",      url: "https://nicholasmarimba.systeme.io/ai-operator-system" },
  { label: "AI Operator Insider $47/mo",  url: "https://nicholasmarimba.systeme.io/ai-operator-insider" },
  { label: "Thank-you / Tripwire page",   url: "https://nicholasmarimba.systeme.io/thank-you" },
];

// FIX #1: Removed "<head" and "</head>" — they matched <header> body tags.
//         Block-level regex in stripForbiddenTags() handles <head>...</head> safely.
//         Removed "<title" / "</title>" — also handled by block regex below.
//         Removed "<footer" / "</footer>" — <footer> is valid body HTML content.
const FORBIDDEN_TAGS_SIMPLE = [
  "<!DOCTYPE html>",
  "<!doctype html>",
  "<html",
  "</html>",
  "<body",
  "</body>",
  "<meta ",
  "<meta>",
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

// FIX #1 (continued): stripForbiddenTags now only uses safe simple-tag list.
//                     Block-level regexes handle head/title precisely.
function stripForbiddenTags(html) {
  let result = html;
  // Pass 1 — strip safe simple outer wrapper tags
  FORBIDDEN_TAGS_SIMPLE.forEach((tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped + "[^>]*>?", "gi");
    result = result.replace(regex, "");
  });
  // Pass 2 — block-level removals (safe: match exact tags, not prefixes)
  result = result.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/gi, "");  // entire <head> block
  result = result.replace(/<title(\s[^>]*)?>[\s\S]*?<\/title>/gi, ""); // entire <title> block
  result = result.replace(/<meta[^>]*\/?>/gi, "");                      // self-closing <meta>
  return result.trim();
}

// FIX: All three extraction functions now receive rawHtml (pre-strip),
//      so stripping can never corrupt what we're trying to extract.
function extractJsonLd(html) {
  const matches = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[0]);
  }
  return matches.join("\n\n");
}

// FIX #8: validateJsonLd — parses the inner JSON and returns an error string or null.
function validateJsonLd(jsonLdBlock) {
  if (!jsonLdBlock.trim()) return null;
  const innerMatch = jsonLdBlock.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  if (!innerMatch) return null;
  try {
    JSON.parse(innerMatch[1].trim());
    return null; // valid
  } catch (e) {
    return `JSON-LD schema is malformed (${e.message}). Validate at schema.org/validator before deploying.`;
  }
}

function extractStyles(html) {
  const matches = [];
  const regex = /<style[\s\S]*?<\/style>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[0]);
  }
  return matches.join("\n\n");
}

// FIX #3: Non-JSON-LD <script> tags are now removed and flagged, not silently passed.
//         Returns { body, scriptStripped } so caller can badge a warning.
function extractBodyContent(html) {
  let result = html;
  // Remove JSON-LD scripts
  result = result.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
  // Remove <style> blocks
  result = result.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Detect and remove all other <script> tags (systeme.io blocks them)
  const scriptCount = (result.match(/<script[\s\S]*?<\/script>/gi) || []).length;
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "");
  return { body: result.trim(), scriptStripped: scriptCount };
}

// FIX #7: Detect external <link rel="stylesheet"> references.
function detectExternalStylesheets(html) {
  return (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).length;
}

function detectPlaceholderUrls(html) {
  const patterns = [
    /href=["']#["']/gi,
    /href=["']\[.*?\]["']/gi,
    /\[CHECKOUT_URL\]/gi,
    /\[REDIRECT_URL\]/gi,
    /YOUR_URL_HERE/gi,
    /example\.com/gi,
    /placeholder/gi,
  ];
  const found = [];
  patterns.forEach((p) => {
    const matches = html.match(p);
    if (matches) found.push(...matches);
  });
  return [...new Set(found)];
}

// FIX: detectRawForms now runs on rawHtml (original input) for maximum reliability.
function detectRawForms(html) {
  return /<form[\s\S]*?>/gi.test(html);
}

// FIX #2: copyToClipboard now has a .catch() handler.
//         On failure it sets copied to "fail-{key}" so callers can show an error state.
//         Falls back to execCommand for iframe/HTTP contexts.
function copyToClipboard(text, setCopied, key) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => {
        // Fallback for iframes / HTTP contexts
        fallbackCopy(text, setCopied, key);
      });
  } else {
    fallbackCopy(text, setCopied, key);
  }
}

function fallbackCopy(text, setCopied, key) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied(null), 2200);
    } else {
      setCopied("fail-" + key);
      setTimeout(() => setCopied(null), 3000);
    }
  } catch {
    setCopied("fail-" + key);
    setTimeout(() => setCopied(null), 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════
// LAYER CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════
function LayerCard({ number, title, destination, content, accent, copiedKey, onCopy }) {
  const isEmpty = !content || content.trim() === "";
  const isFail  = copiedKey && copiedKey.startsWith("fail-");
  const isCopied = copiedKey && !isFail;

  // FIX #13: Body auto-split — if content > 8000 chars offer split halves.
  const splitPoint = (() => {
    if (!content || content.length <= 8000) return -1;
    // Find a clean tag boundary near the midpoint
    const mid = Math.floor(content.length / 2);
    const closeTag = content.lastIndexOf(">", mid);
    return closeTag > 0 ? closeTag + 1 : mid;
  })();

  const [showSplit, setShowSplit] = useState(false);

  return (
    <div style={{
      background: "#0d1a2e",
      border: `1px solid ${accent}33`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 10,
      marginBottom: 16,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: isEmpty ? "none" : `1px solid ${accent}22`,
        flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            background: accent, color: "#0a0f1e",
            fontFamily: "monospace", fontWeight: 900, fontSize: 12,
            padding: "2px 8px", borderRadius: 4,
          }}>LAYER {number}</span>
          <span style={{ color: "#e8dcc8", fontWeight: 600, fontSize: 14 }}>{title}</span>
        </div>
        {!isEmpty && (
          <div style={{ display: "flex", gap: 8 }}>
            {/* FIX #13: Split button appears when body is large */}
            {number === 3 && splitPoint > 0 && (
              <button
                onClick={() => setShowSplit(s => !s)}
                style={{
                  background: showSplit ? "#7a9af522" : "transparent",
                  border: `1px solid ${showSplit ? "#7a9af5" : "#334466"}`,
                  color: showSplit ? "#7a9af5" : "#556688",
                  padding: "5px 12px", borderRadius: 6,
                  cursor: "pointer", fontSize: 11, fontWeight: 700,
                }}>
                {showSplit ? "▲ HIDE SPLIT" : "✂ SPLIT BODY"}
              </button>
            )}
            {/* FIX #2: shows fail state */}
            <button
              onClick={onCopy}
              style={{
                background: isFail ? "#2a080822" : isCopied ? "#00e5cc22" : `${accent}22`,
                border: `1px solid ${isFail ? "#ff4444" : isCopied ? "#00e5cc" : accent}`,
                color: isFail ? "#ff6666" : isCopied ? "#00e5cc" : accent,
                padding: "5px 14px", borderRadius: 6, cursor: "pointer",
                fontSize: 12, fontWeight: 700, transition: "all 0.2s", letterSpacing: 0.5,
              }}>
              {isFail ? "✗ COPY FAILED — SELECT MANUALLY" : isCopied ? "✓ COPIED" : "COPY"}
            </button>
          </div>
        )}
      </div>

      {/* Destination hint */}
      <div style={{ padding: "10px 16px", fontSize: 12, color: "#7a8fa6" }}>
        📌 Paste to: <span style={{ color: accent, fontWeight: 600 }}>{destination}</span>
      </div>

      {isEmpty ? (
        <div style={{ padding: "12px 16px 16px", color: "#445566", fontStyle: "italic", fontSize: 13 }}>
          No content detected for this layer.
        </div>
      ) : showSplit && splitPoint > 0 ? (
        /* FIX #13: Split view */
        <SplitView content={content} splitPoint={splitPoint} accent={accent} />
      ) : (
        <pre style={{
          margin: 0, padding: "12px 16px 16px",
          background: "#060d18", color: "#8fc9e8",
          fontSize: 12, overflowX: "auto", maxHeight: 220, overflowY: "auto",
          fontFamily: "'Courier New', monospace", lineHeight: 1.6,
          borderTop: `1px solid ${accent}11`,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {content.length > 3000
            ? content.slice(0, 3000) + `\n\n... [${content.length} chars total — full content copied]`
            : content}
        </pre>
      )}
    </div>
  );
}

// FIX #13: SplitView — shows Layer 3a and 3b with individual copy buttons.
function SplitView({ content, splitPoint, accent }) {
  const [copied, setCopied] = useState(null);
  const partA = content.slice(0, splitPoint);
  const partB = content.slice(splitPoint);
  return (
    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[{ label: "Raw HTML #2 — First Half", part: partA, key: "a" },
        { label: "Raw HTML #3 — Second Half", part: partB, key: "b" }].map(({ label, part, key }) => (
        <div key={key} style={{
          background: "#060d18", border: `1px solid ${accent}22`, borderRadius: 8, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 12px", borderBottom: `1px solid ${accent}11`,
          }}>
            <span style={{ color: accent, fontSize: 12, fontWeight: 700 }}>{label}</span>
            <button
              onClick={() => copyToClipboard(part, setCopied, key)}
              style={{
                background: copied === key ? "#00e5cc22" : `${accent}22`,
                border: `1px solid ${copied === key ? "#00e5cc" : accent}`,
                color: copied === key ? "#00e5cc" : accent,
                padding: "3px 10px", borderRadius: 5, cursor: "pointer",
                fontSize: 11, fontWeight: 700,
              }}>
              {copied === key ? "✓ COPIED" : "COPY"}
            </button>
          </div>
          <pre style={{
            margin: 0, padding: "10px 12px",
            color: "#8fc9e8", fontSize: 11, maxHeight: 160, overflowY: "auto",
            fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {part.length > 2000 ? part.slice(0, 2000) + `\n... [${part.length} chars total]` : part}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BADGE COMPONENT
// FIX #11: Added fallback — colors[type] ?? colors.warning prevents crash.
// ═══════════════════════════════════════════════════════════════════
function Badge({ type, children }) {
  const colors = {
    error:   { bg: "#2a0a0a", border: "#ff4444", text: "#ff6666", icon: "✗" },
    warning: { bg: "#1a1400", border: "#c9a84c", text: "#e8c76a", icon: "⚠" },
    ok:      { bg: "#0a1a0a", border: "#00c96e", text: "#00e87e", icon: "✓" },
  };
  const c = colors[type] ?? colors.warning; // FIX #11
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 7, padding: "8px 12px",
      display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8,
    }}>
      <span style={{ color: c.text, fontWeight: 900, fontSize: 14, marginTop: 1 }}>{c.icon}</span>
      <span style={{ color: c.text, fontSize: 13, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// FIX #6: checklistState lifted here so it survives tab switching.
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [rawHtml, setRawHtml]       = useState("");
  const [pageType, setPageType]     = useState("non-optin");
  const [processed, setProcessed]   = useState(null);
  const [copied, setCopied]         = useState(null);
  const [tab, setTab]               = useState("processor");
  const [checklistState, setChecklistState] = useState({}); // FIX #6
  const [dropHovered, setDropHovered] = useState(false);    // FIX #10
  const fileRef = useRef();

  // FIX #9: handleFile validates .html/.htm extension before reading.
  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.match(/\.html?$/i)) {
      alert("HTML files only (.html or .htm). Please select a valid file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setRawHtml(ev.target.result);
    reader.readAsText(file);
  }, []);

  // FIX #9 + #10: handleDrop validates file type and uses state for hover.
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDropHovered(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleInputFile = useCallback((e) => {
    handleFile(e.target.files[0]);
  }, [handleFile]);

  // FIX #12: processHtml wrapped in useCallback with correct deps.
  const processHtml = useCallback(() => {
    if (!rawHtml.trim()) return;

    // FIX: All extractions run on rawHtml BEFORE stripping.
    const jsonLd   = extractJsonLd(rawHtml);
    const styles   = extractStyles(rawHtml);
    const stripped = stripForbiddenTags(rawHtml);
    // FIX #3: extractBodyContent now strips non-JSON-LD scripts and reports count.
    const { body, scriptStripped } = extractBodyContent(stripped);

    const warnings = [];
    const errors   = [];

    // Post-strip validation — check nothing forbidden survived
    FORBIDDEN_TAGS_SIMPLE.forEach((tag) => {
      if (stripped.toLowerCase().includes(tag.toLowerCase())) {
        errors.push(`Forbidden tag still present after stripping: ${tag}`);
      }
    });

    // FIX #8: validate JSON-LD
    const jsonLdError = validateJsonLd(jsonLd);
    if (jsonLdError) errors.push(jsonLdError);

    // FIX #3: warn if inline scripts were stripped
    if (scriptStripped > 0) {
      warnings.push(
        `${scriptStripped} inline <script> tag${scriptStripped > 1 ? "s" : ""} removed from body — systeme.io blocks JavaScript in Raw HTML blocks.`
      );
    }

    // FIX #7: detect external stylesheet links
    const extSheets = detectExternalStylesheets(rawHtml);
    if (extSheets > 0) {
      errors.push(
        `${extSheets} external <link rel="stylesheet"> tag${extSheets > 1 ? "s" : ""} detected. These will break silently in systeme.io. Inline all CSS into a <style> block before deploying.`
      );
    }

    // Placeholder URL check (run on rawHtml for full coverage)
    const placeholders = detectPlaceholderUrls(rawHtml);
    if (placeholders.length) {
      warnings.push(
        `Placeholder URLs found — replace before pasting: ${placeholders.slice(0, 4).join(", ")}`
      );
    }

    // FIX: Raw form detection runs on rawHtml for maximum reliability
    if (detectRawForms(rawHtml) && pageType === "optin") {
      errors.push("Raw <form> tag detected on an opt-in page. Remove it — use systeme.io's native Form element instead.");
    } else if (detectRawForms(rawHtml)) {
      warnings.push("Raw <form> tag detected. If this is an opt-in page, switch to the native systeme.io Form element.");
    }

    if (!styles.trim()) {
      warnings.push("No <style> block found. If your design needs CSS, ensure it was included in the original file.");
    }

    if (body.length > 8000) {
      warnings.push(
        `Body content is large (${body.length.toLocaleString()} chars). Use the ✂ SPLIT BODY button on Layer 3 to auto-split across Raw HTML #2 and #3.`
      );
    }

    setProcessed({ jsonLd, styles, body, warnings, errors, charCount: rawHtml.length });
  }, [rawHtml, pageType]);

  const reset = useCallback(() => {
    setRawHtml("");
    setProcessed(null);
    setCopied(null);
  }, []);

  // ── DEPLOYMENT STEPS ──
  const deploySteps = {
    "optin": [
      "1. Copy Layer 1 → Page Settings → Header Code",
      "2. Add Raw HTML element #1 → paste Layer 2 (CSS)",
      "3. Add Raw HTML element #2 → paste above-form HTML from Layer 3",
      "4. ⚠️  Drag systeme.io native Form element onto canvas",
      "5. Add Raw HTML element #3 → paste below-form HTML from Layer 3",
      "6. Save → Publish → Open live URL to verify",
    ],
    // FIX #5: Blog post gets its own correct deployment steps
    "blog": [
      "1. Copy Layer 1 → Blog Post Settings → Header Code",
      "2. Go to Sites → Blogs → Blog Layout → add Raw HTML element → paste Layer 2 (CSS) once — it applies to all posts",
      "3. In your individual post editor: add Raw HTML element → paste Layer 3 (body HTML)",
      "4. If Layer 3 is large: use ✂ SPLIT BODY and paste into Raw HTML #1 and #2 in the post editor",
      "5. Fill all 6 SEO fields per post: Title, Description, Keywords, Author = Marimba Imaana, OG image, Visibility",
      "6. Save → Publish → Open live post URL to verify (not Preview)",
    ],
    "non-optin": [
      "1. Copy Layer 1 → Page Settings → Header Code",
      "2. Add Raw HTML element #1 → paste Layer 2 (CSS)",
      "3. Add Raw HTML element #2 → paste Layer 3 (body HTML)",
      "4. If Layer 3 is large: use ✂ SPLIT BODY and paste #2 and #3 separately",
      "5. Save → Publish → Open LIVE URL (not Preview) to verify",
    ],
  };

  const steps = deploySteps[pageType] || deploySteps["non-optin"];

  // ── RENDER ──
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #050d1a 0%, #0a1628 50%, #030810 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#c8d8e8",
      padding: "0 0 60px",
    }}>

      {/* HEADER */}
      <div style={{
        background: "linear-gradient(90deg, #0f1b35 0%, #0d1f40 100%)",
        borderBottom: "1px solid #c9a84c44",
        padding: "20px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #c9a84c, #00e5cc)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>⚡</div>
            <span style={{ color: "#c9a84c", fontWeight: 900, fontSize: 20, letterSpacing: 1 }}>RankflowHub</span>
            <span style={{ color: "#445566", fontSize: 14 }}>›</span>
            <span style={{ color: "#7a9ab5", fontSize: 14 }}>systeme.io Deployer</span>
          </div>
          <div style={{ color: "#445566", fontSize: 12, paddingLeft: 42 }}>
            3-Layer deployment assistant · Strips forbidden tags · Validates before you paste
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["processor", "checklist", "reference"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? "#c9a84c22" : "transparent",
              border: `1px solid ${tab === t ? "#c9a84c" : "#1e3050"}`,
              color: tab === t ? "#c9a84c" : "#5577aa",
              padding: "6px 14px", borderRadius: 6, cursor: "pointer",
              fontSize: 12, fontWeight: 600, textTransform: "capitalize", transition: "all 0.2s",
            }}>
              {t === "processor" ? "🔧 Processor" : t === "checklist" ? "✓ Checklist" : "📋 Reference"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px 0" }}>

        {/* ── PROCESSOR TAB ── */}
        {tab === "processor" && (
          <>
            {/* Page Type Selector */}
            <div style={{
              background: "#0d1a2e", border: "1px solid #1e3050", borderRadius: 10,
              padding: "16px 20px", marginBottom: 20,
              display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
            }}>
              <span style={{ color: "#7a9ab5", fontSize: 13, fontWeight: 600 }}>PAGE TYPE:</span>
              {[
                { val: "non-optin", label: "Non Opt-in (Sales / Thank-you / Upsell)", icon: "💳" },
                { val: "optin",     label: "Opt-in Page",                              icon: "📧" },
                // FIX #5: Blog type now has its own deploy instructions
                { val: "blog",      label: "Blog Post",                                icon: "📝" },
              ].map(({ val, label, icon }) => (
                <label key={val} style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "6px 14px", borderRadius: 6,
                  border: `1px solid ${pageType === val ? "#00e5cc" : "#1e3050"}`,
                  background: pageType === val ? "#00e5cc11" : "transparent",
                  color: pageType === val ? "#00e5cc" : "#5577aa",
                  fontSize: 13, fontWeight: 600, transition: "all 0.2s",
                }}>
                  <input type="radio" name="pageType" value={val}
                    checked={pageType === val} onChange={() => setPageType(val)}
                    style={{ display: "none" }} />
                  {icon} {label}
                </label>
              ))}
            </div>

            {!processed ? (
              <>
                {/* FIX #10: Drop zone uses state for hover, not inline style mutation */}
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDropHovered(true); }}
                  onDragLeave={() => setDropHovered(false)}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dropHovered ? "#c9a84c" : "#1e3a5f"}`,
                    borderRadius: 12, padding: "32px 24px",
                    textAlign: "center", cursor: "pointer", marginBottom: 16,
                    background: dropHovered ? "#0d1a0a" : "#060d18",
                    transition: "border-color 0.2s, background 0.2s",
                  }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
                  <div style={{ color: "#c9a84c", fontWeight: 700, marginBottom: 6 }}>Drop your HTML file here</div>
                  <div style={{ color: "#445566", fontSize: 13 }}>or click to browse · .html / .htm files only</div>
                  {/* FIX #9: accept attribute already present; validation added in handler */}
                  <input ref={fileRef} type="file" accept=".html,.htm" onChange={handleInputFile} style={{ display: "none" }} />
                </div>

                <div style={{ textAlign: "center", color: "#334455", marginBottom: 14, fontSize: 12, letterSpacing: 1 }}>
                  — OR PASTE HTML BELOW —
                </div>

                <textarea
                  value={rawHtml}
                  onChange={(e) => setRawHtml(e.target.value)}
                  placeholder="Paste your full HTML file here (including DOCTYPE, html, head, body — this tool strips them)..."
                  style={{
                    width: "100%", height: 200,
                    background: "#060d18", border: "1px solid #1e3050", borderRadius: 10,
                    color: "#7ab8d4", padding: 16, fontSize: 12,
                    fontFamily: "'Courier New', monospace", resize: "vertical",
                    boxSizing: "border-box", outline: "none",
                  }}
                />

                <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                  <button
                    onClick={processHtml}
                    disabled={!rawHtml.trim()}
                    style={{
                      flex: 1,
                      background: rawHtml.trim() ? "linear-gradient(90deg, #c9a84c, #e8c76a)" : "#1e2a3a",
                      color: rawHtml.trim() ? "#0a0f1e" : "#334455",
                      border: "none", borderRadius: 8, padding: "14px 0",
                      fontSize: 15, fontWeight: 900,
                      cursor: rawHtml.trim() ? "pointer" : "not-allowed",
                      letterSpacing: 1, transition: "all 0.2s",
                    }}>
                    ⚡ PROCESS & SPLIT INTO 3 LAYERS
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Validation Report */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 13, letterSpacing: 1, marginBottom: 10 }}>
                    VALIDATION REPORT
                  </div>
                  {processed.errors.length === 0 && processed.warnings.length === 0
                    ? <Badge type="ok">All checks passed — file is safe to paste into systeme.io.</Badge>
                    : null}
                  {processed.errors.map((e, i) => <Badge key={i} type="error">{e}</Badge>)}
                  {processed.warnings.map((w, i) => <Badge key={i} type="warning">{w}</Badge>)}
                  {pageType === "optin" && (
                    <Badge type="warning">
                      Opt-in page: After pasting layers below, you MUST add systeme.io's native Form element between Raw HTML #2 and Raw HTML #3. Raw HTML forms do not capture leads.
                    </Badge>
                  )}
                  <div style={{ color: "#445566", fontSize: 12, marginTop: 8 }}>
                    Original: {processed.charCount.toLocaleString()} chars → stripped & split into 3 layers
                  </div>
                </div>

                {/* 3 Layers */}
                <LayerCard
                  number={1}
                  title="JSON-LD Schema"
                  destination={pageType === "blog"
                    ? "Blog Post Settings → Header Code field"
                    : "Page editor → Settings (gear) → Tracking → Header Code field"}
                  content={processed.jsonLd}
                  accent="#c9a84c"
                  copiedKey={copied === "jsonld" ? "jsonld" : copied?.startsWith("fail-jsonld") ? copied : null}
                  onCopy={() => copyToClipboard(processed.jsonLd, setCopied, "jsonld")}
                />
                <LayerCard
                  number={2}
                  title="CSS Styles"
                  destination={pageType === "blog"
                    ? "Sites → Blogs → Blog Layout → Raw HTML element → Edit Code (applies to all posts)"
                    : "Raw HTML Element #1 (top of canvas) → Edit Code → paste"}
                  content={processed.styles}
                  accent="#00e5cc"
                  copiedKey={copied === "styles" ? "styles" : copied?.startsWith("fail-styles") ? copied : null}
                  onCopy={() => copyToClipboard(processed.styles, setCopied, "styles")}
                />
                <LayerCard
                  number={3}
                  title="Body HTML Content"
                  destination={pageType === "blog"
                    ? "Post editor → Raw HTML element → Edit Code"
                    : "Raw HTML Element #2 (and #3 if large) → Edit Code → paste"}
                  content={processed.body}
                  accent="#7a9af5"
                  copiedKey={copied === "body" ? "body" : copied?.startsWith("fail-body") ? copied : null}
                  onCopy={() => copyToClipboard(processed.body, setCopied, "body")}
                />

                {/* Deployment Order — FIX #5: blog shows correct steps */}
                <div style={{
                  background: "#0d1a2e", border: "1px solid #1e3050", borderRadius: 10,
                  padding: "16px 20px", marginBottom: 20,
                }}>
                  <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 13, letterSpacing: 1, marginBottom: 12 }}>
                    DEPLOYMENT ORDER — {pageType === "blog" ? "BLOG POST" : pageType === "optin" ? "OPT-IN PAGE" : "FUNNEL PAGE"}
                  </div>
                  {steps.map((s, i) => (
                    <div key={i} style={{
                      color: s.startsWith("4. ⚠️") ? "#f0a030" : "#7a9ab5",
                      fontSize: 13, marginBottom: 6, paddingLeft: 12, lineHeight: 1.5,
                    }}>{s}</div>
                  ))}
                </div>

                <button onClick={reset} style={{
                  background: "transparent", border: "1px solid #1e3050",
                  color: "#5577aa", padding: "10px 24px", borderRadius: 7,
                  cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>← Process Another File</button>
              </>
            )}
          </>
        )}

        {/* ── CHECKLIST TAB — FIX #6: receives lifted state ── */}
        {tab === "checklist" && (
          <ChecklistTab checks={checklistState} setChecks={setChecklistState} />
        )}

        {/* ── REFERENCE TAB ── */}
        {tab === "reference" && <ReferenceTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHECKLIST TAB
// FIX #6: State is now passed as props from App — survives tab switching.
// FIX #14: Persists to localStorage so a page refresh doesn't reset it.
// ═══════════════════════════════════════════════════════════════════
const CHECKLIST_ITEMS = [
  { id: "strip",   label: "Strip DOCTYPE, html, head, body tags",                        critical: true  },
  { id: "meta",    label: "Remove all <meta> and <title> tags",                          critical: true  },
  { id: "urls",    label: "Replace ALL placeholder URLs (href='#', [CHECKOUT_URL])",     critical: true  },
  { id: "noform",  label: "No raw <form> tags on opt-in pages",                          critical: true  },
  { id: "scripts", label: "No inline <script> tags in body layers",                      critical: true  },
  { id: "extcss",  label: "No <link rel='stylesheet'> — all CSS inlined in <style>",     critical: true  },
  { id: "css",     label: "CSS in Raw HTML #1 only (not mixed with body)",               critical: false },
  { id: "jsonld",  label: "JSON-LD in Header Code field (not Raw HTML blocks)",          critical: false },
  { id: "jsonval", label: "JSON-LD passes JSON.parse validation",                        critical: false },
  { id: "seo1",    label: "SEO: Title filled",                                           critical: false },
  { id: "seo2",    label: "SEO: Description filled",                                     critical: false },
  { id: "seo3",    label: "SEO: Keywords filled",                                        critical: false },
  { id: "seo4",    label: "SEO: Author = 'Marimba Imaana'",                              critical: false },
  { id: "seo5",    label: "SEO: OG image uploaded (1200×630px)",                         critical: false },
  { id: "seo6",    label: "SEO: Hide from search engines = OFF",                         critical: false },
  { id: "publish", label: "Clicked 'Publish' (not just Save)",                           critical: true  },
  { id: "live",    label: "Verified on LIVE URL (not Preview mode)",                     critical: true  },
  { id: "mobile",  label: "Checked page on mobile device",                               critical: false },
  { id: "ga4",     label: "GA4 tag in Profile → Settings → Sales Funnels (global)",      critical: false },
];

function ChecklistTab({ checks, setChecks }) {
  // FIX #14: Load from localStorage on first render
  const initialised = useRef(false);
  if (!initialised.current) {
    try {
      const saved = localStorage.getItem("rfh_checklist");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge saved into current state without causing re-render loop
        Object.assign(checks, parsed);
      }
    } catch {}
    initialised.current = true;
  }

  const toggle = (id) => {
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] };
      // FIX #14: persist to localStorage
      try { localStorage.setItem("rfh_checklist", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const resetAll = () => {
    setChecks({});
    try { localStorage.removeItem("rfh_checklist"); } catch {}
  };

  const done = CHECKLIST_ITEMS.filter(i => checks[i.id]).length;
  const allDone = done === CHECKLIST_ITEMS.length;

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>
            Pre-Publish Checklist
          </div>
          <div style={{ color: "#445566", fontSize: 12 }}>
            State persists across tab switches and page refreshes
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={resetAll} style={{
            background: "transparent", border: "1px solid #334455",
            color: "#556677", padding: "5px 12px", borderRadius: 6,
            cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}>RESET</button>
          <div style={{
            background: "#0d1a2e", border: `1px solid ${allDone ? "#00e5cc44" : "#1e3050"}`,
            borderRadius: 8, padding: "8px 16px", textAlign: "center",
          }}>
            <div style={{ color: allDone ? "#00e5cc" : "#c9a84c", fontWeight: 900, fontSize: 22 }}>
              {done}/{CHECKLIST_ITEMS.length}
            </div>
            <div style={{ color: "#445566", fontSize: 11 }}>complete</div>
          </div>
        </div>
      </div>

      {allDone && (
        <Badge type="ok">All {CHECKLIST_ITEMS.length} checks complete — safe to publish.</Badge>
      )}

      {CHECKLIST_ITEMS.map(({ id, label, critical }) => (
        <div key={id} onClick={() => toggle(id)} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "11px 14px", borderRadius: 8, marginBottom: 8, cursor: "pointer",
          border: `1px solid ${checks[id] ? "#00e5cc33" : critical ? "#c9a84c22" : "#1e3050"}`,
          background: checks[id] ? "#00e5cc08" : "#060d18",
          transition: "all 0.15s",
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: 4, flexShrink: 0,
            border: `2px solid ${checks[id] ? "#00e5cc" : "#1e3a5f"}`,
            background: checks[id] ? "#00e5cc" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}>
            {checks[id] && <span style={{ color: "#050d1a", fontWeight: 900, fontSize: 12 }}>✓</span>}
          </div>
          <span style={{
            flex: 1, fontSize: 13, lineHeight: 1.4,
            color: checks[id] ? "#445566" : "#c8d8e8",
            textDecoration: checks[id] ? "line-through" : "none",
          }}>{label}</span>
          {critical && !checks[id] && (
            <span style={{
              background: "#2a1000", border: "1px solid #c9a84c55",
              color: "#c9a84c", fontSize: 10, padding: "2px 7px", borderRadius: 4,
              fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap",
            }}>CRITICAL</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REFERENCE TAB
// FIX #4: Reads from RANKFLOWHUB_URLS constant — no duplicate array.
// ═══════════════════════════════════════════════════════════════════
function ReferenceTab() {
  const [copied, setCopied] = useState(null);

  const rules = [
    { title: "Forbidden outer tags (auto-stripped by this tool)", items: ["<!DOCTYPE html>", "<html>", "<head>…</head> (full block)", "<body>", "</body>", "<meta>", "<title>…</title> (full block)"] },
    { title: "Opt-in page rule", items: ["NEVER use raw <form> tags", "Use systeme.io native Form element ONLY", "Raw HTML can style around it, not replace it"] },
    { title: "Raw HTML invisible in Preview", items: ["Always verify on live published URL", "Never trust the editor Preview button for Raw HTML"] },
    { title: "Blog CSS: deploy once in Blog Layout", items: ["Sites → Blogs → Blog Layout → Raw HTML → paste <style> block", "This applies to ALL posts — never paste CSS per-post"] },
    { title: "SEO: all 6 fields", items: ["Title · Description · Keywords", "Author = Marimba Imaana", "OG image (1200×630px)", "Hide from search = OFF"] },
  ];

  return (
    <div>
      <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 16, marginBottom: 18 }}>Quick Reference</div>

      <div style={{ color: "#7a9ab5", fontWeight: 700, fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>
        RANKFLOWHUB LIVE URLs
      </div>
      {/* FIX #4: Single source — RANKFLOWHUB_URLS constant */}
      {RANKFLOWHUB_URLS.map(({ label, url }) => (
        <div key={url} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#060d18", border: "1px solid #1e3050", borderRadius: 8,
          padding: "10px 14px", marginBottom: 8, gap: 12,
        }}>
          <div>
            <div style={{ color: "#c8d8e8", fontSize: 13, fontWeight: 600 }}>{label}</div>
            <div style={{ color: "#445566", fontSize: 11, fontFamily: "monospace", marginTop: 2 }}>{url}</div>
          </div>
          <button
            onClick={() => copyToClipboard(url, setCopied, url)}
            style={{
              background: copied === url ? "#00e5cc22" : "#0d1a2e",
              border: `1px solid ${copied === url ? "#00e5cc" : "#1e3050"}`,
              color: copied === url ? "#00e5cc" : "#5577aa",
              padding: "5px 12px", borderRadius: 5, cursor: "pointer",
              fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
            }}>
            {copied === url ? "✓ COPIED" : "COPY URL"}
          </button>
        </div>
      ))}

      <div style={{ height: 24 }} />
      <div style={{ color: "#7a9ab5", fontWeight: 700, fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>
        HARD RULES
      </div>
      {rules.map(({ title, items }) => (
        <div key={title} style={{
          background: "#060d18", border: "1px solid #1e3050",
          borderLeft: "3px solid #c9a84c", borderRadius: 8,
          padding: "12px 16px", marginBottom: 12,
        }}>
          <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
          {items.map((item) => (
            <div key={item} style={{ color: "#7a9ab5", fontSize: 13, marginBottom: 4, paddingLeft: 8 }}>• {item}</div>
          ))}
        </div>
      ))}

      <div style={{ height: 24 }} />
      <div style={{ color: "#7a9ab5", fontWeight: 700, fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>
        BRAND COLOURS
      </div>
      {[
        { name: "Navy",         hex: "#0f1b35" },
        { name: "Gold",         hex: "#c9a84c" },
        { name: "Quantum Cyan", hex: "#00E5CC" },
      ].map(({ name, hex }) => (
        <div key={hex} style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#060d18", border: "1px solid #1e3050",
          borderRadius: 8, padding: "10px 14px", marginBottom: 8,
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 5, background: hex, border: "1px solid #ffffff22", flexShrink: 0 }} />
          <div>
            <div style={{ color: "#c8d8e8", fontSize: 13, fontWeight: 600 }}>{name}</div>
            <div style={{ color: "#445566", fontSize: 11, fontFamily: "monospace" }}>{hex}</div>
          </div>
          <button
            onClick={() => copyToClipboard(hex, setCopied, hex)}
            style={{
              marginLeft: "auto",
              background: copied === hex ? "#00e5cc22" : "#0d1a2e",
              border: `1px solid ${copied === hex ? "#00e5cc" : "#1e3050"}`,
              color: copied === hex ? "#00e5cc" : "#5577aa",
              padding: "4px 10px", borderRadius: 5, cursor: "pointer",
              fontSize: 11, fontWeight: 700,
            }}>
            {copied === hex ? "✓" : "COPY"}
          </button>
        </div>
      ))}
    </div>
  );
}
