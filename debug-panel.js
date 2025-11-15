class DebugPanel {
  constructor() {
    this.isOpen = false;
    this.updateInterval = null;
    this.panel = null;
    this.stats = {};
    this.chartData = {
      latency: [],
      throughput: [],
      chunks: [],
    };
    this.maxChartPoints = 50;
    this.init();
  }

  init() {
    this.createPanel();
    this.startUpdates();
  }

  createPanel() {
    this.panel = document.createElement("div");
    this.panel.id = "debug-panel";
    this.panel.innerHTML = `
      <div class="debug-panel-header">
        <div class="debug-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <path d="M14 2v6h6"></path>
            <path d="M10 13h4"></path>
            <path d="M10 17h4"></path>
            <path d="M8 9h1"></path>
          </svg>
          <span>Debug Panel</span>
        </div>
        <div class="debug-panel-controls">
          <button class="debug-btn-minimize" id="debugMinimizeBtn">−</button>
          <button class="debug-btn-close" id="debugCloseBtn">×</button>
        </div>
      </div>
      <div class="debug-panel-content" id="debugContent">
        <div class="debug-section">
          <div class="debug-section-header" data-section="connection">
            <span>Connection</span>
            <span class="debug-toggle">▼</span>
          </div>
          <div class="debug-section-body" id="section-connection">
            <div class="debug-row">
              <span class="debug-label">Status:</span>
              <span class="debug-value" id="debug-ws-status">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Server URL:</span>
              <span class="debug-value" id="debug-ws-url">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Uptime:</span>
              <span class="debug-value" id="debug-uptime">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Reconnect Attempts:</span>
              <span class="debug-value" id="debug-reconnects">0</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Last Error:</span>
              <span class="debug-value debug-error" id="debug-last-error">-</span>
            </div>
          </div>
        </div>

        <div class="debug-section">
          <div class="debug-section-header" data-section="audio">
            <span>Audio</span>
            <span class="debug-toggle">▼</span>
          </div>
          <div class="debug-section-body" id="section-audio">
            <div class="debug-row">
              <span class="debug-label">Chunks Sent:</span>
              <span class="debug-value" id="debug-chunks-sent">0</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Bytes Sent:</span>
              <span class="debug-value" id="debug-bytes-sent">0 B</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Chunk Rate:</span>
              <span class="debug-value" id="debug-chunk-rate">0/s</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Throughput:</span>
              <span class="debug-value" id="debug-throughput">0 B/s</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Avg Chunk Size:</span>
              <span class="debug-value" id="debug-avg-chunk">0 B</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Last Chunk:</span>
              <span class="debug-value" id="debug-last-chunk">-</span>
            </div>
          </div>
        </div>

        <div class="debug-section">
          <div class="debug-section-header" data-section="transcription">
            <span>Transcription</span>
            <span class="debug-toggle">▼</span>
          </div>
          <div class="debug-section-body" id="section-transcription">
            <div class="debug-row">
              <span class="debug-label">Received:</span>
              <span class="debug-value" id="debug-transcriptions">0</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Rate:</span>
              <span class="debug-value" id="debug-transcription-rate">0/s</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Avg Latency:</span>
              <span class="debug-value" id="debug-avg-latency">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Min Latency:</span>
              <span class="debug-value" id="debug-min-latency">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Max Latency:</span>
              <span class="debug-value" id="debug-max-latency">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Last Received:</span>
              <span class="debug-value" id="debug-last-transcription-time">-</span>
            </div>
            <div class="debug-row full-width">
              <span class="debug-label">Last Text:</span>
              <div class="debug-value debug-text" id="debug-last-text">-</div>
            </div>
          </div>
        </div>

        <div class="debug-section">
          <div class="debug-section-header" data-section="performance">
            <span>Performance</span>
            <span class="debug-toggle">▼</span>
          </div>
          <div class="debug-section-body" id="section-performance">
            <div class="debug-row">
              <span class="debug-label">Capture Duration:</span>
              <span class="debug-value" id="debug-capture-duration">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Success Rate:</span>
              <span class="debug-value" id="debug-success-rate">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Offscreen Doc:</span>
              <span class="debug-value" id="debug-offscreen">-</span>
            </div>
            <div class="debug-row">
              <span class="debug-label">Tab ID:</span>
              <span class="debug-value" id="debug-tab-id">-</span>
            </div>
          </div>
        </div>

        <div class="debug-section">
          <div class="debug-section-header" data-section="chart">
            <span>Latency Chart</span>
            <span class="debug-toggle">▼</span>
          </div>
          <div class="debug-section-body" id="section-chart">
            <canvas id="debug-latency-chart" width="400" height="150"></canvas>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.panel);
    this.setupEventListeners();
    this.setupCharts();
  }

  setupEventListeners() {
    document.getElementById("debugCloseBtn").addEventListener("click", () => {
      this.close();
    });

    let isMinimized = false;
    document.getElementById("debugMinimizeBtn").addEventListener("click", () => {
      isMinimized = !isMinimized;
      const content = document.getElementById("debugContent");
      const btn = document.getElementById("debugMinimizeBtn");
      if (isMinimized) {
        content.style.display = "none";
        btn.textContent = "+";
      } else {
        content.style.display = "block";
        btn.textContent = "−";
      }
    });

    document.querySelectorAll(".debug-section-header").forEach((header) => {
      header.addEventListener("click", () => {
        const section = header.dataset.section;
        const body = document.getElementById(`section-${section}`);
        const toggle = header.querySelector(".debug-toggle");
        
        if (body.style.display === "none") {
          body.style.display = "block";
          toggle.textContent = "▼";
        } else {
          body.style.display = "none";
          toggle.textContent = "▶";
        }
      });
    });

    let isDragging = false;
    let currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;

    const header = this.panel.querySelector(".debug-panel-header");
    
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest(".debug-panel-controls")) return;
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      isDragging = true;
      this.panel.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        xOffset = currentX;
        yOffset = currentY;
        this.panel.style.transform = `translate(${currentX}px, ${currentY}px)`;
      }
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      this.panel.style.transition = "";
    });
  }

  setupCharts() {
    this.canvas = document.getElementById("debug-latency-chart");
    this.ctx = this.canvas.getContext("2d");
  }

  drawLatencyChart() {
    if (!this.canvas || !this.stats.latencySamples) return;

    const canvas = this.canvas;
    const ctx = this.ctx;
    const data = this.stats.latencySamples.slice(-this.maxChartPoints);
    
    if (data.length === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const max = Math.max(...data, 100);
    const min = Math.min(...data, 0);

    ctx.strokeStyle = "#2d2d4e";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (height - padding * 2) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((value, index) => {
      const x = padding + ((width - padding * 2) / (data.length - 1 || 1)) * index;
      const y = height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    ctx.fillStyle = "#60a5fa";
    data.forEach((value, index) => {
      const x = padding + ((width - padding * 2) / (data.length - 1 || 1)) * index;
      const y = height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(max)}ms`, width - padding, padding + 10);
    ctx.fillText(`${Math.round(min)}ms`, width - padding, height - padding);
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  formatDuration(ms) {
    if (!ms) return "-";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  formatTimeAgo(timestamp) {
    if (!timestamp) return "-";
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }

  async updateStats() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "get_debug_stats" }, resolve);
      });

      if (!response) return;

      this.stats = response;
      this.updateUI();
      this.drawLatencyChart();
    } catch (error) {
      console.error("Error updating debug stats:", error);
    }
  }

  updateUI() {
    const s = this.stats;

    const wsStateMap = {
      disconnected: "Disconnected",
      connecting: "Connecting...",
      connected: "Connected",
      error: "Error"
    };
    document.getElementById("debug-ws-status").textContent = wsStateMap[s.wsState] || s.wsState;
    document.getElementById("debug-ws-url").textContent = "ws://localhost:8080";
    
    if (s.connectionStartTime) {
      const uptime = Date.now() - s.connectionStartTime;
      document.getElementById("debug-uptime").textContent = this.formatDuration(uptime);
    } else {
      document.getElementById("debug-uptime").textContent = "-";
    }

    document.getElementById("debug-reconnects").textContent = s.reconnectAttempts || 0;
    
    if (s.lastError) {
      const errorText = s.lastError.length > 40 ? s.lastError.substring(0, 40) + "..." : s.lastError;
      document.getElementById("debug-last-error").textContent = `${errorText} (${this.formatTimeAgo(s.lastErrorTime)})`;
    } else {
      document.getElementById("debug-last-error").textContent = "-";
    }

    document.getElementById("debug-chunks-sent").textContent = s.audioChunksSent || 0;
    document.getElementById("debug-bytes-sent").textContent = this.formatBytes(s.audioBytesSent || 0);
    
    if (s.captureStartTime) {
      const duration = (Date.now() - s.captureStartTime) / 1000;
      const chunkRate = duration > 0 ? (s.audioChunksSent / duration).toFixed(2) : "0";
      document.getElementById("debug-chunk-rate").textContent = `${chunkRate}/s`;
      
      const throughput = duration > 0 ? (s.audioBytesSent / duration) : 0;
      document.getElementById("debug-throughput").textContent = `${this.formatBytes(throughput)}/s`;
    } else {
      document.getElementById("debug-chunk-rate").textContent = "0/s";
      document.getElementById("debug-throughput").textContent = "0 B/s";
    }

    const avgChunk = s.audioChunksSent > 0 ? s.audioBytesSent / s.audioChunksSent : 0;
    document.getElementById("debug-avg-chunk").textContent = this.formatBytes(avgChunk);
    document.getElementById("debug-last-chunk").textContent = this.formatTimeAgo(s.lastChunkTime);

    document.getElementById("debug-transcriptions").textContent = s.transcriptionsReceived || 0;
    
    if (s.captureStartTime) {
      const duration = (Date.now() - s.captureStartTime) / 1000;
      const rate = duration > 0 ? (s.transcriptionsReceived / duration).toFixed(2) : "0";
      document.getElementById("debug-transcription-rate").textContent = `${rate}/s`;
    } else {
      document.getElementById("debug-transcription-rate").textContent = "0/s";
    }

    if (s.averageLatency && s.averageLatency > 0) {
      document.getElementById("debug-avg-latency").textContent = `${Math.round(s.averageLatency)}ms`;
    } else {
      document.getElementById("debug-avg-latency").textContent = "-";
    }

    if (s.latencySamples && s.latencySamples.length > 0) {
      const min = Math.min(...s.latencySamples);
      const max = Math.max(...s.latencySamples);
      document.getElementById("debug-min-latency").textContent = `${Math.round(min)}ms`;
      document.getElementById("debug-max-latency").textContent = `${Math.round(max)}ms`;
    } else {
      document.getElementById("debug-min-latency").textContent = "-";
      document.getElementById("debug-max-latency").textContent = "-";
    }

    document.getElementById("debug-last-transcription-time").textContent = this.formatTimeAgo(s.lastTranscriptionTime);
    
    const lastText = s.lastTranscription || "-";
    const displayText = lastText.length > 100 ? lastText.substring(0, 100) + "..." : lastText;
    document.getElementById("debug-last-text").textContent = displayText;

    if (s.captureStartTime) {
      document.getElementById("debug-capture-duration").textContent = this.formatDuration(Date.now() - s.captureStartTime);
    } else {
      document.getElementById("debug-capture-duration").textContent = "-";
    }

    const successRate = s.audioChunksSent > 0 
      ? ((s.transcriptionsReceived / s.audioChunksSent) * 100).toFixed(1) 
      : "0";
    document.getElementById("debug-success-rate").textContent = `${successRate}%`;

    document.getElementById("debug-offscreen").textContent = s.offscreenDocumentActive ? "Active" : "Inactive";
    document.getElementById("debug-tab-id").textContent = s.currentTabId || "-";
  }

  startUpdates() {
    this.updateStats();
    this.updateInterval = setInterval(() => {
      this.updateStats();
    }, 1000);
  }

  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.panel.style.display = "block";
    this.startUpdates();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.style.display = "none";
    this.stopUpdates();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}

window.DebugPanel = DebugPanel;

