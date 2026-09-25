#!/bin/bash
set -e

LLAMA_VERSION="b4609"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
JNI_DIR="$PLUGIN_DIR/android/src/main/jni"

echo "=== Building llama.cpp for Android (arm64-v8a + armeabi-v7a) ==="

if [ ! -d "$JNI_DIR/llama.cpp" ]; then
    echo "Cloning llama.cpp..."
    git clone --depth 1 --branch "$LLAMA_VERSION" https://github.com/ggml-org/llama.cpp.git "$JNI_DIR/llama.cpp"
fi

echo "=== Android llama.cpp clone complete ==="
echo "NDK build will be handled by Gradle externalNativeBuild with CMakeLists.txt"
