let websocket = null;
let isCapturing = false;
let currentTabId = null;

const CONFIG = {
  wsUrl: "ws://localhost:8080/translate",
  reconnectDelay: 3000,
  audioChunkSize: 1000, // ms
};

// =================================================================
// OFFSCREEN DOCUMENT MANAGEMENT
// =================================================================
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

// Cria o documento offscreen se ele não existir
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Necessário para capturar o áudio da aba.",
  });
}

// Fecha o documento offscreen
async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument().catch(() => {});
}

// =================================================================
// WEBSOCKET LOGIC (Sem alterações)
// =================================================================
function connectWebSocket() {
  if (websocket?.readyState === WebSocket.OPEN) return;

  try {
    websocket = new WebSocket(CONFIG.wsUrl);

    websocket.onopen = () => {
      console.log("WebSocket connected");
      updateStatus("connected");
      websocket.send(
        JSON.stringify({
          type: "config",
          sourceLang: CONFIG.sourceLang,
          targetLang: CONFIG.targetLang,
        })
      );
    };

    websocket.onmessage = (event) => {
      console.log("event received", event);
      const data = JSON.parse(event.data);
      if (data.type === "translation" && currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
          type: "new_translation",
          text: data.text,
          translatedText: data.translatedText,
          timestamp: Date.now(),
        });
      }
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      updateStatus("error");
    };

    websocket.onclose = () => {
      console.log("WebSocket closed");
      updateStatus("disconnected");
      if (isCapturing) {
        setTimeout(connectWebSocket, CONFIG.reconnectDelay);
      }
    };
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
    updateStatus("error");
    mockWebSocket();
  }
}

function mockWebSocket() {
  console.log("Running in mock mode");
  const mockPhrases = [
    { text: "Hello, how are you?", translatedText: "Olá, como você está?" },
    {
      text: "Welcome to the presentation",
      translatedText: "Bem-vindo à apresentação",
    },
    { text: "Let's get started", translatedText: "Vamos começar" },
    { text: "This is an example", translatedText: "Este é um exemplo" },
    { text: "Thank you for watching", translatedText: "Obrigado por assistir" },
  ];

  let mockIndex = 0;
  const mockInterval = setInterval(() => {
    if (!isCapturing) {
      clearInterval(mockInterval);
      return;
    }
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, {
        type: "new_translation",
        ...mockPhrases[mockIndex % mockPhrases.length],
        timestamp: Date.now(),
      });
      mockIndex++;
    }
  }, 3000);
  updateStatus("mock_mode");
}

// =================================================================
// CAPTURE LOGIC (Alterado para usar Offscreen)
// =================================================================

async function startCapture(tabId) {
  if (isCapturing) {
    console.warn("A captura já está em andamento.");
    return;
  }

  try {
    isCapturing = true;
    currentTabId = tabId;

    // 1. Garante que o documento offscreen está pronto
    await setupOffscreenDocument();

    // 2. Obtém o ID do stream da aba
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });

    // 3. Envia o ID para o offscreen document para iniciar a captura
    chrome.runtime.sendMessage({
      type: "start-capture",
      target: "offscreen",
      streamId: streamId,
      audioChunkSize: CONFIG.audioChunkSize,
    });

    // Conecta o WebSocket
    connectWebSocket();

    // Injeta o content script
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"],
    });

    // Atualiza o status
    updateStatus("capturing");
    console.log("Comando para iniciar a captura enviado.");
  } catch (error) {
    console.error("Falha ao iniciar a captura:", error);
    updateStatus("error");
    isCapturing = false;
    currentTabId = null;
    throw error;
  }
}

async function stopCapture() {
  if (!isCapturing) return;

  // Envia mensagem para o offscreen document parar de gravar
  chrome.runtime.sendMessage({
    type: "stop-capture",
    target: "offscreen",
  });

  // Fecha o documento offscreen para liberar recursos
  await closeOffscreenDocument();

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  isCapturing = false;
  currentTabId = null;
  updateStatus("idle");
  console.log("Comando para parar a captura enviado.");
}

// =================================================================
// STATUS & EVENT LISTENERS
// =================================================================
function updateStatus(status) {
  chrome.storage.local.set({
    captureStatus: status,
    isCapturing: isCapturing,
    currentTabId: currentTabId,
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Tratamento assíncrono para casos que retornam Promises
  (async () => {
    console.log("background received a message", request);

    switch (request.type) {
      case "start_capture":
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });

          console.log("tabs", tabs);

          if (tabs[0]) {
            await startCapture(tabs[0].id);
            sendResponse({ success: true });
          } else {
            throw new Error("Nenhuma aba ativa encontrada.");
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      case "stop_capture":
        await stopCapture();
        sendResponse({ success: true });
        break;
      case "get_status":
        sendResponse({
          isCapturing,
          currentTabId,
          wsConnected: websocket?.readyState === WebSocket.OPEN,
        });
        break;
      case "audio_chunk_from_offscreen":
        if (websocket?.readyState === WebSocket.OPEN) {
          console.log("sending new translation");
          websocket.send(
            JSON.stringify({
              type: "audio_chunk",
              audio: request.audio, // base64 encoded
              timestamp: Date.now(),
            })
          );
        }
        break;

      // NOVO: Trata erros vindos do offscreen.js
      case "capture_error":
        console.error(
          "Erro de captura recebido do offscreen:",
          request.message
        );
        await stopCapture();
        break;
    }
  })();

  return true; // Mantém a porta de mensagem aberta para respostas assíncronas
});

// Limpeza quando uma aba é fechada
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    stopCapture();
  }
});
