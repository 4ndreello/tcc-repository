import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import '@src/Popup.css';
import { useState } from 'react';
import { FaSquareFull } from 'react-icons/fa';

const notificationOptions = {
  type: 'basic',
  iconUrl: chrome.runtime.getURL('icon-34.png'),
  title: 'Injecting content script error',
  message: 'You cannot inject script here!',
} as const;

const Popup = () => {
  const theme = useStorage(exampleThemeStorage);
  const isLight = theme === 'light';
  const [isTranslating, setIsTranslating] = useState(false);

  const handleTranslate = async () => {
    setIsTranslating(!isTranslating);
  };

  const handleButtonColor = () => {
    const baseColor = isLight ? 'bg-blue-200 text-black' : 'bg-gray-700 text-white';
    if (isTranslating) {
      return `bg-red-600 animate-pulse`;
    }
    return baseColor;
  };

  const injectContentScript = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });

    if (tab.url!.startsWith('about:') || tab.url!.startsWith('chrome:')) {
      chrome.notifications.create('inject-error', notificationOptions);
    }

    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id! },
        files: ['/content-runtime/index.iife.js'],
      })
      .catch(err => {
        // Handling errors related to other paths
        if (err.message.includes('Cannot access a chrome:// URL')) {
          chrome.notifications.create('inject-error', notificationOptions);
        }
      });
  };

  return (
    <div className={`App ${isLight ? 'bg-slate-50' : 'bg-gray-800'}`}>
      <div className={isLight ? 'text-gray-900' : 'text-gray-100'}>
        <p className="mb-4 text-xl font-extrabold leading-none tracking-tight text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
          Translate in one click any meating in realtime
        </p>

        <div className="flex flex-col items-center p-4">
          <div
            onClick={handleTranslate}
            className={'font-bold p-2 rounded shadow hover:scale-105 ' + handleButtonColor()}>
            <FaSquareFull size={14} />
          </div>
          <p className="mt-2">Click the square to toggle translation.</p>
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <div> Loading ... </div>), <div> Error Occur </div>);
