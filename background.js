let websocket = null;
let isCapturing = false;
let currentTabId = null;

const CONFIG = {
  wsUrl: "ws://localhost:8080",
  reconnectDelay: 3000,
  audioChunkSize: 1000,
};

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

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
    justification: "Necessary to capture tab audio.",
  });
}

async function closeOffscreenDocument() {
  await chrome.offscreen.closeDocument().catch(() => {});
}

function connectWebSocket() {
  if (websocket?.readyState === WebSocket.OPEN) return;

  try {
    websocket = new WebSocket(CONFIG.wsUrl);

    websocket.onopen = () => {
      console.log("WebSocket connected");
      updateStatus("connected");
    };

    websocket.onmessage = (event) => {
      console.log("event received", event);
      const data = JSON.parse(event.data);
      if (data.type === "transcription" && currentTabId) {
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

    await setupOffscreenDocument();

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

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"],
    });

    updateStatus("capturing");
    console.log("Start capture command sent.");
  } catch (error) {
    console.error("Failed to start capture:", error);
    updateStatus("error");
    isCapturing = false;
    currentTabId = null;
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
  const { isCapturing } = await chrome.storage.local.get("isCapturing");

  if (isCapturing) {
    console.log("Action icon clicked: Stopping capture...");
    await stopCapture();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "remove_overlay" });
    } catch (e) {
      console.warn("Could not send remove_overlay message. Was the tab closed?");
    }
  } else {
    console.log("Action icon clicked: Starting capture...");
    const hasPermission = await checkPermissionsOnTab(tab);
    if (hasPermission) {
      await startCapture(tab.id);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    console.log("background received a message", request);

    switch (request.type) {
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
              audio: request.audio,
              duration: CONFIG.audioChunkSize,
              timestamp: Date.now(),
            })
          );
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