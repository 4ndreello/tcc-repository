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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


SAMPLE_RATE = 16000
MAX_BUFFER_SECONDS = 8
OVERLAP_SECONDS = 3

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

    async def transcribe_buffer(self, audio_buffer: np.ndarray, language: Optional[str] = None, initial_prompt: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Transcreve o buffer de áudio.
        
        Args:
            audio_buffer: Buffer de áudio numpy array
            language: Idioma para usar (opcional). Se fornecido, melhora performance
                     pois evita detecção automática. Ex: "pt", "en", "es"
            initial_prompt: Texto de contexto anterior (opcional). Melhora precisão
                          ao fornecer contexto do que foi dito antes.
        
        Returns:
            Dict com text, translatedText, language e language_probs (se disponível)
        """
        try:
            loop = asyncio.get_event_loop()
            
            # Preparar parâmetros para transcribe
            transcribe_kwargs = {"fp16": False}
            if language:
                # Especificar idioma melhora performance e precisão
                # O modelo não precisa calcular probabilidades para todos os idiomas
                transcribe_kwargs["language"] = language
                logger.debug(f"Using specified language: {language} (performance optimized)")
            
            # Usar texto anterior como contexto para melhorar precisão
            if initial_prompt:
                # Limitar o prompt aos últimos 224 tokens (limite do Whisper)
                # Aproximadamente 200 palavras ou ~1000 caracteres
                prompt_text = initial_prompt.strip()
                if len(prompt_text) > 500:
                    # Pegar apenas as últimas palavras para manter contexto recente
                    prompt_text = "..." + prompt_text[-500:]
                transcribe_kwargs["initial_prompt"] = prompt_text
                logger.debug(f"Using context prompt: {prompt_text[:50]}...")
            
            result = await loop.run_in_executor(
                None, 
                lambda: self.whisper_model.transcribe(audio_buffer, **transcribe_kwargs)
            )
            
            original_text = result.get("text", "").strip()
            whisper_detected_language = result.get("language", "unknown")

            if not original_text:
                return None
            
            # Normalizar português para pt-BR
            if whisper_detected_language == "pt":
                final_language = "pt-BR"
            else:
                final_language = whisper_detected_language
            
            response = {
                "text": original_text, 
                "translatedText": original_text,
                "language": final_language
            }
            
            return response
        
        except Exception as e:
            logger.error(f"error during transcription: {e}")
            return None


processor = AudioProcessor(model_size="base")

async def handler(websocket):
    logger.info(f"client connected: {websocket.remote_address}")
    if not processor.is_initialized:
        await processor.initialize_models()
    
    max_samples = SAMPLE_RATE * MAX_BUFFER_SECONDS
    overlap_samples = SAMPLE_RATE * OVERLAP_SECONDS
    
    audio_buffer = np.array([], dtype=np.float32)
    final_transcript = ""
    last_sent_text = ""
    
    # Idioma selecionado pelo cliente (None = detecção automática)
    selected_language = None  # None significa detecção automática

    try:
        async for message in websocket:
            data = json.loads(message)
            
            # Processar configuração de idioma
            if data.get("type") == "language_config":
                lang = data.get("language", "auto")
                if lang == "auto":
                    selected_language = None
                    logger.info("Language set to: AUTO DETECTION (slower)")
                else:
                    selected_language = lang
                    logger.info(f"Language set to: {lang.upper()} (optimized)")
                continue
            
            # Processar reset de contexto
            if data.get("type") == "reset_context":
                audio_buffer = np.array([], dtype=np.float32)
                final_transcript = ""
                last_sent_text = ""
                logger.info("Context reset - buffer and transcript cleared")
                continue
            
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

                audio_buffer = np.concatenate([audio_buffer, decoded_np])
                
                current_window_text = ""
                detected_lang = None

                if len(audio_buffer) >= max_samples:
                    logger.info(f"--- JANELA DE {MAX_BUFFER_SECONDS}s CHEIA ---")
                    
                    # Usar texto finalizado como contexto para melhorar precisão
                    # Passar o final_transcript como initial_prompt
                    result = await processor.transcribe_buffer(
                        audio_buffer, 
                        language=selected_language,
                        initial_prompt=final_transcript.strip() if final_transcript.strip() else None
                    )
                    text_to_finalize = result.get("text", "") if result else ""
                    detected_lang = result.get("language", "unknown") if result else "unknown"
                    
                    final_transcript += text_to_finalize + " "
                    logger.info(f"Texto finalizado: {text_to_finalize} (lang: {detected_lang}, context: {len(final_transcript)} chars)")

                    audio_buffer = audio_buffer[max_samples - overlap_samples:]
                
                else:
                    # Usar texto finalizado como contexto mesmo para janela parcial
                    # Isso ajuda na continuidade da transcrição
                    result = await processor.transcribe_buffer(
                        audio_buffer, 
                        language=selected_language,
                        initial_prompt=final_transcript.strip() if final_transcript.strip() else None
                    )
                    current_window_text = result.get("text", "") if result else ""
                    detected_lang = result.get("language", "unknown") if result else "unknown"


                end_time = time.perf_counter()
                processing_ms = (end_time - start_time) * 1000

                full_text_to_send = final_transcript + current_window_text

                if full_text_to_send and full_text_to_send != last_sent_text:
                    last_sent_text = full_text_to_send
                    
                    # Usar idioma detectado do resultado, ou o selecionado como fallback
                    response_lang = detected_lang if detected_lang else (selected_language or "unknown")
                    
                    response = {
                        "type": "transcription", 
                        "text": full_text_to_send, 
                        "translatedText": full_text_to_send,
                        "timestamp": int(time.time() * 1000),
                        "language": response_lang
                    }
                    
                    await websocket.send(json.dumps(response))
                    
                    logger.info(f"transcription SENT: '{full_text_to_send}' (buffer: {len(audio_buffer)/SAMPLE_RATE:.2f}s, time: {processing_ms:.2f} ms, language: {response_lang})")
                
                elif full_text_to_send:
                    logger.info(f"transcription SKIPPED (redundant). (buffer: {len(audio_buffer)/SAMPLE_RATE:.2f}s)")
                    
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
    logger.info("=============================================")
    async with websockets.serve(handler, host, port):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("server shut down.")