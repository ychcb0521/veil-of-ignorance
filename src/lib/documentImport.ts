import type { CognitiveAssetsDoc } from '@/types/cognitiveAssets';

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 240_000;
const WORD_XML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type CompressionFormatName = 'deflate' | 'deflate-raw' | 'gzip';
type DecompressionStreamConstructor = new (
  format: CompressionFormatName,
) => TransformStream<Uint8Array, Uint8Array>;

type ExtractedDocument = {
  text: string;
  kind: 'PDF' | 'Word' | 'TXT';
};

type DraftSection = {
  title: string;
  content: string;
};

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt']);

function getExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match?.[1] ?? '';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '认知资产';
}

function makeSlug(input: string): string {
  const compact = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return compact.slice(0, 32) || crypto.randomUUID();
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function replaceControlCharacters(input: string): string {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0) continue;
    if ((code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      output += ' ';
    } else {
      output += input[index];
    }
  }
  return output;
}

function normalizeText(input: string): string {
  return replaceControlCharacters(input)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{3,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function scoreReadableText(text: string): number {
  const readable = text.match(/[\u4e00-\u9fa5a-zA-Z0-9，。；：、,.!?;:]/g)?.length ?? 0;
  let controls = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) controls += 1;
  }
  return readable - controls * 12;
}

async function inflateBytes(bytes: Uint8Array, format: CompressionFormatName): Promise<Uint8Array> {
  const DecompressionStreamCtor = (globalThis as unknown as {
    DecompressionStream?: DecompressionStreamConstructor;
  }).DecompressionStream;

  if (!DecompressionStreamCtor) {
    throw new Error('当前浏览器不支持原生文档解压，无法解析该文件');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateWithFallback(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await inflateBytes(bytes, 'deflate-raw');
  } catch {
    return inflateBytes(bytes, 'deflate');
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new Error('未能识别 Word 文档结构');
  }

  const entryCount = readUint16(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);
  const decoder = new TextDecoder('utf-8');
  let cursor = centralDirectoryOffset;
  let documentEntry: { localHeaderOffset: number; compressedSize: number; method: number } | null = null;

  for (let index = 0; index < entryCount && cursor < bytes.length; index += 1) {
    if (readUint32(bytes, cursor) !== 0x02014b50) break;
    const method = readUint16(bytes, cursor + 10);
    const compressedSize = readUint32(bytes, cursor + 20);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localHeaderOffset = readUint32(bytes, cursor + 42);
    const fileName = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));

    if (fileName === 'word/document.xml') {
      documentEntry = { localHeaderOffset, compressedSize, method };
      break;
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (!documentEntry) {
    throw new Error('未能在 Word 文档中找到正文');
  }

  const localOffset = documentEntry.localHeaderOffset;
  if (readUint32(bytes, localOffset) !== 0x04034b50) {
    throw new Error('Word 文档正文数据损坏');
  }

  const nameLength = readUint16(bytes, localOffset + 26);
  const extraLength = readUint16(bytes, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = bytes.slice(dataStart, dataStart + documentEntry.compressedSize);
  const xmlBytes = documentEntry.method === 0 ? data : await inflateWithFallback(data);
  const xml = decoder.decode(xmlBytes);
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(parsed.getElementsByTagNameNS(WORD_XML_NAMESPACE, 'p'));
  const lines = paragraphs
    .map(paragraph => Array.from(paragraph.getElementsByTagNameNS(WORD_XML_NAMESPACE, 't'))
      .map(node => node.textContent ?? '')
      .join(''))
    .map(line => line.trim())
    .filter(Boolean);

  return normalizeText(lines.join('\n\n'));
}

function extractLegacyWordText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = normalizeText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  const utf16 = normalizeText(new TextDecoder('utf-16le', { fatal: false }).decode(bytes));
  const best = scoreReadableText(utf16) > scoreReadableText(utf8) ? utf16 : utf8;
  return best
    .split('\n')
    .map(line => line.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s，。；：、,.!?;:()（）《》""''“”‘’\-_/]+/g, ' '))
    .map(line => line.replace(/\s{2,}/g, ' ').trim())
    .filter(line => line.length >= 4)
    .join('\n\n');
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return text;
}

function decodePdfHexString(source: string): string {
  const hex = source.replace(/[<>\s]/g, '');
  const normalized = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2));
  }
  if (bytes.length > 2 && bytes[0] === 0x00 && bytes[2] === 0x00) {
    return decodeUtf16Be(bytes);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodePdfLiteralString(source: string): string {
  const body = source.slice(1, -1);
  let text = '';

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== '\\') {
      text += char;
      continue;
    }

    const next = body[index + 1];
    index += 1;
    if (next === 'n') text += '\n';
    else if (next === 'r') text += '\n';
    else if (next === 't') text += '\t';
    else if (next === 'b' || next === 'f') text += ' ';
    else if (next === '(' || next === ')' || next === '\\') text += next;
    else if (/[0-7]/.test(next ?? '')) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(body[index + 1] ?? ''); count += 1) {
        octal += body[index + 1];
        index += 1;
      }
      text += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (next) {
      text += next;
    }
  }

  return text;
}

function decodePdfStringToken(token: string): string {
  return token.startsWith('<') ? decodePdfHexString(token) : decodePdfLiteralString(token);
}

function extractPdfTextOperators(source: string): string {
  const chunks: string[] = [];
  const arrayRegex = /\[((?:\s|-?\d+(?:\.\d+)?|\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>)+)\]\s*TJ/g;
  const textRegex = /(\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>)\s*(?:Tj|'|")/g;
  let match: RegExpExecArray | null;

  while ((match = arrayRegex.exec(source)) !== null) {
    const tokens = match[1].match(/\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>/g) ?? [];
    const line = tokens.map(decodePdfStringToken).join('');
    if (line.trim()) chunks.push(line);
  }

  while ((match = textRegex.exec(source)) !== null) {
    const line = decodePdfStringToken(match[1]);
    if (line.trim()) chunks.push(line);
  }

  return chunks.join('\n');
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const binary = new TextDecoder('latin1').decode(bytes);
  const streams: string[] = [];
  let cursor = 0;

  while (cursor < binary.length) {
    const streamKeyword = binary.indexOf('stream', cursor);
    if (streamKeyword < 0) break;
    const endKeyword = binary.indexOf('endstream', streamKeyword);
    if (endKeyword < 0) break;

    let dataStart = streamKeyword + 'stream'.length;
    if (binary.charCodeAt(dataStart) === 13 && binary.charCodeAt(dataStart + 1) === 10) {
      dataStart += 2;
    } else if (binary.charCodeAt(dataStart) === 10 || binary.charCodeAt(dataStart) === 13) {
      dataStart += 1;
    }

    let dataEnd = endKeyword;
    while (dataEnd > dataStart && (binary.charCodeAt(dataEnd - 1) === 10 || binary.charCodeAt(dataEnd - 1) === 13)) {
      dataEnd -= 1;
    }

    const dictionaryStart = binary.lastIndexOf('<<', streamKeyword);
    const dictionary = dictionaryStart >= 0 ? binary.slice(dictionaryStart, streamKeyword) : '';
    const data = bytes.slice(dataStart, dataEnd);

    try {
      const streamBytes = /\/FlateDecode\b/.test(dictionary) ? await inflateBytes(data, 'deflate') : data;
      streams.push(new TextDecoder('latin1').decode(streamBytes));
    } catch {
      streams.push(new TextDecoder('latin1').decode(data));
    }

    cursor = endKeyword + 'endstream'.length;
  }

  const blockTexts = streams.flatMap(stream => {
    const blocks = stream.match(/BT[\s\S]*?ET/g) ?? [stream];
    return blocks.map(extractPdfTextOperators);
  });
  const plainText = extractPdfTextOperators(binary);
  return normalizeText([...blockTexts, plainText].filter(Boolean).join('\n\n'));
}

function getHeadingTitle(line: string): string | null {
  const trimmed = line.trim();
  const markdown = /^(#{1,6})\s+(.+)$/.exec(trimmed);
  if (markdown) return markdown[2].trim();

  if (/^(第[一二三四五六七八九十百千万0-9]+[章节篇部]|[一二三四五六七八九十]+[、.．]|[0-9]+(?:\.[0-9]+)*[、.．\s])\s*.+/.test(trimmed)) {
    return trimmed.replace(/^#{1,6}\s+/, '');
  }

  const bracketHeading = /^([（(][一二三四五六七八九十0-9]+[）)]|[【[].+[】\]])\s*(.+)?$/.exec(trimmed);
  if (bracketHeading && trimmed.length <= 40) return trimmed;

  return null;
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.split('|').filter(Boolean).length >= 2;
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|[•·]\s+|\d+[.)）、．]\s*|[（(]\d+[）)]\s*)\S+/.test(line);
}

function normalizeListLine(line: string): string {
  const trimmed = line.trim();
  const bullet = /^[•·]\s+(.+)$/.exec(trimmed);
  if (bullet) return `- ${bullet[1].trim()}`;

  const parenthesizedNumber = /^[（(](\d+)[）)]\s*(.+)$/.exec(trimmed);
  if (parenthesizedNumber) return `${parenthesizedNumber[1]}. ${parenthesizedNumber[2].trim()}`;

  const ordered = /^(\d+)[)）、．.]\s*(.+)$/.exec(trimmed);
  if (ordered) return `${ordered[1]}. ${ordered[2].trim()}`;

  return trimmed;
}

function isHighlightLine(line: string): boolean {
  return /^(注意|提示|重点|原则|结论|核心|警告|风险)[:：]/.test(line.trim());
}

function normalizeHighlightLine(line: string): string {
  const match = /^(注意|提示|重点|原则|结论|核心|警告|风险)[:：]\s*(.+)$/.exec(line.trim());
  if (!match) return line.trim();
  return `> **${match[1]}**：${match[2].trim()}`;
}

function isLikelyStandaloneHeading(line: string, nextLine?: string): boolean {
  const trimmed = line.trim();
  const next = nextLine?.trim() ?? '';
  if (!trimmed || !next) return false;
  if (isListLine(trimmed) || isTableLine(trimmed) || isHighlightLine(trimmed)) return false;
  if (trimmed.length > 34 || next.length <= trimmed.length) return false;
  if (/[。！？.!?；;]/.test(trimmed)) return false;
  if (/[:：].+/.test(trimmed)) return false;
  if (/[，,、]/.test(trimmed) && trimmed.length > 16) return false;
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(trimmed);
}

function formatSectionLines(lines: string[]): string {
  const blocks: string[] = [];
  let groupedLines: string[] = [];
  let groupedKind: 'list' | 'table' | null = null;

  const flushGroup = () => {
    if (groupedLines.length === 0) return;
    blocks.push(groupedLines.join('\n'));
    groupedLines = [];
    groupedKind = null;
  };

  lines.forEach(line => {
    const kind = isTableLine(line) ? 'table' : isListLine(line) ? 'list' : null;
    if (kind) {
      if (groupedKind && groupedKind !== kind) flushGroup();
      groupedKind = kind;
      groupedLines.push(line);
      return;
    }

    flushGroup();
    blocks.push(line);
  });

  flushGroup();
  return blocks.join('\n\n');
}

function pushSection(sections: DraftSection[], title: string, lines: string[]) {
  const content = formatSectionLines(lines).trim();
  if (!content) return;
  sections.push({ title, content });
}

function chunkByParagraphs(title: string, text: string): DraftSection[] {
  const paragraphs = text.split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];
  const sections: DraftSection[] = [];
  const chunkSize = paragraphs.length > 24 ? 10 : 8;

  for (let index = 0; index < paragraphs.length; index += chunkSize) {
    const chunk = paragraphs.slice(index, index + chunkSize);
    sections.push({
      title: index === 0 ? '正文' : `正文 ${Math.floor(index / chunkSize) + 1}`,
      content: chunk.join('\n\n'),
    });
  }

  return sections.length > 0 ? sections : [{ title, content: text }];
}

function splitIntoSections(title: string, text: string): DraftSection[] {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const sections: DraftSection[] = [];
  let currentTitle = '正文';
  let currentLines: string[] = [];

  lines.forEach((line, index) => {
    const heading = getHeadingTitle(line) ?? (
      isLikelyStandaloneHeading(line, lines[index + 1]) ? line.trim().replace(/[:：]$/, '') : null
    );
    const canStartSection = heading && (index > 0 || lines.length > 1);
    if (canStartSection) {
      pushSection(sections, currentTitle, currentLines);
      currentTitle = heading;
      currentLines = [];
      return;
    }
    currentLines.push(line);
  });

  pushSection(sections, currentTitle, currentLines);
  if (sections.length >= 2) return sections;
  return chunkByParagraphs(title, text);
}

function toMarkdownContent(content: string): string {
  const paragraphs = content.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean);
  const normalized: string[] = [];

  paragraphs.forEach(paragraph => {
    const lines = paragraph.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(isTableLine)) {
      normalized.push(lines.join('\n'));
      return;
    }

    if (lines.length > 1 && lines.every(isListLine)) {
      normalized.push(lines.map(normalizeListLine).join('\n'));
      return;
    }

    const line = lines.join(' ');
    if (isListLine(line)) {
      normalized.push(normalizeListLine(line));
      return;
    }
    if (isHighlightLine(line)) {
      normalized.push(normalizeHighlightLine(line));
      return;
    }
    if (/^>/.test(line)) {
      normalized.push(line);
      return;
    }
    normalized.push(line);
  });

  return normalized.join('\n\n');
}

function truncateIfNeeded(text: string): string {
  if (text.length <= TEXT_PREVIEW_LIMIT) return text;
  return `${text.slice(0, TEXT_PREVIEW_LIMIT)}\n\n> 文档正文较长，已截取前 ${TEXT_PREVIEW_LIMIT.toLocaleString('zh-CN')} 个字符生成认知资产页。`;
}

async function extractDocument(file: File): Promise<ExtractedDocument> {
  const extension = getExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('仅支持上传 PDF、Word（doc/docx）或 TXT 文件');
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('文件过大，请上传 20MB 以内的文档');
  }

  if (extension === 'txt') {
    return { kind: 'TXT', text: normalizeText(await file.text()) };
  }

  const buffer = await file.arrayBuffer();
  if (extension === 'docx') {
    return { kind: 'Word', text: await extractDocxText(buffer) };
  }
  if (extension === 'doc') {
    return { kind: 'Word', text: extractLegacyWordText(buffer) };
  }
  return { kind: 'PDF', text: await extractPdfText(buffer) };
}

export function isSupportedCognitiveAssetFile(file: File): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(file.name));
}

export async function buildCognitiveAssetsDocFromFile(file: File): Promise<CognitiveAssetsDoc> {
  const extracted = await extractDocument(file);
  const text = truncateIfNeeded(normalizeText(extracted.text));
  if (!text || scoreReadableText(text) < 20) {
    throw new Error('未能从文档中提取到足够的可读文字，请换成文本型 PDF、docx 或 txt 文件');
  }

  const title = stripExtension(file.name);
  const sections = splitIntoSections(title, text);
  const uploadedAt = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    meta: {
      title,
      subtitle: `${extracted.kind} · ${uploadedAt}`,
    },
    categories: [
      {
        id: `doc-${makeSlug(title)}`,
        title,
        subtitle: `来源文件：${file.name}`,
        intro: `${extracted.kind} 文档已整理为认知资产阅读页。`,
        sections: sections.map((section, index) => ({
          id: `doc-section-${index + 1}-${makeSlug(section.title)}`,
          title: section.title,
          content: toMarkdownContent(section.content),
        })),
      },
    ],
  };
}
