// offscreen.js

let mediaRecorder;
let audioChunks = [];

// Escuta por mensagens do background script
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

// Inicia a captura de áudio usando o streamId fornecido
async function startCapture(streamId, audioChunkSize) {
  if (mediaRecorder?.state === "recording") {
    console.warn("A captura já está em andamento.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // 🔊 REPRODUZ O ÁUDIO CAPTURADO PARA O USUÁRIO
    const audioElement = new Audio();
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.muted = false; // garante que o som seja ouvido
    audioElement.volume = 1.0;
    document.body.appendChild(audioElement); // opcional (pra manter referência)

    // 🎙️ CONTINUA O MEDIARECORDER COMO JÁ ESTAVA
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    audioChunks = [];

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
      stream.getTracks().forEach((track) => track.stop());
      console.log("Gravação e stream parados no offscreen.");
    };

    mediaRecorder.start(audioChunkSize);
  } catch (error) {
    console.error("Erro ao iniciar a captura no offscreen:", error);
    chrome.runtime.sendMessage({
      type: "capture_error",
      message: error.message,
    });
  }
}

// Para a captura de áudio
function stopCapture() {
  console.log("[offscreen] trying to stop tab capture");
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}
