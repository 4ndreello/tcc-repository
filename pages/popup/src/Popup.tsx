import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import '@src/Popup.css';
import { useEffect, useRef, useState } from 'react';
import { FaSquareFull } from 'react-icons/fa';

const notifyOpts = {
  type: 'basic',
  iconUrl: chrome.runtime.getURL('icon-34.png'),
  title: 'Injecting content script error',
  message: 'The extension is not allowed to inject content script into this page.',
} as const;

const Popup = () => {
  const theme = useStorage(exampleThemeStorage);
  const isLight = theme === 'light';
  const [isListening, setIsListening] = useState(false);
  const [readText, setReadText] = useState<string>('...');

  const handleTranslate = async () => {
    setIsListening(!isListening);
  };

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return (
      <div>
        <h1>Speech Recognition not supported</h1>
      </div>
    );
  }

  useEffect(() => {
    console.log(`${isListening ? 'starting' : 'stoping'} listening`);
    injectContentScript();
  }, [isListening]);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(message);
  });

  const getButtonColor = () => {
    const baseColor = isLight ? 'bg-blue-200 text-black' : 'bg-gray-700 text-white';
    if (isListening) {
      return `bg-red-600 animate-pulse`;
    }
    return baseColor;
  };

  function addListenerToDocument(isListening: boolean) {
    // @ts-expect-error
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.continuous = true;

    recognition.addEventListener('result', (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      console.log(transcript);

      chrome.runtime.sendMessage({ transcript });
    });

    if (isListening) {
      recognition.start();
    } else {
      recognition.stop();
    }
  }

  const injectContentScript = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });

    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id! },
        func: addListenerToDocument,
        args: [isListening],
      })
      .catch(() => chrome.notifications.create('inject-error', notifyOpts));
  };

  return (
    <div
      className={`flex p-2 flex-col select-none h-screen ${isLight ? 'bg-slate-50 text-gray-900' : 'bg-gray-800 text-gray-100'}`}>
      <div className="text-center">
        <p className="mb-4 text-xl font-extrabold leading-none tracking-tight md:text-5xl lg:text-6xl dark:text-white">
          Translate in one click any call in realtime
        </p>
      </div>

      <div className="flex items-center">{isListening ? <h1>Listening: {readText}</h1> : null}</div>

      <div className="flex flex-col flex-1 mt-auto items-center p-4">
        <div
          onClick={handleTranslate}
          className={'font-bold p-2 mt-auto rounded shadow hover:scale-105 ' + getButtonColor()}>
          <FaSquareFull size={14} />
        </div>
        <p className="mt-2">* Click the square to toggle translation.</p>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <div> Loading ... </div>), <div> Error Occur </div>);
