var registerPlugin = (typeof Capacitor !== "undefined" && Capacitor.registerPlugin)
  ? Capacitor.registerPlugin
  : function (name) {
      return {
        loadModel: function () { return Promise.reject(new Error(name + " plugin not available")); },
        generate: function () { return Promise.reject(new Error(name + " plugin not available")); },
        unload: function () { return Promise.resolve(); },
        isModelLoaded: function () { return Promise.resolve({ loaded: false }); },
      };
    };

var LocalLLM = registerPlugin("LocalLLM");

if (typeof module !== "undefined" && module.exports) module.exports = { LocalLLM: LocalLLM };
if (typeof window !== "undefined") { if (!window.Capacitor) window.Capacitor = {}; if (!window.Capacitor.Plugins) window.Capacitor.Plugins = {}; window.Capacitor.Plugins.LocalLLM = LocalLLM; }
