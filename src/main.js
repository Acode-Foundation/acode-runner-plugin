import plugin from '../plugin.json';
import LanguageRunners from './languageRunners';

const languageRunners = new LanguageRunners();

class RunnerPlugin {

  async init() {
    try {
      languageRunners.init();
      this.setupPlayButton();
    } catch (error) {
      console.error('Error initializing runner plugin:', error);
    }
  }

  setupPlayButton() {
    // Create play button element
    this.$runBtn = document.createElement("span");
    this.$runBtn.className = "icon play_arrow";
    this.$runBtn.setAttribute("action", "run");
    this.$runBtn.onclick = this.run.bind(this);
    this.$runBtn.title = "Run Code";
    
    // Check and show button for runnable files
    this.checkRunnable();
    
    // Listen for file switches and renames
    editorManager.on('switch-file', this.checkRunnable.bind(this));
    editorManager.on('rename-file', this.checkRunnable.bind(this));
  }

  checkRunnable() {
    const file = editorManager.activeFile;
    
    // Remove button if it exists
    if (this.$runBtn.isConnected) {
      this.$runBtn.remove();
    }
    
    // Check if current file is runnable
    if (file && languageRunners.canRun(file.filename)) {
      const $header = document.querySelector("#root")?.querySelector('header');
      if ($header) {
        // Insert before the last child
        $header.insertBefore(this.$runBtn, $header.lastChild);
      }
    }
  }

  async run() {
    const file = editorManager.activeFile;
    
    if (file && languageRunners.canRun(file.filename)) {
      await languageRunners.runFile(file);
    }
  }

  async destroy() {
    // Remove play button
    if (this.$runBtn) {
      this.$runBtn.onclick = null;
      this.$runBtn.remove();
    }

    editorManager.off('switch-file', this.checkRunnable.bind(this));
    editorManager.off('rename-file', this.checkRunnable.bind(this));
    
    // Cleanup language runners
    languageRunners.destroy();
  }
}

if (window.acode) {
  const acodePlugin = new RunnerPlugin();
  acode.setPluginInit(plugin.id, async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    acodePlugin.baseUrl = baseUrl;
    await acodePlugin.init($page, cacheFile, cacheFileUrl);
  });
  acode.setPluginUnmount(plugin.id, () => {
    acodePlugin.destroy();
  });
}
