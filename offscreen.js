// offscreen.js

let mediaRecorder;
let stream; // Referência global para o stream
let audioChunkSize; // Armazena o tamanho do chunk vindo do background
let captureLoop; // Referência para o nosso loop de captura (setTimeout)

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

    // 🔊 REPRODUZ O ÁUDIO CAPTURADO PARA O USUÁRIO (Opcional, mas estava no seu)
    const audioElement = new Audio();
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.muted = false;
    document.body.appendChild(audioElement);

    // Inicia o loop de gravação
    startRecordingLoop();

  } catch (error) {
    console.error("Erro ao iniciar a captura no offscreen:", error);
    chrome.runtime.sendMessage({
      type: "capture_error",
      message: error.message,
    });
  }
}

// Esta é a nova função de loop
function startRecordingLoop() {
  if (!stream) return; // Parou

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
    // Quando 'stop()' é chamado, o 'ondataavailable' acima é disparado.
    // Assim que ele termina, este 'onstop' reinicia o loop para a próxima gravação.
    startRecordingLoop(); // Reinicia o loop
  };

  mediaRecorder.start(); // Começa a gravar

  // Agenda o 'stop()' para daqui a 'audioChunkSize' milissegundos.
  // Isso força o 'ondataavailable' a ser disparado com um arquivo completo.
  captureLoop = setTimeout(() => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  }, audioChunkSize);
}


// Para a captura de áudio
function stopCapture() {
  console.log("[offscreen] trying to stop tab capture");

  // Para o loop de reinício
  if (captureLoop) {
    clearTimeout(captureLoop);
    captureLoop = null;
  }

  // Para o stream
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  // Para o mediaRecorder se ele estiver ativo
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.onstop = null; // Impede que ele reinicie
    mediaRecorder.stop();
    mediaRecorder = null;
  }
}