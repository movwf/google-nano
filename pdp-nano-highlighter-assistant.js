/**
 * PDP Chrome Gemini Nano Highlighter Assistant
 * 
 * Paste this script directly into your browser console, or load it dynamically:
 * fetch('https://your-host.com/pdp-nano-highlighter-assistant.js')
 *   .then(r => r.text())
 *   .then(eval);
 */
(async function() {
  'use strict';

  // 1. Remove existing instance if any (allows clean hot reloading)
  const existingRoot = document.getElementById('pdp-nano-assistant-root');
  if (existingRoot) {
    existingRoot.remove();
    cleanupHighlights();
  }

  // 2. Global State
  const state = {
    active: true,
    apiStatus: 'checking', // 'checking' | 'ready' | 'error' | 'simulated'
    apiStatusReason: '',
    loading: false,
    simulate: false,
    question: '',
    dataMap: {}, // holds extracted DOM elements and structured info
    highlighted: [], // [{ id, explanation }]
    logs: [], // [{ type: 'think'|'action'|'observation', text: string, sectionId?: string }]
    finalResult: null
  };

  // 3. Setup UI Container and Shadow DOM
  const root = document.createElement('div');
  root.id = 'pdp-nano-assistant-root';
  document.body.appendChild(root);

  const shadow = root.attachShadow({ mode: 'open' });

  // Add Font stylesheet links
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap';
  shadow.appendChild(fontLink);

  // Initialize
  await initAssistant();

  // --- API Checks ---
  async function checkGeminiNano() {
    if (typeof window.ai === 'undefined') {
      return { available: false, reason: 'window.ai is not defined. Ensure you are using Chrome Dev/Canary (version 127+) and have enabled Gemini Nano flags.' };
    }
    
    const lm = window.ai.languageModel || window.ai.assistant;
    if (!lm) {
      return { available: false, reason: 'Gemini Nano Prompt API (languageModel or assistant) is missing in window.ai.' };
    }

    try {
      const capabilities = await lm.capabilities();
      if (capabilities.available === 'no') {
        return { available: false, reason: 'Gemini Nano model is not ready or downloading. Check chrome://components -> "Optimization Guide On Device Model".' };
      }
      return { available: true, capabilities };
    } catch (e) {
      return { available: false, reason: `Error checking capabilities: ${e.message}` };
    }
  }

  async function initAssistant() {
    renderUI();
    const status = await checkGeminiNano();
    if (status.available) {
      state.apiStatus = 'ready';
      state.simulate = false;
    } else {
      state.apiStatus = 'error';
      state.apiStatusReason = status.reason;
      // Auto fallback to Simulated mode to ensure smooth evaluation on any browser/configuration
      state.simulate = true;
      state.apiStatus = 'simulated';
      console.warn("Chrome Gemini Nano not detected or not ready. Falling back to Simulated Mode (Demo):", status.reason);
    }
    renderUI();
  }

  // --- DOM Extraction ---
  function extractData() {
    state.dataMap = {};
    const extractedList = [];

    // Helper to register parsed entries in map and return metadata
    function addEntry(id, type, text, element, title) {
      state.dataMap[id] = { id, type, text, element };
      extractedList.push({ id, title, snippet: text.substring(0, 100) + '...' });
    }

    // ==========================================
    // 1. BRIEF SECTION
    // ==========================================

    // Product Title (hlp) => #product-title ::innerText
    const titleEl = document.querySelector('#product-title');
    if (titleEl) {
      const id = 'brief_title';
      titleEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'brief', `Product Title: ${titleEl.innerText.trim()}`, titleEl, 'Product Title');
    }

    // Product Price (hlp) => .pdp-price ::innerText
    const priceEl = document.querySelector('.pdp-price');
    if (priceEl) {
      const id = 'brief_price';
      priceEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'brief', `Product Price: ${priceEl.innerText.trim()}`, priceEl, 'Product Price');
    }

    // Product Promotions (hlp) => .pdp-promotion-slider .swiper-slide ::foreach(innerText)
    const promoSlides = document.querySelectorAll('.pdp-promotion-slider .swiper-slide');
    promoSlides.forEach((slide, idx) => {
      const text = slide.innerText.trim();
      if (text) {
        const id = `brief_promo_${idx}`;
        slide.setAttribute('data-highlight-id', id);
        addEntry(id, 'brief', `Product Promotion ${idx + 1}: ${text}`, slide, `Product Promotion ${idx + 1}`);
      }
    });

    // Product Reviews - Rating (hlp) => #reviews-link .rating ::dataset.rating
    const ratingEl = document.querySelector('#reviews-link .rating');
    if (ratingEl) {
      const rating = ratingEl.dataset.rating || ratingEl.getAttribute('data-rating') || ratingEl.innerText.trim();
      const id = 'brief_rating';
      ratingEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'brief', `Product Rating: ${rating}`, ratingEl, 'Product Rating');
    }

    // Product Reviews - Qty (hlp) => #reviews-link .qty > span ::innerText
    const qtyEl = document.querySelector('#reviews-link .qty > span') || document.querySelector('#reviews-link .qty');
    if (qtyEl) {
      const id = 'brief_review_qty';
      qtyEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'brief', `Product Review Count: ${qtyEl.innerText.trim()}`, qtyEl, 'Product Review Qty');
    }

    // Product Showcased Features => .pdp-features (multiple) -> .item (each hlp) -> .t / .v
    const pdpFeatures = document.querySelectorAll('.pdp-features');
    pdpFeatures.forEach((featuresRoot, fIdx) => {
      const items = featuresRoot.querySelectorAll('.item');
      items.forEach((item, itemIdx) => {
        const tEl = item.querySelector('.t');
        const vEl = item.querySelector('.v');
        if (tEl && vEl) {
          const id = `brief_feature_${fIdx}_${itemIdx}`;
          item.setAttribute('data-highlight-id', id);
          const text = `${tEl.innerText.trim()}: ${vEl.innerText.trim()}`;
          addEntry(id, 'brief', `Showcased Feature [${tEl.innerText.trim()}]: ${vEl.innerText.trim()}`, item, `Showcased Feature: ${tEl.innerText.trim()}`);
        }
      });
    });

    // ==========================================
    // 2. TECHNOLOGIES
    // ==========================================
    
    // .pdp-technologies .ftc-item (each hlp) :: foreach(innerText)
    const ftcItems = document.querySelectorAll('.pdp-technologies .ftc-item');
    ftcItems.forEach((item, idx) => {
      const text = item.innerText.trim();
      if (text) {
        const id = `tech_${idx}`;
        item.setAttribute('data-highlight-id', id);
        addEntry(id, 'technologies', `Technology Card: ${text}`, item, `Technology ${idx + 1}`);
      }
    });

    // ==========================================
    // 3. DETAILED INFORMATIONS (under .pdp-tab)
    // ==========================================

    function extractAccordion(selector, parserFn) {
      const tabEl = document.querySelector(`.pdp-tab ${selector}`);
      if (tabEl) {
        const title = tabEl.dataset.atcSection || tabEl.getAttribute('data-atc-section') || selector.replace('#pdp-', '');
        const isActive = tabEl.classList.contains('active');
        parserFn(tabEl, title, isActive);
      }
    }

    // #pdp-promotions
    extractAccordion('#pdp-promotions', (tabEl, title, isActive) => {
      // .pdp-tab #pdp-promotions (hlp)
      // .pdp-tab #pdp-promotions .acc-item .act > span ::innerText
      const promoItems = tabEl.querySelectorAll('.acc-item .act > span');
      if (promoItems.length > 0) {
        promoItems.forEach((item, idx) => {
          const id = `tab_promo_${idx}`;
          item.setAttribute('data-highlight-id', id);
          addEntry(id, 'details', `Promotion [Section: ${title}, Active: ${isActive}]: ${item.innerText.trim()}`, item, `Promo Detail ${idx + 1}`);
        });
      } else {
        const id = 'tab_promotions_root';
        tabEl.setAttribute('data-highlight-id', id);
        addEntry(id, 'details', `Promotions [Section: ${title}, Active: ${isActive}]`, tabEl, 'Promotions Section');
      }
    });

    // #pdp-technical
    extractAccordion('#pdp-technical', (tabEl, title, isActive) => {
      // .pdp-tab #pdp-technical .feature-item -> .title / .item -> .t / .v
      const featureItems = tabEl.querySelectorAll('.feature-item');
      featureItems.forEach((fItem, fIdx) => {
        const subTitleEl = fItem.querySelector('.title');
        const subTitle = subTitleEl ? subTitleEl.innerText.trim() : 'Technical';

        const items = fItem.querySelectorAll('.item');
        items.forEach((item, itemIdx) => {
          const tEl = item.querySelector('.t');
          const vEl = item.querySelector('.v');
          if (tEl && vEl) {
            const id = `tab_tech_${fIdx}_${itemIdx}`;
            item.setAttribute('data-highlight-id', id);
            const text = `${subTitle} - ${tEl.innerText.trim()}: ${vEl.innerText.trim()}`;
            addEntry(id, 'details', `Technical Specification [Section: ${title}, Active: ${isActive}]: ${text}`, item, `Spec: ${tEl.innerText.trim()}`);
          }
        });
      });
      if (featureItems.length === 0) {
        const id = 'tab_technical_root';
        tabEl.setAttribute('data-highlight-id', id);
        addEntry(id, 'details', `Technical Specifications [Section: ${title}, Active: ${isActive}]`, tabEl, 'Technical Specifications Section');
      }
    });

    // #pdp-downloads
    extractAccordion('#pdp-downloads', (tabEl, title, isActive) => {
      // .pdp-tab #pdp-downloads .tab-content .item > a (each hlp) -> href / .v (Label)
      const links = tabEl.querySelectorAll('.tab-content .item > a') || tabEl.querySelectorAll('a');
      links.forEach((link, idx) => {
        const vEl = link.querySelector('.v') || link;
        const label = vEl ? vEl.innerText.trim() : 'Document Link';
        const href = link.getAttribute('href') || '#';
        const id = `tab_download_${idx}`;
        link.setAttribute('data-highlight-id', id);
        addEntry(id, 'details', `Download document [Section: ${title}, Active: ${isActive}]: ${label} (Link: ${href})`, link, `Document: ${label}`);
      });
      if (links.length === 0) {
        const id = 'tab_downloads_root';
        tabEl.setAttribute('data-highlight-id', id);
        addEntry(id, 'details', `Downloads & Documents [Section: ${title}, Active: ${isActive}]`, tabEl, 'Downloads Section');
      }
    });

    // #pdp-store-locator
    extractAccordion('#pdp-store-locator', (tabEl, title, isActive) => {
      const id = 'tab_store_locator';
      tabEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'details', `Store Locator Section [Section: ${title}, Active: ${isActive}]`, tabEl, 'Store Locator Section');
    });

    // #pdp-installments
    extractAccordion('#pdp-installments', (tabEl, title, isActive) => {
      // .pdp-tab #pdp-installments .installments-card .acc-item h4
      const methods = tabEl.querySelectorAll('.installments-card .acc-item h4') || tabEl.querySelectorAll('h4');
      const methodNames = Array.from(methods).map(m => m.innerText.trim()).filter(Boolean);
      const id = 'tab_installments';
      tabEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'details', `Installment Options [Section: ${title}, Active: ${isActive}]: ${methodNames.join(', ') || 'Various Cards Supported'}`, tabEl, 'Installments Section');
    });

    // #pdp-refund
    extractAccordion('#pdp-refund', (tabEl, title, isActive) => {
      // .pdp-tab #pdp-refund (highlighted) ::innerText
      const text = tabEl.innerText.trim();
      const id = 'tab_refund';
      tabEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'details', `Refund/Return terms [Section: ${title}, Active: ${isActive}]: ${text}`, tabEl, 'Refund Terms Section');
    });

    // #pdp-allreviews
    extractAccordion('#pdp-allreviews', (tabEl, title, isActive) => {
      const id = 'tab_allreviews';
      tabEl.setAttribute('data-highlight-id', id);
      addEntry(id, 'details', `User Reviews [Section: ${title}, Active: ${isActive}]`, tabEl, 'All Reviews Accordion');
    });

    // If no PDP classes found, inject demo PDP container for developer demonstration
    if (extractedList.length === 0) {
      console.log("No Arcelik PDP selectors detected. Injecting demo DOM elements matching exact structure.");
      injectDemoPDPElements();
      return extractData();
    }

    return extractedList;
  }

  // --- Accordion Active States Manager ---
  function ensureAccordionActive(el) {
    if (!el) return;
    
    // Find closest accordion section matching our selector targets
    const accordionRoot = el.closest('#pdp-promotions, #pdp-technical, #pdp-downloads, #pdp-store-locator, #pdp-installments, #pdp-refund, #pdp-allreviews');
    if (accordionRoot && !accordionRoot.classList.contains('active')) {
      console.log(`Expanding collapsed accordion section: ${accordionRoot.id}`);
      
      // Toggle class for our demo mockup
      if (accordionRoot.classList.contains('acc-section')) {
        accordionRoot.classList.add('active');
        const content = accordionRoot.querySelector('.acc-content');
        if (content) content.style.display = 'block';
        const indicator = accordionRoot.querySelector('.status-indicator-icon');
        if (indicator) indicator.textContent = '▲';
      } else {
        // Trigger page-native click handler
        const trigger = accordionRoot.querySelector('.acc-header, h2, h3, h4, button, a') || accordionRoot;
        trigger.click();
      }
    }
  }

  // --- Visual Highlighting ---
  function cleanupHighlights() {
    const prev = document.querySelectorAll('.pdp-nano-highlight-wrapper');
    prev.forEach(el => el.remove());

    document.querySelectorAll('[data-highlight-id]').forEach(el => {
      el.removeAttribute('data-highlight-id');
      el.style.border = '';
      el.style.boxShadow = '';
      el.style.position = '';
      el.style.borderRadius = '';
      el.style.transition = '';
    });
  }

  function toggleForHighlight(id, explanation) {
    const item = state.dataMap[id];
    if (!item) {
      return `Error: Section ID '${id}' not found in cache.`;
    }

    const existingIdx = state.highlighted.findIndex(h => h.id === id);
    if (existingIdx > -1) {
      state.highlighted[existingIdx].explanation = explanation;
    } else {
      state.highlighted.push({ id, explanation });
    }

    // Apply highlighting to DOM immediately as requested
    applyHighlightsToPage();

    return `Added '${id}' to the highlight queue with explanation: "${explanation}"`;
  }

  function applyHighlightsToPage() {
    // Clear only existing badges and inline outline styles
    const wrappers = document.querySelectorAll('.pdp-nano-highlight-wrapper');
    wrappers.forEach(el => el.remove());

    document.querySelectorAll('[data-highlight-id]').forEach(el => {
      el.style.border = '';
      el.style.boxShadow = '';
      el.style.borderRadius = '';
    });

    state.highlighted.forEach((h, index) => {
      let item = state.dataMap[h.id];
      if (item && item.element) {
        const el = item.element;
        
        // Ensure accordion is expanded
        ensureAccordionActive(el);

        const computedStyle = window.getComputedStyle(el);
        if (computedStyle.position === 'static') {
          el.style.position = 'relative';
        }

        // Apply Premium Neon Outline
        el.style.border = '3px solid #6366f1';
        el.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.6)';
        el.style.borderRadius = '8px';
        el.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

        // Create Badge
        const badge = document.createElement('div');
        badge.className = 'pdp-nano-highlight-wrapper';
        badge.style.cssText = `
          position: absolute;
          top: -14px;
          left: 14px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          color: #ffffff;
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 700;
          font-family: 'Inter', sans-serif;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          z-index: 100000;
          display: flex;
          align-items: center;
          gap: 6px;
          pointer-events: auto;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.2);
          transition: all 0.2s ease;
        `;

        badge.innerHTML = `
          <span style="background: rgba(255,255,255,0.2); width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 9px;">${index + 1}</span>
          <span>${h.explanation}</span>
        `;

        badge.addEventListener('mouseenter', () => {
          badge.style.transform = 'scale(1.05)';
          el.style.boxShadow = '0 0 30px rgba(168, 85, 247, 0.8)';
          el.style.borderColor = '#a855f7';
        });

        badge.addEventListener('mouseleave', () => {
          badge.style.transform = 'scale(1)';
          el.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.6)';
          el.style.borderColor = '#6366f1';
        });

        el.appendChild(badge);
      }
    });
  }

  function highlightAll() {
    applyHighlightsToPage();

    if (state.highlighted.length === 0) {
      return "No elements queued in state.highlighted.";
    }

    // Scroll to the first highlighted element
    const firstH = state.highlighted[0];
    let firstItem = state.dataMap[firstH.id];
    if (firstItem && firstItem.element) {
      // Ensure accordion expanded
      ensureAccordionActive(firstItem.element);
      firstItem.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return `Successfully highlighted ${state.highlighted.length} evidence section(s) on the page and scrolled to the first one.`;
  }

  // --- Summarizer API ---
  async function summarizeTechnologies() {
    const techTexts = Object.values(state.dataMap)
      .filter(item => item.type === 'technologies')
      .map(item => item.text)
      .join('\n');

    if (!techTexts) {
      return "No technology sections found to summarize.";
    }

    if (state.simulate) {
      return "[Mock Summarizer TL;DR]: Technologies focus on resource protection. CycleTech optimizes drum rotations to decrease runtime and save 30% energy. HomeWhiz adds remote Wi-Fi configuration.";
    }

    if (typeof window.ai === 'undefined' || !window.ai.summarizer) {
      return `[Fallback Summarizer]: window.ai.summarizer is not supported on this browser. Technical keywords: ${techTexts.substring(0, 180)}...`;
    }

    try {
      const summarizer = await window.ai.summarizer.create({
        type: 'tl;dr',
        format: 'plain-text',
        length: 'short'
      });
      return await summarizer.summarize(techTexts);
    } catch (e) {
      console.warn('Summarizer API failed, falling back to Prompt API for summary', e);
      try {
        const lm = window.ai.languageModel || window.ai.assistant;
        const session = await lm.create();
        return await session.prompt(`Summarize the following technology texts in a short, bulleted TL;DR mode:\n${techTexts}`);
      } catch (e2) {
        return `[Summary Fallback]: ${techTexts.substring(0, 200)}...`;
      }
    }
  }

  // --- ReAct Loop Runner ---
  async function runAssistant() {
    if (state.loading || !state.question.trim()) return;

    state.loading = true;
    state.logs = [];
    state.highlighted = [];
    state.finalResult = null;
    cleanupHighlights();
    renderUI();

    try {
      let session = null;
      if (!state.simulate) {
        const systemPrompt = `You are a PDP Assistant agent running inside a browser. Your goal is to answer the user's question by inspecting the product page and highlighting relevant evidence.

You must run a ReAct loop. In each step, you output:
Thought: <your reasoning>
Action: <tool_name>(<arguments>)

Available Tools:
1. extract_data() - Scrapes the page, returns a list of section IDs and brief titles. Call this first!
2. read_section(id) - Reads the full text of a section. E.g. read_section("tech_0").
3. summarize_technologies() - Generates a TL;DR summary of technologies.
4. toggle_for_highlight(id, explanation) - Toggles highlighting for a section and saves a short explanation.
5. highlight_all() - Finalizes and highlights all toggled sections. This terminates the loop.

Constraints:
- You must output only one Thought and one Action per turn.
- The Action must match one of the tools exactly.
- Keep reasoning short.
- When you are done highlighting the evidence, call highlight_all().`;

        const lm = window.ai.languageModel || window.ai.assistant;
        try {
          session = await lm.create({ systemPrompt });
        } catch (e) {
          try {
            session = await lm.create({ systemPrompt: systemPrompt.substring(0, 1000) });
          } catch (e2) {
            session = await lm.create();
          }
        }
      }

      let loopCount = 0;
      const maxLoops = 8;
      let history = `User Question: ${state.question}\n`;
      let finished = false;

      while (loopCount < maxLoops && !finished) {
        let promptText = `${history}\nWhat is your next step? Format your output with Thought: <reasoning> followed by Action: <tool_call>(<args>).`;
        
        let response = "";
        if (state.simulate) {
          await new Promise(r => setTimeout(r, 1000));
          response = getMockResponse(state.question, loopCount, state.dataMap);
        } else {
          response = await session.prompt(promptText);
        }

        console.log(`[Agent Step ${loopCount + 1}] Response:\n${response}`);

        // Parse Thought
        let thought = "Reasoning step.";
        const thoughtMatch = response.match(/Thought:\s*(.*?)(?=Action:|$)/is);
        if (thoughtMatch) {
          thought = thoughtMatch[1].trim();
        } else {
          const actionIndex = response.indexOf("Action:");
          if (actionIndex > -1) {
            thought = response.substring(0, actionIndex).trim();
          } else {
            thought = response.trim();
          }
        }

        // Parse Action
        let actionName = null;
        let actionArgs = [];
        const actionMatch = response.match(/Action:\s*(\w+)\((.*)\)/i);
        if (actionMatch) {
          actionName = actionMatch[1].trim();
          actionArgs = parseArgs(actionMatch[2].trim());
        }

        // Resolve Section ID for action/observation links
        let targetSectionId = null;
        if (actionName === 'read_section' || actionName === 'toggle_for_highlight') {
          targetSectionId = actionArgs[0];
        }

        state.logs.push({ type: 'think', text: thought });
        if (actionName) {
          state.logs.push({ 
            type: 'action', 
            text: `${actionName}(${actionArgs.map(x => `'${x}'`).join(', ')})`,
            sectionId: targetSectionId
          });
        } else {
          state.logs.push({ type: 'action', text: 'No structured action parsed. Defaulting to extract_data().' });
          actionName = 'extract_data';
        }
        renderUI();

        // Execute Action
        let observation = "";
        try {
          if (actionName === 'extract_data') {
            const list = extractData();
            observation = `Extracted ${list.length} sections from the page. Available IDs:\n` + 
              list.map(item => `- ID: ${item.id} (${item.title}): "${item.snippet}"`).join('\n');
          } else if (actionName === 'read_section') {
            const id = actionArgs[0];
            if (!id) {
              observation = "Error: No section ID provided.";
            } else {
              const item = state.dataMap[id];
              if (item) {
                observation = `Content of section ${id}:\n${item.text}`;
              } else {
                observation = `Error: Section ID '${id}' is not in cached data. Call extract_data first.`;
              }
            }
          } else if (actionName === 'summarize_technologies') {
            const summary = await summarizeTechnologies();
            observation = `Summary of technologies: ${summary}`;
          } else if (actionName === 'toggle_for_highlight') {
            const id = actionArgs[0];
            const exp = actionArgs[1] || "Relevant evidence";
            if (!id) {
              observation = "Error: No section ID provided.";
            } else {
              observation = toggleForHighlight(id, exp);
            }
          } else if (actionName === 'highlight_all') {
            observation = highlightAll();
            finished = true;
          } else {
            observation = `Error: Unknown tool '${actionName}'.`;
          }
        } catch (e) {
          observation = `Error executing tool: ${e.message}`;
        }

        state.logs.push({ 
          type: 'observation', 
          text: observation,
          sectionId: targetSectionId 
        });
        renderUI();

        history += `\nThought: ${thought}\nAction: ${actionName}(${actionArgs.join(', ')})\nObservation: ${observation}\n`;
        loopCount++;
        await new Promise(r => setTimeout(r, 600));
      }

      if (!finished) {
        highlightAll();
      }

      // Final Summary Answer
      let finalAnswer = "";
      if (state.simulate) {
        finalAnswer = getMockFinalAnswer(state.question, state.dataMap);
      } else {
        const finalPrompt = `${history}\n\nBased on the observations and evidence you highlighted, write a concise final response to the user's question: "${state.question}". Keep it informative and reference the highlighted evidence sections.`;
        finalAnswer = await session.prompt(finalPrompt);
      }

      state.finalResult = finalAnswer;
    } catch (e) {
      console.error('Error running agent loop', e);
      state.logs.push({ type: 'observation', text: `Agent Error: ${e.message}` });
      state.finalResult = `An error occurred while running the Gemini Nano agent: ${e.message}. Consider trying Simulation Mode.`;
    } finally {
      state.loading = false;
      renderUI();
    }
  }

  // --- Argument Parser ---
  function parseArgs(argsStr) {
    if (!argsStr) return [];
    const args = [];
    let current = "";
    let insideQuote = false;
    let quoteChar = null;
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if ((char === '"' || char === "'") && (i === 0 || argsStr[i-1] !== '\\')) {
        if (insideQuote && char === quoteChar) {
          insideQuote = false;
          quoteChar = null;
        } else if (!insideQuote) {
          insideQuote = true;
          quoteChar = char;
        }
      } else if (char === ',' && !insideQuote) {
        args.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current) {
      args.push(current.trim());
    }
    
    return args.map(arg => {
      let clean = arg;
      if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
        clean = clean.slice(1, -1);
      }
      return clean.replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
    });
  }

  // --- Simulated Mock Engine ---
  function findKeyByKeyword(dataMap, type, keywords) {
    const keys = Object.keys(dataMap).filter(k => dataMap[k].type === type);
    for (const key of keys) {
      const text = dataMap[key].text.toLowerCase();
      if (keywords.some(kw => text.includes(kw))) {
        return key;
      }
    }
    return keys[0] || null;
  }

  function getMockResponse(question, loopCount, dataMap) {
    const q = question.toLowerCase();

    // Look for matching sections dynamically based on selectors
    const cycleTechKey = findKeyByKeyword(dataMap, 'technologies', ['cycle', 'tambur', 'drum']) || 'tech_0';
    const smartTechKey = findKeyByKeyword(dataMap, 'technologies', ['home', 'akıllı', 'smart', 'bağlantı', 'connect']) || 'tech_1';
    
    const energySpecKey = findKeyByKeyword(dataMap, 'details', ['energy class', 'enerji sınıfı', 'class a', 'a (scale']) || 'tab_tech_0_0';
    const promoKey = findKeyByKeyword(dataMap, 'details', ['promotion', 'kampanya', 'indirim']) || 'tab_promo_0';
    const downloadKey = findKeyByKeyword(dataMap, 'details', ['download', 'belge', 'kılavuz', 'manual']) || 'tab_download_0';

    if (loopCount === 0) {
      return `Thought: I will start by extracting all product data from the page using the defined selectors.
Action: extract_data()`;
    }

    if (q.includes('energy') || q.includes('verim') || q.includes('cycle') || q.includes('enerj') || q.includes('tüket')) {
      if (loopCount === 1) {
        return `Thought: Let's inspect the first technology card (${cycleTechKey}) to see if it contains information about energy savings.
Action: read_section("${cycleTechKey}")`;
      }
      if (loopCount === 2) {
        return `Thought: The section describes CycleTech, which provides up to 30% energy savings. This is related! I will highlight it.
Action: toggle_for_highlight("${cycleTechKey}", "CycleTech provides up to 30% energy savings.")`;
      }
      if (loopCount === 3) {
        return `Thought: Let's check the next technology card (${smartTechKey}) to see if it is related to energy.
Action: read_section("${smartTechKey}")`;
      }
      if (loopCount === 4) {
        return `Thought: ${smartTechKey} is about smart connection and not directly about energy efficiency. Let's inspect the technical specs sheet row (${energySpecKey}) under the detailed information accordion.
Action: read_section("${energySpecKey}")`;
      }
      if (loopCount === 5) {
        return `Thought: The spec row confirms Energy Class A, which is related! I will highlight this row.
Action: toggle_for_highlight("${energySpecKey}", "Energy Class is rated A, indicating highest efficiency.")`;
      }
      if (loopCount === 6) {
        return `Thought: I have checked all technologies and detailed specs, and highlighted the energy efficiency evidence. I will finalize now.
Action: highlight_all()`;
      }
    } else if (q.includes('smart') || q.includes('akıll') || q.includes('control') || q.includes('home')) {
      if (loopCount === 1) {
        return `Thought: Let's inspect the first technology card (${cycleTechKey}) for smart control details.
Action: read_section("${cycleTechKey}")`;
      }
      if (loopCount === 2) {
        return `Thought: CycleTech is about rotation and energy savings, not smart controls. Let's inspect the second technology card (${smartTechKey}).
Action: read_section("${smartTechKey}")`;
      }
      if (loopCount === 3) {
        return `Thought: HomeWhiz describes smart connection over Wi-Fi. This is related! I will highlight it.
Action: toggle_for_highlight("${smartTechKey}", "HomeWhiz connectivity provides remote smart control.")`;
      }
      if (loopCount === 4) {
        return `Thought: I found the smart control technology. I will apply highlights and finish.
Action: highlight_all()`;
      }
    } else if (q.includes('program') || q.includes('save') || q.includes('water') || q.includes('su')) {
      if (loopCount === 1) {
        return `Thought: Let's look at the first technology card (${cycleTechKey}) to see if it mentions water/wash cycles.
Action: read_section("${cycleTechKey}")`;
      }
      if (loopCount === 2) {
        return `Thought: CycleTech has energy savings. I will highlight it.
Action: toggle_for_highlight("${cycleTechKey}", "CycleTech optimizes washing speed and saves resource consumption.")`;
      }
      if (loopCount === 3) {
        return `Thought: Let's check the technical specs row related to consumption (${energySpecKey}) to see if water details are present.
Action: read_section("${energySpecKey}")`;
      }
      if (loopCount === 4) {
        return `Thought: The row specifies Energy Consumption. Let's finalize and highlight.
Action: highlight_all()`;
      }
    } else if (q.includes('compare') || q.includes('karşılaştır') || q.includes('buy') || q.includes('al')) {
      if (loopCount === 1) {
        return `Thought: Let's look at the product title to see basic details to compare.
Action: read_section("brief_title")`;
      }
      if (loopCount === 2) {
        return `Thought: Highlighting the product title.
Action: toggle_for_highlight("brief_title", "Compare this 9 kg model capacity.")`;
      }
      if (loopCount === 3) {
        return `Thought: Let's look at the pricing.
Action: read_section("brief_price")`;
      }
      if (loopCount === 4) {
        return `Thought: Highlighting the price.
Action: toggle_for_highlight("brief_price", "Compare the price with alternative machines.")`;
      }
      if (loopCount === 5) {
        return `Thought: Finalizing highlight selections.
Action: highlight_all()`;
      }
    } else {
      if (loopCount === 1) {
        return `Thought: Let's check the first technology section.
Action: read_section("${cycleTechKey}")`;
      }
      if (loopCount === 2) {
        return `Thought: Highlighting general features.
Action: toggle_for_highlight("${cycleTechKey}", "General product details.")`;
      }
      if (loopCount === 3) {
        return `Thought: Finalizing.
Action: highlight_all()`;
      }
    }

    return `Thought: Done.
Action: highlight_all()`;
  }

  function getMockFinalAnswer(question, dataMap) {
    const q = question.toLowerCase();
    
    const cycleTechKey = findKeyByKeyword(dataMap, 'technologies', ['cycle', 'tambur', 'drum']) || 'tech_0';
    const energySpecKey = findKeyByKeyword(dataMap, 'details', ['energy class', 'enerji sınıfı', 'class a', 'a (scale']) || 'tab_tech_0_0';
    const smartTechKey = findKeyByKeyword(dataMap, 'technologies', ['home', 'akıllı', 'smart', 'bağlantı', 'connect']) || 'tech_1';

    if (q.includes('energy') || q.includes('verim') || q.includes('cycle') || q.includes('enerj') || q.includes('tüket')) {
      const cycleText = dataMap[cycleTechKey] ? dataMap[cycleTechKey].text : 'CycleTech Technology';
      const specText = dataMap[energySpecKey] ? dataMap[energySpecKey].text : 'Energy Class A';
      return `Yes, the product is highly energy efficient:
1. **CycleTech** (highlighted): ${cycleText.replace('Technology Card: ', '')}
2. **Energy Class** (highlighted): ${specText.replace('Technical Specification: ', '')}

I have highlighted these two evidence blocks on the page.`;
    }

    if (q.includes('smart') || q.includes('akıll') || q.includes('control') || q.includes('home')) {
      const smartText = dataMap[smartTechKey] ? dataMap[smartTechKey].text : 'HomeWhiz Connection';
      return `Yes, it supports smart controls via **HomeWhiz Connection** (highlighted on the page):
${smartText.replace('Technology Card: ', '')}`;
    }

    if (q.includes('program') || q.includes('save') || q.includes('water') || q.includes('su')) {
      return `To save resources, use the **Eco 40-60 program** (found in detailed technical specifications) and check **CycleTech** which optimizes wash drum rotations. Both are highlighted on the page.`;
    }

    return `I have evaluated the page and highlighted the sections relevant to your question. You can review them directly on the screen.`;
  }

  // --- Demo Injected PDP HTML ---
  function injectDemoPDPElements() {
    const container = document.createElement('div');
    container.id = 'demo-pdp-container';
    container.style.cssText = `
      max-width: 1000px;
      margin: 40px auto;
      padding: 30px;
      background: #ffffff;
      color: #333333;
      font-family: 'Inter', sans-serif;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
    `;

    container.innerHTML = `
      <!-- 1. Brief -->
      <div style="border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; background: #ffffff; color: #333;">
        <h1 id="product-title" style="font-size: 22px; font-weight: bold; margin: 0 0 10px 0;">Arcelik 9140 MP OG 9 kg Camasir Makinesi</h1>
        <div id="reviews-link" style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <span class="rating" data-rating="4.8" style="background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 4px; font-weight: 600;">★ 4.8</span>
          <span class="qty" style="color: #6b7280; font-size: 13px;"><span>124 Reviews</span></span>
        </div>
        <div class="pdp-price" style="font-size: 24px; font-weight: 700; color: #dc2626; margin-bottom: 16px;">24.999 TL</div>
        
        <div class="pdp-promotion-slider" style="margin-bottom: 16px;">
          <div class="swiper-slide" style="font-size: 13px; color: #2563eb; background: #eff6ff; padding: 8px; border-radius: 6px; margin-bottom: 4px;">Free installation and checkout warranty!</div>
          <div class="swiper-slide" style="font-size: 13px; color: #2563eb; background: #eff6ff; padding: 8px; border-radius: 6px;">Extra 10% off for credit cards.</div>
        </div>

        <div class="pdp-features" style="display: flex; gap: 12px; border-top: 1px dashed #e5e7eb; padding-top: 12px;">
          <div class="item" style="border: 1px solid #f3f4f6; padding: 8px 12px; border-radius: 6px; text-align: center; flex: 1;">
            <div class="t" style="font-size: 11px; color: #6b7280; font-weight: bold;">Capacity</div>
            <div class="v" style="font-size: 14px; font-weight: bold; color: #1f2937;">9 kg</div>
          </div>
          <div class="item" style="border: 1px solid #f3f4f6; padding: 8px 12px; border-radius: 6px; text-align: center; flex: 1;">
            <div class="t" style="font-size: 11px; color: #6b7280; font-weight: bold;">Spin Speed</div>
            <div class="v" style="font-size: 14px; font-weight: bold; color: #1f2937;">1400 rpm</div>
          </div>
        </div>
      </div>

      <!-- 2. Technologies -->
      <div style="border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; background: #ffffff; color: #333;">
        <h2 style="font-size: 18px; font-weight: bold; margin-bottom: 12px;">Technologies</h2>
        <div class="pdp-technologies" style="display: flex; flex-direction: column; gap: 12px;">
          <div class="ftc-item" style="border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; background: #fafafa;">
            <strong style="color: #1e3a8a; display: block; margin-bottom: 4px;">CycleTech</strong>
            CycleTech optimizes drum rhythm and speed. The customized rotation allows clothes to slide gently along the drum, preserving fabric quality and saving 30% energy.
          </div>
          <div class="ftc-item" style="border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; background: #fafafa;">
            <strong style="color: #1e3a8a; display: block; margin-bottom: 4px;">HomeWhiz Connection</strong>
            HomeWhiz provides smart remote controls over Wi-Fi, allowing you to configure wash programs or download new ones via the mobile app.
          </div>
        </div>
      </div>

      <!-- 3. Detailed Information / Accordions -->
      <div class="pdp-tab" style="grid-column: span 2; display: flex; flex-direction: column; gap: 16px; color: #333;">
        <h2 style="font-size: 18px; font-weight: bold; margin-bottom: 8px; color: #1e293b;">Detailed Information</h2>

        <!-- promotions accordion (collapsed) -->
        <div id="pdp-promotions" class="acc-section" data-atc-section="Active Promotions" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #ffffff; cursor: pointer;">
          <div class="acc-header" style="background: #f8fafc; padding: 12px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>Active Promotions</span>
            <span class="status-indicator-icon">▼</span>
          </div>
          <div class="acc-content" style="padding: 16px; display: none; border-top: 1px solid #e5e7eb;">
            <div class="acc-item">
              <div class="act" style="color: #059669; font-weight: 600;"><span>Campaign 1: 50% discount on laundry detergent with purchase!</span></div>
            </div>
          </div>
        </div>

        <!-- technical accordion (active by default for test) -->
        <div id="pdp-technical" class="acc-section active" data-atc-section="Technical Specifications" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #ffffff; cursor: pointer;">
          <div class="acc-header" style="background: #f8fafc; padding: 12px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>Technical Specifications</span>
            <span class="status-indicator-icon">▲</span>
          </div>
          <div class="acc-content" style="padding: 16px; border-top: 1px solid #e5e7eb; display: block;">
            <div class="feature-item" style="margin-bottom: 12px;">
              <div class="title" style="font-weight: bold; color: #475569; margin-bottom: 6px; font-size: 14px;">Performance & Consumption</div>
              <div class="item" style="display: flex; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
                <span class="t" style="color: #64748b;">Energy Class</span>
                <span class="v" style="font-weight: 600; color: #059669;">A (Scale A to G)</span>
              </div>
              <div class="item" style="display: flex; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #f1f5f9;">
                <span class="t" style="color: #64748b;">Energy Consumption</span>
                <span class="v" style="font-weight: 600;">49 kWh per 100 cycles</span>
              </div>
            </div>
          </div>
        </div>

        <!-- downloads accordion (collapsed) -->
        <div id="pdp-downloads" class="acc-section" data-atc-section="Downloads & Documents" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #ffffff; cursor: pointer;">
          <div class="acc-header" style="background: #f8fafc; padding: 12px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>Downloads & Documents</span>
            <span class="status-indicator-icon">▼</span>
          </div>
          <div class="acc-content" style="padding: 16px; display: none; border-top: 1px solid #e5e7eb;">
            <div class="tab-content">
              <div class="item" style="margin-bottom: 8px;">
                <a href="/downloads/manual.pdf" style="color: #2563eb; font-weight: bold; text-decoration: none;">
                  <span class="v">User Manual PDF</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- installments accordion (collapsed) -->
        <div id="pdp-installments" class="acc-section" data-atc-section="Installment Options" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #ffffff; cursor: pointer;">
          <div class="acc-header" style="background: #f8fafc; padding: 12px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>Installment Options</span>
            <span class="status-indicator-icon">▼</span>
          </div>
          <div class="acc-content" style="padding: 16px; display: none; border-top: 1px solid #e5e7eb;">
            <div class="installments-card">
              <div class="acc-item">
                <h4 style="margin: 0 0 6px 0; color: #1e293b;">Worldcard: up to 9 installments</h4>
              </div>
              <div class="acc-item">
                <h4 style="margin: 0; color: #1e293b;">Bonus Card: up to 12 installments</h4>
              </div>
            </div>
          </div>
        </div>

        <!-- refund accordion (collapsed) -->
        <div id="pdp-refund" class="acc-section" data-atc-section="Refund Policy" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #ffffff; cursor: pointer;">
          <div class="acc-header" style="background: #f8fafc; padding: 12px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
            <span>Refund Policy</span>
            <span class="status-indicator-icon">▼</span>
          </div>
          <div class="acc-content" style="padding: 16px; display: none; border-top: 1px solid #e5e7eb;">
            14-day money-back guarantee, free return shipping for returns requested through our client panel.
          </div>
        </div>
      </div>
    `;

    document.body.prepend(container);

    // Click handler to toggle collapsed/active states inside our demo mockup
    container.querySelectorAll('.acc-section').forEach(section => {
      const header = section.querySelector('.acc-header');
      header.addEventListener('click', () => {
        const isActive = section.classList.contains('active');
        if (isActive) {
          section.classList.remove('active');
          section.querySelector('.acc-content').style.display = 'none';
          section.querySelector('.status-indicator-icon').textContent = '▼';
        } else {
          section.classList.add('active');
          section.querySelector('.acc-content').style.display = 'block';
          section.querySelector('.status-indicator-icon').textContent = '▲';
        }
      });
    });
  }

  // --- Event Handlers ---
  function toggleDrawer(force) {
    state.active = typeof force === 'boolean' ? force : !state.active;
    const drawer = shadow.querySelector('.drawer');
    const fab = shadow.querySelector('.fab');
    if (drawer) {
      if (state.active) drawer.classList.add('open');
      else drawer.classList.remove('open');
    }
    if (fab) {
      if (state.active) fab.classList.add('active');
      else fab.classList.remove('active');
    }
  }

  function handleReset() {
    cleanupHighlights();
    const container = document.getElementById('demo-pdp-container');
    if (container) {
      container.remove();
    }
    state.question = '';
    state.highlighted = [];
    state.logs = [];
    state.finalResult = null;
    state.loading = false;
    state.dataMap = {};
    renderUI();
  }

  function enableSimulationMode() {
    state.simulate = true;
    state.apiStatus = 'simulated';
    renderUI();
  }

  function handleQuerySubmit(e) {
    e.preventDefault();
    runAssistant();
  }

  function locateElement(id) {
    let item = state.dataMap[id];
    if (item && item.element) {
      // Expand accordion first if collapsed
      ensureAccordionActive(item.element);
      
      // Smooth scroll
      item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Temporary flash highlight effect
      const origBox = item.element.style.boxShadow;
      const origBorder = item.element.style.border;
      item.element.style.boxShadow = '0 0 35px #a855f7';
      item.element.style.border = '3px solid #a855f7';
      setTimeout(() => {
        const isHighlighted = state.highlighted.some(h => h.id === id);
        if (isHighlighted) {
          item.element.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.6)';
          item.element.style.border = '3px solid #6366f1';
        } else {
          item.element.style.boxShadow = origBox;
          item.element.style.border = origBorder;
        }
      }, 1500);
    }
  }

  // Register Global Esc toggle
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.active) {
      toggleDrawer(false);
    }
  });

  // --- UI Renderer ---
  function renderUI() {
    const children = Array.from(shadow.children);
    children.forEach(child => {
      if (child.tagName !== 'LINK') {
        child.remove();
      }
    });

    const style = document.createElement('style');
    style.textContent = getCSS();
    shadow.appendChild(style);

    // FAB Button
    const fab = document.createElement('div');
    fab.className = `fab ${state.active ? 'active' : ''} ${state.loading ? 'pulse' : ''}`;
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z" fill="#ffffff"/>
      </svg>
    `;
    fab.addEventListener('click', () => toggleDrawer());
    shadow.appendChild(fab);

    // Drawer Body
    const drawer = document.createElement('div');
    drawer.className = `drawer ${state.active ? 'open' : ''}`;
    
    // Header
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <div class="header-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--secondary); margin-right: 4px;">
          <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
          <polyline points="2 17 12 22 22 17"></polyline>
          <polyline points="2 12 12 17 22 12"></polyline>
        </svg>
        Nano PDP Assistant
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="btn-reset" title="Reset Assistant">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
        </button>
        <button class="icon-btn" id="btn-close" title="Close Panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
    drawer.appendChild(header);

    // Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    let statusText = 'Gemini Nano Ready';
    let dotClass = 'ready';
    if (state.apiStatus === 'checking') {
      statusText = 'Checking Gemini Nano...';
      dotClass = 'checking';
    } else if (state.apiStatus === 'error') {
      statusText = 'Nano API Unsupported';
      dotClass = 'error';
    } else if (state.apiStatus === 'simulated') {
      statusText = 'Simulated Nano Mode';
      dotClass = 'simulated';
    }

    statusBar.innerHTML = `
      <div class="status-indicator">
        <span class="status-dot ${dotClass}"></span>
        <span>${statusText}</span>
      </div>
      ${state.apiStatus !== 'checking' ? `<div style="font-weight: 600; font-size: 10px; opacity: 0.8;">${state.simulate ? 'DEMO MOCK' : 'NATIVE'}</div>` : ''}
    `;
    drawer.appendChild(statusBar);

    // Content container
    const content = document.createElement('div');
    content.className = 'content';

    if (state.apiStatus === 'error' && !state.simulate) {
      const warning = document.createElement('div');
      warning.className = 'warning-card';
      warning.innerHTML = `
        <h4>Gemini Nano Required</h4>
        <p>This assistant runs local ReAct reasoning over PDP data using Chrome Gemini Nano. To configure your browser:</p>
        <ol>
          <li>Open <b>chrome://flags/#optimization-guide-on-device-model</b> and select <b>Enabled (BypassPerfRequirement)</b>.</li>
          <li>Open <b>chrome://flags/#prompt-api-for-gemini-nano</b> and select <b>Enabled</b>.</li>
          <li>Relaunch Chrome.</li>
          <li>Open <b>chrome://components</b>, find <b>Optimization Guide On Device Model</b>, and click "Check for update" to start downloading the model.</li>
        </ol>
        <p>Or skip setup and run in Demo Mode right now:</p>
        <button class="btn-simulate" id="btn-enable-simulate">Activate Simulated Demo</button>
      `;
      content.appendChild(warning);
    } else {
      // Search input
      const searchForm = document.createElement('form');
      searchForm.className = 'search-form';
      searchForm.innerHTML = `
        <input type="text" class="search-input" placeholder="Ask a question about this product..." value="${state.question}" ${state.loading ? 'disabled' : ''}>
        <button type="submit" class="send-btn" ${state.loading || !state.question.trim() ? 'disabled' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      `;
      searchForm.addEventListener('submit', handleQuerySubmit);
      
      const inputField = searchForm.querySelector('.search-input');
      inputField.addEventListener('input', (e) => {
        state.question = e.target.value;
        const sendBtn = searchForm.querySelector('.send-btn');
        if (sendBtn) sendBtn.disabled = state.loading || !state.question.trim();
      });

      content.appendChild(searchForm);

      // Suggestions
      const quickQs = document.createElement('div');
      quickQs.className = 'quick-questions';
      quickQs.innerHTML = `
        <div class="quick-label">Suggested Questions</div>
        <div class="pill-list">
          <button class="pill" type="button" data-q="Is this energy efficient?">Is this energy efficient?</button>
          <button class="pill" type="button" data-q="Which sections prove the energy claim?">Which sections prove the energy claim?</button>
          <button class="pill" type="button" data-q="Does it have smart controls?">Does it have smart controls?</button>
          <button class="pill" type="button" data-q="What programs help save energy or water?">What programs save energy/water?</button>
          <button class="pill" type="button" data-q="What should I compare before buying?">What to compare before buying?</button>
        </div>
      `;
      quickQs.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
          state.question = pill.getAttribute('data-q');
          runAssistant();
        });
      });
      if (state.loading) {
        quickQs.querySelectorAll('.pill').forEach(p => p.disabled = true);
      }
      content.appendChild(quickQs);

      // Console logs
      if (state.logs.length > 0) {
        const consoleWrapper = document.createElement('div');
        consoleWrapper.style.display = 'flex';
        consoleWrapper.style.flexDirection = 'column';
        consoleWrapper.style.gap = '8px';
        
        consoleWrapper.innerHTML = `<div class="quick-label">Agentic ReAct Loop Activity</div>`;
        const consoleEl = document.createElement('div');
        consoleEl.className = 'console';
        
        state.logs.forEach(log => {
          const step = document.createElement('div');
          step.className = `console-step ${log.type}`;
          
          let label = 'Thought';
          let labelClass = 'think';
          if (log.type === 'action') {
            label = 'Action';
            labelClass = 'act';
          } else if (log.type === 'observation') {
            label = 'Observation';
            labelClass = 'obs';
          }
          
          step.innerHTML = `
            <div class="console-label ${labelClass}">${label}</div>
            <div style="white-space: pre-wrap;">${log.text}</div>
          `;
          
          // Render interactive Jump/Goto button next to the section data log
          if (log.sectionId && state.dataMap[log.sectionId]) {
            const gotoBtn = document.createElement('button');
            gotoBtn.className = 'btn-locate';
            gotoBtn.style.cssText = 'margin-top: 6px; font-size: 10px; padding: 4px 8px; font-family: inherit; display: inline-flex; align-items: center; gap: 4px;';
            gotoBtn.innerHTML = `
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(45deg);">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              Go to Section
            `;
            gotoBtn.addEventListener('click', () => locateElement(log.sectionId));
            step.appendChild(gotoBtn);
          }
          
          consoleEl.appendChild(step);
        });
        
        consoleWrapper.appendChild(consoleEl);
        content.appendChild(consoleWrapper);
        
        setTimeout(() => {
          consoleEl.scrollTop = consoleEl.scrollHeight;
        }, 50);
      }

      // Shimmer loading card
      if (state.loading && state.logs.length === 0) {
        const loadingCard = document.createElement('div');
        loadingCard.className = 'result-card';
        loadingCard.innerHTML = `
          <h3 style="margin-bottom: 12px;">
            <svg class="pulse" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary); margin-right: 6px;">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Analyzing Product Data...
          </h3>
          <div class="shimmer" style="margin-bottom: 8px; width: 100%;"></div>
          <div class="shimmer" style="margin-bottom: 8px; width: 85%;"></div>
          <div class="shimmer" style="width: 60%;"></div>
        `;
        content.appendChild(loadingCard);
      } else if (state.finalResult) {
        const resultCard = document.createElement('div');
        resultCard.className = 'result-card';
        resultCard.innerHTML = `
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--success); margin-right: 6px;">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            Evidence Summary
          </h3>
          <div style="font-size: 13px; line-height: 1.5; color: #e2e8f0; font-family: inherit; white-space: pre-line;">${state.finalResult}</div>
        `;
        content.appendChild(resultCard);
      }

      // Highlights panel
      if (state.highlighted.length > 0) {
        const hPanel = document.createElement('div');
        hPanel.className = 'highlights-panel';
        hPanel.innerHTML = `<div class="quick-label">Highlighted Evidence (${state.highlighted.length})</div>`;
        
        state.highlighted.forEach((h, idx) => {
          const hItem = document.createElement('div');
          hItem.className = 'highlight-item';
          hItem.innerHTML = `
            <div class="highlight-info">
              <div class="highlight-id">Evidence #${idx + 1} (${h.id})</div>
              <div class="highlight-explanation">${h.explanation}</div>
            </div>
            <button class="btn-locate" data-id="${h.id}">Locate</button>
          `;
          hItem.querySelector('.btn-locate').addEventListener('click', () => locateElement(h.id));
          hPanel.appendChild(hItem);
        });
        content.appendChild(hPanel);
      }
    }

    drawer.appendChild(content);
    shadow.appendChild(drawer);

    // Bind footer Actions
    const closeBtn = drawer.querySelector('#btn-close');
    if (closeBtn) closeBtn.addEventListener('click', () => toggleDrawer(false));
    
    const resetBtn = drawer.querySelector('#btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', handleReset);

    const simulateBtn = drawer.querySelector('#btn-enable-simulate');
    if (simulateBtn) simulateBtn.addEventListener('click', enableSimulationMode);
  }

  // --- Dynamic CSS ---
  function getCSS() {
    return `
      :host {
        --primary: #6366f1;
        --primary-hover: #4f46e5;
        --secondary: #a855f7;
        --bg-dark: #0f172a;
        --bg-card: rgba(30, 41, 59, 0.7);
        --text-main: #f1f5f9;
        --text-muted: #94a3b8;
        --border: rgba(255, 255, 255, 0.08);
        --success: #10b981;
        --warning: #f59e0b;
        --error: #ef4444;
        
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        color: var(--text-main);
        box-sizing: border-box;
      }
      
      * {
        box-sizing: border-box;
      }
      
      .fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        box-shadow: 0 8px 30px rgba(99, 102, 241, 0.4), inset 0 2px 4px rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 999999;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .fab:hover {
        transform: translateY(-4px) scale(1.05);
        box-shadow: 0 12px 40px rgba(99, 102, 241, 0.6);
      }
      
      .fab svg {
        width: 28px;
        height: 28px;
        fill: #fff;
        transition: transform 0.3s ease;
      }
      
      .fab.active svg {
        transform: rotate(135deg);
      }
      
      .drawer {
        position: fixed;
        top: 0;
        right: -420px;
        width: 400px;
        height: 100vh;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(20px);
        border-left: 1px solid var(--border);
        box-shadow: -10px 0 40px rgba(0, 0, 0, 0.5);
        z-index: 999998;
        transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
      }
      
      .drawer.open {
        right: 0;
      }
      
      .header {
        padding: 20px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: linear-gradient(to right, rgba(99, 102, 241, 0.05), rgba(168, 85, 247, 0.05));
      }
      
      .header-title {
        font-size: 18px;
        font-weight: 700;
        background: linear-gradient(135deg, #a5b4fc, #e9d5ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .header-actions {
        display: flex;
        gap: 8px;
      }
      
      .icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .icon-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-main);
      }
      
      .status-bar {
        padding: 8px 20px;
        font-size: 11px;
        border-bottom: 1px solid var(--border);
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      
      .status-dot.checking { background: var(--warning); animation: statusPulse 1s infinite alternate; }
      .status-dot.ready { background: var(--success); box-shadow: 0 0 8px var(--success); }
      .status-dot.error { background: var(--error); box-shadow: 0 0 8px var(--error); }
      .status-dot.simulated { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
      
      @keyframes statusPulse {
        from { opacity: 0.4; }
        to { opacity: 1; }
      }
      
      .content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      
      .warning-card {
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        padding: 16px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.5;
        color: #fca5a5;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .warning-card h4 {
        margin: 0;
        color: #f87171;
        font-weight: 600;
        font-size: 14px;
      }
      
      .warning-card ol {
        margin: 0;
        padding-left: 20px;
      }
      
      .warning-card li {
        margin-bottom: 6px;
      }
      
      .btn-simulate {
        background: linear-gradient(135deg, var(--warning), #d97706);
        color: #0f172a;
        border: none;
        padding: 10px 16px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
        font-size: 13px;
      }
      .btn-simulate:hover {
        opacity: 0.95;
        transform: translateY(-1px);
      }
      
      .search-form {
        display: flex;
        gap: 8px;
      }
      
      .search-input {
        flex: 1;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 16px;
        color: var(--text-main);
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: all 0.2s;
      }
      
      .search-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
      }
      
      .send-btn {
        background: var(--primary);
        border: none;
        width: 44px;
        height: 44px;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        transition: all 0.2s;
      }
      
      .send-btn:hover {
        background: var(--primary-hover);
      }
      
      .send-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      
      .quick-questions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .quick-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      
      .pill-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      
      .pill {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border);
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--text-main);
        text-align: left;
        font-family: inherit;
      }
      
      .pill:hover {
        background: rgba(99, 102, 241, 0.15);
        border-color: var(--primary);
        transform: translateY(-1px);
      }
      
      .console {
        background: #020617;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        font-family: 'Fira Code', monospace;
        font-size: 11px;
        max-height: 250px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.1) transparent;
      }
      
      .console::-webkit-scrollbar {
        width: 4px;
      }
      .console::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
      }
      
      .console-step {
        border-left: 2px solid var(--border);
        padding-left: 10px;
        display: flex;
        flex-direction: column;
      }
      
      .console-step.think {
        border-left-color: var(--secondary);
      }
      
      .console-step.action {
        border-left-color: var(--primary);
      }
      
      .console-step.observation {
        border-left-color: var(--success);
      }
      
      .console-label {
        font-weight: bold;
        font-size: 10px;
        text-transform: uppercase;
        margin-bottom: 4px;
        letter-spacing: 0.05em;
      }
      .console-label.think { color: #d8b4fe; }
      .console-label.act { color: #818cf8; }
      .console-label.obs { color: #34d399; }
      
      .result-card {
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08));
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 12px;
        padding: 16px;
        line-height: 1.6;
      }
      
      .result-card h3 {
        margin: 0 0 10px 0;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .highlights-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .highlight-item {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        transition: all 0.2s;
      }
      
      .highlight-item:hover {
        border-color: rgba(99, 102, 241, 0.3);
        background: rgba(30, 41, 59, 0.9);
      }
      
      .highlight-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .highlight-id {
        font-size: 10px;
        font-family: 'Fira Code', monospace;
        color: #a5b4fc;
        font-weight: bold;
      }
      
      .highlight-explanation {
        font-size: 13px;
        color: var(--text-main);
        line-height: 1.4;
      }
      
      .btn-locate {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--border);
        color: var(--text-main);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
      }
      
      .btn-locate:hover {
        background: var(--primary);
        border-color: var(--primary);
        transform: translateY(-1px);
      }
      
      .shimmer {
        height: 14px;
        background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
        background-size: 200% 100%;
        animation: loading-shimmer 1.5s infinite;
        border-radius: 4px;
      }
      
      @keyframes loading-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      
      .pulse {
        animation: pulse-ring 1.5s cubic-bezier(0.215, 0.610, 0.355, 1) infinite;
      }
      
      @keyframes pulse-ring {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(99, 102, 241, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
      }
    `;
  }
})();
