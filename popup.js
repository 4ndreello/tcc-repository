const toggleButton = document.getElementById("toggleButton");
const debugToggle = document.getElementById("debugToggle");
const debugContent = document.getElementById("debugContent");

let debugUpdateInterval = null;

async function checkPermissions() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://")
    ) {
      alert(
        "Cannot capture audio from browser system pages. Please navigate to a regular website."
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Permission check failed:", error);
    return false;
  }
}

async function startOrStopCapture(isListening) {
  return new Promise(async (resolve) => {
    const hasPermission = await checkPermissions();
    if (!hasPermission) return;

    const wantTranslation = document.getElementById("wantTranslation").checked;

    chrome.runtime.sendMessage(
      {
        type: !isListening ? "start_capture" : "stop_capture",
        transcriptionLanguage: "pt-BR", // Padrão quando inicia pelo popup
        wantTranslation: wantTranslation,
      },
      resolve
    );
  });
}

toggleButton.addEventListener("click", async () => {
  const buttonName = toggleButton.innerText.toLowerCase();
  const isListening = !buttonName.includes("start");

  await startOrStopCapture(isListening);

  const statusText = document.getElementById("statusText");
  statusText.textContent = isListening ? "Disconnected" : "Connected";

  const statusClassName = "active";
  const statusIndicator = document.getElementById("statusIndicator");

  if (isListening) statusIndicator.classList.remove(statusClassName);
  else statusIndicator.classList.add("active");

  toggleButton.innerText = isListening
    ? "Start Translation"
    : "Stop Translation";

  if (!isListening) {
    startDebugUpdates();
  } else {
    stopDebugUpdates();
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatDuration(ms) {
  if (!ms) return "-";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "-";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ago`;
  } else if (seconds > 0) {
    return `${seconds}s ago`;
  } else {
    return "now";
  }
}

async function updateDebugInfo() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "get_debug_stats" }, resolve);
    });

    if (!response) return;

    const wsStateMap = {
      disconnected: "Desconectado",
      connecting: "Conectando...",
      connected: "Conectado",
      error: "Erro",
    };
    document.getElementById("debugWsState").textContent =
      wsStateMap[response.wsState] || response.wsState;

    if (response.connectionStartTime) {
      const connectionDuration = Date.now() - response.connectionStartTime;
      document.getElementById("debugConnectionTime").textContent =
        formatDuration(connectionDuration);
    } else {
      document.getElementById("debugConnectionTime").textContent = "-";
    }

    document.getElementById("debugChunksSent").textContent =
      response.audioChunksSent || 0;

    document.getElementById("debugBytesSent").textContent = formatBytes(
      response.audioBytesSent || 0
    );

    document.getElementById("debugTranscriptions").textContent =
      response.transcriptionsReceived || 0;

    if (response.averageLatency && response.averageLatency > 0) {
      document.getElementById("debugLatency").textContent = `${Math.round(
        response.averageLatency
      )}ms`;
    } else {
      document.getElementById("debugLatency").textContent = "-";
    }

    document.getElementById("debugReconnects").textContent =
      response.reconnectAttempts || 0;

    document.getElementById("debugOffscreen").textContent =
      response.offscreenDocumentActive ? "Ativo" : "Inativo";

    if (response.captureStartTime) {
      const captureDuration = Date.now() - response.captureStartTime;
      document.getElementById("debugCaptureDuration").textContent =
        formatDuration(captureDuration);
    } else {
      document.getElementById("debugCaptureDuration").textContent = "-";
    }

    if (response.lastError) {
      document.getElementById("debugErrorGroup").style.display = "flex";
      const errorText =
        response.lastError.length > 50
          ? response.lastError.substring(0, 50) + "..."
          : response.lastError;
      document.getElementById(
        "debugLastError"
      ).textContent = `${errorText} (${formatTimeAgo(response.lastErrorTime)})`;
    } else {
      document.getElementById("debugErrorGroup").style.display = "none";
    }

    if (response.lastTranscription) {
      const transcriptionText =
        response.lastTranscription.length > 100
          ? response.lastTranscription.substring(0, 100) + "..."
          : response.lastTranscription;
      document.getElementById("debugLastTranscription").textContent =
        transcriptionText || "-";
    } else {
      document.getElementById("debugLastTranscription").textContent = "-";
    }
  } catch (error) {
    console.error("Error updating debug info:", error);
  }
}

function startDebugUpdates() {
  if (debugUpdateInterval) return;
  updateDebugInfo();
  debugUpdateInterval = setInterval(updateDebugInfo, 1000);
}

function stopDebugUpdates() {
  if (debugUpdateInterval) {
    clearInterval(debugUpdateInterval);
    debugUpdateInterval = null;
  }
}

if (debugToggle && debugContent) {
  debugToggle.addEventListener("click", () => {
    const isExpanded = debugContent.style.display !== "none";
    debugContent.style.display = isExpanded ? "none" : "block";
    debugToggle.classList.toggle("expanded", !isExpanded);

    if (!isExpanded) {
      startDebugUpdates();
    } else {
      stopDebugUpdates();
    }
  });
}

chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
  if (
    response &&
    response.isCapturing &&
    debugContent &&
    debugContent.style.display !== "none"
  ) {
    startDebugUpdates();
  }
});

if (debugContent && debugContent.style.display !== "none") {
  updateDebugInfo();
}
