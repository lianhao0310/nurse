#!/bin/bash
set -e

LLAMA_VERSION="b4609"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PLUGIN_DIR/ios/Plugin/llama"
SRC_DIR="$BUILD_DIR/src"

echo "=== Building llama.cpp for iOS (arm64 + x86_64 simulator) ==="

mkdir -p "$BUILD_DIR"

if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning llama.cpp..."
    git clone --depth 1 --branch "$LLAMA_VERSION" https://github.com/ggml-org/llama.cpp.git "$SRC_DIR"
fi

cd "$SRC_DIR"

build_arch() {
    ARCH=$1
    echo "Building $ARCH..."
    rm -rf "build-$ARCH"
    mkdir -p "build-$ARCH" && cd "build-$ARCH"
    cmake .. \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="$BUILD_DIR/install-$ARCH" \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_EXAMPLES=OFF \
        -DLLAMA_BUILD_SERVER=OFF \
        -DGGML_METAL=ON \
        -DGGML_OPENMP=OFF \
        -DBUILD_SHARED_LIBS=OFF
    cmake --build . --config Release -j$(sysctl -n hw.ncpu)
    cmake --install . --config Release 2>/dev/null || true
    cd "$SRC_DIR"
    echo "=== .a files in build-$ARCH ==="
    find "build-$ARCH" -name "*.a" -type f || true
    echo "=== .a files in install-$ARCH ==="
    find "$BUILD_DIR/install-$ARCH" -name "*.a" -type f || true
}

build_arch "arm64"
build_arch "x86_64"

echo "Creating universal static libraries..."
mkdir -p "$BUILD_DIR/lib"

# Collect all unique .a filenames from both builds
ALL_LIBS=$(find "$SRC_DIR/build-arm64" "$SRC_DIR/build-x86_64" \
    "$BUILD_DIR/install-arm64" "$BUILD_DIR/install-x86_64" \
    -name "*.a" -type f 2>/dev/null | xargs -I{} basename {} | sort -u)

if [ -z "$ALL_LIBS" ]; then
    echo "ERROR: No .a files found in build directories"
    echo "=== build-arm64 contents ==="
    find "$SRC_DIR/build-arm64" -type f -name "*.a" -o -name "*.dylib" 2>/dev/null || true
    exit 1
fi

for lib in $ALL_LIBS; do
    ARM64_FILE=$(find "$SRC_DIR/build-arm64" "$BUILD_DIR/install-arm64" -name "$lib" -type f 2>/dev/null | head -1)
    X86_FILE=$(find "$SRC_DIR/build-x86_64" "$BUILD_DIR/install-x86_64" -name "$lib" -type f 2>/dev/null | head -1)

    echo "Merging $lib:"
    echo "  arm64: $ARM64_FILE"
    echo "  x86_64: $X86_FILE"

    if [ -n "$ARM64_FILE" ] && [ -n "$X86_FILE" ]; then
        lipo -create "$ARM64_FILE" "$X86_FILE" -output "$BUILD_DIR/lib/$lib"
    elif [ -n "$ARM64_FILE" ]; then
        cp "$ARM64_FILE" "$BUILD_DIR/lib/$lib"
    elif [ -n "$X86_FILE" ]; then
        cp "$X86_FILE" "$BUILD_DIR/lib/$lib"
    fi
done

echo "Copying headers..."
mkdir -p "$BUILD_DIR/include"
cp -r "$SRC_DIR/include/"* "$BUILD_DIR/include/" 2>/dev/null || true
cp -r "$SRC_DIR/ggml/include/"* "$BUILD_DIR/include/" 2>/dev/null || true
cp -r "$SRC_DIR/common/"*.h "$BUILD_DIR/include/" 2>/dev/null || true

echo "=== iOS llama.cpp build complete ==="
echo "Libraries:"
ls -la "$BUILD_DIR/lib/"
echo "Headers:"
ls "$BUILD_DIR/include/"
