/*!
 * PDP Nano Highlighter
 * -----------------------------------------------------------------------
 * Paste-in-console bundle: turns a shopper question into highlighted,
 * explained sections of the current product page, using Chrome's on-device
 * Gemini Nano (Prompt API) as a tool-calling agent. No cloud LLM is used
 * for relevance decisions — every "which section matters and why" call is
 * made locally by Nano choosing which custom tool to invoke next.
 *
 * Load it with, e.g.:
 *   fetch('https://<your-pages-domain>/pdp-nano-highlighter.js').then(r=>r.text()).then(eval)
 *
 * Safe to paste twice — re-invoking just refocuses the existing panel.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__pdpNanoHighlighter) {
    window.__pdpNanoHighlighter.show();
    return;
  }

  /* ============================== CONFIG ============================== */

  const CFG = {
    MAX_SECTIONS: 40,
    MIN_SECTION_TEXT: 15,
    PREVIEW_LEN: 130,
    READ_LEN: 900,
    MAX_TOOL_STEPS: 14,
    MAX_JSON_RETRIES: 2,
    RELEVANCE_THRESHOLD: 0.45,
    HIGHLIGHT_COLOR: '#f5b301',
    ACCENT: '#7c3aed',
  };

  /* ========================= SECTION EXTRACTION ========================= */

  const IGNORE_ANCESTOR_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'HEADER']);
  const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,summary,dt,[role="heading"],legend,caption';

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function hasIgnoredAncestor(el) {
    let n = el;
    while (n && n !== document.body) {
      if (IGNORE_ANCESTOR_TAGS.has(n.tagName)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function collectFollowingText(headingEl, maxChars) {
    // Walk forward through siblings/descendants until the next heading-level
    // boundary or a character budget is exhausted. Returns {text, nodes}.
    const level = headingEl.tagName.match(/^H(\d)/) ? Number(headingEl.tagName[1]) : 6;
    const nodes = [headingEl];
    let text = cleanText(headingEl.textContent);
    let budget = maxChars;

    // Special case: <dt> -> pair with following <dd>s
    if (headingEl.tagName === 'DT') {
      let sib = headingEl.nextElementSibling;
      while (sib && sib.tagName === 'DD' && budget > 0) {
        const t = cleanText(sib.textContent);
        text += ' — ' + t;
        budget -= t.length;
        nodes.push(sib);
        sib = sib.nextElementSibling;
      }
      return { text, nodes };
    }

    // Special case: <summary> -> pair with the parent <details> content
    if (headingEl.tagName === 'SUMMARY' && headingEl.parentElement && headingEl.parentElement.tagName === 'DETAILS') {
      const det = headingEl.parentElement;
      const t = cleanText(det.textContent);
      return { text: t.slice(0, maxChars), nodes: [det] };
    }

    // Special case: <caption> -> whole table is the section
    if (headingEl.tagName === 'CAPTION' && headingEl.closest('table')) {
      const table = headingEl.closest('table');
      const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) => cleanText(c.textContent)).filter(Boolean).join(': ')
      ).filter(Boolean);
      return { text: (text + ' — ' + rows.join(' | ')).slice(0, maxChars), nodes: [table] };
    }

    // Generic case: walk forward sibling-by-sibling (and one level up if we
    // run out of siblings), stopping at the next same-or-higher heading.
    let container = headingEl.parentElement;
    let cursor = headingEl.nextElementSibling;
    let hops = 0;
    while (cursor && budget > 0 && hops < 60) {
      hops++;
      if (cursor.matches && cursor.matches(HEADING_SELECTOR)) {
        const cLevel = cursor.tagName.match(/^H(\d)/) ? Number(cursor.tagName[1]) : 6;
        if (cLevel <= level) break;
      }
      if (isVisible(cursor) && !hasIgnoredAncestor(cursor)) {
        const t = cleanText(cursor.textContent);
        if (t) {
          text += ' — ' + t;
          budget -= t.length;
          nodes.push(cursor);
        }
      }
      cursor = cursor.nextElementSibling;
    }
    return { text: text.slice(0, maxChars), nodes };
  }

  function scanSections() {
    const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR));
    const seenNodeSets = [];
    const sections = [];
    let idx = 0;

    for (const h of headings) {
      if (!isVisible(h) || hasIgnoredAncestor(h)) continue;
      const titleText = cleanText(h.textContent);
      if (!titleText || titleText.length > 90) continue;

      const { text, nodes } = collectFollowingText(h, CFG.READ_LEN);
      if (cleanText(text).length < CFG.MIN_SECTION_TEXT) continue;

      // Skip if this exact node set is basically a subset of a section we
      // already captured (dedupe nested headings inside the same table etc).
      const key = nodes.map((n) => domPath(n)).join('|');
      if (seenNodeSets.includes(key)) continue;
      seenNodeSets.push(key);

      sections.push({
        id: 'sec-' + idx++,
        title: titleText.slice(0, 90),
        text,
        nodes,
      });
    }

    // Prioritize richer, more specific sections if we're over budget.
    sections.sort((a, b) => b.text.length - a.text.length);
    const limited = sections.slice(0, CFG.MAX_SECTIONS);
    limited.sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));

    const byId = new Map();
    limited.forEach((s) => byId.set(s.id, s));
    return byId;
  }

  function domPath(el) {
    // Cheap structural fingerprint for dedupe purposes only.
    const parts = [];
    let n = el;
    for (let i = 0; i < 4 && n; i++) {
      parts.push(n.tagName + (n.className ? '.' + String(n.className).slice(0, 20) : ''));
      n = n.parentElement;
    }
    return parts.join('>');
  }

  /* ============================ TOOL DEFINITIONS ============================ */
  // These are the only things the model is able to do. Nano decides which
  // to call, in which order, based on the shopper's question.

  const TOOLS_SPEC = [
    {
      name: 'list_sections',
      description: 'List every visible content section detected on the current product page, with a short preview of each.',
      args: {},
    },
    {
      name: 'read_section',
      description: 'Read the fuller text content of one specific section by id, to check whether it actually supports an answer.',
      args: { id: 'string — a section id returned by list_sections' },
    },
    {
      name: 'score_relevance',
      description: 'Record how relevant one section is to the shopper question, with a short reason. Call once per section you investigated.',
      args: {
        id: 'string — the section id being scored',
        score: 'number 0.0-1.0 — how strongly this section supports the answer',
        reason: 'string — one short sentence, specific to this section\'s content',
      },
    },
    {
      name: 'highlight',
      description: 'Finish the task: highlight the sections that best answer the question and give the shopper a short final answer.',
      args: {
        ids: 'array of section ids to highlight, ordered by relevance, most relevant first',
        answer: 'string — a short (1-3 sentence) direct answer to the shopper question',
      },
    },
  ];

  function buildSystemPrompt() {
    const toolDocs = TOOLS_SPEC.map(
      (t) => `- ${t.name}(${Object.keys(t.args).join(', ')}): ${t.description}`
    ).join('\n');

    return [
      'You are a product-page assistant. You cannot see the page directly.',
      'You can only learn about it by calling tools, one at a time.',
      '',
      'Available tools:',
      toolDocs,
      '',
      'Rules:',
      '- Respond with EXACTLY ONE JSON object per turn, nothing else — no prose, no markdown fences.',
      '- Format: {"tool": "<name>", "args": {...}}',
      '- Always start by calling list_sections.',
      '- Before highlighting, read_section and score_relevance on every section that looks even possibly relevant (title or preview mentions related concepts). Do not skip straight to highlight after only reading one section.',
      '- Only score a section above 0.6 if the section text you actually read supports the answer — not just because the title sounds related.',
      '- When you have enough evidence, call highlight exactly once with the best section ids (highest scored first, usually 1-4 ids) and a short direct answer.',
      '- If truly nothing on the page answers the question, call highlight with an empty ids array and say so plainly in "answer".',
    ].join('\n');
  }

  function extractJson(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      return null;
    }
  }

  /* ============================ NANO PROVIDER ============================ */

  async function getNanoAvailability() {
    try {
      if ('LanguageModel' in self) {
        const a = await self.LanguageModel.availability();
        return normalizeAvailability(a);
      }
      if (window.ai && window.ai.languageModel) {
        const a = await window.ai.languageModel.capabilities();
        return normalizeAvailability(a.available);
      }
      return 'unsupported';
    } catch (e) {
      return 'unsupported';
    }
  }

  function normalizeAvailability(v) {
    if (v === 'available' || v === 'readily') return 'available';
    if (v === 'downloadable' || v === 'after-download') return 'downloadable';
    if (v === 'downloading') return 'downloading';
    return 'unavailable';
  }

  async function createNanoSession(systemPrompt, onProgress) {
    const monitor = (m) => {
      m.addEventListener('downloadprogress', (e) => {
        if (onProgress) onProgress(e.loaded);
      });
    };
    if ('LanguageModel' in self) {
      try {
        return await self.LanguageModel.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }],
          monitor,
        });
      } catch (e) {
        return await self.LanguageModel.create({ systemPrompt, monitor });
      }
    }
    if (window.ai && window.ai.languageModel) {
      return await window.ai.languageModel.create({ systemPrompt, monitor });
    }
    throw new Error('No Gemini Nano provider found on this browser.');
  }

  /* ============================ AGENT LOOP ============================ */

  class ToolAgent {
    constructor(session, sectionsById) {
      this.session = session;
      this.sectionsById = sectionsById;
      this.trace = []; // {tool, args, result}
    }

    listSections() {
      return Array.from(this.sectionsById.values()).map((s) => ({
        id: s.id,
        title: s.title,
        preview: s.text.slice(0, CFG.PREVIEW_LEN),
      }));
    }

    readSection(id) {
      const s = this.sectionsById.get(id);
      if (!s) return { error: `Unknown section id: ${id}` };
      return { id: s.id, title: s.title, text: s.text.slice(0, CFG.READ_LEN) };
    }

    scoreRelevance(id, score, reason) {
      const s = this.sectionsById.get(id);
      if (!s) return { error: `Unknown section id: ${id}` };
      s.score = Number(score) || 0;
      s.reason = String(reason || '').slice(0, 200);
      return { ok: true, id, recorded: s.score };
    }

    async runTool(call) {
      const { tool, args = {} } = call;
      switch (tool) {
        case 'list_sections':
          return this.listSections();
        case 'read_section':
          return this.readSection(args.id);
        case 'score_relevance':
          return this.scoreRelevance(args.id, args.score, args.reason);
        case 'highlight':
          return { done: true, ids: args.ids || [], answer: args.answer || '' };
        default:
          return { error: `Unknown tool: ${tool}` };
      }
    }

    async run(question, onStep) {
      let turnInput = `Shopper question: "${question}"\nBegin.`;
      for (let step = 0; step < CFG.MAX_TOOL_STEPS; step++) {
        let call = null;
        let retries = 0;
        let raw = '';
        while (retries <= CFG.MAX_JSON_RETRIES) {
          raw = await this.session.prompt(turnInput);
          call = extractJson(raw);
          if (call && call.tool) break;
          retries++;
          turnInput = 'Your last reply was not a single valid JSON tool call. Respond again with EXACTLY one JSON object: {"tool": "...", "args": {...}}.';
        }
        if (!call || !call.tool) {
          throw new Error('Model did not return a usable tool call after retries.');
        }

        const result = await this.runTool(call);
        this.trace.push({ tool: call.tool, args: call.args, result });
        if (onStep) onStep({ tool: call.tool, args: call.args, result });

        if (call.tool === 'highlight') {
          return result;
        }

        turnInput = `TOOL_RESULT ${call.tool}: ${JSON.stringify(result)}\nChoose the next tool call.`;
      }
      throw new Error('Reached max tool-call steps without a final highlight() call.');
    }
  }

  /* ============================ HIGHLIGHT ENGINE ============================ */

  const activeHighlights = [];

  function clearHighlights() {
    activeHighlights.forEach((h) => {
      h.el.style.outline = h.prevOutline;
      h.el.style.boxShadow = h.prevShadow;
      h.el.style.backgroundColor = h.prevBg;
      if (h.badge) h.badge.remove();
    });
    activeHighlights.length = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  let rafId = null;
  function repositionBadges() {
    activeHighlights.forEach((h) => {
      const rect = h.el.getBoundingClientRect();
      h.badge.style.top = Math.max(0, rect.top + window.scrollY - 10) + 'px';
      h.badge.style.left = Math.max(0, rect.left + window.scrollX - 10) + 'px';
    });
    rafId = requestAnimationFrame(repositionBadges);
  }

  function highlightSections(sections) {
    clearHighlights();
    sections.forEach((s, i) => {
      const target = s.nodes[0];
      if (!target) return;
      const prevOutline = target.style.outline;
      const prevShadow = target.style.boxShadow;
      const prevBg = target.style.backgroundColor;

      target.style.outline = `3px solid ${CFG.HIGHLIGHT_COLOR}`;
      target.style.boxShadow = `0 0 0 6px ${CFG.HIGHLIGHT_COLOR}33`;
      target.style.backgroundColor = target.style.backgroundColor || `${CFG.HIGHLIGHT_COLOR}14`;
      target.style.scrollMarginTop = '90px';

      const badge = document.createElement('div');
      badge.textContent = String(i + 1);
      Object.assign(badge.style, {
        position: 'absolute',
        zIndex: 2147483000,
        background: CFG.ACCENT,
        color: '#fff',
        borderRadius: '50%',
        width: '22px',
        height: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: '700',
        boxShadow: '0 2px 6px rgba(0,0,0,.35)',
        pointerEvents: 'none',
      });
      document.body.appendChild(badge);

      activeHighlights.push({ el: target, prevOutline, prevShadow, prevBg, badge });
    });

    if (sections[0] && sections[0].nodes[0]) {
      sections[0].nodes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    repositionBadges();
  }

  /* ================================ UI ================================ */

  function buildPanel() {
    const host = document.createElement('div');
    host.id = 'pdp-nano-highlighter-host';
    Object.assign(host.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 2147483647,
      width: '360px',
      maxHeight: '70vh',
    });
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 10px 40px rgba(0,0,0,.25);
          border: 1px solid #eee;
          display: flex;
          flex-direction: column;
          max-height: 70vh;
          overflow: hidden;
        }
        .head {
          background: linear-gradient(135deg, ${CFG.ACCENT}, #4c1d95);
          color: #fff;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
          font-weight: 600;
        }
        .head button {
          background: rgba(255,255,255,.15);
          border: none;
          color: #fff;
          border-radius: 6px;
          width: 24px;
          height: 24px;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
        }
        .body {
          padding: 12px 14px;
          overflow-y: auto;
          font-size: 13px;
          color: #222;
          flex: 1;
        }
        .status {
          font-size: 12px;
          color: #666;
          margin-bottom: 10px;
          padding: 8px 10px;
          background: #f6f5ff;
          border-radius: 8px;
          border: 1px solid #ece9fb;
        }
        .status.err { background: #fdecec; border-color: #f6c8c8; color: #a12222; }
        .status.warn { background: #fff8e6; border-color: #f1dfa4; color: #8a6d00; }
        .answer {
          background: #f8f8fb;
          border: 1px solid #eee;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 10px;
          line-height: 1.4;
        }
        .evidence-item {
          display: flex;
          gap: 8px;
          padding: 8px 0;
          border-top: 1px dashed #e6e6e6;
        }
        .badge-mini {
          flex: 0 0 auto;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: ${CFG.ACCENT};
          color: #fff;
          font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 700;
        }
        .ev-title { font-weight: 600; margin-bottom: 2px; }
        .ev-reason { color: #555; }
        .foot {
          padding: 10px 12px;
          border-top: 1px solid #eee;
          display: flex;
          gap: 8px;
        }
        input {
          flex: 1;
          font-size: 13px;
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 8px;
          outline: none;
        }
        input:focus { border-color: ${CFG.ACCENT}; }
        button.send {
          background: ${CFG.ACCENT};
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 0 14px;
          font-size: 13px;
          cursor: pointer;
          font-weight: 600;
        }
        button.send:disabled { opacity: .5; cursor: default; }
        .trace {
          font-size: 11px;
          color: #888;
          margin-top: 8px;
          white-space: pre-wrap;
        }
        a.link { color: ${CFG.ACCENT}; }
      </style>
      <div class="card">
        <div class="head">
          <span>🔎 PDP Highlighter · Gemini Nano</span>
          <button id="close">✕</button>
        </div>
        <div class="body" id="body">
          <div class="status" id="status">Checking on-device Gemini Nano…</div>
        </div>
        <div class="foot">
          <input id="q" placeholder="Ask about this product…" disabled />
          <button class="send" id="send" disabled>Ask</button>
        </div>
      </div>
    `;

    root.getElementById('close').addEventListener('click', () => {
      host.style.display = 'none';
    });

    return { host, root };
  }

  /* ============================== CONTROLLER ============================== */

  const state = {
    availability: null,
    session: null,
    sectionsById: null,
  };

  function setStatus(root, text, kind) {
    const el = root.getElementById('status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderEmptyBody(root) {
    root.getElementById('body').innerHTML = '<div class="status" id="status"></div>';
  }

  function renderAnswer(root, answer, scored) {
    const body = root.getElementById('body');
    const relevant = scored.filter((s) => s.included);
    const evidenceHtml = relevant
      .map(
        (s, i) => `
        <div class="evidence-item">
          <div class="badge-mini">${i + 1}</div>
          <div>
            <div class="ev-title">${escapeHtml(s.title)}</div>
            <div class="ev-reason">${escapeHtml(s.reason || 'Relevant to your question.')}</div>
          </div>
        </div>`
      )
      .join('');

    body.innerHTML = `
      <div class="status">Answered locally by on-device Gemini Nano — no cloud model used.</div>
      <div class="answer">${escapeHtml(answer)}</div>
      ${relevant.length ? evidenceHtml : '<div class="status warn">No page section clearly answers this — highlighted nothing.</div>'}
    `;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str == null ? '' : str);
    return d.innerHTML;
  }

  async function initAvailability(root) {
    const status = await getNanoAvailability();
    state.availability = status;
    const input = root.getElementById('q');
    const send = root.getElementById('send');

    if (status === 'unsupported') {
      setStatus(
        root,
        'Gemini Nano is not available in this browser. Use a recent Chrome (Desktop) with the built-in AI / Prompt API enabled, then reload this page.',
        'err'
      );
      return;
    }
    if (status === 'unavailable') {
      setStatus(root, 'Gemini Nano reports it cannot run on this device right now.', 'err');
      return;
    }

    if (status === 'downloadable' || status === 'downloading') {
      setStatus(root, 'Gemini Nano model is downloading to your device… this can take a while the first time.', 'warn');
    } else {
      setStatus(root, 'Gemini Nano is ready. Scanning the page for sections…');
    }

    try {
      state.session = await createNanoSession(buildSystemPrompt(), (loaded) => {
        setStatus(root, `Downloading Gemini Nano model… ${Math.round(loaded * 100)}%`, 'warn');
      });
    } catch (e) {
      setStatus(root, 'Could not initialize Gemini Nano: ' + e.message, 'err');
      return;
    }

    state.sectionsById = scanSections();
    if (state.sectionsById.size === 0) {
      setStatus(root, 'No readable sections were found on this page.', 'warn');
      return;
    }

    setStatus(root, `Ready. Found ${state.sectionsById.size} page sections. Ask a question below.`);
    input.disabled = false;
    send.disabled = false;
    input.focus();
  }

  async function handleAsk(root, question) {
    const input = root.getElementById('q');
    const send = root.getElementById('send');
    input.disabled = true;
    send.disabled = true;
    clearHighlights();
    renderEmptyBody(root);
    setStatus(root, 'Nano is inspecting the page (calling tools)…');

    // fresh score slate for this question
    state.sectionsById.forEach((s) => {
      s.score = undefined;
      s.reason = undefined;
    });

    const agent = new ToolAgent(state.session, state.sectionsById);
    let stepCount = 0;

    try {
      const result = await agent.run(question, () => {
        stepCount++;
        setStatus(root, `Nano is inspecting the page (calling tools)… step ${stepCount}`);
      });

      const scored = Array.from(state.sectionsById.values())
        .filter((s) => typeof s.score === 'number')
        .sort((a, b) => b.score - a.score);

      const idsFromHighlight = (result.ids || []).filter((id) => state.sectionsById.has(id));
      const finalIds = idsFromHighlight.length
        ? idsFromHighlight
        : scored.filter((s) => s.score >= CFG.RELEVANCE_THRESHOLD).map((s) => s.id);

      const finalSections = finalIds
        .map((id) => state.sectionsById.get(id))
        .filter(Boolean);

      const withFlag = Array.from(state.sectionsById.values()).map((s) => ({
        ...s,
        included: finalIds.includes(s.id),
      }));

      if (finalSections.length) {
        highlightSections(finalSections);
      }
      renderAnswer(root, result.answer || (finalSections.length ? 'See highlighted sections.' : "I couldn't find a section on this page that answers that."), withFlag);
    } catch (e) {
      renderEmptyBody(root);
      setStatus(root, 'Something went wrong while reasoning about your question: ' + e.message, 'err');
    } finally {
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  }

  /* ================================ BOOT ================================ */

  function boot() {
    const { host, root } = buildPanel();

    const input = root.getElementById('q');
    const send = root.getElementById('send');
    send.addEventListener('click', () => {
      const val = input.value.trim();
      if (val) handleAsk(root, val);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send.click();
    });

    initAvailability(root);

    window.__pdpNanoHighlighter = {
      show() {
        host.style.display = 'block';
      },
      destroy() {
        clearHighlights();
        host.remove();
        delete window.__pdpNanoHighlighter;
      },
    };
  }

  boot();
})();