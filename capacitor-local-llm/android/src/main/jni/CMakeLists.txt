cmake_minimum_required(VERSION 3.22)
project(llama_bridge)

set(CMAKE_CXX_STANDARD 17)

add_library(llama_bridge SHARED
    jni_bridge.cpp
    llama_bridge.mm
)

# llama.cpp source (cloned by CI build script)
set(LLAMA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp)
if(EXISTS ${LLAMA_DIR})
    include(${LLAMA_DIR}/cmake/build-info.cmake OPTIONAL)
    add_subdirectory(${LLAMA_DIR} llama_build)
    target_link_libraries(llama_bridge PRIVATE llama ggml)
endif()

find_library(log-lib log)

target_link_libraries(llama_bridge
    PRIVATE
    ${log-lib}
)
