/**
 * 把一段文本存成文件。
 *
 * BOM（﻿）是必需的：Excel 打开不带 BOM 的 UTF-8 CSV 会把中文显示成乱码。
 * 这个模式此前在六处导出里各抄了一份（战役复盘、战役快照、情绪日记、时间机器、指南、分析面板），
 * 新的导出一律走这里。
 */
export function downloadTextFile(fileName: string, content: string, mime = 'text/plain'): string {
  const blob = new Blob([`﻿${content}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

/** 文件名里不能出现的字符。 */
export function safeExportFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
