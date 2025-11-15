if (!document.getElementById("translation-overlay")) {
  const overlay = document.createElement("div");
  overlay.id = "translation-overlay";
  overlay.innerHTML = `
    <div class="overlay-header">
      <span class="overlay-title">
        <span class="status-dot"></span>
        Live
      </span>
      <div class="overlay-controls">
        <button class="debug-bug-btn" id="debugBugBtn" title="Debug Panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <path d="M14 2v6h6"></path>
            <path d="M10 13h4"></path>
            <path d="M10 17h4"></path>
            <path d="M8 9h1"></path>
          </svg>
        </button>
        <select class="language-select" id="languageSelect" title="Select language">
          <option value="pt">Portuguese</option>
          <option value="en">English</option>
          <option value="auto">Auto Detect</option>
        </select>
        <button class="start-stop-btn" id="startStopBtn">▶ Start</button>
        <button class="reset-btn" id="resetBtn" title="Reset connection and clear context">↻</button>
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
  const resetBtn = overlay.querySelector("#resetBtn");
  const minimizeBtn = overlay.querySelector(".minimize-btn");
  const closeBtn = overlay.querySelector(".close-btn");
  const languageSelect = overlay.querySelector("#languageSelect");

  let isMinimized = false;
  let isCapturing = false;

  async function toggleCapture() {
    try {
      if (!isCapturing) {
        startStopBtn.textContent = "⏸ Stop";
        startStopBtn.disabled = true;

        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent = "Starting capture...";
        transcriptEl.classList.add("waiting");

        const url = window.location.href;
        if (
          url.startsWith("chrome://") ||
          url.startsWith("chrome-extension://") ||
          url.startsWith("edge://")
        ) {
          transcriptEl.textContent =
            "Cannot capture from browser system pages.";
          startStopBtn.textContent = "▶ Start";
          startStopBtn.disabled = false;
          return;
        }

        const selectedLanguage = languageSelect.value;

        chrome.runtime.sendMessage(
          { type: "start_capture_from_content", language: selectedLanguage },
          (response) => {
            startStopBtn.disabled = false;
            if (chrome.runtime.lastError) {
              console.error(
                "Error starting capture:",
                chrome.runtime.lastError
              );
              transcriptEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
              startStopBtn.textContent = "▶ Start";
              return;
            }

            if (response && response.success) {
              isCapturing = true;
              // Não desabilitar o seletor - permitir mudanças durante a captura
              transcriptEl.textContent = "Waiting for audio...";
              transcriptEl.classList.add("waiting");
            } else if (response && response.error === "activeTab") {
              transcriptEl.textContent =
                "Please click the extension icon in the toolbar first, then try again.";
              transcriptEl.style.color = "#fbbf24";
              startStopBtn.textContent = "▶ Start";
            } else {
              transcriptEl.textContent =
                response?.message ||
                response?.error ||
                "Failed to start capture";
              startStopBtn.textContent = "▶ Start";
            }
          }
        );
      } else {
        startStopBtn.textContent = "▶ Start";
        startStopBtn.disabled = true;
        isCapturing = false;

        chrome.runtime.sendMessage({ type: "stop_capture" }, (response) => {
          startStopBtn.disabled = false;
          const transcriptEl = overlay.querySelector(".continuous-transcript");
          transcriptEl.textContent =
            "Transcription stopped. Click 'Start' to begin again.";
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

  // Botão de reset - mata conexão e zera contexto
  resetBtn.addEventListener("click", () => {
    lastText = ""; // Resetar texto anterior
    if (isCapturing) {
      // Primeiro parar a captura
      chrome.runtime.sendMessage({ type: "stop_capture" }, () => {
        // Depois resetar conexão e contexto
        chrome.runtime.sendMessage({ type: "reset_connection" }, (response) => {
          const transcriptEl = overlay.querySelector(".continuous-transcript");
          transcriptEl.textContent = "Connection reset. Click 'Start' to begin with fresh context.";
          transcriptEl.classList.add("waiting");
          isCapturing = false;
          startStopBtn.textContent = "▶ Start";
        });
      });
    } else {
      // Se não está capturando, apenas resetar conexão
      chrome.runtime.sendMessage({ type: "reset_connection" }, (response) => {
        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent = "Connection reset. Click 'Start' to begin.";
        transcriptEl.classList.add("waiting");
      });
    }
  });

  // Fechar conexão quando a aba é fechada ou recarregada
  window.addEventListener("beforeunload", () => {
    if (isCapturing) {
      chrome.runtime.sendMessage({ type: "stop_capture" });
    }
  });

  // Permitir mudança de idioma durante a captura
  languageSelect.addEventListener("change", () => {
    if (isCapturing) {
      const selectedLanguage = languageSelect.value;
      chrome.runtime.sendMessage({
        type: "change_language",
        language: selectedLanguage
      });
    }
  });

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

  let lastText = "";
  let highlightTimeouts = [];

  function addTranslation(data) {
    console.log("add translation", data);
    const transcriptEl = overlay.querySelector(".continuous-transcript");

    if (data.translatedText) {
      const newText = data.translatedText;
      const currentText = transcriptEl.textContent.trim();
      
      // Limpar todos os timeouts anteriores
      highlightTimeouts.forEach(timeout => clearTimeout(timeout));
      highlightTimeouts = [];
      
      // Se há texto anterior e o novo texto é uma continuação, apenas adicionar o novo
      if (lastText && newText.length > lastText.length && newText.startsWith(lastText.trim())) {
        const newPart = newText.slice(lastText.length).trim();
        
        if (newPart) {
          // Limpar highlights antigos que ainda estão visíveis
          const oldHighlights = transcriptEl.querySelectorAll(".text-new");
          oldHighlights.forEach(span => {
            const text = span.textContent;
            span.replaceWith(document.createTextNode(text));
          });
          
          // Adicionar apenas o novo trecho com destaque
          const newSpan = document.createElement("span");
          newSpan.className = "text-new";
          newSpan.textContent = newPart;
          
          // Adicionar espaço se necessário
          if (currentText && !currentText.endsWith(" ") && !currentText.endsWith("\n")) {
            transcriptEl.appendChild(document.createTextNode(" "));
          }
          
          transcriptEl.appendChild(newSpan);
          
          // Remover destaque após 2 segundos
          const timeout1 = setTimeout(() => {
            if (newSpan.parentNode) {
              newSpan.classList.add("fade-out-highlight");
              const timeout2 = setTimeout(() => {
                if (newSpan.parentNode) {
                  const text = newSpan.textContent;
                  newSpan.replaceWith(document.createTextNode(text));
                }
              }, 600);
              highlightTimeouts.push(timeout2);
            }
          }, 2000);
          highlightTimeouts.push(timeout1);
        }
      } else {
        // Texto completamente novo - substituir tudo
        // Limpar todos os highlights primeiro
        const allHighlights = transcriptEl.querySelectorAll(".text-new");
        allHighlights.forEach(span => {
          const text = span.textContent;
          span.replaceWith(document.createTextNode(text));
        });
        
        // Atualizar o texto
        transcriptEl.textContent = newText;
      }
      
      lastText = newText;
      transcriptEl.classList.remove("waiting");

      // Scroll suave para o final
      content.scrollTo({
        top: content.scrollHeight,
        behavior: "smooth"
      });
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
      lastText = ""; // Resetar texto anterior
      startStopBtn.textContent = "▶ Start";
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "Transcription stopped.";
      transcriptEl.classList.add("waiting");
      transcriptEl.style.color = "#fff"; // Resetar cor
    } else if (request.type === "capture_error") {
      // Tratar erro de captura
      if (request.error === "activeTab") {
        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent =
          "⚠️ Please click the extension icon in the toolbar first, then try again.";
        transcriptEl.style.color = "#fbbf24";
        startStopBtn.textContent = "▶ Start";
        startStopBtn.disabled = false;
        isCapturing = false;
      }
    } else if (request.type === "tab_activated") {
      // Só atualizar o texto se não estiver capturando
      if (!isCapturing) {
        const transcriptEl = overlay.querySelector(".continuous-transcript");
        transcriptEl.textContent =
          "Tab activated! Click 'Start' to begin transcription.";
        transcriptEl.style.color = "#4ade80";
        setTimeout(() => {
          // Verificar novamente se não está capturando antes de resetar
          if (!isCapturing) {
            transcriptEl.style.color = "#fff";
            transcriptEl.textContent = "Click 'Start' to begin transcription.";
          }
        }, 3000);
      }
    }
  });

  chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
    if (response && response.isCapturing) {
      isCapturing = true;
      startStopBtn.textContent = "⏸ Stop";
      const transcriptEl = overlay.querySelector(".continuous-transcript");
      transcriptEl.textContent = "Waiting for audio...";
      transcriptEl.classList.add("waiting");
    }
  });

  let debugPanel = null;
  const debugBugBtn = overlay.querySelector("#debugBugBtn");

  setTimeout(() => {
    if (window.DebugPanel) {
      debugPanel = new window.DebugPanel();

      debugBugBtn.addEventListener("click", () => {
        debugPanel.toggle();
        debugBugBtn.classList.toggle("active", debugPanel.isOpen);
      });
    } else {
      console.error("DebugPanel class not found");
    }
  }, 100);
}
