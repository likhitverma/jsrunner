require.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
  },
});

require(["vs/editor/editor.main"], function () {
  // 🎨 Define Dark Modern Theme
  let isLightTheme = false;
  let statusDiv = null;
  monaco.editor.defineTheme("dark-modern", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", background: "1e1e1e" },
      { token: "comment", foreground: "6A9955" },
      { token: "keyword", foreground: "C586C0" },
      { token: "number", foreground: "B5CEA8" },
      { token: "string", foreground: "CE9178" },
      { token: "type", foreground: "4EC9B0" },
      { token: "function", foreground: "DCDCAA" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "methods", foreground: "264F78" },
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
      value: `// Welcome to the JS Runner! (JavaScript Compiler)\n// Press Ctrl+Enter to execute.\n// Click </> to format your code.\n\nconsole.log("Hello, I am JS Runner!");`,
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

  // Toggle Dark Mode Theme
  function toggleDarkMode() {
    isLightTheme = !isLightTheme;
    editor = monaco.editor.create(
      document.getElementById("editor"),
      getMonacoConfig({ theme: isLightTheme ? "vs-light" : "dark-modern" })
    );
  }

  document.getElementById("darkModeBtn").onclick = toggleDarkMode;

  const consoleDiv = document.getElementById("console");
  const clearBtn = document.getElementById("clearBtn");

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

  // Run Code
  function runCode() {
    consoleDiv.innerHTML = "";
    const code = editor.getValue();
    // Show and track status
    statusDiv = logStatus("🕒 Execution in progress...");
    try {
      new Function(code)();
    } catch (err) {
      if (consoleDiv.contains(statusDiv)) {
        consoleDiv.removeChild(statusDiv);
      }
      const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
      if (match) {
        const line = parseInt(match[1]);
        logToConsole(`❌ Error at line ${line}: ${err.message}`, "error");
      } else {
        logToConsole(`❌ ${err.message}`, "error");
      }
    }
  }

  document.getElementById("runBtn").onclick = runCode;
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);

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
    if (appElement) {
      document.fullscreenElement
        ? document.exitFullscreen()
        : appElement.requestFullscreen();
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

  const startResize = (e) => {
    isResizing = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      window.innerWidth <= 768 ? "ns-resize" : "ew-resize";
    e.preventDefault();
  };

  const stopResize = () => {
    isResizing = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
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
        editor.layout();
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
        editor.layout();
      }
    }
  };

  // Mouse events
  divider.addEventListener("mousedown", startResize);
  window.addEventListener("mousemove", (e) =>
    handleResize(e.clientX, e.clientY)
  );
  window.addEventListener("mouseup", stopResize);

  // Touch events (mobile)
  divider.addEventListener("touchstart", (e) => {
    startResize(e.touches[0]);
  });
  window.addEventListener("touchmove", (e) => {
    handleResize(e.touches[0].clientX, e.touches[0].clientY);
  });
  window.addEventListener("touchend", stopResize);
});
