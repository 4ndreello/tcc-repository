#!/usr/bin/env python3

import logging
import asyncio
import websockets
import json
import base64
import tempfile
import os
import time
import subprocess
from typing import Optional, Dict, Any

import whisper
import numpy as np
import torch

# --- NOVAS IMPORTAÇÕES ---
import logging.handlers
import datetime
# --- FIM DAS NOVAS IMPORTAÇÕES ---

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- INÍCIO DA MODIFICAÇÃO: CONFIGURAÇÃO DO LOGGER DE DADOS ---
# Define o nome do arquivo de log de performance
DATA_LOG_FILE = "server_performance.txt"

# Cria um logger separado para os dados de performance
data_logger = logging.getLogger('performance')
data_logger.setLevel(logging.INFO)
data_logger.propagate = False  # Impede que os logs de dados apareçam no console

# Configura o handler do arquivo (RotatingFileHandler para evitar arquivos gigantes)
# 5MB por arquivo, mantém 2 arquivos de backup
file_handler = logging.handlers.RotatingFileHandler(
    DATA_LOG_FILE, maxBytes=5*1024*1024, backupCount=2
)

# Define um formato simples: apenas a mensagem, pois vamos formatá-la manualmente
file_handler.setFormatter(logging.Formatter('%(message)s'))
data_logger.addHandler(file_handler)

# Escreve o cabeçalho no arquivo .txt se ele for novo ou estiver vazio
# Este formato é TSV (Tab-Separated Values), fácil de importar no Excel
if not os.path.exists(DATA_LOG_FILE) or os.path.getsize(DATA_LOG_FILE) == 0:
    data_logger.info(
        "timestamp_iso\t"
        "processing_latency_ms\t"
        "decoded_audio_duration_s\t"
        "throughput_x_realtime\t"
        "device"
    )
# --- FIM DA MODIFICAÇÃO ---


SAMPLE_RATE = 16000 # Taxa de amostragem do Whisper
MAX_BUFFER_SECONDS = 20 # Manter um "histórico" de 20 segundos (a "janela")
OVERLAP_SECONDS = 3   # Manter 3s de áudio anterior para dar contexto

class AudioProcessor:
    def __init__(self, model_size: str = "base", ffmpeg_path: str = None):
        self.model_size = model_size
        self.ffmpeg_path = ffmpeg_path or "ffmpeg"
        self.whisper_model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.is_initialized = False

    async def initialize_models(self):
        if self.is_initialized: return
        logger.info("loading whisper model...")
        loop = asyncio.get_event_loop()
        self.whisper_model = await loop.run_in_executor(None, whisper.load_model, self.model_size, self.device)
        self.is_initialized = True
        logger.info(f"models loaded! whisper: {self.model_size}, device: {self.device}")

    async def decode_chunk(self, audio_bytes: bytes) -> Optional[np.ndarray]:
        input_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                temp_file.write(audio_bytes)
                input_path = temp_file.name
            
            cmd = [
                self.ffmpeg_path, '-y', '-i', input_path,
                '-ar', str(SAMPLE_RATE),
                '-ac', '1',
                '-f', 's16le',
                '-'
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd, 
                stdout=asyncio.subprocess.PIPE, 
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.error(f"ffmpeg failed: {stderr.decode('utf-8', errors='ignore')[:500]}")
                return None
            
            if not stdout:
                logger.warning("ffmpeg produced no output.")
                return None

            audio_np = np.frombuffer(stdout, dtype=np.int16).astype(np.float32) / 32768.0
            return audio_np

        except Exception as e:
            logger.error(f"error during decoding: {e}")
            return None
        finally:
            if input_path and os.path.exists(input_path): 
                os.unlink(input_path)

    async def transcribe_buffer(self, audio_buffer: np.ndarray) -> Optional[Dict[str, Any]]:
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: self.whisper_model.transcribe(audio_buffer, fp16=False))
            original_text = result.get("text", "").strip()

            if not original_text:
                return None
            
            return {"text": original_text, "translatedText": original_text}
        
        except Exception as e:
            logger.error(f"error during transcription: {e}")
            return None


processor = AudioProcessor(model_size="base")

async def handler(websocket):
    logger.info(f"client connected: {websocket.remote_address}")
    if not processor.is_initialized:
        await processor.initialize_models()
    
    # --- Lógica de Estado (Buffer) ---
    max_samples = SAMPLE_RATE * MAX_BUFFER_SECONDS
    overlap_samples = SAMPLE_RATE * OVERLAP_SECONDS # Amostras de sobreposição
    
    audio_buffer = np.array([], dtype=np.float32)     # A "janela" de áudio de 20s
    final_transcript = ""                             # O seu "texto salvo localmente"
    last_sent_text = ""                               # Para evitar repetições

    try:
        async for message in websocket:
            data = json.loads(message)
            if data.get("type") == "audio_chunk":
                base64_audio = data.get("audio", "")
                
                if base64_audio.startswith('data:'):
                    base64_audio = base64_audio.split(',', 1)[1]
                
                missing_padding = len(base64_audio) % 4
                if missing_padding: base64_audio += '=' * (4 - missing_padding)
                
                audio_bytes = base64.b64decode(base64_audio)
                
                start_time = time.perf_counter()
                
                decoded_np = await processor.decode_chunk(audio_bytes)
                if decoded_np is None:
                    logger.warning("skipping chunk, decoding failed.")
                    continue

                # 1. Adiciona o novo áudio ao buffer da janela atual
                audio_buffer = np.concatenate([audio_buffer, decoded_np])
                
                current_window_text = "" # Texto "temporário" da janela atual

                # 2. A janela está cheia? (20s)
                if len(audio_buffer) >= max_samples:
                    logger.info(f"--- JANELA DE {MAX_BUFFER_SECONDS}s CHEIA ---")
                    
                    # 3. Transcreve a janela *inteira* para "finalizar"
                    result = await processor.transcribe_buffer(audio_buffer)
                    text_to_finalize = result.get("text", "") if result else ""
                    
                    # 4. Salva o texto
                    final_transcript += text_to_finalize + " "
                    logger.info(f"Texto finalizado: {text_to_finalize}")

                    # 5. Limpa o buffer, mas mantém a sobreposição (os últimos 3s)
                    audio_buffer = audio_buffer[max_samples - overlap_samples:]
                
                else:
                    # A janela ainda está enchendo (0-19s)
                    # Transcreve o buffer atual para dar um "preview"
                    result = await processor.transcribe_buffer(audio_buffer)
                    current_window_text = result.get("text", "") if result else ""
                # *** FIM DA MODIFICAÇÃO ***


                end_time = time.perf_counter()
                processing_ms = (end_time - start_time) * 1000
                
                # --- INÍCIO DA MODIFICAÇÃO: LOG DE PERFORMANCE ---
                decoded_duration_s = 0.0
                throughput_x_rt = 0.0
                
                # Calcula a duração real do áudio decodificado
                if decoded_np is not None:
                    decoded_duration_s = len(decoded_np) / SAMPLE_RATE
                
                processing_duration_s = processing_ms / 1000.0

                if processing_duration_s > 0:
                    # Calcula o "throughput" como "X vezes o tempo real"
                    # Ex: Se processou 1s de áudio em 0.5s, o throughput é 2.0x
                    throughput_x_rt = decoded_duration_s / processing_duration_s

                # Obtém o timestamp atual em formato ISO
                log_timestamp = datetime.datetime.utcnow().isoformat()
                
                # Loga os dados no arquivo 'server_performance.txt'
                data_logger.info(
                    f"{log_timestamp}\t"
                    f"{processing_ms:.4f}\t"
                    f"{decoded_duration_s:.4f}\t"
                    f"{throughput_x_rt:.4f}\t"
                    f"{processor.device}"
                )
                # --- FIM DA MODIFICAÇÃO ---

                # 6. Envia o texto completo (Salvo + Preview da janela atual)
                full_text_to_send = final_transcript + current_window_text

                if full_text_to_send and full_text_to_send != last_sent_text:
                    last_sent_text = full_text_to_send
                    
                    response = {
                        "type": "transcription", 
                        "text": full_text_to_send, 
                        "translatedText": full_text_to_send, # Mudar aqui se tiver tradução real
                        "timestamp": int(time.time() * 1000)
                    }
                    await websocket.send(json.dumps(response))
                    
                    logger.info(f"transcription SENT: '{full_text_to_send}' (buffer: {len(audio_buffer)/SAMPLE_RATE:.2f}s, time: {processing_ms:.2f} ms)")
                
                elif full_text_to_send:
                    logger.info(f"transcription SKIPPED (redundant). (buffer: {len(audio_buffer)/SAMPLE_RATE:.2f}s, time: {processing_ms:.2f} ms)")
                    
    except websockets.ConnectionClosed:
        logger.info(f"client disconnected: {websocket.remote_address}")
    except Exception as e:
        logger.error(f"error in handler: {e}")

async def main():
    host = "localhost"
    port = 8080
    logger.info("=============================================")
    logger.info("in-memory audio processing server started")
    logger.info(f"address: ws://{host}:{port}")
    logger.info(f"buffer size: {MAX_BUFFER_SECONDS}s window, {OVERLAP_SECONDS}s overlap")
    # --- MODIFICAÇÃO: Loga o local do arquivo de dados ---
    logger.info(f"performance data will be logged to: {DATA_LOG_FILE}")
    # --- FIM DA MODIFICAÇÃO ---
    logger.info("=============================================")
    async with websockets.serve(handler, host, port):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("server shut down.")