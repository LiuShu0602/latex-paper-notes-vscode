import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latexmkEngineOption,
  probeArguments,
  probeFailureReason,
  probeSucceeded,
  selectCoherentToolset,
  toolchainProcessEnvironment,
  type ToolExecutables,
  type ToolName
} from '../src/toolchain.js';

const defaults: ToolExecutables = {
  latexmk: 'latexmk',
  pdflatex: 'pdflatex',
  xelatex: 'xelatex',
  lualatex: 'lualatex',
  makeindex: 'makeindex',
  synctex: 'synctex',
  kpsewhich: 'kpsewhich'
};

test('makeindex uses its portable usage probe and accepts the conventional exit code 1', () => {
  assert.deepEqual(probeArguments('makeindex'), ['-h']);
  assert.equal(probeSucceeded('makeindex', {
    code: 1,
    stdout: '',
    stderr: 'Usage: makeindex [-ilqrcg] [-s sty] [-o ind] [idx0 idx1 ...]'
  }), true);
});

test('latexmk without Perl is optional-capability failure with an actionable reason', () => {
  const result = {
    code: 1,
    stdout: '',
    stderr: 'The Perl interpreter could not be found.'
  };
  assert.equal(probeSucceeded('latexmk', result), false);
  assert.match(probeFailureReason('latexmk', result) ?? '', /Perl is unavailable/);
});

test('automatic selection prefers one complete modern TeX Live over an older MiKTeX first on PATH', () => {
  const candidates = dualInstallCandidates();
  const selection = selectCoherentToolset(defaults, candidates, requiredTools());
  assert.equal(selection.distributionDetail, 'TeX Live 2026');
  assert.equal(selection.coherent, true);
  for (const name of requiredTools()) {
    assert.match(selection.executables[name], /^D:\\texlive\\2026\\bin\\windows\\/i);
  }
});

test('an explicit paper-engine path pins automatic selection to that installation', () => {
  const configured = {
    ...defaults,
    pdflatex: 'C:\\CTEX\\MiKTeX\\miktex\\bin\\pdflatex.exe'
  };
  const selection = selectCoherentToolset(configured, dualInstallCandidates(), requiredTools());
  assert.equal(selection.distribution, 'MiKTeX');
  assert.equal(selection.coherent, true);
  assert.match(selection.executables.xelatex, /^C:\\CTEX\\MiKTeX\\miktex\\bin\\/i);
});

test('a partial mixed installation is reported instead of silently combining toolchains', () => {
  const candidates = dualInstallCandidates();
  candidates.pdflatex = ['C:\\CTEX\\MiKTeX\\miktex\\bin\\pdflatex.exe'];
  candidates.xelatex = ['D:\\texlive\\2026\\bin\\windows\\xelatex.exe'];
  candidates.latexmk = ['C:\\CTEX\\MiKTeX\\miktex\\bin\\latexmk.exe'];
  const selection = selectCoherentToolset(defaults, candidates, requiredTools());
  assert.equal(selection.coherent, false);
  assert.match(selection.coherenceDetail, /different TeX installations/i);
});

test('latexmk receives the configured engine path and the same tool directory leads child PATH', () => {
  const tools = {
    ...defaults,
    latexmk: 'D:\\texlive\\2026\\bin\\windows\\latexmk.exe',
    xelatex: 'C:\\Program Files\\TeX Live\\bin\\xelatex.exe',
    kpsewhich: 'C:\\Program Files\\TeX Live\\bin\\kpsewhich.exe',
    makeindex: 'C:\\Program Files\\TeX Live\\bin\\makeindex.exe',
    synctex: 'C:\\Program Files\\TeX Live\\bin\\synctex.exe'
  };
  assert.equal(
    latexmkEngineOption('xelatex', tools.xelatex),
    '-pdfxelatex="C:/Program Files/TeX Live/bin/xelatex.exe"'
  );
  const environment = toolchainProcessEnvironment(tools, 'xelatex', { Path: 'C:\\Windows\\System32' });
  assert.match(environment.Path ?? '', /^C:\\Program Files\\TeX Live\\bin;/i);
});

function requiredTools(): ToolName[] {
  return ['pdflatex', 'xelatex', 'makeindex', 'synctex', 'kpsewhich'];
}

function dualInstallCandidates(): Record<ToolName, string[]> {
  const result = {} as Record<ToolName, string[]>;
  for (const name of Object.keys(defaults) as ToolName[]) {
    result[name] = [
      `C:\\CTEX\\MiKTeX\\miktex\\bin\\${name}.exe`,
      `D:\\texlive\\2026\\bin\\windows\\${name}.exe`
    ];
  }
  return result;
}
