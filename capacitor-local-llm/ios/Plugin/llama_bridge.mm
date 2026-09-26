#include "llama_bridge.h"
#include "llama.h"
#include <string>
#include <vector>
#include <cstring>

static llama_model* g_model = nullptr;
static llama_context* g_ctx = nullptr;

static inline void batch_add(llama_batch & batch, llama_token id, llama_pos pos, const std::vector<llama_seq_id> & seq_ids, bool logits) {
    batch.token[batch.n_tokens] = id;
    batch.pos[batch.n_tokens] = pos;
    for (size_t i = 0; i < seq_ids.size(); i++) {
        batch.seq_id[batch.n_tokens][i] = seq_ids[i];
    }
    batch.n_seq_id[batch.n_tokens] = seq_ids.size();
    batch.logits[batch.n_tokens] = logits ? 1 : 0;
    batch.n_tokens++;
}

llama_model_handle llama_bridge_load_model(const char* path, int context_length) {
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 99;
    g_model = llama_model_load_from_file(path, model_params);
    if (!g_model) return nullptr;

    llama_bridge_new_context(g_model, context_length);
    return (llama_model_handle)g_model;
}

llama_context_handle llama_bridge_new_context(llama_model_handle model, int context_length) {
    if (!model) return nullptr;
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = context_length;
    ctx_params.n_batch = 512;
    ctx_params.n_threads = 2;
    ctx_params.n_threads_batch = 2;
    g_ctx = llama_init_from_model((llama_model*)model, ctx_params);
    return (llama_context_handle)g_ctx;
}

void llama_bridge_free_model(llama_model_handle model) {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
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
    if (!g_ctx || !g_model || !prompt) return -1;

    llama_model* mdl = g_model;
    llama_context* lctx = g_ctx;

    const llama_vocab* vocab = llama_model_get_vocab(mdl);
    int n_ctx = llama_n_ctx(lctx);

    std::string text(prompt);
    std::vector<llama_token> tokens;
    tokens.resize(text.size() + 2);
    int n_tokens = llama_tokenize(vocab, text.c_str(), text.size(), tokens.data(), tokens.size(), true, true);
    if (n_tokens < 0) {
        tokens.resize(-n_tokens);
        n_tokens = llama_tokenize(vocab, text.c_str(), text.size(), tokens.data(), tokens.size(), true, true);
    }
    if (n_tokens <= 0) return -1;

    if (n_tokens > n_ctx) n_tokens = n_ctx;

    int n_batch = 512;
    llama_batch batch = llama_batch_init(n_batch, 0, 1);

    for (int i = 0; i < n_tokens; i += n_batch) {
        int n = std::min(n_batch, n_tokens - i);
        batch.n_tokens = 0;
        for (int j = 0; j < n; j++) {
            batch_add(batch, tokens[i + j], i + j, {0}, false);
        }
        if (llama_decode(lctx, batch)) {
            llama_batch_free(batch);
            return -1;
        }
    }

    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    llama_sampler* smpl = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    auto token_to_str = [&](llama_token token) -> std::string {
        char buf[256];
        int len = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, false);
        if (len < 0) { len = -len; std::vector<char> big(len); llama_token_to_piece(vocab, token, big.data(), big.size(), 0, false); return std::string(big.data(), len); }
        return std::string(buf, len);
    };

    int generated = 0;
    llama_token last_token = tokens[n_tokens - 1];
    llama_token eos_token = llama_vocab_eos(vocab);

    for (int i = 0; i < max_tokens; i++) {
        batch.n_tokens = 0;
        batch_add(batch, last_token, n_tokens + i, {0}, true);
        if (llama_decode(lctx, batch)) break;

        last_token = llama_sampler_sample(smpl, lctx, -1);
        if (last_token == eos_token) break;

        std::string piece = token_to_str(last_token);
        if (callback) callback(piece.c_str(), user_data);
        generated++;
    }

    llama_batch_free(batch);
    llama_sampler_free(smpl);
    return generated;
}
