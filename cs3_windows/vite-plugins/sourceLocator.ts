import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

/**
 * Where each piece of UI was written, stamped on it in development.
 *
 * The UI inspector (`src/components/devtools/`) answers "which component is
 * this, and which file do I change?" React 19 can no longer answer the second
 * half on its own: `fiber._debugSource` — what every click-to-component tool
 * read — was removed, and owner stacks point into transformed modules. So the
 * location is written into the module before React's transform sees it:
 *
 *  - every intrinsic element (`<div>`, `<button>`) gets
 *    `data-cs3-loc="src/…/File.tsx:line:col"` — the JSX that produced it;
 *  - every application component element (`<PosterCard …>`) gets
 *    `data-cs3-site="…"` — where it was *used*, read back from the fiber's
 *    props, so the hierarchy can say "rendered at SearchView.tsx:564";
 *  - every top-level component definition gets a non-enumerable
 *    `__cs3Source = "file:line"` — where it is *defined*.
 *
 * **Development only** (`apply: 'serve'`): a packaged build carries none of
 * it, which is also why the inspector says so instead of guessing. Inserting
 * attributes adds no newlines, so line numbers in stack traces and breakpoints
 * stay exact; only columns on stamped lines shift.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex: JSX in
 * strings, comments, generics (`<T,>`) and comparisons all look like tags to a
 * pattern, and a wrong insertion here breaks the module it touches.
 */

/** React's own element types: a data prop on these warns or means nothing. */
const SKIPPED_COMPONENTS = new Set(['Fragment', 'Suspense', 'StrictMode', 'Profiler', 'Activity']);

const isComponentName = (name: string) => /^[A-Z]/.test(name);

export function annotateSource(code: string, relativePath: string): string | null {
  if (!code.includes('<')) return null;
  const source = ts.createSourceFile(relativePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const insertions: Array<{ at: number; text: string }> = [];
  const location = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${relativePath}:${line + 1}:${character + 1}`;
  };

  const hasAttribute = (attributes: ts.JsxAttributes, name: string) =>
    attributes.properties.some(
      (property) => ts.isJsxAttribute(property) && property.name.getText(source) === name
    );

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag)) {
        const name = tag.text;
        const intrinsic = /^[a-z]/.test(name);
        const attribute = intrinsic ? 'data-cs3-loc' : 'data-cs3-site';
        if (
          (intrinsic || (isComponentName(name) && !SKIPPED_COMPONENTS.has(name))) &&
          !hasAttribute(node.attributes, attribute)
        ) {
          // After the tag name and any type arguments: `<Select<string> …`.
          const at = node.typeArguments ? node.typeArguments.end + 1 : tag.end;
          insertions.push({ at, text: ` ${attribute}="${location(node)}"` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  /*
   * Definitions: top-level `function Name` and `const Name = (…) => …`,
   * `memo(…)`, `forwardRef(…)`. Lowercase names are hooks and helpers, not
   * components, and are left alone.
   */
  const definitions: string[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isComponentName(statement.name.text)) {
      definitions.push(defineSource(statement.name.text, location(statement)));
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !isComponentName(declaration.name.text)) continue;
        const init = declaration.initializer;
        if (!init) continue;
        const isFunction = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
        const isWrapped =
          ts.isCallExpression(init) && /(memo|forwardRef)$/.test(init.expression.getText(source));
        if (isFunction || isWrapped) {
          definitions.push(defineSource(declaration.name.text, location(declaration)));
        }
      }
    }
  }

  if (insertions.length === 0 && definitions.length === 0) return null;

  let output = code;
  for (const { at, text } of insertions.sort((a, b) => b.at - a.at)) {
    output = output.slice(0, at) + text + output.slice(at);
  }
  if (definitions.length > 0) output += `\n;${definitions.join(';')};\n`;
  return output;
}

function defineSource(name: string, where: string): string {
  return `try{Object.defineProperty(${name},'__cs3Source',{value:${JSON.stringify(where)},configurable:true})}catch{}`;
}

export function sourceLocator(): Plugin {
  let root = process.cwd();
  return {
    name: 'cs3-source-locator',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.tsx') || file.includes('/node_modules/')) return null;
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative.startsWith('..')) return null;
      try {
        const annotated = annotateSource(code, relative);
        return annotated === null ? null : { code: annotated, map: null };
      } catch {
        // A file the parser cannot read is served untouched, never broken.
        return null;
      }
    },
  };
}
