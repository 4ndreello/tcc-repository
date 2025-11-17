let websocket = null;
let isCapturing = false;
let currentTabId = null;
let selectedLanguage = "pt"; // Idioma padrão: Português

const CONFIG = {
  wsUrl: "ws://90a34275710b.ngrok-free.app ",
  reconnectDelay: 3000,
  audioChunkSize: 500,
};

const debugStats = {
  wsState: "disconnected",
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
  latencySamples: [], // Últimas 50 amostras (para o gráfico)
  allLatencySamples: [], // TODAS as amostras (para exportação)
  lastChunkTime: null,
  lastChunkTimestamp: null, // Timestamp do último chunk enviado
  currentTabId: null,
};

function addLatencySample(latencyMs) {
  // Adicionar a TODAS as amostras (sem limite)
  debugStats.allLatencySamples.push(latencyMs);

  // Manter apenas as últimas 50 para o gráfico (performance)
  debugStats.latencySamples.push(latencyMs);
  if (debugStats.latencySamples.length > 50) {
    debugStats.latencySamples.shift();
  }

  // Calcular média baseada nas últimas 50 (para exibição)
  const sum = debugStats.latencySamples.reduce((a, b) => a + b, 0);
  debugStats.averageLatency = sum / debugStats.latencySamples.length;
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    debugStats.offscreenDocumentActive = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Necessary to capture tab audio.",
  });

  debugStats.offscreenDocumentActive = true;
}

async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument().catch(() => {});
  debugStats.offscreenDocumentActive = false;
}

function connectWebSocket() {
  if (websocket?.readyState === WebSocket.OPEN) return;

  try {
    debugStats.wsState = "connecting";
    debugStats.connectionStartTime = Date.now();

    websocket = new WebSocket(CONFIG.wsUrl);

    websocket.onopen = () => {
      console.log("WebSocket connected");
      debugStats.wsState = "connected";
      debugStats.connectionStartTime = Date.now();
      debugStats.lastError = null;
      debugStats.lastErrorTime = null;
      updateStatus("connected");

      // Enviar configuração de idioma ao conectar
      if (selectedLanguage) {
        websocket.send(
          JSON.stringify({
            type: "language_config",
            language: selectedLanguage,
          })
        );
      }
    };

    websocket.onmessage = (event) => {
      console.log("event received", event);
      const receiveTime = Date.now();
      const data = JSON.parse(event.data);

      if (data.type === "transcription" && currentTabId) {
        debugStats.transcriptionsReceived++;
        debugStats.lastTranscription = data.text || data.translatedText || "";
        debugStats.lastTranscriptionTime = receiveTime;

        // Calcular latência como tempo desde o último chunk enviado até receber a transcrição
        // Isso dá uma medida mais precisa do round-trip time
        if (debugStats.lastChunkTimestamp) {
          const latency = receiveTime - debugStats.lastChunkTimestamp;
          // Só adicionar se a latência for razoável (entre 0 e 60 segundos)
          // Isso evita valores absurdos causados por problemas de sincronização
          if (latency > 0 && latency < 60000) {
            addLatencySample(latency);
          }
          // Resetar o timestamp para que a próxima transcrição use o timestamp do próximo chunk
          // Isso evita que múltiplas transcrições usem o mesmo timestamp
          debugStats.lastChunkTimestamp = null;
        }

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
    };

    websocket.onclose = () => {
      console.log("WebSocket closed");
      debugStats.wsState = "disconnected";
      updateStatus("disconnected");

      if (isCapturing) {
        debugStats.reconnectAttempts++;
        setTimeout(connectWebSocket, CONFIG.reconnectDelay);
      }
    };
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
    debugStats.wsState = "error";
    debugStats.lastError = error.message || "Failed to create WebSocket";
    debugStats.lastErrorTime = Date.now();
    updateStatus("error");
  }
}

async function startCapture(tabId, language = "pt") {
  if (isCapturing) {
    console.warn("Capture is already in progress.");
    return;
  }

  try {
    isCapturing = true;
    currentTabId = tabId;
    selectedLanguage = language || "pt"; // Armazenar idioma selecionado
    debugStats.captureStartTime = Date.now();
    debugStats.audioChunksSent = 0;
    debugStats.audioBytesSent = 0;
    debugStats.transcriptionsReceived = 0;
    debugStats.reconnectAttempts = 0;
    debugStats.latencySamples = []; // Últimas 50 para o gráfico
    debugStats.allLatencySamples = []; // TODAS as amostras da sessão (para exportação)
    debugStats.averageLatency = 0;
    debugStats.lastChunkTime = null;
    debugStats.currentTabId = tabId;

    await setupOffscreenDocument();

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
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

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"],
      });
    } catch (e) {
      console.log("Content script may already be loaded");
    }

    updateStatus("capturing");
    console.log("Start capture command sent.");
  } catch (error) {
    console.error("Failed to start capture:", error);
    debugStats.lastError = error.message || "Failed to start capture";
    debugStats.lastErrorTime = Date.now();
    updateStatus("error");
    isCapturing = false;
    currentTabId = null;

    if (error.message && error.message.includes("activeTab")) {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: "capture_error",
          error: "activeTab",
          message:
            "Please click the extension icon first to activate this page, then try again.",
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
  selectedLanguage = "pt"; // Resetar para padrão
  debugStats.captureStartTime = null;
  debugStats.wsState = "disconnected";
  debugStats.currentTabId = null;
  debugStats.lastChunkTimestamp = null; // Resetar timestamp do chunk
  // Não resetar allLatencySamples aqui - manter para exportação
  updateStatus("idle");
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
  console.log("Action icon clicked: Activating tab for extension...");

  const hasPermission = await checkPermissionsOnTab(tab);
  if (!hasPermission) {
    console.warn("Cannot activate tab - restricted page");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        console.log("Extension activated for this tab");
      },
    });

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "tab_activated",
        message: "Tab activated! You can now use the Start button.",
      });
    } catch (e) {
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
        try {
          const tabId = sender.tab?.id;
          const language = request.language || "pt"; // Receber idioma da mensagem

          if (!tabId) {
            sendResponse({ success: false, error: "No tab ID available" });
            return;
          }

          const tab = await chrome.tabs.get(tabId);
          if (!tab) {
            sendResponse({ success: false, error: "Tab not found" });
            return;
          }

          const hasPermission = await checkPermissionsOnTab(tab);
          if (!hasPermission) {
            sendResponse({
              success: false,
              error: "Cannot capture from this page",
            });
            return;
          }

          if (isCapturing && currentTabId === tabId) {
            // Se já está capturando, apenas atualizar o idioma se necessário
            if (language !== selectedLanguage) {
              selectedLanguage = language;
              // Enviar nova configuração de idioma se WebSocket estiver aberto
              if (websocket?.readyState === WebSocket.OPEN) {
                websocket.send(
                  JSON.stringify({
                    type: "language_config",
                    language: selectedLanguage,
                  })
                );
              }
            }
            sendResponse({ success: true, message: "Already capturing" });
            try {
              chrome.tabs.sendMessage(tabId, { type: "capture_started" });
            } catch (e) {
              console.warn("Could not send capture_started message:", e);
            }
            return;
          }

          try {
            await startCapture(tabId, language);
            sendResponse({ success: true });

            try {
              chrome.tabs.sendMessage(tabId, { type: "capture_started" });
            } catch (e) {
              console.warn("Could not send capture_started message:", e);
            }
          } catch (error) {
            if (error.message && error.message.includes("activeTab")) {
              sendResponse({
                success: false,
                error: "activeTab",
                message:
                  "Please click the extension icon in the toolbar first to activate this page, then try again.",
              });
            } else {
              throw error;
            }
          }
        } catch (error) {
          console.error("Error starting capture from content:", error);
          sendResponse({
            success: false,
            error: error.message || "Failed to start capture",
          });
        }
        break;
      case "stop_capture":
        await stopCapture();
        if (currentTabId) {
          try {
            chrome.tabs.sendMessage(currentTabId, { type: "capture_stopped" });
          } catch (e) {
            console.warn("Could not send capture_stopped message:", e);
          }
        }
        sendResponse({ success: true });
        break;
      case "reset_connection":
        // Fechar conexão WebSocket e resetar estado
        if (websocket) {
          // Enviar comando de reset para o servidor antes de fechar
          if (websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: "reset_context" }));
            // Dar um tempo para o servidor processar antes de fechar
            setTimeout(() => {
              websocket.close();
              websocket = null;
            }, 100);
          } else {
            websocket.close();
            websocket = null;
          }
        }
        // Se estava capturando, parar também
        if (isCapturing) {
          await stopCapture();
        }
        // Resetar estatísticas
        debugStats.audioChunksSent = 0;
        debugStats.audioBytesSent = 0;
        debugStats.transcriptionsReceived = 0;
        debugStats.latencySamples = [];
        debugStats.allLatencySamples = [];
        debugStats.averageLatency = 0;
        debugStats.wsState = "disconnected";
        sendResponse({ success: true });
        break;
      case "change_language":
        // Mudar idioma durante a captura
        const newLanguage = request.language || "pt";
        if (isCapturing && newLanguage !== selectedLanguage) {
          selectedLanguage = newLanguage;
          // Enviar nova configuração de idioma se WebSocket estiver aberto
          if (websocket?.readyState === WebSocket.OPEN) {
            websocket.send(
              JSON.stringify({
                type: "language_config",
                language: selectedLanguage,
              })
            );
            console.log(`Language changed to: ${selectedLanguage}`);
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
          const base64Data = audioData.includes(",")
            ? audioData.split(",")[1]
            : audioData;
          const audioSize = Math.floor(base64Data.length * 0.75);

          debugStats.audioChunksSent++;
          debugStats.audioBytesSent += audioSize;
          const chunkTimestamp = Date.now();
          debugStats.lastChunkTime = chunkTimestamp;
          debugStats.lastChunkTimestamp = chunkTimestamp; // Guardar timestamp para cálculo de latência

          websocket.send(
            JSON.stringify({
              type: "audio_chunk",
              audio: audioData,
              duration: CONFIG.audioChunkSize,
              timestamp: chunkTimestamp,
            })
          );
        } else {
          debugStats.lastError = "WebSocket not open, cannot send audio chunk";
          debugStats.lastErrorTime = Date.now();
        }
        break;
      case "capture_error":
        console.error(
          "Capture error received from offscreen:",
          request.message
        );
        await stopCapture();
        break;
    }
  })();

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    console.log(`Tab ${tabId} closed, stopping capture and closing connection`);
    stopCapture();
    // Fechar conexão WebSocket também
    if (websocket) {
      websocket.close();
      websocket = null;
    }
  }
});

// Também fechar conexão quando a aba é atualizada (recarregada)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.status === "loading") {
    console.log(`Tab ${tabId} reloading, stopping capture`);
    stopCapture();
    // Fechar conexão WebSocket
    if (websocket) {
      websocket.close();
      websocket = null;
    }
  }
});
