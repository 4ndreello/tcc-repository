// Check if overlay already exists
if (!document.getElementById("translation-overlay")) {
  // State
  // REMOVIDO: Não precisamos mais de 'translations = []' ou 'MAX_TRANSLATIONS'

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
      <div class="continuous-transcript waiting">Waiting for audio...</div>
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
  const content = overlay.querySelector(".overlay-content"); // MODIFICADO: Pegamos a referência do 'content'

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
  // const content = overlay.querySelector(".overlay-content"); // Já pego lá em cima

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

  // ===================================================================
  // FUNÇÃO 'addTranslation' COMPLETAMENTE MODIFICADA
  // ===================================================================
  function addTranslation(data) {
    console.log("add translation", data);
    const transcriptEl = overlay.querySelector(".continuous-transcript");

    if (data.translatedText) {
      // Apenas atualiza o texto do elemento
      transcriptEl.textContent = data.translatedText;
      transcriptEl.classList.remove("waiting"); // Remove o estilo de "esperando"

      // MODIFICADO: Faz o scroll acompanhar o texto
      content.scrollTop = content.scrollHeight;
    }

    // Flash status dot
    const statusDot = overlay.querySelector(".status-dot");
    statusDot.classList.add("flash");
    setTimeout(() => statusDot.classList.remove("flash"), 500);
  }
  // ===================================================================

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("received in content", request);
    if (request.type === "new_translation") {
      addTranslation(request);
    }
  });
}