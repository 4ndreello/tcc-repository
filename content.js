// Check if overlay already exists
if (!document.getElementById("translation-overlay")) {
  // State
  let translations = [];
  const MAX_TRANSLATIONS = 5;

  // Create overlay container
  const overlay = document.createElement("div");
  overlay.id = "translation-overlay";
  overlay.innerHTML = `
    <div class="overlay-header">
      <span class="overlay-title">
        <span class="status-dot"></span>
        Live Translation
      </span>
      <div class="overlay-controls">
        <button class="minimize-btn">−</button>
        <button class="close-btn">×</button>
      </div>
    </div>
    <div class="overlay-content">
      <div class="translations-container"></div>
      <div class="no-translations">Waiting for audio...</div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Make overlay draggable
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const header = overlay.querySelector(".overlay-header");

  header.addEventListener("mousedown", dragStart);
  document.addEventListener("mousemove", drag);
  document.addEventListener("mouseup", dragEnd);

  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === header || e.target.parentElement === header) {
      isDragging = true;
      overlay.style.transition = "none";
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      overlay.style.transform = `translate(${currentX}px, ${currentY}px)`;
    }
  }

  function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
    overlay.style.transition = "";
  }

  // Controls
  const minimizeBtn = overlay.querySelector(".minimize-btn");
  const closeBtn = overlay.querySelector(".close-btn");
  const content = overlay.querySelector(".overlay-content");

  let isMinimized = false;

  minimizeBtn.addEventListener("click", () => {
    isMinimized = !isMinimized;
    if (isMinimized) {
      content.style.display = "none";
      overlay.classList.add("minimized");
      minimizeBtn.textContent = "+";
    } else {
      content.style.display = "block";
      overlay.classList.remove("minimized");
      minimizeBtn.textContent = "−";
    }
  });

  closeBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    chrome.runtime.sendMessage({ type: "stop_capture" });
  });

  // Add translation to overlay
  function addTranslation(data) {
    console.log("add translation", data);
    const container = overlay.querySelector(".translations-container");
    const noTranslations = overlay.querySelector(".no-translations");

    noTranslations.style.display = "none";

    // Create translation element
    const translationEl = document.createElement("div");
    translationEl.className = "translation-item";
    translationEl.innerHTML = `
      <div class="original-text">${data.text}</div>
      <div class="translated-text">${data.translatedText}</div>
      <div class="translation-time">${new Date(
        data.timestamp
      ).toLocaleTimeString()}</div>
    `;

    // Add to beginning
    container.insertBefore(translationEl, container.firstChild);

    // Animate in
    setTimeout(() => translationEl.classList.add("show"), 10);

    // Remove old translations
    translations.unshift(data);
    if (translations.length > MAX_TRANSLATIONS) {
      const removed = container.lastElementChild;
      removed.classList.add("fade-out");
      setTimeout(() => removed.remove(), 300);
      translations.pop();
    }

    // Flash status dot
    const statusDot = overlay.querySelector(".status-dot");
    statusDot.classList.add("flash");
    setTimeout(() => statusDot.classList.remove("flash"), 500);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("received in content", request);
    if (request.type === "new_translation") {
      addTranslation(request);
    }
  });
}
