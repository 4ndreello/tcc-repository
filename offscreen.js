let mediaRecorder;
let stream;
let audioChunkSize;
let captureLoop;

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
  if (message.target !== "offscreen") {
    return;
  }

  switch (message.type) {
    case "start-capture":
      await startCapture(message.streamId, message.audioChunkSize);
      break;
    case "stop-capture":
      stopCapture();
      break;
    default:
      console.warn(`Mensagem desconhecida recebida: ${message.type}`);
  }
}

async function startCapture(streamId, chunkSize) {
  if (stream) {
    console.warn("A captura já está em andamento.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    audioChunkSize = chunkSize;

    const audioElement = new Audio();
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.muted = false;
    document.body.appendChild(audioElement);

    startRecordingLoop();

  } catch (error) {
    console.error("Erro ao iniciar a captura no offscreen:", error);
    chrome.runtime.sendMessage({
      type: "capture_error",
      message: error.message,
    });
  }
}

function startRecordingLoop() {
  if (!stream) return;

  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        chrome.runtime.sendMessage({
          type: "audio_chunk_from_offscreen",
          audio: reader.result,
        });
      };
      reader.readAsDataURL(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    startRecordingLoop();
  };

  mediaRecorder.start();

  captureLoop = setTimeout(() => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  }, audioChunkSize);
}

function stopCapture() {
  console.log("[offscreen] trying to stop tab capture");

  if (captureLoop) {
    clearTimeout(captureLoop);
    captureLoop = null;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    mediaRecorder = null;
  }
}