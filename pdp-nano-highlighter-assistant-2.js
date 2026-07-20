/**
 * PDP Chrome Gemini Nano Highlighter Assistant
 *
 * Paste this script directly into your browser console, or load it dynamically:
 * fetch('https://your-host.com/pdp-nano-highlighter-assistant.js')
 *   .then(r => r.text())
 *   .then(eval);
 */
(async function () {
  "use strict";

  // Global State
  const state = {
    active: true,
    apiStatus: "checking", // 'checking' | 'ready' | 'error'
    apiStatusReason: "",
    loading: false,
    question: "",
    dataMap: {}, // holds extracted DOM elements and structured info { section: { id: string, value: string }[] }
    highlighted: [], // [{ id, explanation }]
    logs: [], // [{ type: 'think'|'action'|'observation', text: string, sectionId?: string }]
    finalResult: null,
    showDevLogs: false, // DEV toggle to show/hide the technical ReAct loop activity (hidden by default for consumer use)
  };

  function extractData() {
    const extractedList = [];
    const dataMap = {};

    function addEntry(el, id, section, value) {
      dataMap[section]
        ? dataMap[section].push({ id, value })
        : (dataMap[section] = [{ id, value }]);
      el.dataset["highlightId"] = id;
      extractedList.push(`ID: ${id} | Section: ${section} | Value: ${value}`);
    }

    function flattenMultilineText(text) {
      return text.replaceAll("\n", " ").trim();
    }

    function normalizeTurkish(text) {
      return text
        .replace(/İ/g, "I") // Standardize capital dotted İ to English I
        .replace(/ı/g, "i") // Standardize lowercase dotless ı to English i
        .normalize("NFD") // Separate accents from base characters (e.g., ç -> c + ̧ )
        .replace(/[\u0300-\u036f]/g, ""); // Strip out the separated accents
    }

    function lowerKebabCase(str) {
      return str.toLowerCase().replaceAll(" ", "-");
    }

    // BRIEF
    const titleEl = document.querySelector("#product-title");
    if (titleEl) {
      addEntry(
        titleEl,
        "product-title",
        "brief",
        `Product Name: ${flattenMultilineText(titleEl.innerText)}`,
      );
    }
    const priceEl = document.querySelector(".pdp-price");
    if (priceEl) {
      addEntry(
        priceEl,
        "product-price",
        "brief",
        `Product Price: ${priceEl.innerText}`,
      );
    }
    const briefPromotionsEl = document.querySelectorAll(
      ".pdp-promotion-slider .swiper-slide",
    );
    briefPromotionsEl.forEach((el, idx) => {
      addEntry(
        briefPromotionsEl[0],
        `brief-promotions`,
        "brief",
        `Promotion ${idx + 1}: ${el.innerText}`,
      );
    });
    const ratingEl = document.querySelector("#reviews-link .rating");
    if (ratingEl) {
      addEntry(
        ratingEl,
        "brief-rating",
        "brief",
        `Rating: ${ratingEl.dataset.rating}`,
      );
    }
    const reviewQtyEl = document.querySelector("#reviews-link .qty span");
    if (reviewQtyEl) {
      addEntry(
        reviewQtyEl,
        "brief-review-qty",
        "brief",
        `Review Quantity: ${reviewQtyEl.innerText}`,
      );
    }
    const showcasedFeaturesEl = document.querySelector(".pdp-features");
    if (showcasedFeaturesEl) {
      const items = showcasedFeaturesEl.querySelectorAll(".item");
      items.forEach((item, idx) => {
        const tEl = item.querySelector(".t");
        const vEl = item.querySelector(".v");
        if (tEl && vEl) {
          addEntry(
            item,
            `feature-${idx}`,
            "brief",
            `${tEl.innerText}: ${vEl.innerText}`,
          );
        }
      });
    }

    // Technologies
    const technologyEls = document.querySelectorAll(
      ".pdp-technologies .ftc-item",
    );
    technologyEls.forEach((el, idx) => {
      const tEl = el.querySelector(".ftc-title");
      const vEl = el.querySelector(".ftc-text");
      if (tEl && vEl) {
        addEntry(
          el,
          `technology-${idx}`,
          "technologies",
          `${tEl.innerText}: ${vEl.innerText}`,
        );
      }
      // TODO: Summarize text
    });

    // TODO: Toggle
    // Product & Other Details
    const promotionsEl = document.querySelector(".pdp-tab #pdp-promotions");
    if (promotionsEl) {
      const detailTitle = promotionsEl.dataset.accSection;
      const promotionTexts = promotionsEl.querySelectorAll(
        ".acc-item .act > span",
      );
      promotionTexts.forEach((el, idx) => {
        addEntry(
          el,
          `promotion-${idx}`,
          "product-details-promotions",
          `${detailTitle}: ${el.innerText}`,
        );
      });
    }

    const technicalSpecificationsEl = document.querySelector(
      ".pdp-tab #pdp-technical",
    );
    if (technicalSpecificationsEl) {
      const detailTitle = technicalSpecificationsEl.dataset.accSection;
      const featureItemEls =
        technicalSpecificationsEl.querySelectorAll(".feature-item");
      featureItemEls.forEach((featureEl) => {
        const featureTitleEl = featureEl.querySelector(".title");
        const featureTitle = featureTitleEl ? featureTitleEl.innerText : null;
        const specEls = featureEl.querySelectorAll(".item");
        specEls.forEach((el, idx) => {
          const tEl = el.querySelector(".t");
          const vEl = el.querySelector(".v");
          addEntry(
            el,
            `specification-${normalizeTurkish(lowerKebabCase(featureTitle))}-${idx}`,
            "product-details-technical-specs",
            `${detailTitle} ${featureTitle}: ${tEl.innerText}: ${vEl.innerText}`,
          );
        });
      });
    }

    const documentsEl = document.querySelector(".pdp-tab #pdp-downloads");
    if (documentsEl) {
      const detailTitle = documentsEl.dataset.accSection;
      const downloadItems = documentsEl.querySelectorAll(".item");
      downloadItems.forEach((item, idx) => {
        addEntry(
          item,
          `document-${idx}`,
          "product-details-documents",
          `${detailTitle}: ${flattenMultilineText(item.innerText)}`,
        );
      });
    }

    const storeLocatorEl = document.querySelector(
      ".pdp-tab #pdp-store-locator",
    );
    if (storeLocatorEl) {
      const detailTitle = storeLocatorEl.dataset.accSection;
      addEntry(
        storeLocatorEl,
        `store-locator`,
        "product-details-store-locator",
        `${detailTitle}`,
      );
    }

    const installmentsEl = document.querySelector(".pdp-tab #pdp-installments");
    if (installmentsEl) {
      const detailTitle = installmentsEl.dataset.accSection;
      addEntry(
        installmentsEl,
        `installments`,
        "product-details-installments",
        `${detailTitle}`,
      );
    }

    const refundEl = document.querySelector(".pdp-tab #pdp-refund");
    if (refundEl) {
      const detailTitle = refundEl.dataset.accSection;
      addEntry(refundEl, `refund`, "product-details-refund", `${detailTitle}`);
    }

    const allReviewsEl = document.querySelector(".pdp-tab #pdp-allreviews");
    if (allReviewsEl) {
      const detailTitle = allReviewsEl.dataset.accSection;
      addEntry(
        allReviewsEl,
        `all-reviews`,
        "product-details-reviews",
        `${detailTitle}`,
      );
    }

    return { extractedList, dataMap };
  }

  // Remove existing instance if any (allows clean hot reloading)
  const existingRoot = document.getElementById("pdp-nano-assistant-root");
  if (existingRoot) {
    existingRoot.remove();
    cleanupHighlights();
  }

  // --- Event Handlers ---
  function toggleDrawer(force) {
    state.active = typeof force === "boolean" ? force : !state.active;
    const drawer = shadow.querySelector(".drawer");
    const fab = shadow.querySelector(".fab");
    if (drawer) {
      if (state.active) drawer.classList.add("open");
      else drawer.classList.remove("open");
    }
    if (fab) {
      if (state.active) fab.classList.add("active");
      else fab.classList.remove("active");
    }
  }

  function handleReset() {
    cleanupHighlights();
    const container = document.getElementById("demo-pdp-container");
    if (container) {
      container.remove();
    }
    state.question = "";
    state.highlighted = [];
    state.logs = [];
    state.finalResult = null;
    state.loading = false;
    state.dataMap = {};
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
      item.element.scrollIntoView({ behavior: "smooth", block: "center" });

      // Temporary flash highlight effect
      const origBox = item.element.style.boxShadow;
      const origBorder = item.element.style.border;
      item.element.style.boxShadow = "0 0 35px #a855f7";
      item.element.style.border = "3px solid #a855f7";
      setTimeout(() => {
        const isHighlighted = state.highlighted.some((h) => h.id === id);
        if (isHighlighted) {
          item.element.style.boxShadow = "0 0 20px rgba(99, 102, 241, 0.6)";
          item.element.style.border = "3px solid #6366f1";
        } else {
          item.element.style.boxShadow = origBox;
          item.element.style.border = origBorder;
        }
      }, 1500);
    }
  }

  // Register Global Esc toggle
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.active) {
      toggleDrawer(false);
    }
  });

  // Setup UI Container and Shadow DOM
  const root = document.createElement("div");
  root.id = "pdp-nano-assistant-root";
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });

  // Add Font stylesheet links
  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap";
  shadow.appendChild(fontLink);

  // API Check
  async function checkGeminiNano() {
    const lm = window.LanguageModel;
    if (!lm) {
      return {
        available: false,
        reason: "Gemini Nano Prompt API is missing in window.LanguageModel.",
      };
    }

    try {
      const isAvailable = await lm.availability();
      if (isAvailable !== "available") {
        return {
          available: false,
          reason:
            'Gemini Nano model is not ready or downloading. Check chrome://components -> "Optimization Guide On Device Model".',
        };
      }
      return { available: true };
    } catch (e) {
      return {
        available: false,
        reason: `Error checking availability: ${e.message}`,
      };
    }
  }

  // Initialize
  await (async function () {
    renderUI();
    const status = await checkGeminiNano();
    if (status.available) {
      state.apiStatus = "ready";
    } else {
      state.apiStatus = "error";
      state.apiStatusReason = status.reason;
      console.warn(
        "Chrome Gemini Nano not detected or not ready.",
        status.reason,
      );
    }
    renderUI();
  })();

  // --- UI Renderer ---
  function renderUI() {
    const children = Array.from(shadow.children);
    children.forEach((child) => {
      if (child.tagName !== "LINK") {
        child.remove();
      }
    });

    const style = document.createElement("style");
    style.textContent = getCSS();
    shadow.appendChild(style);

    // FAB Button
    const fab = document.createElement("div");
    fab.className = `fab ${state.active ? "active" : ""} ${state.loading ? "pulse" : ""}`;
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z" fill="#ffffff"/>
      </svg>
    `;
    fab.addEventListener("click", () => toggleDrawer());
    shadow.appendChild(fab);

    // Drawer Body
    const drawer = document.createElement("div");
    drawer.className = `drawer ${state.active ? "open" : ""}`;

    // Header
    const header = document.createElement("div");
    header.className = "header";
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
        <button class="icon-btn ${state.showDevLogs ? "active" : ""}" id="btn-dev-toggle" title="Toggle Developer Logs">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </button>
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
    const statusBar = document.createElement("div");
    statusBar.className = "status-bar";
    let statusText = "Gemini Nano Ready";
    let dotClass = "ready";
    if (state.apiStatus === "checking") {
      statusText = "Checking Gemini Nano...";
      dotClass = "checking";
    } else if (state.apiStatus === "error") {
      statusText = "Nano API Unsupported";
      dotClass = "error";
    }

    statusBar.innerHTML = `
      <div class="status-indicator">
        <span class="status-dot ${dotClass}"></span>
        <span>${statusText}</span>
      </div>
    `;
    drawer.appendChild(statusBar);

    // Content container
    const content = document.createElement("div");
    content.className = "content";

    if (state.apiStatus === "error") {
      const warning = document.createElement("div");
      warning.className = "warning-card";
      warning.innerHTML = `
        <h4>Gemini Nano Required</h4>
        <p>This assistant runs local ReAct reasoning over PDP data using Chrome Gemini Nano. To configure your browser:</p>
        <ol>
          <li>Open <b>chrome://flags/#optimization-guide-on-device-model</b> and select <b>Enabled (BypassPerfRequirement)</b>.</li>
          <li>Open <b>chrome://flags/#prompt-api-for-gemini-nano</b> and select <b>Enabled</b>.</li>
          <li>Relaunch Chrome.</li>
          <li>Open <b>chrome://components</b>, find <b>Optimization Guide On Device Model</b>, and click "Check for update" to start downloading the model.</li>
        </ol>
      `;
      content.appendChild(warning);
    } else {
      // Search input
      const searchForm = document.createElement("form");
      searchForm.className = "search-form";
      searchForm.innerHTML = `
        <input type="text" class="search-input" placeholder="Ask a question about this product..." value="${state.question}" ${state.loading ? "disabled" : ""}>
        <button type="submit" class="send-btn" ${state.loading || !state.question.trim() ? "disabled" : ""}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      `;
      searchForm.addEventListener("submit", handleQuerySubmit);

      const inputField = searchForm.querySelector(".search-input");
      inputField.addEventListener("input", (e) => {
        state.question = e.target.value;
        const sendBtn = searchForm.querySelector(".send-btn");
        if (sendBtn) sendBtn.disabled = state.loading || !state.question.trim();
      });

      content.appendChild(searchForm);

      // Suggestions
      const quickQs = document.createElement("div");
      quickQs.className = "quick-questions";
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
      quickQs.querySelectorAll(".pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          state.question = pill.getAttribute("data-q");
          runAssistant();
        });
      });
      if (state.loading) {
        quickQs.querySelectorAll(".pill").forEach((p) => (p.disabled = true));
      }
      content.appendChild(quickQs);

      // Console logs
      if (state.showDevLogs && state.logs.length > 0) {
        const consoleWrapper = document.createElement("div");
        consoleWrapper.style.display = "flex";
        consoleWrapper.style.flexDirection = "column";
        consoleWrapper.style.gap = "8px";

        consoleWrapper.innerHTML = `<div class="quick-label">Agentic ReAct Loop Activity</div>`;
        const consoleEl = document.createElement("div");
        consoleEl.className = "console";

        state.logs.forEach((log) => {
          const step = document.createElement("div");
          step.className = `console-step ${log.type}`;

          let label = "Thought";
          let labelClass = "think";
          if (log.type === "action") {
            label = "Action";
            labelClass = "act";
          } else if (log.type === "observation") {
            label = "Observation";
            labelClass = "obs";
          }

          step.innerHTML = `
            <div class="console-label ${labelClass}">${label}</div>
            <div style="white-space: pre-wrap;">${log.text}</div>
          `;

          // Render interactive Jump/Goto button next to the section data log
          if (log.sectionId && state.dataMap[log.sectionId]) {
            const gotoBtn = document.createElement("button");
            gotoBtn.className = "btn-locate";
            gotoBtn.style.cssText =
              "margin-top: 6px; font-size: 10px; padding: 4px 8px; font-family: inherit; display: inline-flex; align-items: center; gap: 4px;";
            gotoBtn.innerHTML = `
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(45deg);">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              Go to Section
            `;
            gotoBtn.addEventListener("click", () =>
              locateElement(log.sectionId),
            );
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

      // Shimmer loading card or consumer-friendly progress indicator
      if (state.loading) {
        if (!state.showDevLogs) {
          // Render a beautiful, consumer-friendly scanning status card
          const progressCard = document.createElement("div");
          progressCard.className = "result-card";

          let statusMessage = "Analyzing product details...";
          if (state.logs.length > 0) {
            const lastLog = state.logs[state.logs.length - 1];
            if (lastLog.type === "think") {
              statusMessage = "Formulating analysis strategy...";
            } else if (lastLog.type === "action") {
              if (lastLog.text.includes("read_section")) {
                statusMessage = "Inspecting product specifications...";
              } else if (lastLog.text.includes("toggle_for_highlight")) {
                statusMessage =
                  "Highlighting discovered evidence on the page...";
              } else if (lastLog.text.includes("summarize_technologies")) {
                statusMessage = "Summarizing core technologies...";
              } else {
                statusMessage = "Retrieving product elements...";
              }
            } else if (lastLog.type === "observation") {
              statusMessage = "Evaluating parsed information...";
            }
          }

          progressCard.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px;">
              <div class="loader-radar">
                <div class="radar-ping"></div>
                <div class="radar-dot"></div>
              </div>
              <div style="flex: 1;">
                <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                  AI Assistant is Analyzing
                  <span style="display: inline-flex; gap: 2px;">
                    <span style="animation: dot-glow 1s infinite alternate; width: 4px; height: 4px; background: #fff; border-radius: 50%;"></span>
                    <span style="animation: dot-glow 1s infinite alternate 0.2s; width: 4px; height: 4px; background: #fff; border-radius: 50%;"></span>
                    <span style="animation: dot-glow 1s infinite alternate 0.4s; width: 4px; height: 4px; background: #fff; border-radius: 50%;"></span>
                  </span>
                </h4>
                <p style="margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.4;">${statusMessage}</p>
              </div>
            </div>
          `;
          content.appendChild(progressCard);
        } else if (state.logs.length === 0) {
          const loadingCard = document.createElement("div");
          loadingCard.className = "result-card";
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
        }
      } else if (state.finalResult) {
        const resultCard = document.createElement("div");
        resultCard.className = "result-card";
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
        const hPanel = document.createElement("div");
        hPanel.className = "highlights-panel";
        hPanel.innerHTML = `<div class="quick-label">Highlighted Evidence (${state.highlighted.length})</div>`;

        state.highlighted.forEach((h, idx) => {
          const hItem = document.createElement("div");
          hItem.className = "highlight-item";
          hItem.innerHTML = `
            <div class="highlight-info">
              <div class="highlight-id">Evidence #${idx + 1} (${h.id})</div>
              <div class="highlight-explanation">${h.explanation}</div>
            </div>
            <button class="btn-locate" data-id="${h.id}">Locate</button>
          `;
          hItem
            .querySelector(".btn-locate")
            .addEventListener("click", () => locateElement(h.id));
          hPanel.appendChild(hItem);
        });
        content.appendChild(hPanel);
      }
    }

    drawer.appendChild(content);
    shadow.appendChild(drawer);

    // Bind footer Actions
    const devToggleBtn = drawer.querySelector("#btn-dev-toggle");
    if (devToggleBtn) {
      devToggleBtn.addEventListener("click", () => {
        state.showDevLogs = !state.showDevLogs;
        renderUI();
      });
    }

    const closeBtn = drawer.querySelector("#btn-close");
    if (closeBtn) closeBtn.addEventListener("click", () => toggleDrawer(false));

    const resetBtn = drawer.querySelector("#btn-reset");
    if (resetBtn) resetBtn.addEventListener("click", handleReset);
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
      
      .icon-btn.active {
        color: var(--secondary);
        background: rgba(168, 85, 247, 0.15);
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

      .loader-radar {
        position: relative;
        width: 36px;
        height: 36px;
        background: rgba(99, 102, 241, 0.15);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(99, 102, 241, 0.3);
      }
      
      .radar-ping {
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: var(--primary);
        opacity: 0.7;
        animation: radar-pulsate 1.5s infinite ease-out;
      }
      
      .radar-dot {
        width: 8px;
        height: 8px;
        background: var(--primary);
        border-radius: 50%;
        box-shadow: 0 0 10px var(--primary);
        z-index: 1;
      }
      
      @keyframes radar-pulsate {
        0% { transform: scale(1); opacity: 0.6; }
        100% { transform: scale(1.8); opacity: 0; }
      }

      @keyframes dot-glow {
        from { opacity: 0.2; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1.2); }
      }
    `;
  }
})();
