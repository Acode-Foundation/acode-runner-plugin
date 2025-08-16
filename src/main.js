import plugin from '../plugin.json';
import LanguageRunners from './languageRunners';

const languageRunners = new LanguageRunners();

class RunnerPlugin {

  async init() {
    try {
      languageRunners.init();

      this.setupFileHooks();
    } catch (error) {
      console.error('Error initializing runner plugin:', error);
    }
  }

  setupFileHooks() {
    const EditorFile = acode.require('EditorFile');
    
    // Store original methods for cleanup
    this.originalReadCanRun = EditorFile.prototype.readCanRun;
    this.originalRun = EditorFile.prototype.run;
    
    
    const plugin = this; // Capture plugin instance for closures
    
    // Hook into readCanRun to extend functionality
    if (this.originalReadCanRun) {
      EditorFile.prototype.readCanRun = async function() {
        try {
          if (!Terminal || !Terminal.isInstalled()) {
            await plugin.originalReadCanRun.call(this);
            return;
          }

          const isLanguageFile = languageRunners.canRun(this.filename);
          
          if (isLanguageFile) {
            this.writeCanRun(() => true);
            return;
          }
          
          await plugin.originalReadCanRun.call(this);
          
        } catch (error) {
          console.error('Plugin readCanRun error:', error);
          // Always fallback to original to avoid breaking the app
          try {
            await plugin.originalReadCanRun.call(this);
          } catch (originalError) {
            console.error('Original readCanRun also failed:', originalError);
          }
        }
      };
    }

    // Hook into run method
    if (this.originalRun) {
      EditorFile.prototype.run = function() {
        try {
          if (languageRunners.canRun(this.filename)) {
            languageRunners.runFile(this, false);
          } else {
            plugin.originalRun.call(this);
          }
        } catch (error) {
          console.error('Plugin run error:', error);
          // Always fallback to original
          try {
            plugin.originalRun.call(this);
          } catch (originalError) {
            console.error('Original run also failed:', originalError);
          }
        }
      };
    }
  }

  async destroy() {
    // Cleanup when plugin is uninstalled
    languageRunners.destroy();
    
    const EditorFile = acode.require('EditorFile');
    
    // Restore original methods
    if (this.originalCanRun) {
      EditorFile.prototype.canRun = this.originalCanRun;
    }
    if (this.originalRun) {
      EditorFile.prototype.run = this.originalRun;
    }
    if (this.originalReadCanRun) {
      EditorFile.prototype.readCanRun = this.originalReadCanRun;
    }
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
