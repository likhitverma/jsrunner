require.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
  },
});

require(["vs/editor/editor.main"], function () {
  // 🎨 Define Dark Modern Theme
  let isLightTheme = false;
  let statusDiv = null;
  const defaultEditorValue = `// Welcome to the JS Runner! (JavaScript Compiler)\n// Press Ctrl+Enter to execute.\n// Click </> to format your code.\n\nif (true) {\n  console.log("Hello, I am JS Runner!");\n}`;

  // Register custom JS tokenizer to highlight function names & calls
  monaco.languages.setMonarchTokensProvider("javascript", {
    tokenizer: {
      root: [
        [/[a-zA-Z_$][\w$]*(?=\s*\()/, "function.call"], // highlight function calls
        [/[A-Z][\w\$]*/, "type.identifier"], // class names
        { include: "@whitespace" },
        [/\b(true|false)\b/, "boolean"], // ✅ highlight booleans
        [/\d+/, "number"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/[{}()\[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
        [
          /\b(function|return|const|let|var|if|else|for|while|async|await|try|catch|throw|class|extends|new|import|export|default|from|as)\b/,
          "keyword",
        ],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
      whitespace: [
        [/[ \t\r\n]+/, "white"],
        [/\/\/.*$/, "comment"],
      ],
    },
  });

  monaco.editor.defineTheme("dark-modern", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", background: "1e1e1e" },
      { token: "comment", foreground: "6A9955" },
      { token: "keyword", foreground: "C586C0" },
      { token: "number", foreground: "B5CEA8" },
      { token: "string", foreground: "CE9178" },
      { token: "type.identifier", foreground: "4EC9B0" },
      { token: "function.call", foreground: "FFBB00FF" },
      { token: "boolean", foreground: "4FC1FF" }, // ✅ added boolean color
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#c6c6c6",
      "editor.selectionBackground": "#264F78",
    },
  });

  function getMonacoConfig(config) {
    const monacoConfig = {
      value: defaultEditorValue,
      language: "javascript",
      theme: config.theme,
      fontSize: 15,
      fontFamily: "Roboto Mono",
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      lineNumbers: "on",
    };
    return monacoConfig;
  }

  let editor = monaco.editor.create(
    document.getElementById("editor"),
    getMonacoConfig({ theme: "dark-modern" })
  );

  // Restore code saved from a previous session
  const savedCode = localStorage.getItem("jsrunner_code");
  if (savedCode !== null) {
    editor.setValue(savedCode);
  }

  // Auto-save code to localStorage on every keystroke.
  // Must be called again after each editor recreation (e.g. theme toggle).
  function attachChangeListener() {
    editor.onDidChangeModelContent(() => {
      localStorage.setItem("jsrunner_code", editor.getValue());
    });
  }
  attachChangeListener();

  // Toggle Dark Mode Theme — preserves code and re-attaches keyboard shortcuts
  function toggleDarkMode() {
    const currentCode = editor.getValue();
    isLightTheme = !isLightTheme;
    editor = monaco.editor.create(
      document.getElementById("editor"),
      getMonacoConfig({ theme: isLightTheme ? "vs-light" : "dark-modern" })
    );
    editor.setValue(currentCode);
    attachChangeListener();
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backquote, formatCode);
  }

  document.getElementById("darkModeBtn").onclick = toggleDarkMode;

  const consoleDiv = document.getElementById("console");
  const clearBtn = document.getElementById("clearBtn");
  const stopBtn = document.getElementById("stopBtn");

  function logToConsole(message, type = "log") {
    const div = document.createElement("div");
    div.className = type;
    div.textContent = message;
    consoleDiv.appendChild(div);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
  }

  function logStatus(message) {
    // Remove previous status if present
    const prevStatus = consoleDiv.querySelector(".status");
    if (prevStatus) consoleDiv.removeChild(prevStatus);

    // Add new status element
    statusDiv = document.createElement("div");
    statusDiv.className = "log status";
    statusDiv.textContent = message;
    consoleDiv.appendChild(statusDiv);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
    return statusDiv;
  }

  // Capture console.log
  const originalLog = console.log;
  console.log = async function (...args) {
    originalLog.apply(console, args);
    // Convert all arguments properly for display
    const formatted = args
      .map((arg) => {
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg, null, 2); // Pretty print objects
          } catch (e) {
            return "[Circular Object]";
          }
        }
        return String(arg);
      })
      .join(" ");
    if (consoleDiv.contains(statusDiv)) {
      consoleDiv.removeChild(statusDiv);
    }
    logToConsole(formatted, "log");
  };

  // 🧠 Track error decorations
  let errorDecorations = [];

  const EXECUTION_TIMEOUT_MS = 5000;

  // Holds the finish() function of the currently running worker (null when idle)
  let currentFinish = null;

  function stopExecution() {
    if (currentFinish) {
      currentFinish();
      if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
      logToConsole("🛑 Execution halted by user.", "error");
    }
  }

  document.getElementById("stopBtn").onclick = stopExecution;

  // Run Code — executes user code in a Web Worker with a 5s timeout
  async function runCode() {
    consoleDiv.innerHTML = "";
    const code = editor.getValue();
    // Remove previous error highlights before new run
    errorDecorations = editor.deltaDecorations(errorDecorations, []);

    statusDiv = logStatus("🕒 Execution in progress...");
    stopBtn.disabled = false;

    // Worker source: overrides console inside the worker and posts messages back.
    // Output is capped at MAX_LOGS to prevent flooding the main thread's task queue
    // (which would delay the timeout callback and make termination appear broken).
    const workerSrc = `
      let _logCount = 0;
      const _MAX_LOGS = 5000;

      function _postLog(msg, logType) {
        if (_logCount >= _MAX_LOGS) return;
        _logCount++;
        if (_logCount === _MAX_LOGS) {
          self.postMessage({ type: 'log', message: '⚠️ Output limit reached (5000 lines). Further logs suppressed.' });
          return;
        }
        self.postMessage({ type: 'log', message: msg, logType: logType });
      }

      console.log = function(...args) {
        const msg = args.map(a => {
          if (typeof a === 'object' && a !== null) {
            try { return JSON.stringify(a, null, 2); } catch(e) { return '[Circular Object]'; }
          }
          return String(a);
        }).join(' ');
        _postLog(msg, 'log');
      };
      console.error = function(...args) {
        _postLog(args.map(String).join(' '), 'error');
      };
      console.warn = function(...args) {
        _postLog(args.map(String).join(' '), 'warn');
      };
      self.onunhandledrejection = function(e) {
        const err = e.reason;
        self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err), line: null });
      };
      self.onmessage = async function(e) {
        const code = e.data;
        try {
          await eval('(async () => {\\n' + code + '\\n})()');
          self.postMessage({ type: 'done' });
        } catch(err) {
          const stack = (err && err.stack) || '';
          let line = null, m;
          m = stack.match(/<anonymous>:(\\d+):(\\d+)/);
          if (m) line = parseInt(m[1]) - 1;
          if (!line) { m = stack.match(/@debugger eval code:(\\d+)/i); if (m) line = parseInt(m[1]) - 1; }
          if (!line) { m = stack.match(/anonymous:(\\d+)/i); if (m) line = parseInt(m[1]) - 1; }
          if (!line) { m = stack.match(/eval code:(\\d+)/i); if (m) line = parseInt(m[1]) - 1; }
          self.postMessage({ type: 'error', message: err.message, line: line > 0 ? line : null });
        }
      };
    `;

    return new Promise((resolve) => {
      const blob = new Blob([workerSrc], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      let settled = false;

      function finish() {
        if (settled) return;
        settled = true;
        currentFinish = null;
        stopBtn.disabled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve();
      }

      currentFinish = finish;

      const timer = setTimeout(() => {
        finish();
        if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
        logToConsole("⏱️ Execution timed out (5s). Check for infinite loops.", "error");
      }, EXECUTION_TIMEOUT_MS);

      worker.onmessage = function (e) {
        const { type, message, logType, line } = e.data;
        if (type === "log") {
          if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
          logToConsole(message, logType || "log");
        } else if (type === "error") {
          finish();
          if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
          if (line) {
            logToConsole(`❌ Error at line ${line}: ${message}`, "error");
            errorDecorations = editor.deltaDecorations(errorDecorations, [
              {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  className: "errorLineDecoration",
                  glyphMarginClassName: "errorGlyph",
                },
              },
            ]);
          } else {
            logToConsole(`❌ ${message}`, "error");
          }
        } else if (type === "done") {
          finish();
          if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
          logStatus("✅ Execution complete.");
        }
      };

      worker.onerror = function (e) {
        finish();
        if (statusDiv && consoleDiv.contains(statusDiv)) consoleDiv.removeChild(statusDiv);
        logToConsole(`❌ ${e.message}`, "error");
      };

      worker.postMessage(code);
    });
  }

  document.getElementById("runBtn").onclick = runCode;
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);

  function resetEditor() {
    consoleDiv.innerHTML = "";
    editor.setValue(defaultEditorValue);
    localStorage.removeItem("jsrunner_code");
  }

  document.getElementById("resetBtn").onclick = resetEditor;

  // 🛡️ Catch global synchronous errors
  window.onerror = function (message, source, lineno, colno, error) {
    // ResizeObserver loop is a browser-internal notification, not user code error — ignore it
    if (typeof message === "string" && message.includes("ResizeObserver")) return true;
    if (statusDiv && consoleDiv.contains(statusDiv)) {
      consoleDiv.removeChild(statusDiv);
    }
    logToConsole(`❌ Error at line ${lineno}: ${message}`, "error");
    return true; // prevent default browser logging
  };

  // 🛡️ Catch global async (Promise) errors — cross-browser stack parsing
  window.onunhandledrejection = function (event) {
    if (statusDiv && consoleDiv.contains(statusDiv)) {
      consoleDiv.removeChild(statusDiv);
    }
    const error = event.reason;
    if (error && error.stack) {
      let line = null, m;
      // Chrome/Edge: <anonymous>:N:M
      m = error.stack.match(/<anonymous>:(\d+):(\d+)/);
      if (m) line = parseInt(m[1]) - 1;
      // Firefox: @debugger eval code:N:M
      if (!line) { m = error.stack.match(/@debugger eval code:(\d+)/i); if (m) line = parseInt(m[1]) - 1; }
      // Firefox fallback: anonymous:N:M
      if (!line) { m = error.stack.match(/anonymous:(\d+)/i); if (m) line = parseInt(m[1]) - 1; }
      // Safari: eval code:N:M
      if (!line) { m = error.stack.match(/eval code:(\d+)/i); if (m) line = parseInt(m[1]) - 1; }

      if (line && line > 0) {
        logToConsole(`❌ Async Error at line ${line}: ${error.message}`, "error");
      } else {
        logToConsole(`❌ Async Error: ${error.message || error}`, "error");
      }
    } else {
      logToConsole(`❌ Async Error: ${String(error)}`, "error");
    }
    return true; // prevent default browser logging
  };

  // Format Code using Prettier
  function formatCode() {
    const code = editor.getValue();
    try {
      const formatted = prettier.format(code, {
        parser: "babel",
        plugins: prettierPlugins,
      });
      logToConsole("✅ Code formatted!");
      editor.setValue(formatted);
    } catch (err) {
      logToConsole("⚠️ Format Error: " + err.message, "error");
    }
  }

  document.getElementById("formatBtn").onclick = formatCode;
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backquote,
    formatCode
  );

  // fullscreen
  function triggerFullScreenEvent() {
    const appElement = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      appElement.requestFullscreen().catch((err) => {
        logToConsole(`⚠️ Could not enter fullscreen: ${err.message}`, "error");
      });
    }
  }
  document.getElementById("fullScreenBtn").onclick = triggerFullScreenEvent;

  // Clear Console
  clearBtn.onclick = () => (consoleDiv.innerHTML = "");

  // 🧩 Improved Resizable Console (Desktop + Mobile)
  const divider = document.getElementById("divider");
  const editorDiv = document.querySelector(".editor-section");
  const consoleContainer = document.getElementById("consoleContainer");
  const main = document.querySelector(".main-content");

  let isResizing = false;

  // Debounced editor layout — avoids ResizeObserver loop by scheduling outside
  // the current paint cycle. setTimeout(0) creates a new macro-task, breaking
  // the synchronous ResizeObserver → layout → ResizeObserver chain.
  let _layoutTimer = null;
  const scheduleEditorLayout = () => {
    clearTimeout(_layoutTimer);
    _layoutTimer = setTimeout(() => editor.layout(), 20);
  };

  const startResize = (e) => {
    isResizing = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      window.innerWidth <= 768 ? "ns-resize" : "ew-resize";
    // Guard: Touch objects don't have preventDefault — only Events do
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  };

  const stopResize = () => {
    isResizing = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
    divider.classList.remove("active");
  };

  const handleResize = (clientX, clientY) => {
    if (!isResizing) return;

    if (window.innerWidth <= 768) {
      // Mobile: vertical resize
      const totalHeight = main.offsetHeight;
      const editorHeight = clientY - main.getBoundingClientRect().top;
      const minHeight = 100;
      if (editorHeight > minHeight && editorHeight < totalHeight - minHeight) {
        editorDiv.style.height = editorHeight + "px";
        consoleContainer.style.height = totalHeight - editorHeight - 6 + "px";
        editorDiv.style.width = "100%";
        consoleContainer.style.width = "100%";
        // Defer layout to next frame to avoid ResizeObserver loop errors
        scheduleEditorLayout();
      }
    } else {
      // Desktop: horizontal resize
      const totalWidth = main.offsetWidth;
      const editorWidth = clientX;
      const minWidth = 200;
      if (editorWidth > minWidth && editorWidth < totalWidth - minWidth) {
        editorDiv.style.width = editorWidth + "px";
        consoleContainer.style.width = totalWidth - editorWidth - 6 + "px";
        editorDiv.style.height = "100%";
        consoleContainer.style.height = "100%";
        scheduleEditorLayout();
      }
    }
  };

  // Mouse events
  divider.addEventListener("mousedown", startResize);
  window.addEventListener("mousemove", (e) =>
    handleResize(e.clientX, e.clientY)
  );
  window.addEventListener("mouseup", stopResize);

  // Touch events (mobile) — passive: false required for preventDefault to work
  divider.addEventListener("touchstart", (e) => {
    e.preventDefault();
    divider.classList.add("active");
    startResize(e.touches[0]);
  }, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (isResizing) e.preventDefault(); // block page scroll while resizing
    handleResize(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  window.addEventListener("touchend", stopResize);
});
