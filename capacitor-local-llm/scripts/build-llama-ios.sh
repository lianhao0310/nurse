#!/bin/bash
set -e

LLAMA_VERSION="b4609"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PLUGIN_DIR/ios/Plugin/llama"
SRC_DIR="$BUILD_DIR/src"

echo "=== Building llama.cpp for iOS (arm64 + x86_64 simulator) ==="

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning llama.cpp..."
    git clone --depth 1 --branch "$LLAMA_VERSION" https://github.com/ggml-org/llama.cpp.git "$SRC_DIR"
fi

cd "$SRC_DIR"

build_arch() {
    ARCH=$1
    echo "Building $ARCH..."
    mkdir -p "build-$ARCH" && cd "build-$ARCH"
    cmake .. \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
        -DCMAKE_BUILD_TYPE=Release \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_SERVER=OFF \
        -DGGML_METAL=ON \
        -DGGML_OPENMP=OFF
    cmake --build . --config Release -j$(sysctl -n hw.ncpu)
    cd ..
}

build_arch "arm64"
build_arch "x86_64"

echo "Creating universal static libraries..."
mkdir -p "$BUILD_DIR/lib"
for lib in libllama.a libggml.a libggml-base.a libcommon.a; do
    lipo -create \
        "$SRC_DIR/build-arm64/src/$lib" \
        "$SRC_DIR/build-x86_64/src/$lib" \
        -output "$BUILD_DIR/lib/$lib"
done

echo "Copying headers..."
mkdir -p "$BUILD_DIR/include"
cp -r "$SRC_DIR/include/"* "$BUILD_DIR/include/"
cp "$SRC_DIR/ggml/include/"* "$BUILD_DIR/include/" 2>/dev/null || true

echo "=== iOS llama.cpp build complete ==="
ls -la "$BUILD_DIR/lib/"
