# Android Flemish Dutch Piper voices

Bookstr adds two Belgian Dutch Piper VITS voices to the Android voice catalog:

| Voice | Catalog ID | Model repository | Pinned revision | Model size | Tokens size |
| --- | --- | --- | --- | ---: | ---: |
| Nathalie · Nederlands (nl-BE) | `piper_nl_be_nathalie` | [csukuangfj/vits-piper-nl_BE-nathalie-medium](https://huggingface.co/csukuangfj/vits-piper-nl_BE-nathalie-medium) | `1356793b677b4effa325817d758902c88d775709` | 63,201,420 bytes | 921 bytes |
| RDH · Nederlands (nl-BE) | `piper_nl_be_rdh` | [csukuangfj/vits-piper-nl_BE-rdh-medium](https://huggingface.co/csukuangfj/vits-piper-nl_BE-rdh-medium) | `6e4aa36cc18a29bd5b72786dc52eee9fb49bc26a` | 63,104,652 bytes | 763 bytes |

The catalog keeps both voices under the existing `nl` language tag. Their explicit `nl-BE` labels distinguish them in the voice picker while the locale continues to normalize to `nl` internally.

## Checksums

SHA-256 checksums were computed from the files served by the pinned Hugging Face revisions:

| Voice | File | SHA-256 |
| --- | --- | --- |
| Nathalie | `nl_BE-nathalie-medium.onnx` | `d6901ce5548dc4ca2d7f42fd5e53647fdd790b5b6a4350aa8b4e24adc3e903dc` |
| Nathalie | `tokens.txt` | `87c8ef66eae5473ed0cc0366b3964c736ca6c5f676c979522ea31234e47430b9` |
| RDH | `nl_BE-rdh-medium.onnx` | `45260062e54e44270d6e3b57c082b3d0d7085e4b542fa2909cf212ffad4b73a0` |
| RDH | `tokens.txt` | `42d1a69ed2b91a51928a711aa228ed9f3dc021c6d359a3e9c4f37eb1d20f80bd` |

## Licensing evidence

The Nathalie [model card](https://huggingface.co/csukuangfj/vits-piper-nl_BE-nathalie-medium/blob/main/MODEL_CARD) identifies its language as `nl_BE`, names the [dataset-voice-nathalie dataset](https://github.com/rhasspy/dataset-voice-nathalie), and explicitly labels that dataset `CC0`. The RDH [model card](https://huggingface.co/csukuangfj/vits-piper-nl_BE-rdh-medium/blob/main/MODEL_CARD) identifies its language as `nl_BE`, names the [dutch-vl-tts dataset](https://github.com/r-dh/dutch-vl-tts), and explicitly labels that dataset `CC0 1.0 Universal`.

These cards state the dataset licenses. They do not separately state a license for the trained ONNX weights, and the model repository pages do not expose a license field. This catalog addition therefore records the source evidence without treating either dataset license or a repository tag as a confirmed weight license. Review of the training-data terms alone should not be used as a substitute for confirming rights to distribute the resulting model files.

Both voices use the existing complete Dutch pronunciation bundle, with most files pinned to `csukuangfj/vits-piper-nl_NL-dii-high` revision `12169a38e0f40f3ffc429273346f6d0700387cdf`. The Italian dictionary is pinned to `csukuangfj/kokoro-multi-lang-v1_0` revision `f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b`, matching its source in the catalog's other speech models. Every pronunciation-file URL is explicit and revision-pinned.
