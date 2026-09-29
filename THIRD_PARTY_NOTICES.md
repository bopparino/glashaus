# Third-party notices

The bundled web app includes the following MIT-licensed software. Font licenses are included next to the fonts in dist/web/fonts.

## react

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## react-dom

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## @phosphor-icons/react

MIT License

Copyright (c) 2020 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Full-companion runtime additions

The source installer fetches these dependencies through the lockfile. Their complete license files are retained in the installed packages:

- `@js-temporal/polyfill` — ISC
- `@modelcontextprotocol/sdk` — MIT
- `imapflow` — MIT
- `mailparser` — MIT
- `nodemailer` — MIT-0
- Node.js — MIT and bundled third-party licenses, retained in the private runtime's `LICENSE`
- pnpm — MIT, retained in the private package-manager installation

The installer downloads pinned Node 24.21.0 and pnpm 11.19.0 archives from their official distribution endpoints and checks the committed SHA-256/SHA-512 values before extraction. Tailscale, Ollama, ElevenLabs, Apple SDKs and platform fonts are separate products, not redistributed here. Native background and icon assets are generated artwork; provenance is under `ios/Design`. User-supplied moodboards and video are private design references and are not distributed.

## Hermes document utilities

Glashaus reuses the MIT-licensed document helper code under `tool-runtime/vendor/hermes`, adapted through Glashaus's own renderer and isolated task execution. Upstream: https://github.com/NousResearch/hermes-agent, commit `5000e29936df69d5209f7cf2eea8e5776cb4cbb1`. The complete copyright and permission notice is retained in `tool-runtime/vendor/hermes/LICENSE`. Glashaus does not run a Hermes agent or daemon.

The optional sandbox image installs Python, python-docx, pypdf, pypdfium2, LibreOffice and Liberation fonts. Their package license files remain in the image; Docker Desktop is installed separately under its own terms.

The Mac bundle redistributes Node.js 24.21.0; its complete license and bundled third-party notices are retained as `runtime/NODE-LICENSE.txt`.
