import { encodeXml, R2Objects } from './deps.ts';

export function computeDirectoryListingHtml(objects: R2Objects, opts: { prefix: string, cursor?: string }): string {
    const { prefix, cursor } = opts;
    const lines = ['<!DOCTYPE html>', '<html>', '<head>', '<style>', STYLE, '</style>', '</head>', '<body>'];

    lines.push('<div id="contents">');
    lines.push(`<div class="full">${computeBreadcrumbs(prefix)}</div>`);
    lines.push('<div class="full">&nbsp;</div>');
    lines.push(`<div>Name</div><div class="ralign">Size (bytes)</div>`);
    if (objects.delimitedPrefixes.length > 0) {
        for (const delimitedPrefix of objects.delimitedPrefixes) {
            lines.push(`<a class="full" href="${encodeXml('/' + delimitedPrefix)}">${encodeXml(delimitedPrefix.substring(prefix.length))}</a>`);
        }
        lines.push('<div class="full">&nbsp;</div>');
    }
    for (const obj of objects.objects) {
        lines.push(`<a href="${encodeXml('/' + obj.key)}">${encodeXml(obj.key.substring(prefix.length))}</a><div class="ralign">${obj.size.toLocaleString()}</div>`);
    }
    if (cursor) {
        lines.push('<div class="full">&nbsp;</div>');
        lines.push(`<div class="full"><a href="?cursor=${encodeXml(cursor)}">next ➜</a></div>`);
    }
    lines.push('</div>');

    lines.push('</body>', '</html>');
    return lines.join('\n');
}

const STYLE = `
body { margin: 3rem; font-family: sans-serif; }
a { text-decoration: none; text-underline-offset: 0.2rem; }
a:hover { text-decoration: underline; }
.ralign { text-align: right; }
#contents { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.5rem; white-space: nowrap; }
#contents .full { grid-column: 1 / span 2; }

@media (prefers-color-scheme: dark) {
    body {background: #151920; color: #f5f5f5; }
    a { color: #3bb13b; }
}
`;

function computeBreadcrumbs(prefix: string): string {
    const tokens = ('/' + prefix).split('/').filter((v, i) => i === 0 || v !== '');
    return tokens.map((v, i) => `${i === 0 ? '' : ` ⟩ `}${i === tokens.length - 1 ? (i === 0 ? 'root' : encodeXml(v)) : `<a href="${tokens.slice(0, i + 1).join('/') + '/'}">${i === 0 ? 'root' : encodeXml(v)}</a>`}`).join('');
}
