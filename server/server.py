import asyncio
import websockets
import json
import random
import time

# Lista de frases de exemplo para simular a tradução
MOCK_PHRASES = [
    {"text": "This is the first sentence.", "translatedText": "Esta é a primeira frase."},
    {"text": "We are now testing the real-time translation.", "translatedText": "Estamos agora testando a tradução em tempo real."},
    {"text": "The audio chunk was received successfully.", "translatedText": "O pedaço de áudio foi recebido com sucesso."},
    {"text": "Please wait for the next translation.", "translatedText": "Por favor, aguarde a próxima tradução."},
    {"text": "The system is working as expected.", "translatedText": "O sistema está funcionando como esperado."},
    {"text": "This concludes the demonstration.", "translatedText": "Isto conclui a demonstração."},
]

# Função para enviar traduções falsas para o cliente
async def send_mock_translations(websocket):
    """Envia uma tradução mock a cada 3-5 segundos."""
    print("-> Iniciando tarefa de envio de traduções mock.")
    while True:
        try:
            # Escolhe uma frase aleatória
            phrase = random.choice(MOCK_PHRASES)
            
            # Monta a mensagem no formato esperado pela extensão
            message = {
                "type": "translation",
                "text": phrase["text"],
                "translatedText": phrase["translatedText"],
                "timestamp": int(time.time() * 1000)
            }
            
            # Envia a mensagem para o cliente (extensão)
            await websocket.send(json.dumps(message))
            print(f"   Sent translation: '{message['translatedText']}'")
            
            # Espera um tempo aleatório antes de enviar a próxima
            await asyncio.sleep(random.uniform(3, 5))
            
        except websockets.ConnectionClosed:
            print("-> Conexão fechada. Tarefa de envio de traduções encerrada.")
            break
        except Exception as e:
            print(f"Erro na tarefa de envio: {e}")
            break

# Função principal que trata cada conexão de cliente
# CORREÇÃO APLICADA AQUI: O argumento 'path' foi removido
async def handler(websocket):
    """
    Trata conexões de entrada, recebe mensagens e inicia o envio de mocks.
    """
    client_address = websocket.remote_address
    print(f"[+] Novo cliente conectado: {client_address}")
    
    # Inicia a tarefa em segundo plano para enviar as traduções mock
    sender_task = asyncio.create_task(send_mock_translations(websocket))
    
    try:
        # Fica escutando por mensagens do cliente
        async for message in websocket:
            data = json.loads(message)
            
            if data.get("type") == "config":
                print(f"   Received config: Source='{data.get('sourceLang')}', Target='{data.get('targetLang')}'")
                
            elif data.get("type") == "audio_chunk":
                # Mostra apenas o início do chunk de áudio para não poluir o terminal
                audio_preview = data.get("audio", "")[:80]
                print(f"   Received audio_chunk: {audio_preview}...")
                
            else:
                print(f"   Received unknown message type: {data}")

    except websockets.ConnectionClosed:
        print(f"[-] Cliente desconectado: {client_address}")
    finally:
        # Cancela a tarefa de envio quando o cliente se desconecta
        sender_task.cancel()


# Função para iniciar o servidor
async def main():
    host = "localhost"
    port = 8080
    async with websockets.serve(handler, host, port):
        print("=============================================")
        print(f"  Servidor WebSocket Mock iniciado em ws://{host}:{port}")
        print("  Aguardando conexões da extensão do Chrome...")
        print("=============================================")
        await asyncio.Future()  # Executa para sempre

# Ponto de entrada do script
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServidor desligado.")