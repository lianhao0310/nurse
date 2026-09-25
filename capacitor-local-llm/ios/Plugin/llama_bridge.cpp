#include "llama_bridge.h"
#include "llama.h"
#include <string>
#include <vector>
#include <cstring>

static llama_model* g_model = nullptr;
static llama_context* g_ctx = nullptr;

llama_model_handle llama_bridge_load_model(const char* path, int context_length) {
    if (g_model) { llama_free_model(g_model); g_model = nullptr; }
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    g_model = llama_model_load_from_file(path, model_params);
    if (!g_model) return nullptr;

    g_ctx = llama_bridge_new_context(g_model, context_length);
    return (llama_model_handle)g_model;
}

llama_context_handle llama_bridge_new_context(llama_model_handle model, int context_length) {
    if (!model) return nullptr;
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = context_length;
    ctx_params.n_batch = 512;
    ctx_params.n_threads = 4;
    ctx_params.n_threads_batch = 4;
    g_ctx = llama_new_context_with_model((llama_model*)model, ctx_params);
    return (llama_context_handle)g_ctx;
}

void llama_bridge_free_model(llama_model_handle model) {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_free_model(g_model); g_model = nullptr; }
}

void llama_bridge_free_context(llama_context_handle ctx) {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
}

bool llama_bridge_is_loaded(void) {
    return g_model != nullptr && g_ctx != nullptr;
}

int llama_bridge_generate(
    llama_context_handle ctx,
    llama_model_handle model,
    const char* prompt,
    int max_tokens,
    float temperature,
    void (*callback)(const char* token, void* user_data),
    void* user_data
) {
    if (!ctx || !model || !prompt) return -1;

    llama_model* mdl = (llama_model*)model;
    llama_context* ctx = (llama_context*)ctx;

    const llama_vocab* vocab = llama_model_get_vocab(mdl);
    int n_ctx = llama_n_ctx(ctx);

    std::string text(prompt);
    std::vector<llama_token> tokens;
    tokens.resize(text.size() + 2);
    int n_tokens = llama_tokenize(vocab, text.c_str(), text.size(), tokens.data(), tokens.size(), true, true);
    if (n_tokens < 0) {
        tokens.resize(-n_tokens);
        n_tokens = llama_tokenize(vocab, text.c_str(), text.size(), tokens.data(), tokens.size(), true, true);
    }
    if (n_tokens <= 0) return -1;

    for (int i = 0; i < n_tokens && i < n_ctx; i++) {
        llama_batch batch = llama_batch_get_one(tokens.data() + i, 1);
        if (llama_decode(ctx, batch)) return -1;
    }

    llama_batch batch = llama_batch_init(max_tokens, 0, 1);

    auto llama_token_to_str = [&](llama_token token) -> std::string {
        char buf[256];
        int len = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, false);
        if (len < 0) { len = -len; std::vector<char> big(len); llama_token_to_piece(vocab, token, big.data(), big.size(), 0, false); return std::string(big.data(), len); }
        return std::string(buf, len);
    };

    int generated = 0;
    llama_token last_token = tokens[n_tokens - 1];

    for (int i = 0; i < max_tokens; i++) {
        float* logits = llama_get_logits(ctx);
        int n_vocab = llama_vocab_n_tokens(vocab);

        std::vector<llama_token_data> candidates;
        candidates.resize(n_vocab);
        for (int t = 0; t < n_vocab; t++) {
            candidates[t] = { t, logits[t], 0.0f };
        }
        llama_token_data_array candidates_p = { candidates.data(), candidates.size(), false };

        llama_sample_temp(ctx, &candidates_p, temperature);
        llama_sample_top_k(ctx, &candidates_p, 40, 1);
        llama_sample_tail_free(ctx, &candidates_p, 1.0f, 1);
        llama_sample_typical(ctx, &candidates_p, 1.0f, 1);
        llama_sample_top_p(ctx, &candidates_p, 0.9f, 1);
        llama_sample_min_p(ctx, &candidates_p, 0.0f, 1);
        llama_sample_token(ctx, &candidates_p);

        last_token = candidates_p.data[0].id;
        if (last_token == llama_vocab_eos(vocab)) break;

        std::string piece = llama_token_to_str(last_token);
        if (callback) callback(piece.c_str(), user_data);
        generated++;

        batch.n_tokens = 0;
        llama_batch_add(batch, last_token, n_tokens + i, { 0 }, true);
        if (llama_decode(ctx, batch)) break;
    }

    llama_batch_free(batch);
    return generated;
}
