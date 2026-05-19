"""OpenAI embeddings provider.

Phase-1 design uses `text-embedding-3-small` because its native 1536-dim
output matches the `FLOAT[1536]` declared in `001_initial.sql` for both
`episodic_vec` and `semantic_vec`.

CAUTION — embedding dim is load-bearing.

`vec0` virtual tables fix their dimension at CREATE time. If you ever
want to switch embedding providers, **the dim has to match or you need
a new migration that drops and recreates the *_vec tables**, plus a
re-embedding pass over every existing record.

Common alternatives and their dims:

- OpenAI `text-embedding-3-small` — 1536  (current default)
- OpenAI `text-embedding-3-large` — 3072
- OpenAI `text-embedding-ada-002` — 1536  (legacy)
- nomic-embed-text                — 768
- BAAI/bge-small-en               — 384
- mxbai-embed-large               — 1024

The `dimensions` parameter on OpenAI's API can downscale 3-large or
3-small to a shorter prefix, but doing so requires the same migration
rebuild — the shape of every existing row would still be wrong.

The capabilities property exposes `dimensions` so the storage layer can
sanity-check this at startup.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Final

from openai import OpenAI

from glashaus.providers.base import EmbeddingCapabilities

DEFAULT_MODEL: Final[str] = "text-embedding-3-small"
DEFAULT_DIMENSIONS: Final[int] = 1536  # native output for text-embedding-3-small
DEFAULT_MAX_INPUT_TOKENS: Final[int] = 8191  # per OpenAI docs


class OpenAIEmbeddingProvider:
    """Implements [`EmbeddingProvider`][glashaus.providers.base.EmbeddingProvider]
    against OpenAI's embeddings API.

    Use the `dimensions` constructor parameter ONLY when you have a
    matching migration on the *_vec tables — otherwise the shape will
    drift from the schema.
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        api_key: str | None = None,
        dimensions: int = DEFAULT_DIMENSIONS,
        max_input_tokens: int = DEFAULT_MAX_INPUT_TOKENS,
    ) -> None:
        resolved_key = api_key or os.environ.get("OPENAI_API_KEY")
        # The OpenAI client will raise on first call if the key is
        # missing; don't fail-fast here so test fixtures can construct
        # the provider without a real key when they're going to mock
        # the underlying client.
        self._client = OpenAI(api_key=resolved_key) if resolved_key else OpenAI(api_key="")
        self._model = model
        self._capabilities = EmbeddingCapabilities(
            dimensions=dimensions,
            max_input_tokens=max_input_tokens,
        )

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def capabilities(self) -> EmbeddingCapabilities:
        return self._capabilities

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        # text-embedding-3-* accepts a list and returns a list in the
        # same order. We pass `dimensions` only when it differs from
        # the model's native output (the API rejects redundant dims on
        # some models). Two explicit call sites avoid **kwargs, which
        # mypy can't reconcile with OpenAI's strict create() signature.
        texts_list = list(texts)
        if self._capabilities.dimensions != DEFAULT_DIMENSIONS:
            response = self._client.embeddings.create(
                model=self._model,
                input=texts_list,
                dimensions=self._capabilities.dimensions,
            )
        else:
            response = self._client.embeddings.create(
                model=self._model,
                input=texts_list,
            )
        return [list(item.embedding) for item in response.data]
