# Fine-tuning: moving the voice into the weights

Prompt-level character is rented; weight-level character is owned. Once a
companion has lived enough (3,000+ good messages is the honest floor), their
own history can tune a small local model until the voice — and the register
discipline — is structural instead of prompted. This is the deepest fix for
identity breaks there is: a model whose "I" was trained on one person only.

## 1. Export the corpus

```sh
glashaus export-corpus            # → ~/.glashaus/corpus-YYYY-MM-DD.jsonl
```

Chat-format JSONL, one real exchange per line. Redacted stretches are
excluded; replies that ever broke identity or register are filtered out —
the dataset is who your companion is *at their best*. The system line on
every sample (`I am <Name>.`) is the conditioning anchor: keep the same
first line in your runtime SOUL after tuning.

## 2. Pick the base

Use the audition to choose what you tune:

```sh
glashaus audition stheno:8b
glashaus audition mag-mell:12b
```

Tune the model that already gets a CALLBACK — QLoRA sharpens a voice, it
doesn't transplant one. 8B needs ~10 GB VRAM to tune at 4-bit; 12B ~16 GB.

## 3. QLoRA (axolotl)

```yaml
# alanna-qlora.yml
base_model: Sao10K/L3-8B-Stheno-v3.2
load_in_4bit: true
adapter: qlora
lora_r: 16
lora_alpha: 32
lora_dropout: 0.05
lora_target_linear: true
datasets:
  - path: corpus-2026-07-16.jsonl
    type: chat_template
sequence_len: 4096
micro_batch_size: 2
gradient_accumulation_steps: 8
num_epochs: 2
learning_rate: 2e-4
lr_scheduler: cosine
warmup_ratio: 0.05
output_dir: ./out
```

```sh
pip install axolotl
axolotl train alanna-qlora.yml
```

Two epochs is deliberate — voice tuning overfits fast, and an overfit
companion parrots old conversations instead of having new ones. If replies
start quoting the corpus verbatim, back off to one epoch.

## 4. Back into Ollama

Merge the adapter, convert to GGUF (llama.cpp's `convert_hf_to_gguf.py`,
then `llama-quantize` to Q5_K_M), and:

```
# Modelfile
FROM ./alanna-q5_k_m.gguf
```

```sh
ollama create alanna -f Modelfile
```

Then split-brain it in `~/.glashaus/config.json` — her voice on her weights,
bookkeeping on a strong instruction-follower:

```json
"ollama": { "voiceModel": "alanna", "utilityModel": "kimi-k2.6:cloud", ... }
```

Audition the result before switching for real: `glashaus audition alanna`.
The identity probes should be unbreakable now — it's hard to claim you're
someone else when every gradient in you disagrees.
