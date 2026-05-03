/**
 * Tiny markdown renderer purpose-built for this docs site.
 *
 * Supports the subset of markdown the existing docs/*.md files use:
 *   - ATX headings (#, ##, ###, ####)
 *   - paragraphs separated by blank lines
 *   - unordered lists (- or *) and ordered lists (1.)
 *   - fenced code blocks (```lang\n…\n```)
 *   - inline code (`x`)
 *   - links [text](url)
 *   - tables (| col | col | with --- separator)
 *   - horizontal rules (---)
 *   - bold (**x**), italic (*x* / _x_)
 *
 * No external deps — keeps the site fully static and the bundle thin.
 * For anything more elaborate (footnotes, mdx components) we can swap in
 * a real renderer later; right now this matches what the source markdown
 * actually contains.
 */
import type { JSX } from 'react';

interface Token {
  type: 'heading' | 'paragraph' | 'list' | 'olist' | 'code' | 'table' | 'hr' | 'blockquote';
  // Heading
  level?: number;
  text?: string;
  // List items
  items?: string[];
  // Code
  lang?: string;
  // Table
  headers?: string[];
  rows?: string[][];
}

function tokenize(md: string): Token[] {
  const tokens: Token[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? '';
      i++;
      const buf: string[] = [];
      while (i < lines.length && !(lines[i] ?? '').match(/^```\s*$/)) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++;
      tokens.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      tokens.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    // Horizontal rule.
    if (line.match(/^-{3,}\s*$/)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // Table: a `|` line followed by `|---|---|` separator.
    if (
      line.startsWith('|') &&
      i + 1 < lines.length &&
      (lines[i + 1] ?? '').match(/^\s*\|?[\s:|-]+\|?\s*$/)
    ) {
      const headers = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((s) => s.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        rows.push(
          (lines[i] ?? '')
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((s) => s.trim()),
        );
        i++;
      }
      tokens.push({ type: 'table', headers, rows });
      continue;
    }

    // Unordered list.
    if (line.match(/^\s*[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^\s*[-*]\s+/)) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      tokens.push({ type: 'list', items });
      continue;
    }

    // Ordered list.
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^\s*\d+\.\s+/)) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      tokens.push({ type: 'olist', items });
      continue;
    }

    // Blockquote.
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      tokens.push({ type: 'blockquote', text: buf.join(' ') });
      continue;
    }

    // Paragraph: read until blank line or block start.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !(lines[i] ?? '').match(/^#{1,6}\s|^```|^-{3,}\s*$|^\s*[-*]\s+|^\s*\d+\.\s+|^\|/)
    ) {
      buf.push(lines[i] ?? '');
      i++;
    }
    tokens.push({ type: 'paragraph', text: buf.join(' ') });
  }
  return tokens;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // Inline code.
  out = out.replace(/`([^`]+?)`/g, '<code>$1</code>');
  // Bold.
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // Italic (single * not adjacent to other *, or _x_).
  out = out.replace(/(^|\W)\*([^*\n]+?)\*(\W|$)/g, '$1<em>$2</em>$3');
  out = out.replace(/(^|\W)_([^_\n]+?)_(\W|$)/g, '$1<em>$2</em>$3');
  // Links.
  out = out.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');
  return out;
}

interface MdProps {
  source: string;
}

export function Md({ source }: MdProps): JSX.Element {
  const tokens = tokenize(source);
  return (
    <>
      {tokens.map((t, idx) => {
        switch (t.type) {
          case 'heading': {
            const level = Math.min(Math.max(t.level ?? 1, 1), 4);
            const html = renderInline(t.text ?? '');
            const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
            return <Tag key={idx} dangerouslySetInnerHTML={{ __html: html }} />;
          }
          case 'paragraph':
            return <p key={idx} dangerouslySetInnerHTML={{ __html: renderInline(t.text ?? '') }} />;
          case 'list':
            return (
              <ul key={idx}>
                {(t.items ?? []).map((item, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                ))}
              </ul>
            );
          case 'olist':
            return (
              <ol key={idx}>
                {(t.items ?? []).map((item, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre key={idx}>
                <code>{t.text ?? ''}</code>
              </pre>
            );
          case 'table':
            return (
              <table key={idx}>
                <thead>
                  <tr>
                    {(t.headers ?? []).map((h, j) => (
                      <th key={j} dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(t.rows ?? []).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case 'hr':
            return <hr key={idx} />;
          case 'blockquote':
            return (
              <blockquote
                key={idx}
                style={{
                  borderLeft: '3px solid #2a313c',
                  paddingLeft: '12px',
                  color: '#9aa3ad',
                  margin: '1em 0',
                }}
                dangerouslySetInnerHTML={{ __html: renderInline(t.text ?? '') }}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
