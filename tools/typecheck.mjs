// 类型检查：借用 DZMM-WEB-MAIN 的 typescript 编译器 API（本地零安装）。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require2 = createRequire('/workspace/repos/DZMM-WEB-MAIN/node_modules/');
const ts = require2('typescript');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const configPath = join(ROOT, 'tsconfig.json');
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);

let errors = 0;
for (const d of diagnostics) {
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`${d.file.fileName.replace(ROOT + '/', '')}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  } else {
    console.log(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  }
  if (d.category === ts.DiagnosticCategory.Error) errors++;
}
console.log(errors ? `✗ ${errors} error(s)` : '✓ typecheck clean');
process.exit(errors ? 1 : 0);
