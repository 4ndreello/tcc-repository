if (!document.getElementById("translation-overlay")) {
  const overlay = document.createElement("div");
  overlay.id = "translation-overlay";
  overlay.innerHTML = `
    <div class="overlay-header">
      <span class="overlay-title">
        <span class="status-dot"></span>
        Live Translation
      </span>
      <div class="overlay-controls">
        <button class="start-stop-btn" id="startStopBtn">▶ Start</button>
        <button class="minimize-btn">−</button>
        <button class="close-btn">×</button>
      </div>
    </div>
    <div class="overlay-content">
      <div class="continuous-transcript waiting">Click "Start" to begin transcription.<br><small style="opacity: 0.7;">If it fails, click the extension icon first.</small></div>
    </div>
  `;

  document.body.appendChild(overlay);

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const header = overlay.querySelector(".overlay-header");
  const content = overlay.querySelector(".overlay-content");

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

  const startStopBtn = overlay.querySelector("#startStopBtn");
  const minimizeBtn = overlay.querySelector(".minimize-btn");
  const closeBtn = overlay.querySelector(".close-btn");

  let isMinimized = false;
  let isCapturing = false;

  // Função para iniciar/parar a captura
  async function toggleCapture() {
    try {
      if (!isCapturing) {
        // Iniciar captura
        startStopBtn.textContent = "⏸ Stop";
        startStopBtn.disabled = true;
        
        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent = "Starting capture...";
        transcriptEl.classList.add("waiting");

        // Verificar se é uma página permitida
        const url = window.location.href;
        if (
          url.startsWith("chrome://") ||
          url.startsWith("chrome-extension://") ||
          url.startsWith("edge://")
        ) {
          transcriptEl.textContent = "Cannot capture from browser system pages.";
          startStopBtn.textContent = "▶ Start";
          startStopBtn.disabled = false;
          return;
        }

        // Solicitar início da captura ao background
        chrome.runtime.sendMessage(
          { type: "start_capture_from_content" },
          (response) => {
            startStopBtn.disabled = false;
            if (chrome.runtime.lastError) {
              console.error("Error starting capture:", chrome.runtime.lastError);
              transcriptEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
              startStopBtn.textContent = "▶ Start";
              return;
            }
            
            if (response && response.success) {
              isCapturing = true;
              transcriptEl.textContent = "Waiting for audio...";
            } else if (response && response.error === "activeTab") {
              // Erro específico de activeTab - mostrar mensagem clara
              transcriptEl.textContent = "⚠️ Please click the extension icon in the toolbar first, then try again.";
              transcriptEl.style.color = "#fbbf24";
              startStopBtn.textContent = "▶ Start";
            } else {
              transcriptEl.textContent = response?.message || response?.error || "Failed to start capture";
              startStopBtn.textContent = "▶ Start";
            }
          }
        );
      } else {
        // Parar captura
        startStopBtn.textContent = "▶ Start";
        startStopBtn.disabled = true;
        isCapturing = false;

        chrome.runtime.sendMessage({ type: "stop_capture" }, (response) => {
          startStopBtn.disabled = false;
          const transcriptEl = overlay.querySelector(".continuous-transcript");
          transcriptEl.textContent = "Transcription stopped. Click 'Start' to begin again.";
          transcriptEl.classList.add("waiting");
        });
      }
    } catch (error) {
      console.error("Error toggling capture:", error);
      startStopBtn.disabled = false;
      startStopBtn.textContent = isCapturing ? "⏸ Stop" : "▶ Start";
    }
  }

  startStopBtn.addEventListener("click", toggleCapture);

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

  function addTranslation(data) {
    console.log("add translation", data);
    const transcriptEl = overlay.querySelector(".continuous-transcript");

    if (data.translatedText) {
      transcriptEl.textContent = data.translatedText;
      transcriptEl.classList.remove("waiting");

      content.scrollTop = content.scrollHeight;
    }

    const statusDot = overlay.querySelector(".status-dot");
    statusDot.classList.add("flash");
    setTimeout(() => statusDot.classList.remove("flash"), 500);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("received in content", request);
    if (request.type === "new_translation") {
      addTranslation(request);
      if (!isCapturing) {
        isCapturing = true;
        startStopBtn.textContent = "⏸ Stop";
      }
    } else if (request.type === "remove_overlay") {
      const overlay = document.getElementById("translation-overlay");
      if (overlay) {
        overlay.remove();
      }
      sendResponse({ success: true });
      return true;
    } else if (request.type === "capture_started") {
      isCapturing = true;
      startStopBtn.textContent = "⏸ Stop";
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "Waiting for audio...";
      transcriptEl.classList.add("waiting");
      transcriptEl.style.color = "#fff"; // Resetar cor
    } else if (request.type === "capture_stopped") {
      isCapturing = false;
      startStopBtn.textContent = "▶ Start";
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "Transcription stopped.";
      transcriptEl.classList.add("waiting");
      transcriptEl.style.color = "#fff"; // Resetar cor
    } else if (request.type === "capture_error") {
      // Tratar erro de captura
      if (request.error === "activeTab") {
        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent = "⚠️ Please click the extension icon in the toolbar first, then try again.";
        transcriptEl.style.color = "#fbbf24";
        startStopBtn.textContent = "▶ Start";
        startStopBtn.disabled = false;
        isCapturing = false;
      }
    } else if (request.type === "tab_activated") {
      // Tab foi ativada pelo clique no ícone
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "✓ Tab activated! Click 'Start' to begin transcription.";
      transcriptEl.style.color = "#4ade80";
      setTimeout(() => {
        transcriptEl.style.color = "#fff";
        transcriptEl.textContent = "Click 'Start' to begin transcription.";
      }, 3000);
    }
  });

  // Verificar status ao carregar
  chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
    if (response && response.isCapturing) {
      isCapturing = true;
      startStopBtn.textContent = "⏸ Stop";
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "Waiting for audio...";
      transcriptEl.classList.remove("waiting");
    }
  });
}