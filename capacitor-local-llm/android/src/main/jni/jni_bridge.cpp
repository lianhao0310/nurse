#include <jni.h>
#include <string>
#include "llama_bridge.h"

extern "C" {

JNIEXPORT jint JNICALL
Java_com_nurse_plugins_localllm_LocalLLMPlugin_nativeLoadModel(
    JNIEnv* env, jobject, jstring jPath, jint contextLength) {
    const char* path = env->GetStringUTFChars(jPath, nullptr);
    llama_model_handle model = llama_bridge_load_model(path, contextLength);
    env->ReleaseStringUTFChars(jPath, path);
    return model ? 0 : -1;
}

JNIEXPORT jstring JNICALL
Java_com_nurse_plugins_localllm_LocalLLMPlugin_nativeGenerate(
    JNIEnv* env, jobject, jstring jPrompt, jint maxTokens, jfloat temperature) {
    const char* prompt = env->GetStringUTFChars(jPrompt, nullptr);
    std::string result;
    llama_bridge_generate(
        nullptr, nullptr, prompt, maxTokens, temperature,
        [](const char* token, void* userData) {
            auto* str = (std::string*)userData;
            *str += token;
        },
        &result
    );
    env->ReleaseStringUTFChars(jPrompt, prompt);
    return env->NewStringUTF(result.c_str());
}

JNIEXPORT void JNICALL
Java_com_nurse_plugins_localllm_LocalLLMPlugin_nativeUnload(
    JNIEnv*, jobject) {
    llama_bridge_free_model(nullptr);
}

}
