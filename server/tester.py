import asyncio
import websockets
import json
import base64
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SERVER_URI = "ws://localhost:8080"
TEST_FILE = "test_audio.wav" # certifique-se que este arquivo existe no mesmo diretorio

async def send_audio_test(file_path: str):
    logger.info(f"connecting to {SERVER_URI}...")
    try:
        async with websockets.connect(SERVER_URI) as websocket:
            logger.info("connection established.")
            
            # ler o arquivo de audio de teste
            try:
                with open(file_path, "rb") as f:
                    audio_data = f.read()
            except FileNotFoundError:
                logger.error(f"test file not found: {file_path}")
                logger.error(f"please create a '{TEST_FILE}' file in this directory.")
                return

            # codificar em base64
            base64_audio = base64.b64encode(audio_data).decode('utf-8')
            
            # montar a mensagem json
            message = json.dumps({
                "type": "audio_chunk",
                "audio": base64_audio
            })
            
            logger.info(f"sending audio chunk ({len(audio_data)} bytes)...")
            await websocket.send(message)
            
            # aguardar a resposta
            logger.info("waiting for server response...")
            response_str = await websocket.recv()
            logger.info("response received:")
            
            # formatar o json para melhor legibilidade
            try:
                response_json = json.loads(response_str)
                logger.info(json.dumps(response_json, indent=2, ensure_ascii=False))
            except json.JSONDecodeError:
                logger.info(response_str)

    except websockets.exceptions.ConnectionClosedError as e:
        logger.error(f"connection closed: {e}")
    except Exception as e:
        logger.error(f"an error occurred: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(send_audio_test(TEST_FILE))
    except KeyboardInterrupt:
        logger.info("test interrupted by user.")