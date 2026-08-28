/**
 * script.js – AI SQL Assistant
 *
 * React 18 app using htm (hyperscript markup tagging) for JSX-like syntax
 * without any build step or transpiler. Loaded as a plain <script> tag.
 *
 * htm docs: https://github.com/developit/htm
 * Syntax:   html`<div class="foo">${expr}</div>`
 *           Components: html`<${MyComp} prop=${val} />`
 *           Fragments:  html`<//>`
 */

'use strict';

// ─── React + htm bindings ─────────────────────────────────────────────────────
const {
  useState,
  useEffect,
  useRef,
  useCallback,
} = React;

const { createPortal } = ReactDOM;

/** htm's `html` tag — transforms tagged template literals into React.createElement calls */
const html = htm.bind(React.createElement);

// ─── Constants ────────────────────────────────────────────────────────────────
const API_URL        = '/generate';
const CHAR_LIMIT     = 1000;
const MAX_HISTORY    = 8;
const TOAST_DURATION = 3200; // ms before a toast auto-dismisses
const COPY_RESET_MS  = 2000; // ms before the copy button resets

// ─── SQL highlight data ───────────────────────────────────────────────────────
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS', 'DISTINCT', 'INSERT', 'INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD',
  'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'INDEX', 'VIEW',
  'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'BETWEEN',
  'ASC', 'DESC', 'WITH', 'RETURNING', 'YEAR', 'MONTH', 'DATE',
  'CURRENT_DATE', 'CURRENT_TIMESTAMP',
];

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'COALESCE', 'IFNULL', 'NULLIF',
  'ROUND', 'FLOOR', 'CEIL', 'ABS', 'LENGTH', 'UPPER', 'LOWER', 'TRIM',
  'SUBSTRING', 'CONCAT', 'NOW', 'CURDATE', 'DATEADD', 'DATEDIFF',
  'CAST', 'CONVERT', 'ISNULL',
];

/** Example queries shown as quick-fill chips */
const EXAMPLES = [
  { label: 'Salary > 50k',          query: 'Show all employees with salary greater than 50000' },
  { label: 'Customers from Mumbai', query: 'Find customers from Mumbai' },
  { label: 'Orders this month',     query: 'Count total orders placed this month' },
  { label: 'Top 10 products',       query: 'Show top 10 products by sales' },
  { label: 'Students > 80',         query: 'List students who scored above 80 marks' },
  { label: 'Avg salary by dept',    query: 'Find average salary by department' },
];

// ─── Utility functions ────────────────────────────────────────────────────────

/** Escape a plain string so it is safe to inject into innerHTML. */
function escapeHtml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Syntax-highlight a SQL string and return an HTML string.
 * Applied order matters: comments → strings → numbers → functions → keywords → operators.
 */
function highlightSQL(sql) {
  let h = escapeHtml(sql);
  h = h.replace(/(--[^\n]*)/g,         '<span class="cm">$1</span>');
  h = h.replace(/('(?:[^'\\]|\\.)*')/g,'<span class="str">$1</span>');
  h = h.replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="num">$1</span>');

  const fnPat = new RegExp(`\\b(${SQL_FUNCTIONS.join('|')})\\s*(?=\\()`, 'gi');
  h = h.replace(fnPat, '<span class="fn">$1</span>');

  const kwPat = new RegExp(`\\b(${SQL_KEYWORDS.join('|')})\\b`, 'gi');
  h = h.replace(kwPat, (m) => `<span class="kw">${m.toUpperCase()}</span>`);

  return h;
}

/** Run basic structural checks on the generated SQL and return result objects. */
function validateSQL(sql) {
  const up = sql.toUpperCase();
  return [
    {
      id: 'select',
      pass: /\bSELECT\b|\bCOUNT\b|\bSUM\b|\bAVG\b|\bMAX\b|\bMIN\b/.test(up),
      label: 'Contains SELECT or aggregate',
    },
    {
      id: 'from',
      pass: /\bFROM\b/.test(up),
      label: 'Contains FROM clause',
    },
    {
      id: 'semicolon',
      pass: sql.trim().endsWith(';'),
      label: 'Ends with semicolon',
    },
    {
      id: 'uppercase',
      pass: !/select|from|where|order|group/.test(sql.replace(/'[^']*'/g, '')),
      label: 'Keywords are uppercase',
    },
  ];
}

// ─── Toast system (module-level registry, avoids prop-drilling) ───────────────
let _toastRegistry = [];

function registerToastUpdater(fn)   { _toastRegistry.push(fn); }
function unregisterToastUpdater(fn) { _toastRegistry = _toastRegistry.filter(f => f !== fn); }

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'} type
 */
function showToast(message, type = 'success') {
  const entry = { id: Date.now() + Math.random(), message, type };
  _toastRegistry.forEach(fn => fn(prev => [...prev, entry]));
}

// ─── Component: ToastItem ─────────────────────────────────────────────────────
function ToastItem({ toast, onRemove }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true),           TOAST_DURATION);
    const t2 = setTimeout(() => onRemove(toast.id), TOAST_DURATION + 350);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []); // intentionally empty — fires once on mount

  const icon = toast.type === 'success' ? '✓' : '✕';
  const cls  = `toast ${toast.type}${exiting ? ' fade-out' : ''}`;

  return html`
    <div class=${cls} role="status">
      <span class="toast-icon">${icon}</span>
      <span>${toast.message}</span>
    </div>
  `;
}

// ─── Component: ToastContainer ────────────────────────────────────────────────
/**
 * Renders toasts into a portal (#toast-root) so they always sit above the
 * rest of the UI regardless of stacking context.
 */
function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    registerToastUpdater(setToasts);
    return () => unregisterToastUpdater(setToasts);
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const portalTarget = document.getElementById('toast-root');
  if (!portalTarget) return null;

  const container = html`
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      ${toasts.map(t => html`<${ToastItem} key=${t.id} toast=${t} onRemove=${remove} />`)}
    </div>
  `;

  return createPortal(container, portalTarget);
}

// ─── Component: ValidationPanel ───────────────────────────────────────────────
function ValidationPanel({ sql }) {
  if (!sql) return null;
  const checks = validateSQL(sql);

  return html`
    <div class="validation-panel" aria-label="SQL validation results">
      ${checks.map(c => html`
        <div key=${c.id} class=${'val-item ' + (c.pass ? 'pass' : 'fail')}>
          <span class="val-icon">${c.pass ? '✓' : '✗'}</span>
          ${c.label}
        </div>
      `)}
    </div>
  `;
}

// ─── Component: OutputCard ────────────────────────────────────────────────────
function OutputCard({ sql, method, loading }) {
  const [copied, setCopied] = useState(false);

  // Reset copied state whenever the SQL changes
  useEffect(() => { setCopied(false); }, [sql]);

  const handleCopy = useCallback(async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      showToast('SQL copied to clipboard', 'success');
      setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      showToast('Copy failed — select and copy manually', 'error');
    }
  }, [sql]);

  const methodLabel = method === 'gemini' ? '✦ Gemini' : '⚙ Rule-based';
  const methodClass = method === 'gemini' ? 'ai' : 'rule';

  // ── Empty / loading placeholder ──
  if (!sql) {
    return html`
      <div class="card output-card" aria-label="Generated SQL output">
        <div class="card-header">
          <span class="card-label">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M4 6h8M4 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Generated SQL
          </span>
        </div>
        <div class="output-empty">
          ${loading
            ? html`
                <div class="spinner" style=${{ width: '24px', height: '24px', borderWidth: '2.5px' }}></div>
                <p class="empty-text" style=${{ marginTop: '12px' }}>Generating SQL…</p>
              `
            : html`
                <div class="empty-icon">🗄️</div>
                <p class="empty-text">Your SQL will appear here after generation.</p>
              `
          }
        </div>
      </div>
    `;
  }

  // ── Result state ──
  return html`
    <div class="card output-card" aria-label="Generated SQL output">
      <div class="card-header">
        <span class="card-label">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
            <path d="M4 6h8M4 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Generated SQL
        </span>
        <span class=${'method-pill ' + methodClass} aria-label="Generation method">
          ${methodLabel}
        </span>
      </div>

      <div class="sql-result" aria-live="polite">
        <div class="sql-topbar">
          <div class="sql-topbar-left">
            <div class="mac-dots" aria-hidden="true">
              <span class="dot dot-r"></span>
              <span class="dot dot-y"></span>
              <span class="dot dot-g"></span>
            </div>
            <span class="sql-lang">SQL</span>
          </div>
          <button
            class=${'btn-copy' + (copied ? ' copied' : '')}
            onClick=${handleCopy}
            aria-label="Copy SQL to clipboard"
          >
            ${copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        </div>

        <div class="sql-code">
          <code
            id="sqlOutput"
            aria-label="Generated SQL query"
            dangerouslySetInnerHTML=${{ __html: highlightSQL(sql) }}
          ></code>
        </div>

        <${ValidationPanel} sql=${sql} />
      </div>
    </div>
  `;
}

// ─── Component: Header ────────────────────────────────────────────────────────
function Header() {
  return html`
    <header class="header" role="banner">
      <div class="header-brand">
        <div class="brand-logo" aria-hidden="true">🗄️</div>
        <span class="brand-name">AI SQL Assistant</span>
      </div>
    </header>
  `;
}

// ─── Component: Hero ──────────────────────────────────────────────────────────
function Hero() {
  return html`
    <section class="hero" aria-labelledby="heroTitle">
      <h2 class="hero-title" id="heroTitle">
        Plain English to SQL,<br />
        <em>in seconds.</em>
      </h2>
      <p class="hero-sub">
        Describe any database question naturally and get a clean,
        executable SQL query instantly — powered by AI.
      </p>
      <div class="badge-row" aria-label="Feature highlights">
        <span class="badge">⚡ Instant Generation</span>
        <span class="badge">✔ Syntax Validation</span>
        <span class="badge">⎘ One-click Copy</span>
        <span class="badge">◈ Gemini + Offline</span>
      </div>
    </section>
  `;
}

// ─── Component: HistorySection ────────────────────────────────────────────────
function HistorySection({ history, onRestore }) {
  return html`
    <section class="history-section" aria-labelledby="historyTitle">
      <h3 class="section-title" id="historyTitle">
        <span aria-hidden="true">↺</span> Recent Queries
      </h3>
      ${history.length === 0
        ? html`<p class="history-empty">No queries yet. Generate your first SQL above!</p>`
        : html`
            <div class="history-list" role="list">
              ${history.map((entry, i) => html`
                <div
                  key=${i}
                  class="history-item"
                  role="listitem"
                  tabIndex="0"
                  aria-label=${'History: ' + entry.query}
                  onClick=${() => onRestore(entry)}
                  onKeyDown=${(e) => { if (e.key === 'Enter') onRestore(entry); }}
                >
                  <span class="history-query" title=${entry.query}>${entry.query}</span>
                  <span class="history-time">${entry.time}</span>
                </div>
              `)}
            </div>
          `
      }
    </section>
  `;
}

// ─── Component: Workspace ─────────────────────────────────────────────────────
/**
 * Owns all query state: the text input, the generated SQL, loading + error.
 * History updates bubble up to App via `onAddHistory`.
 * History restore is received via `restoredEntry` prop.
 */
function Workspace({ onAddHistory, restoredEntry }) {
  const [query,   setQuery]   = useState('');
  const [sql,     setSql]     = useState('');
  const [method,  setMethod]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const textareaRef = useRef(null);

  // Focus textarea on initial render
  useEffect(() => { textareaRef.current && textareaRef.current.focus(); }, []);

  // Apply a restored history entry
  useEffect(() => {
    if (!restoredEntry) return;
    setQuery(restoredEntry.query);
    setSql(restoredEntry.sql);
    setMethod(restoredEntry.method || '');
    setError('');
    if (textareaRef.current) {
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [restoredEntry]);

  const generate = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setError('Please enter a query before generating SQL.');
      return;
    }
    setError('');
    setLoading(true);
    setSql('');
    setMethod('');

    try {
      const res  = await fetch(API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: q }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `Server error (${res.status})`);
      }

      const newSql    = data.sql    || '';
      const newMethod = data.method || 'rule-based';

      setSql(newSql);
      setMethod(newMethod);
      onAddHistory({ query: q, sql: newSql, method: newMethod });
      showToast('SQL generated successfully', 'success');
    } catch (err) {
      setError(err.message || 'Failed to generate SQL. Please try again.');
      showToast('Generation failed — try again', 'error');
    } finally {
      setLoading(false);
    }
  }, [query, onAddHistory]);

  const clear = useCallback(() => {
    setQuery('');
    setSql('');
    setMethod('');
    setError('');
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
  }, [generate]);

  const len       = query.length;
  const charClass = len > 950 ? 'over' : len > 800 ? 'warn' : '';

  return html`
    <div class="workspace">

      <!-- ── Input card ── -->
      <div class="card">
        <div class="card-header">
          <span class="card-label">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M2 8h8M2 12h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Your Query
          </span>
        </div>

        <div class="textarea-wrap">
          <textarea
            ref=${textareaRef}
            id="queryInput"
            class="query-textarea"
            value=${query}
            onInput=${(e) => { setQuery(e.target.value); setError(''); }}
            onKeyDown=${handleKeyDown}
            rows="7"
            maxlength=${CHAR_LIMIT}
            placeholder=${'Describe your query in plain English…\n\ne.g. Show all employees with salary greater than 50000'}
            aria-label="Natural language SQL query input"
            autocomplete="off"
            spellcheck="true"
          ></textarea>
        </div>

        <div class=${'char-count' + (charClass ? ' ' + charClass : '')} aria-live="polite">
          ${len} / ${CHAR_LIMIT}
        </div>

        <p class="chips-label">Try an example:</p>
        <div class="chips-row" role="list" aria-label="Example queries">
          ${EXAMPLES.map(ex => html`
            <button
              key=${ex.label}
              class="chip"
              role="listitem"
              onClick=${() => {
                setQuery(ex.query);
                setError('');
                textareaRef.current && textareaRef.current.focus();
              }}
            >${ex.label}</button>
          `)}
        </div>

        <div class="btn-row">
          <button
            class="btn btn-primary"
            id="generateBtn"
            onClick=${generate}
            disabled=${loading}
            aria-label="Generate SQL from input"
            title="Generate SQL (Ctrl+Enter)"
          >
            ${loading
              ? html`<div class="spinner"></div><span>Generating…</span>`
              : html`<span aria-hidden="true">⚡</span><span>Generate SQL</span>`
            }
          </button>
          <button
            class="btn btn-ghost"
            id="clearBtn"
            onClick=${clear}
            aria-label="Clear all input and output"
          >
            Clear
          </button>
        </div>

        <p class="shortcut-hint">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to generate
        </p>

        ${error && html`
          <div class="error-banner" role="alert" aria-live="assertive">
            <span aria-hidden="true">⚠</span>
            <span>${error}</span>
          </div>
        `}
      </div>

      <!-- ── Output card ── -->
      <${OutputCard} sql=${sql} method=${method} loading=${loading} />

    </div>
  `;
}

// ─── Root: App ────────────────────────────────────────────────────────────────
function App() {
  const [history, setHistory] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('sqlHistory') || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });

  const [restoredEntry, setRestoredEntry] = useState(null);

  const addHistory = useCallback(({ query, sql, method }) => {
    setHistory(prev => {
      const entry = {
        query,
        sql,
        method,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const next = [entry, ...prev].slice(0, MAX_HISTORY);
      try { localStorage.setItem('sqlHistory', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleRestore = useCallback((entry) => {
    // Pass a new object each time so the useEffect in Workspace always fires
    setRestoredEntry({ ...entry, _ts: Date.now() });
  }, []);

  const year = (window.__APP_CONFIG__ || {}).year || new Date().getFullYear();

  return html`
    <div class="app">
      <${Header} />

      <main class="main" role="main">
        <${Hero} />
        <${Workspace} onAddHistory=${addHistory} restoredEntry=${restoredEntry} />
        <${HistorySection} history=${history} onRestore=${handleRestore} />
      </main>

      <footer class="footer" role="contentinfo">
        <span aria-hidden="true">🗄️</span>
        <span>AI SQL Assistant</span>
        <span class="footer-sep">·</span>
        <span>Built with Flask &amp; Gemini</span>
        <span class="footer-sep">·</span>
        <span>MIT © ${year}</span>
      </footer>

      <${ToastContainer} />
    </div>
  `;
}

// ─── Mount ────────────────────────────────────────────────────────────────────
const rootEl = document.getElementById('root');
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught an error", error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      return html`
        <div style=${{ padding: '20px', color: 'red', background: '#fee', margin: '20px', borderRadius: '8px', border: '1px solid red' }}>
          <h2>UI Crash Detected</h2>
          <p>Please share this error with the AI assistant so it can fix the bug:</p>
          <pre style=${{ whiteSpace: 'pre-wrap', fontSize: '12px', background: '#fff', padding: '10px' }}>${this.state.error && this.state.error.toString()}</pre>
          <pre style=${{ whiteSpace: 'pre-wrap', fontSize: '12px', background: '#fff', padding: '10px' }}>${this.state.info && this.state.info.componentStack}</pre>
        </div>
      `;
    }
    return this.props.children;
  }
}

// Render the application with ErrorBoundary
const root = ReactDOM.createRoot(document.getElementById('root'));
if (rootEl) {
  root.render(html`<${ErrorBoundary}><${App} /></${ErrorBoundary}>`);
} else {
  console.error('[AI SQL Assistant] #root element not found — cannot mount React app.');
}
