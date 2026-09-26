#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* llama_model_handle;
typedef void* llama_context_handle;

llama_model_handle llama_bridge_load_model(const char* path, int context_length);
llama_context_handle llama_bridge_new_context(llama_model_handle model, int context_length);
void llama_bridge_free_model(llama_model_handle model);
void llama_bridge_free_context(llama_context_handle ctx);
bool llama_bridge_is_loaded(void);

int llama_bridge_generate(
    llama_context_handle ctx,
    llama_model_handle model,
    const char* prompt,
    int max_tokens,
    float temperature,
    void (*callback)(const char* token, void* user_data),
    void (*status_callback)(const char* status, void* user_data),
    void* user_data
);

#ifdef __cplusplus
}
#endif
