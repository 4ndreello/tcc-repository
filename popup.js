// add error handling for permissions
async function checkPermissions() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    // check if it's a restricted tab
    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://")
    ) {
      alert(
        "Cannot capture audio from browser system pages. Please navigate to a regular website."
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Permission check failed:", error);
    return false;
  }
}

/**
 * @param {boolean} isListening
 */
async function startOrStopCapture(isListening) {
  return new Promise(async (resolve) => {
    const hasPermission = await checkPermissions();
    if (!hasPermission) return;

    chrome.runtime.sendMessage(
      { type: !isListening ? "start_capture" : "stop_capture" },
      resolve
    );
  });
}

// Update toggle button click handler
toggleButton.addEventListener("click", async () => {
  const buttonName = toggleButton.innerText.toLowerCase();
  const isListening = !buttonName.includes("start");

  await startOrStopCapture(isListening);

  const statusText = document.getElementById("statusText");
  statusText.textContent = isListening ? "Disconnected" : "Connected";

  const statusClassName = "active";
  const statusIndicator = document.getElementById("statusIndicator");

  if (isListening) statusIndicator.classList.remove(statusClassName);
  else statusIndicator.classList.add("active");

  // change toggleButton text
  toggleButton.innerText = isListening
    ? "Start Translation"
    : "Stop Translation";
});
