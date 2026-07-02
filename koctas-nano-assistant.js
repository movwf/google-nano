/*!
 * PDP Nano Assistant
 * -------------------------------------------------------------------------
 * A self-contained, on-device shopping assistant for any product page.
 * Paste the console loader snippet (see README) and this file runs entirely
 * client-side: it reads the page you're already on, and answers questions
 * using Chrome's built-in Gemini Nano model (window Prompt API / `LanguageModel`).
 *
 * No product content, page text, or questions ever leave the browser.
 * There is no server component. If Chrome's on-device model isn't available,
 * the widget says so plainly instead of silently failing or calling a cloud API.
 *
 * Reference build target: Koçtaş PDP
 * https://www.koctas.com.tr/evdemo-serra-3-kisilik-bazali-kanepe-cekyat-koltuk-gri/p/5002920720
 * but extraction is generic (JSON-LD Product schema + DOM heuristics), so this
 * runs on most e-commerce PDPs, not just Koçtaş.
 * -------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__pdpNanoAssistantLoaded) {
    console.warn('[PDP Nano Assistant] Already loaded on this page — skipping re-init.');
    return;
  }
  window.__pdpNanoAssistantLoaded = true;

  console.log(
    '%cPDP Nano Assistant%c loaded — scanning page & checking for local AI…',
    'color:#D97D3D;font-weight:700;font-family:monospace',
    'color:inherit;font-weight:400'
  );

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  var CONFIG = {
    maxContextChars: 3200,
    maxSpecs: 18,
    maxBullets: 8,
    maxDescriptionChars: 1200,
    maxHiddenFields: 50,
    stabilityAttempts: 10,
    stabilityIntervalMs: 600
  };

  var SUGGESTED_QUESTIONS = [
    'What color is this?',
    'Does it have storage?',
    'How many people is it for?',
    'Good for a living room?',
    'What should I check before buying?'
  ];

  // ---------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function textOf(el) {
    return el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function safeJSONParse(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  function clamp(str, max) {
    if (!str) return str;
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  // ---------------------------------------------------------------------
  // Extraction: JSON-LD (Product / BreadcrumbList schema.org)
  // ---------------------------------------------------------------------
  function collectJSONLD() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('script[type="application/ld+json"]'));
    var products = [];
    var breadcrumbs = [];
    nodes.forEach(function (node) {
      var data = safeJSONParse(node.textContent);
      if (!data) return;
      var items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      items.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var type = item['@type'];
        var typeStr = Array.isArray(type) ? type.join(',') : (type || '');
        if (/product/i.test(typeStr)) products.push(item);
        if (/breadcrumblist/i.test(typeStr)) breadcrumbs.push(item);
      });
    });
    return { products: products, breadcrumbs: breadcrumbs };
  }

  // ---------------------------------------------------------------------
  // Extraction: DOM heuristics (fallback / supplement to JSON-LD)
  // ---------------------------------------------------------------------
  function extractBreadcrumbFromDOM() {
    var candidates = document.querySelectorAll(
      '[class*="breadcrumb" i], nav[aria-label*="breadcrumb" i], [class*="Breadcrumb"]'
    );
    for (var i = 0; i < candidates.length; i++) {
      var links = Array.prototype.slice
        .call(candidates[i].querySelectorAll('a, span, li'))
        .map(textOf)
        .filter(Boolean);
      if (links.length >= 2 && links.length <= 8) return links;
    }
    return [];
  }

  function extractPriceFromDOM() {
    // Matches "₺1.234,56", "1.234 TL", "1234,56₺", plain "TL 1.234" etc.
    var priceRe = /(?:₺\s?[\d.,]+|[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:TL|₺|TRY))/i;
    var nodes = document.querySelectorAll(
      '[class*="price" i], [class*="fiyat" i], [id*="price" i], [id*="fiyat" i]'
    );
    var found = [];
    nodes.forEach(function (n) {
      var t = textOf(n);
      if (!t || t.length > 40) return;
      var m = t.match(priceRe);
      if (m) {
        var strike = !!n.closest('del, s, [class*="old" i], [class*="strike" i], [style*="line-through"]');
        found.push({ text: m[0], strike: strike });
      }
    });
    var nonStrike = found.filter(function (f) { return !f.strike; })[0];
    var was = found.filter(function (f) { return f.strike; })[0];
    return {
      price: (nonStrike || found[0] || {}).text || null,
      wasPrice: was ? was.text : null
    };
  }

  function extractSpecsFromDOM() {
    var specs = [];
    var seenKeys = {};

    function pushPair(k, v) {
      k = (k || '').trim();
      v = (v || '').trim();
      if (!k || !v || k.length > 60 || v.length > 220) return;
      var key = k.toLowerCase();
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      specs.push([k, v]);
    }

    document.querySelectorAll('dl').forEach(function (dl) {
      var dts = dl.querySelectorAll('dt');
      dts.forEach(function (dt) {
        var dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') pushPair(textOf(dt), textOf(dd));
      });
    });

    document.querySelectorAll('table').forEach(function (table) {
      table.querySelectorAll('tr').forEach(function (tr) {
        var cells = tr.querySelectorAll('th, td');
        if (cells.length === 2) pushPair(textOf(cells[0]), textOf(cells[1]));
      });
    });

    return specs.slice(0, CONFIG.maxSpecs);
  }

  function extractDescriptionFromDOM() {
    var candidates = document.querySelectorAll(
      '[class*="description" i], [class*="aciklama" i], [class*="tanim" i], [id*="description" i], [id*="aciklama" i]'
    );
    var best = '';
    candidates.forEach(function (c) {
      var t = textOf(c);
      if (t.length > best.length && t.length < 6000) best = t;
    });
    return best;
  }

  function extractBulletsFromDOM() {
    var lis = document.querySelectorAll(
      '[class*="description" i] li, [class*="feature" i] li, [class*="ozellik" i] li, ' +
      '[class*="highlight" i] li, [class*="aciklama" i] li, [class*="tanim" i] li'
    );
    var out = [];
    lis.forEach(function (li) {
      var t = textOf(li);
      if (t && t.length < 200) out.push(t);
    });
    return out.slice(0, CONFIG.maxBullets);
  }

  function extractAvailability() {
    var body = (document.body && document.body.innerText) || '';
    if (/tükendi|stokta yok|stok bulunmam/i.test(body)) return 'Page shows out-of-stock wording.';
    if (/sepete\s?ekle|hemen\s?al|satın\s?al/i.test(body)) return 'Page shows an "add to cart / buy" control (in-stock signal).';
    return null;
  }

  // ---------------------------------------------------------------------
  // Extraction: input[type="hidden"] fields
  // Many PDPs (a lot of Turkish e-commerce sites are ASP.NET WebForms under
  // the hood, e.g. id="ctl00_ContentPlaceHolder1_hdnRenk") stash real product
  // facts — color code, SKU, price, variant — in hidden inputs that never
  // make it into JSON-LD or visible markup. We read them, but filter hard:
  // this is the one source most likely to also contain CSRF tokens, view
  // state, and session junk that has nothing to do with the product.
  // ---------------------------------------------------------------------
  var HIDDEN_NOISE_NAME_RE = /csrf|__|token|viewstate|antiforgery|verificationtoken|eventvalidation|captcha|nonce|session|honeypot|analytics|gtm|utm|referr|cookie/i;
  var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var PRICE_NAME_RE = /price|fiyat|tutar|ucret/i;
  var SKU_NAME_RE = /sku|stokkod|urunkod|productcode|itemcode|urunid|productid|modelkod/i;

  function humanizeHiddenName(raw) {
    if (!raw) return '';
    // ASP.NET control trees look like "ctl00$ContentPlaceHolder1$hdnRenk" or
    // "ctl00_ContentPlaceHolder1_hdnRenk" — the meaningful part is the last segment.
    var seg = raw.split(/[$]/).pop();
    var parts = seg.split('_');
    seg = parts[parts.length - 1] || seg;
    seg = seg.replace(/^(hdn|hf|hid|txt|inp|lbl)[-_]?/i, '');
    seg = seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    if (!seg) return '';
    return seg.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function collectHiddenInputPairs() {
    var inputs = document.querySelectorAll('input[type="hidden"]');
    var out = [];
    var seenLabels = {};
    for (var i = 0; i < inputs.length && out.length < 40; i++) {
      var el = inputs[i];
      var raw = (el.value || '').trim();
      if (!raw || raw.length > 80) continue; // empty, or a blob (serialized JSON, long token, etc.)
      var rawName = el.name || el.id || '';
      if (!rawName || HIDDEN_NOISE_NAME_RE.test(rawName)) continue;
      if (GUID_RE.test(raw)) continue;
      if (/^https?:\/\//i.test(raw)) continue; // URLs aren't useful as a spec fact here
      if (!/\s/.test(raw) && raw.length > 40) continue; // long, spaceless -> likely a hash/token, not a fact
      var label = humanizeHiddenName(rawName);
      if (!label || label.length > 40) continue;
      var key = label.toLowerCase();
      if (seenLabels[key]) continue;
      seenLabels[key] = true;
      out.push({ name: rawName, label: label, value: raw });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Build unified product context
  // ---------------------------------------------------------------------
  function buildContext() {
    var jsonld = collectJSONLD();
    var p = jsonld.products[0] || {};
    var offers = p.offers ? (Array.isArray(p.offers) ? p.offers[0] : p.offers) : null;

    var title =
      p.name ||
      (document.querySelector('meta[property="og:title"]') || {}).content ||
      document.title ||
      '';

    var metaDescription = (document.querySelector('meta[name="description"], meta[property="og:description"]') || {}).content || '';
    var description = p.description || metaDescription || extractDescriptionFromDOM();

    var image =
      (p.image && (Array.isArray(p.image) ? p.image[0] : p.image)) ||
      (document.querySelector('meta[property="og:image"]') || {}).content ||
      null;

    var jsonPrice = offers && offers.price ? (offers.price + ' ' + (offers.priceCurrency || '')).trim() : null;
    var brand = (p.brand && (p.brand.name || p.brand)) || null;
    var sku = p.sku || p.mpn || null;

    var domPrice = extractPriceFromDOM();
    var specs = extractSpecsFromDOM();
    var bullets = extractBulletsFromDOM();
    var hiddenPairs = collectHiddenInputPairs();

    var price = jsonPrice || domPrice.price;
    var consumedHiddenNames = {};

    if (!price) {
      var priceHidden = hiddenPairs.filter(function (h) {
        return PRICE_NAME_RE.test(h.name) && /^[\d.,]+$/.test(h.value);
      })[0];
      if (priceHidden) {
        price = priceHidden.value + ' (currency not confirmed on page — treat as approximate)';
        consumedHiddenNames[priceHidden.name] = true;
      }
    }
    if (!sku) {
      var skuHidden = hiddenPairs.filter(function (h) { return SKU_NAME_RE.test(h.name); })[0];
      if (skuHidden) {
        sku = skuHidden.value;
        consumedHiddenNames[skuHidden.name] = true;
      }
    }

    var specKeysLower = {};
    specs.forEach(function (kv) { specKeysLower[kv[0].toLowerCase()] = true; });

    var hiddenFields = hiddenPairs
      .filter(function (h) { return !consumedHiddenNames[h.name] && !specKeysLower[h.label.toLowerCase()]; })
      .slice(0, CONFIG.maxHiddenFields)
      .map(function (h) { return [h.label, h.value]; });

    var crumbsJSON = [];
    if (jsonld.breadcrumbs[0] && Array.isArray(jsonld.breadcrumbs[0].itemListElement)) {
      crumbsJSON = jsonld.breadcrumbs[0].itemListElement
        .map(function (i) { return i.name || (i.item && i.item.name); })
        .filter(Boolean);
    }
    var crumbs = crumbsJSON.length ? crumbsJSON : extractBreadcrumbFromDOM();

    return {
      title: (title || '').trim(),
      url: location.href,
      breadcrumbs: crumbs,
      price: price,
      wasPrice: domPrice.wasPrice,
      brand: brand,
      sku: sku,
      specs: specs,
      bullets: bullets,
      hiddenFields: hiddenFields,
      description: clamp((description || '').trim(), CONFIG.maxDescriptionChars),
      availabilitySignal: extractAvailability(),
      image: image
    };
  }

  function digestAndFields(ctx) {
    var lines = [];
    var fields = [];

    lines.push('Title: ' + (ctx.title || '(not found)'));
    if (ctx.breadcrumbs.length) {
      lines.push('Category / breadcrumb: ' + ctx.breadcrumbs.join(' > '));
      fields.push('breadcrumb');
    }
    if (ctx.price) {
      lines.push('Price: ' + ctx.price + (ctx.wasPrice ? ' (was ' + ctx.wasPrice + ')' : ''));
      fields.push('price');
    }
    if (ctx.brand) { lines.push('Brand: ' + ctx.brand); fields.push('brand'); }
    if (ctx.sku) { lines.push('SKU / product code: ' + ctx.sku); fields.push('sku'); }
    if (ctx.availabilitySignal) { lines.push('Availability signal: ' + ctx.availabilitySignal); fields.push('availability'); }
    if (ctx.specs.length) {
      lines.push('Specifications:');
      ctx.specs.forEach(function (kv) { lines.push('- ' + kv[0] + ': ' + kv[1]); });
      fields.push('specs');
    }
    if (ctx.bullets.length) {
      lines.push('Listed highlights:');
      ctx.bullets.forEach(function (b) { lines.push('- ' + b); });
      fields.push('highlights');
    }
    if (ctx.description) {
      lines.push('Description: ' + ctx.description);
      fields.push('description');
    }
    if (ctx.hiddenFields.length) {
      lines.push('Additional page data (from hidden form fields, not visibly shown to the shopper):');
      ctx.hiddenFields.forEach(function (kv) { lines.push('- ' + kv[0] + ': ' + kv[1]); });
      fields.push('hidden-fields');
    }

    console.log(ctx);

    var text = clamp(lines.join('\n'), CONFIG.maxContextChars);
    var sparse = fields.length === 0;

    console.log(text);

    return { text: text, fields: fields, sparse: sparse };
  }

  function waitForStableContext(cb) {
    var last = null;
    var count = 0;
    function tick() {
      count++;
      var ctx = buildContext();
      var d = digestAndFields(ctx);
      var looksReady = ctx.title && !d.sparse;
      if ((looksReady && d.text === last) || count >= CONFIG.stabilityAttempts) {
        cb(ctx, d);
        return;
      }
      last = d.text;
      setTimeout(tick, CONFIG.stabilityIntervalMs);
    }
    tick();
  }

  // ---------------------------------------------------------------------
  // UI: shadow-DOM widget
  // ---------------------------------------------------------------------
  var STYLE =
    '<style>' +
    ':host,*{box-sizing:border-box;}' +
    '.root{position:fixed;bottom:20px;right:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#F3EFE9;}' +
    '.chip{display:flex;align-items:center;gap:8px;background:#242322;border:1px solid rgba(255,255,255,0.10);' +
    'color:#F3EFE9;padding:10px 16px;border-radius:999px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.35);' +
    'font-size:13px;font-weight:600;letter-spacing:0.01em;transition:transform .15s ease,box-shadow .15s ease;}' +
    '.chip:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,0.4);}' +
    '.chip:focus-visible{outline:2px solid #D97D3D;outline-offset:2px;}' +
    '.dot{width:8px;height:8px;border-radius:50%;flex:none;}' +
    '.dot-green{background:#7FB88F;}' +
    '.dot-amber{background:#D97D3D;}' +
    '.dot-red{background:#D9645A;}' +
    '.dot-gray{background:#6B6560;}' +
    '@media (prefers-reduced-motion:no-preference){.dot-pulse{animation:pulse 1.4s ease-in-out infinite;}}' +
    '@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}' +
    '.panel{display:none;flex-direction:column;position:absolute;bottom:52px;right:0;width:min(380px,92vw);' +
    'height:min(540px,72vh);background:#1C1B1A;border:1px solid rgba(255,255,255,0.10);border-radius:16px;' +
    'box-shadow:0 20px 60px rgba(0,0,0,0.5);overflow:hidden;}' +
    '.root.open .panel{display:flex;}' +
    '.root.open .chip .chip-label{}' +
    '.hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08);background:#201F1E;}' +
    '.hdr-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:#F3EFE9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.hdr-sub{font-family:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;font-size:10px;color:#A69C8F;letter-spacing:.03em;text-transform:uppercase;}' +
    '.iconbtn{background:none;border:none;color:#A69C8F;cursor:pointer;padding:4px 6px;border-radius:6px;font-size:14px;line-height:1;}' +
    '.iconbtn:hover{color:#F3EFE9;background:rgba(255,255,255,0.06);}' +
    '.iconbtn:focus-visible{outline:2px solid #D97D3D;outline-offset:1px;}' +
    '.grounded{padding:8px 14px;font-family:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;font-size:10px;' +
    'color:#A69C8F;border-bottom:1px solid rgba(255,255,255,0.06);letter-spacing:.02em;}' +
    '.grounded b{color:#D97D3D;font-weight:600;}' +
    '.warn{padding:8px 14px;font-size:11.5px;color:#E5B98B;background:rgba(217,125,61,0.10);border-bottom:1px solid rgba(255,255,255,0.06);}' +
    '.body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}' +
    '.centerbox{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:10px;padding:6px 4px;}' +
    '.centerbox p{font-size:12.5px;line-height:1.5;color:#C9C2B8;margin:0;}' +
    '.centerbox a{color:#D97D3D;}' +
    '.spinner{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.15);border-top-color:#D97D3D;flex:none;}' +
    '@media (prefers-reduced-motion:no-preference){.spinner{animation:spin .8s linear infinite;}}' +
    '@keyframes spin{to{transform:rotate(360deg);}}' +
    '.progress{width:100%;height:6px;border-radius:4px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:6px;}' +
    '.progress > i{display:block;height:100%;background:#D97D3D;transition:width .2s ease;}' +
    '.btn{background:#D97D3D;color:#1C1B1A;border:none;padding:9px 14px;border-radius:9px;font-size:12.5px;font-weight:700;cursor:pointer;}' +
    '.btn:hover{filter:brightness(1.08);}' +
    '.btn:focus-visible{outline:2px solid #F3EFE9;outline-offset:2px;}' +
    '.btn-ghost{background:none;border:1px solid rgba(255,255,255,0.16);color:#F3EFE9;}' +
    '.msg{max-width:86%;padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;}' +
    '.msg.user{align-self:flex-end;background:rgba(217,125,61,0.16);border:1px solid rgba(217,125,61,0.30);border-bottom-right-radius:3px;}' +
    '.msg.assistant{align-self:flex-start;background:#242322;border:1px solid rgba(255,255,255,0.08);border-bottom-left-radius:3px;}' +
    '.msg.assistant.err{background:rgba(217,100,90,0.12);border-color:rgba(217,100,90,0.35);}' +
    '.thinking{align-self:flex-start;display:flex;align-items:center;gap:6px;color:#A69C8F;font-size:12px;padding:2px 2px;}' +
    '.suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}' +
    '.sugg{background:#242322;border:1px solid rgba(255,255,255,0.10);color:#C9C2B8;font-size:11.5px;padding:6px 10px;' +
    'border-radius:999px;cursor:pointer;text-align:left;}' +
    '.sugg:hover{border-color:#D97D3D;color:#F3EFE9;}' +
    '.inputwrap{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,0.08);background:#201F1E;}' +
    '.inputwrap input{flex:1;background:#141312;border:1px solid rgba(255,255,255,0.12);color:#F3EFE9;border-radius:9px;' +
    'padding:9px 10px;font-size:13px;min-width:0;}' +
    '.inputwrap input:focus-visible{outline:2px solid #D97D3D;outline-offset:1px;}' +
    '.inputwrap input::placeholder{color:#6B6560;}' +
    '.inputwrap button{flex:none;}' +
    '.footer{padding:6px 14px 10px;font-size:10px;color:#6B6560;font-family:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;}' +
    '.flagbox{background:#141312;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:8px 9px;font-family:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;font-size:11px;color:#D97D3D;user-select:all;}' +
    '</style>';

  var host = document.createElement('div');
  host.style.all = 'initial';
  document.documentElement.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });

  var state = {
    open: false,
    status: 'checking', // checking | unsupported-browser | unsupported-device | downloadable | downloading | ready | error
    progress: 0,
    session: null,
    ctx: null,
    digest: '',
    fields: [],
    sparse: false,
    history: [], // {role:'user'|'assistant', text, error}
    thinking: false,
    errorMessage: '',
    isRescan: false
  };

  function statusMeta(s) {
    return (
      {
        checking: { label: 'Scanning page…', dot: 'dot-amber dot-pulse' },
        'unsupported-browser': { label: 'Local AI unavailable', dot: 'dot-gray' },
        'unsupported-device': { label: 'Local AI unavailable', dot: 'dot-gray' },
        downloadable: { label: 'Enable local AI', dot: 'dot-amber' },
        downloading: { label: 'Downloading model… ' + state.progress + '%', dot: 'dot-amber dot-pulse' },
        starting: { label: 'Starting local AI…', dot: 'dot-amber dot-pulse' },
        ready: { label: 'Ask about this product', dot: 'dot-green' },
        error: { label: 'Local AI error', dot: 'dot-red' }
      }[s] || { label: 'Assistant', dot: 'dot-gray' }
    );
  }

  function chipTemplate() {
    var meta = statusMeta(state.status);
    var label = state.open ? 'Close' : meta.label;
    return (
      '<button class="chip" data-action="toggle" aria-expanded="' + (state.open ? 'true' : 'false') + '">' +
      '<span class="dot ' + meta.dot + '"></span>' +
      '<span class="chip-label">' + esc(label) + '</span>' +
      '</button>'
    );
  }

  function headerTemplate() {
    var title = (state.ctx && state.ctx.title) || document.title || 'This page';
    return (
      '<div class="hdr">' +
      '<div style="min-width:0;flex:1;">' +
      '<div class="hdr-title">' + esc(clamp(title, 46)) + '</div>' +
      '<div class="hdr-sub">On-device · Gemini Nano</div>' +
      '</div>' +
      (state.status === 'ready'
        ? '<button class="iconbtn" data-action="rescan" title="Re-scan this page">⟳</button>'
        : '') +
      '<button class="iconbtn" data-action="toggle" title="Close">✕</button>' +
      '</div>'
    );
  }

  function groundedStrip() {
    if (!state.fields || !state.fields.length) return '';
    return '<div class="grounded"><b>GROUNDED IN</b> · ' + esc(state.fields.join(' · ')) + '</div>';
  }

  function sparseWarning() {
    if (!state.sparse) return '';
    return '<div class="warn">⚠ Limited product data found on this page. Answers may be incomplete — try re-scanning after the page fully loads.</div>';
  }

  function loadingBody(text) {
    return '<div class="centerbox"><div class="spinner"></div><p>' + esc(text) + '</p></div>';
  }

  function unsupportedBody(kind) {
    var isBrowser = kind === 'unsupported-browser';
    var msg = isBrowser
      ? "This browser doesn't expose Chrome's on-device Prompt API. This assistant only works in a recent desktop Chrome (138+) with local AI enabled — not Firefox, Safari, or older Chrome builds."
      : "Chrome's on-device model reports it can't run on this device (unsupported hardware/OS, or insufficient storage/RAM).";
    return (
      '<div class="centerbox">' +
      '<p>' + esc(msg) + '</p>' +
      (isBrowser
        ? '<p>To enable it: open a new tab, visit these two flags, set both to <b>Enabled</b>, then relaunch Chrome:</p>' +
        '<div class="flagbox">chrome://flags/#optimization-guide-on-device-model</div>' +
        '<div class="flagbox">chrome://flags/#prompt-api-for-gemini-nano</div>' +
        '<p>Then reload this page and re-paste the assistant.</p>'
        : '') +
      '<p>No product answers are generated without local AI — this assistant never falls back to a cloud model.</p>' +
      '</div>'
    );
  }

  function errorBody() {
    return (
      '<div class="centerbox">' +
      '<p>Local AI hit an error while starting up:</p>' +
      '<div class="flagbox">' + esc(state.errorMessage || 'Unknown error') + '</div>' +
      '<button class="btn btn-ghost" data-action="retry">Try again</button>' +
      '</div>'
    );
  }

  function downloadableBody() {
    return (
      '<div class="centerbox">' +
      '<p>This device supports Gemini Nano, but the model hasn\'t been downloaded yet (~a few GB, one-time, cached by Chrome for every site).</p>' +
      '<button class="btn" data-action="download">Enable local AI</button>' +
      '</div>'
    );
  }

  function downloadingBody() {
    return (
      '<div class="centerbox" style="width:100%;">' +
      '<p>Downloading Gemini Nano to this device…</p>' +
      '<div class="progress"><i style="width:' + state.progress + '%"></i></div>' +
      '<p style="color:#6B6560;font-size:11px;">This only happens once per device. Feel free to keep this tab open.</p>' +
      '</div>'
    );
  }

  function chatBody() {
    var out = '';
    if (!state.history.length) {
      out +=
        '<div style="color:#A69C8F;font-size:12px;line-height:1.5;">' +
        'Ask me about this product — I only use what\'s on this page.' +
        '</div>' +
        '<div class="suggestions">' +
        SUGGESTED_QUESTIONS.map(function (q) {
          return '<button class="sugg" data-action="ask-suggested" data-q="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') +
        '</div>';
    }
    state.history.forEach(function (m) {
      out +=
        '<div class="msg ' + m.role + (m.error ? ' err' : '') + '">' + esc(m.text) + '</div>';
    });
    if (state.thinking) {
      out += '<div class="thinking"><div class="spinner" style="width:12px;height:12px;"></div> thinking…</div>';
    }
    return out;
  }

  function render() {
    var bodyInner = '';
    var showChat = false;

    if (state.status === 'unsupported-browser' || state.status === 'unsupported-device') {
      bodyInner = unsupportedBody(state.status);
    } else if (state.status === 'error') {
      bodyInner = errorBody();
    } else if (state.status === 'downloadable') {
      bodyInner = downloadableBody();
    } else if (state.status === 'downloading') {
      bodyInner = downloadingBody();
    } else if (state.status === 'checking') {
      bodyInner = loadingBody(state.isRescan ? 'Re-scanning this page for updated product details…' : 'Reading this page & checking for local AI…');
    } else if (state.status === 'starting') {
      bodyInner = loadingBody('Starting the on-device model…');
    } else if (state.status === 'ready') {
      showChat = true;
      bodyInner = chatBody();
    }

    var panel =
      '<div class="panel">' +
      headerTemplate() +
      (showChat ? groundedStrip() : '') +
      (showChat ? sparseWarning() : '') +
      '<div class="body" data-role="scrollbody">' + bodyInner + '</div>' +
      (showChat
        ? '<form class="inputwrap" data-action="submit">' +
        '<input type="text" name="q" placeholder="Ask a question about this product…" ' +
        (state.thinking ? 'disabled' : '') + ' autocomplete="off" />' +
        '<button class="btn" type="submit" ' + (state.thinking ? 'disabled' : '') + '>Ask</button>' +
        '</form>'
        : '') +
      '<div class="footer">Runs on-device via Chrome Gemini Nano · nothing sent to a server</div>' +
      '</div>';

    shadow.innerHTML = STYLE + '<div class="root ' + (state.open ? 'open' : '') + '">' + chipTemplate() + panel + '</div>';

    var scrollBody = shadow.querySelector('[data-role="scrollbody"]');
    if (scrollBody) scrollBody.scrollTop = scrollBody.scrollHeight;

    var input = shadow.querySelector('.inputwrap input');
    if (input && state._focusInput) {
      input.focus();
      state._focusInput = false;
    }
  }

  // ---------------------------------------------------------------------
  // Model lifecycle
  // ---------------------------------------------------------------------
  function buildSystemPrompt() {
    return [
      'You are a concise shopping assistant embedded directly on a single product page (PDP).',
      'Answer only using the PRODUCT CONTEXT below, extracted from the page the shopper is currently viewing.',
      "If the answer isn't present in the context, say plainly that the page doesn't mention it. Never invent specs, materials, dimensions, price, or stock status.",
      'Some context may be labeled as coming from hidden page fields rather than visible text — treat it as real page data, but note if a value looks like an internal code rather than a plain answer (e.g. a color code instead of a color name).',
      'Reply in the same language the shopper writes in. Keep answers to 2-4 sentences unless a short list is clearer.',
      'When useful, briefly note which part of the listing you used (e.g. "per the specifications" or "per the description").',
      '',
      'PRODUCT CONTEXT:',
      state.digest || '(no extractable product content was found on this page)'
    ].join('\n');
  }

  function createSession() {
    return LanguageModel.create({
      initialPrompts: [{ role: 'system', content: buildSystemPrompt() }],
      monitor: function (m) {
        m.addEventListener('downloadprogress', function (e) {
          state.progress = Math.round((e.loaded || 0) * 100);
          if (state.status === 'downloading') render();
        });
      }
    });
  }

  function ensureModel() {
    if (!('LanguageModel' in window)) {
      state.status = 'unsupported-browser';
      render();
      return;
    }
    LanguageModel.availability()
      .then(function (availability) {
        if (availability === 'unavailable') {
          state.status = 'unsupported-device';
          render();
          return;
        }
        if (availability === 'available') {
          state.status = 'starting'; // model is present; session init is near-instant, no download needed
          render();
          return createSession().then(function (session) {
            state.session = session;
            state.status = 'ready';
            render();
          });
        }
        // 'downloadable' -> needs an explicit, user-activated click to start the download
        state.status = 'downloadable';
        render();
      })
      .catch(function (e) {
        state.status = 'error';
        state.errorMessage = String((e && e.message) || e);
        render();
      });
  }

  function startDownloadFlow() {
    state.status = 'downloading';
    state.progress = 0;
    render();
    createSession()
      .then(function (session) {
        state.session = session;
        state.status = 'ready';
        render();
      })
      .catch(function (e) {
        state.status = 'error';
        state.errorMessage = String((e && e.message) || e);
        render();
      });
  }

  function ask(question) {
    question = (question || '').trim();
    if (!question || !state.session || state.thinking) return;
    state.history.push({ role: 'user', text: question });
    state.thinking = true;
    render();

    state.session
      .prompt(question)
      .then(function (answer) {
        state.history.push({ role: 'assistant', text: answer });
        state.thinking = false;
        render();
      })
      .catch(function (e) {
        var isQuota = (e && e.name === 'QuotaExceededError') || /quota/i.test(String(e));
        if (isQuota) {
          try { state.session.destroy && state.session.destroy(); } catch (e2) { }
          createSession()
            .then(function (session) {
              state.session = session;
              return session.prompt(question);
            })
            .then(function (answer) {
              state.history.push({ role: 'assistant', text: answer });
              state.thinking = false;
              render();
            })
            .catch(function () {
              state.history.push({
                role: 'assistant',
                error: true,
                text: 'This conversation got too long for the on-device model to hold in context. Try a shorter question, or hit ⟳ to reset with a fresh page scan.'
              });
              state.thinking = false;
              render();
            });
        } else {
          state.history.push({
            role: 'assistant',
            error: true,
            text: 'Local AI could not answer that (' + ((e && e.message) || 'unknown error') + ').'
          });
          state.thinking = false;
          render();
        }
      });
  }

  function rescan() {
    state.status = 'checking';
    state.isRescan = true;
    state.history.push({ role: 'assistant', text: '🔄 Re-scanning this page for updated product details…' });
    render();
    waitForStableContext(function (ctx, digest) {
      state.ctx = ctx;
      state.digest = digest.text;
      state.fields = digest.fields;
      state.sparse = digest.sparse;
      try { state.session && state.session.destroy && state.session.destroy(); } catch (e) { }
      state.session = null;
      ensureModel();
    });
  }

  // ---------------------------------------------------------------------
  // Event delegation (bound once)
  // ---------------------------------------------------------------------
  shadow.addEventListener('click', function (evt) {
    var actionEl = evt.target.closest ? evt.target.closest('[data-action]') : null;
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');

    if (action === 'toggle') {
      state.open = !state.open;
      state._focusInput = state.open && state.status === 'ready';
      render();
    } else if (action === 'download') {
      startDownloadFlow();
    } else if (action === 'retry') {
      state.status = 'checking';
      render();
      ensureModel();
    } else if (action === 'ask-suggested') {
      ask(actionEl.getAttribute('data-q'));
    } else if (action === 'rescan') {
      rescan();
    }
  });

  shadow.addEventListener('submit', function (evt) {
    var form = evt.target.closest ? evt.target.closest('[data-action="submit"]') : null;
    if (!form) return;
    evt.preventDefault();
    var input = form.querySelector('input[name="q"]');
    var q = input ? input.value : '';
    if (input) input.value = '';
    ask(q);
  });

  // Free GPU/RAM if the tab is closing.
  window.addEventListener('beforeunload', function () {
    try { state.session && state.session.destroy && state.session.destroy(); } catch (e) { }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  render();
  waitForStableContext(function (ctx, digest) {
    state.ctx = ctx;
    state.digest = digest.text;
    state.fields = digest.fields;
    state.sparse = digest.sparse;
    ensureModel();
  });
})();
