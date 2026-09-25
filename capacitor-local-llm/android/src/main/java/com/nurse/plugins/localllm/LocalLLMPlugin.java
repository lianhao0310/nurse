package com.nurse.plugins.localllm;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocalLLM")
public class LocalLLMPlugin extends Plugin {

    static {
        try {
            System.loadLibrary("llama_bridge");
        } catch (UnsatisfiedLinkError e) {
            // Native library not available
        }
    }

    private boolean modelLoaded = false;

    @PluginMethod
    public void loadModel(PluginCall call) {
        String ggufPath = call.getString("ggufPath");
        if (ggufPath == null) {
            call.reject("ggufPath is required");
            return;
        }
        int contextLength = call.getInt("contextLength", 2048);

        String absPath = getAbsolutePath(ggufPath);
        if (absPath == null) {
            call.reject("Model file not found: " + ggufPath);
            return;
        }

        try {
            int result = nativeLoadModel(absPath, contextLength);
            if (result != 0) {
                call.reject("Failed to load model");
                return;
            }
            modelLoaded = true;
            call.resolve();
        } catch (UnsatisfiedLinkError e) {
            call.reject("Native library not loaded: " + e.getMessage());
        }
    }

    @PluginMethod
    public void generate(PluginCall call) {
        if (!modelLoaded) {
            call.reject("Model not loaded");
            return;
        }
        String prompt = call.getString("prompt", "");
        int maxTokens = call.getInt("maxTokens", 512);
        double temperature = call.getDouble("temperature", 0.7);

        try {
            String result = nativeGenerate(prompt, maxTokens, (float) temperature);
            JSObject ret = new JSObject();
            ret.put("text", result);
            call.resolve(ret);
        } catch (UnsatisfiedLinkError e) {
            call.reject("Native library not loaded: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unload(PluginCall call) {
        try {
            nativeUnload();
        } catch (UnsatisfiedLinkError e) {
            // ignore
        }
        modelLoaded = false;
        call.resolve();
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", modelLoaded);
        call.resolve(ret);
    }

    private String getAbsolutePath(String path) {
        if (path.startsWith("/")) return path;
        String docsDir = getContext().getFilesDir().getAbsolutePath();
        return docsDir + "/" + path;
    }

    private native int nativeLoadModel(String path, int contextLength);
    private native String nativeGenerate(String prompt, int maxTokens, float temperature);
    private native void nativeUnload();
}
