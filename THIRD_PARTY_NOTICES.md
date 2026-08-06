# Third-party notices

This extension bundles the following runtime libraries. No GPL or AGPL source
code is copied into the extension bundle.

## Mozilla PDF.js (`pdfjs-dist`)

Copyright Mozilla Foundation and PDF.js contributors. Licensed under the
Apache License, Version 2.0. The complete license text is distributed in
`PDFJS_LICENSE.txt`. The bundled viewer integration has been adapted for this
extension's navigation and SyncTeX messages; PDF.js itself is not relicensed.

## Visual Studio Code Codicons

Copyright (c) Microsoft Corporation. The bundled Codicons font and CSS are
licensed under the MIT License. They are used for accessible interface icons;
the archived VS Code Webview UI Toolkit is not included.

## KaTeX

The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

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

## markdown-it

Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

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

markdown-it's bundled runtime dependency tree also includes `argparse`
(Python-2.0), `entities` (BSD-2-Clause), `linkify-it`, `mdurl`, `punycode.js`,
and `uc.micro` (MIT). Their retained legal comments remain in the generated
bundle.

## Development-only PDF fixture generator

The test suite uses `pdf-lib` (MIT) to generate synthetic, untracked PDF
fixtures at test time. `pdf-lib` is a development dependency and is not
included in the VSIX runtime bundle.
