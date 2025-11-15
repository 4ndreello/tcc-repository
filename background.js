let websocket = null;
let isCapturing = false;
let currentTabId = null;

const CONFIG = {
  wsUrl: "ws://localhost:8080",
  reconnectDelay: 3000,
  audioChunkSize: 1000,
};

// Sistema de debug
const debugStats = {
  wsState: "disconnected", // disconnected, connecting, connected, error
  connectionStartTime: null,
  audioChunksSent: 0,
  audioBytesSent: 0,
  transcriptionsReceived: 0,
  lastTranscription: null,
  lastTranscriptionTime: null,
  lastError: null,
  lastErrorTime: null,
  reconnectAttempts: 0,
  offscreenDocumentActive: false,
  captureStartTime: null,
  averageLatency: 0,
  latencySamples: [],
};

function updateDebugStats() {
  chrome.storage.local.set({ debugStats: { ...debugStats } });
}

function addLatencySample(latencyMs) {
  debugStats.latencySamples.push(latencyMs);
  // Manter apenas os últimos 50 samples
  if (debugStats.latencySamples.length > 50) {
    debugStats.latencySamples.shift();
  }
  // Calcular média
  const sum = debugStats.latencySamples.reduce((a, b) => a + b, 0);
  debugStats.averageLatency = sum / debugStats.latencySamples.length;
  updateDebugStats();
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    debugStats.offscreenDocumentActive = true;
    updateDebugStats();
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Necessary to capture tab audio.",
  });
  
  debugStats.offscreenDocumentActive = true;
  updateDebugStats();
}

async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument().catch(() => {});
  debugStats.offscreenDocumentActive = false;
  updateDebugStats();
}

function connectWebSocket() {
  if (websocket?.readyState === WebSocket.OPEN) return;

  try {
    debugStats.wsState = "connecting";
    debugStats.connectionStartTime = Date.now();
    updateDebugStats();

    websocket = new WebSocket(CONFIG.wsUrl);

    websocket.onopen = () => {
      console.log("WebSocket connected");
      debugStats.wsState = "connected";
      debugStats.connectionStartTime = Date.now();
      debugStats.lastError = null;
      debugStats.lastErrorTime = null;
      updateStatus("connected");
      updateDebugStats();
    };

    websocket.onmessage = (event) => {
      console.log("event received", event);
      const receiveTime = Date.now();
      const data = JSON.parse(event.data);
      
      if (data.type === "transcription" && currentTabId) {
        debugStats.transcriptionsReceived++;
        debugStats.lastTranscription = data.text || data.translatedText || "";
        debugStats.lastTranscriptionTime = receiveTime;
        
        // Calcular latência se o servidor enviou timestamp
        if (data.timestamp) {
          const latency = receiveTime - data.timestamp;
          addLatencySample(latency);
        }
        
        updateDebugStats();
        
        chrome.tabs.sendMessage(currentTabId, {
          type: "new_translation",
          text: data.text,
          translatedText: data.translatedText,
          timestamp: receiveTime,
        });
      }
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      debugStats.wsState = "error";
      debugStats.lastError = error.message || "WebSocket connection error";
      debugStats.lastErrorTime = Date.now();
      updateStatus("error");
      updateDebugStats();
    };

    websocket.onclose = () => {
      console.log("WebSocket closed");
      debugStats.wsState = "disconnected";
      updateStatus("disconnected");
      updateDebugStats();
      
      if (isCapturing) {
        debugStats.reconnectAttempts++;
        updateDebugStats();
        setTimeout(connectWebSocket, CONFIG.reconnectDelay);
      }
    };
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
    debugStats.wsState = "error";
    debugStats.lastError = error.message || "Failed to create WebSocket";
    debugStats.lastErrorTime = Date.now();
    updateStatus("error");
    updateDebugStats();
  }
}

async function startCapture(tabId) {
  if (isCapturing) {
    console.warn("Capture is already in progress.");
    return;
  }

  try {
    isCapturing = true;
    currentTabId = tabId;
    debugStats.captureStartTime = Date.now();
    debugStats.audioChunksSent = 0;
    debugStats.audioBytesSent = 0;
    debugStats.transcriptionsReceived = 0;
    debugStats.reconnectAttempts = 0;
    debugStats.latencySamples = [];
    debugStats.averageLatency = 0;
    updateDebugStats();

    await setupOffscreenDocument();

    // Tentar ativar a aba executando um script simples primeiro
    // Isso ajuda a garantir que a extensão foi "invocada" para a aba
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Script vazio apenas para ativar a aba
          console.log("Activating tab for extension");
        },
      });
    } catch (e) {
      console.warn("Could not execute activation script:", e);
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });

    chrome.runtime.sendMessage({
      type: "start-capture",
      target: "offscreen",
      streamId: streamId,
      audioChunkSize: CONFIG.audioChunkSize,
    });

    connectWebSocket();

    // Garantir que o content.js está carregado
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"],
      });
    } catch (e) {
      // Content script já pode estar carregado, ignorar erro
      console.log("Content script may already be loaded");
    }

    updateStatus("capturing");
    console.log("Start capture command sent.");
  } catch (error) {
    console.error("Failed to start capture:", error);
    debugStats.lastError = error.message || "Failed to start capture";
    debugStats.lastErrorTime = Date.now();
    updateStatus("error");
    updateDebugStats();
    isCapturing = false;
    currentTabId = null;
    
    // Verificar se é erro de activeTab
    if (error.message && error.message.includes("activeTab")) {
      // Notificar o content script sobre o erro
      try {
        chrome.tabs.sendMessage(tabId, {
          type: "capture_error",
          error: "activeTab",
          message: "Please click the extension icon first to activate this page, then try again.",
        });
      } catch (e) {
        console.warn("Could not send error message to content script:", e);
      }
    }
    
    throw error;
  }
}

async function stopCapture() {
  if (!isCapturing) return;

  chrome.runtime.sendMessage({
    type: "stop-capture",
    target: "offscreen",
  });

  await closeOffscreenDocument();

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  isCapturing = false;
  currentTabId = null;
  debugStats.captureStartTime = null;
  debugStats.wsState = "disconnected";
  updateStatus("idle");
  updateDebugStats();
  console.log("Stop capture command sent.");
}

function updateStatus(status) {
  chrome.storage.local.set({
    captureStatus: status,
    isCapturing: isCapturing,
    currentTabId: currentTabId,
  });
}

async function checkPermissionsOnTab(tab) {
  try {
    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://")
    ) {
      console.warn("Cannot capture audio from browser system pages.");
      return false;
    }
    return true;
  } catch (error) {
    console.error("Permission check failed:", error);
    return false;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  // O clique no ícone apenas ativa a aba para permitir tabCapture
  // O controle de iniciar/parar é feito pelo botão no overlay
  console.log("Action icon clicked: Activating tab for extension...");
  
  const hasPermission = await checkPermissionsOnTab(tab);
  if (!hasPermission) {
    console.warn("Cannot activate tab - restricted page");
    return;
  }

  // Executar um script simples para ativar a aba (concede activeTab permission)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        console.log("Extension activated for this tab");
      },
    });
    
    // Notificar o content script que a aba foi ativada
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "tab_activated",
        message: "Tab activated! You can now use the Start button.",
      });
    } catch (e) {
      // Content script pode não estar carregado ainda, não é problema
      console.log("Content script not ready yet");
    }
  } catch (error) {
    console.error("Failed to activate tab:", error);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    console.log("background received a message", request);

    switch (request.type) {
      case "start_capture_from_content":
        // Iniciar captura a partir do content script
        try {
          const tabId = sender.tab?.id;
          if (!tabId) {
            sendResponse({ success: false, error: "No tab ID available" });
            return;
          }

          // Obter informações da tab
          const tab = await chrome.tabs.get(tabId);
          if (!tab) {
            sendResponse({ success: false, error: "Tab not found" });
            return;
          }

          const hasPermission = await checkPermissionsOnTab(tab);
          if (!hasPermission) {
            sendResponse({ success: false, error: "Cannot capture from this page" });
            return;
          }

          if (isCapturing && currentTabId === tabId) {
            sendResponse({ success: true, message: "Already capturing" });
            // Notificar content.js que a captura já está ativa
            try {
              chrome.tabs.sendMessage(tabId, { type: "capture_started" });
            } catch (e) {
              console.warn("Could not send capture_started message:", e);
            }
            return;
          }

          try {
            await startCapture(tabId);
            sendResponse({ success: true });
            
            // Notificar content.js que a captura foi iniciada
            try {
              chrome.tabs.sendMessage(tabId, { type: "capture_started" });
            } catch (e) {
              console.warn("Could not send capture_started message:", e);
            }
          } catch (error) {
            // Se for erro de activeTab, retornar erro específico
            if (error.message && error.message.includes("activeTab")) {
              sendResponse({
                success: false,
                error: "activeTab",
                message: "Please click the extension icon in the toolbar first to activate this page, then try again.",
              });
            } else {
              throw error;
            }
          }
        } catch (error) {
          console.error("Error starting capture from content:", error);
          sendResponse({ success: false, error: error.message || "Failed to start capture" });
        }
        break;
      case "stop_capture":
        await stopCapture();
        // Notificar content.js que a captura foi parada
        if (currentTabId) {
          try {
            chrome.tabs.sendMessage(currentTabId, { type: "capture_stopped" });
          } catch (e) {
            console.warn("Could not send capture_stopped message:", e);
          }
        }
        sendResponse({ success: true });
        break;
      case "get_status":
        sendResponse({
          isCapturing,
          currentTabId,
          wsConnected: websocket?.readyState === WebSocket.OPEN,
        });
        break;
      case "get_debug_stats":
        sendResponse({ ...debugStats });
        break;
      case "audio_chunk_from_offscreen":
        if (websocket?.readyState === WebSocket.OPEN) {
          console.log("sending new translation");
          const audioData = request.audio;
          // Estimar tamanho do áudio (base64 é ~33% maior que o original)
          // Remover prefixo data:audio/webm;base64, se existir
          const base64Data = audioData.includes(',') ? audioData.split(',')[1] : audioData;
          const audioSize = Math.floor(base64Data.length * 0.75); // Aproximação do tamanho real
          
          debugStats.audioChunksSent++;
          debugStats.audioBytesSent += audioSize;
          updateDebugStats();
          
          websocket.send(
            JSON.stringify({
              type: "audio_chunk",
              audio: audioData,
              duration: CONFIG.audioChunkSize,
              timestamp: Date.now(),
            })
          );
        } else {
          debugStats.lastError = "WebSocket not open, cannot send audio chunk";
          debugStats.lastErrorTime = Date.now();
          updateDebugStats();
        }
        break;
      case "capture_error":
        console.error("Capture error received from offscreen:", request.message);
        await stopCapture();
        break;
    }
  })();

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    stopCapture();
  }
});