@import Capacitor;

CAP_PLUGIN(LocalLLMPlugin, "LocalLLM",
    CAP_PLUGIN_METHOD(loadModel, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(generate, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(unload, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isModelLoaded, CAPPluginReturnPromise);
)
