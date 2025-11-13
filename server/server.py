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

    async def process_chunk(self, audio_bytes: bytes) -> Optional[Dict[str, Any]]:
        input_path = None
        try:
            #still need the temporary input file for ffmpeg
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                temp_file.write(audio_bytes)
                input_path = temp_file.name
            
            # modified ffmpeg command:
            # -f s16le: format output as 16-bit signed little-endian pcm
            # -: send output to stdout, not a file
            cmd = [
                self.ffmpeg_path, '-y', '-i', input_path,
                '-ar', '16000',     # resample to 16khz
                '-ac', '1',          # mono channel
                '-f', 's16le',       # output format (raw pcm)
                '-'                  # output to stdout
            ]

            logger.info(f"processing chunk of {len(audio_bytes)} bytes in-memory...")
            
            # 3. run process and capture stdout/stderr
            proc = await asyncio.create_subprocess_exec(
                *cmd, 
                stdout=asyncio.subprocess.PIPE, 
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.error(f"ffmpeg failed: {stderr.decode('utf-8', errors='ignore')[:500]}")
                return None
            
            # 'stdout' now contains the raw pcm audio bytes
            logger.info(f"ffmpeg ok. received {len(stdout)} bytes of raw pcm data.")
            
            if not stdout:
                logger.warning("ffmpeg produced no output.")
                return None

            # convert raw bytes to numpy float32 array
            # whisper expects audio normalized between -1.0 and 1.0
            audio_np = np.frombuffer(stdout, dtype=np.int16).astype(np.float32) / 32768.0
            
            # feed numpy array directly to whisper
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: self.whisper_model.transcribe(audio_np, fp16=False))
            original_text = result.get("text", "").strip()

            if not original_text:
                logger.info("no text transcribed.")
                return None
            
            logger.info(f"transcribed: '{original_text}'")
            
            # return original text in both fields
            return {"text": original_text, "translatedText": original_text}

        except Exception as e:
            logger.error(f"error during processing: {e}")
            return None
        finally:
            # 7. clean up only the temporary input file
            if input_path and os.path.exists(input_path): 
                os.unlink(input_path)

processor = AudioProcessor(model_size="base")

async def handler(websocket):
    """manages the connection and maintains state (the header) for each client."""
    logger.info(f"client connected: {websocket.remote_address}")
    if not processor.is_initialized:
        await processor.initialize_models()
    
    # --- connection state logic ---
    header_bytes = None # each connection has its own header "memory"
    # --- end of state logic ---

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
                
                # --- audio assembly logic ---
                bytes_to_process = None
                if header_bytes is None:
                    # this is the first chunk, it contains the header.
                    logger.info("first chunk (with header) received. saving and processing...")
                    header_bytes = audio_bytes
                    bytes_to_process = audio_bytes
                else:
                    # this is a subsequent chunk. joining with the saved header.
                    logger.info("subsequent data chunk received. combining with header...")
                    bytes_to_process = header_bytes + audio_bytes
                # --- end of assembly logic ---

                # --- start timing ---
                start_time = time.perf_counter()
                
                result = await processor.process_chunk(bytes_to_process)
                
                # --- end timing ---
                end_time = time.perf_counter()
                processing_ms = (end_time - start_time) * 1000
                
                if result:
                    response = {"type": "transcription", **result, "timestamp": int(time.time() * 1000)}
                    await websocket.send(json.dumps(response))
                    
                    # log with timing
                    logger.info(f"transcription sent to extension. (processing time: {processing_ms:.2f} ms)")
                    
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
    logger.info("=============================================")
    async with websockets.serve(handler, host, port):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("server shut down.")