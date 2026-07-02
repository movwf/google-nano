# PDP Nano Assistant — How to Run

This guide explains how to run the **PDP Nano Assistant** on the local demo page or inject it onto a live product detail page (PDP) using **Chrome's built-in, on-device Gemini Nano model**.

---

## 1. Configure Google Chrome (Prerequisites)

Because Gemini Nano is currently flag-gated for standard web pages, you must explicitly enable it in your browser settings:

1. Open **Google Chrome** (version 138 or newer, desktop version).
2. Open a new tab and navigate to `chrome://flags`.
3. Search for and **Enable** the following two flags:
   - **Optimization Guide on-device model** (`#optimization-guide-on-device-model`)  
     *Tip: Set this to **Enabled BypassPerfRequirement** if you are on a lower-spec device.*
   - **Prompt API for Gemini Nano** (`#prompt-api-for-gemini-nano`)
4. Click the **Relaunch** button in the bottom-right corner of Chrome to apply changes.
5. **Model Download (One-Time):** The first time you use the Prompt API, Chrome needs to download the local model (~2.4 GB). When you open the assistant, it will show a progress bar indicating the download progress. Once completed, the model is cached locally and shared across all websites.


## 2. Run on a Real Product Page

You can run the assistant on any live product page. For this demonstration, we will use the Koçtaş product page:

* **Example PDP:** [Telefon Tutuculu Kamp Sandalyesi](https://www.koctas.com.tr/telefon-tutuculu-kamp-sandalyesi/p/2000035716)

### Running Via Loader Snippet

1. Go to the [Telefon Tutuculu Kamp Sandalyesi page](https://www.koctas.com.tr/telefon-tutuculu-kamp-sandalyesi/p/2000035716).
2. Open Chrome DevTools Console by pressing:
   - **Mac:** `⌥ + ⌘ + J` (or `Cmd + Option + J`)
   - **Windows / Linux:** `Ctrl + Shift + J`
3. Copy the loader snippet below (which points to the deployed URL at `https://movwf.github.io/google-nano/`):

   ```javascript
   (async () => {
     const url = "https://movwf.github.io/google-nano/koctas-nano-assistant.js";
     try {
       const res = await fetch(url, { cache: "no-store" });
       if (!res.ok) throw new Error("HTTP " + res.status);
       (0, eval)(await res.text());
     } catch (e) {
       console.error("[PDP Nano Assistant] couldn't load hosted bundle:", e);
       console.warn("If this page's CSP blocks the fetch, paste the full bundle source directly into Console instead.");
     }
   })();
   ```

4. Paste the snippet into the Console and press **Enter**.
5. The assistant chip will appear in the bottom-right corner of the page. Click it to start asking questions!

### Troubleshooting: CSP Blocks the Loader
Some websites have strict Content Security Policies (CSP) that block the browser from fetching external scripts via `fetch()`. If you see a CSP error in the console:

1. Open `https://movwf.github.io/google-nano/koctas-nano-assistant.js` directly in a new tab.
2. Select all (`Ctrl + A` or `Cmd + A`) and copy the entire file content.
3. Go back to the product page tab, paste the entire code directly into the DevTools Console, and press **Enter**. This bypasses CSP restrictions completely.

---

## 3. Questions to Try on the Camp Chair Page

Here are a few questions you can ask the assistant once it is running on the Koçtaş Kamp Sandalyesi page:
- *Telefon tutucusu var mı?* (Does it have a phone holder?)
- *Taşıma kapasitesi nedir?* (What is the weight capacity?)
- *Hangi malzemelerden üretilmiştir?* (What materials is it made of?)
- *Ürünün fiyatı nedir?* (What is the price of the product?)
- *Is it suitable for outdoor use?* (The assistant handles Turkish and English and answers based on the page context).
