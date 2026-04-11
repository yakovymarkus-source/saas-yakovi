'use strict';

/**
 * exporters/zip-exporter.js — ZIP Export Builder
 *
 * Converts an ExportPackage (from html-exporter.js) into a binary ZIP file.
 *
 * Uses Node.js built-in modules ONLY — no external dependencies required.
 *   zlib.deflateRawSync — DEFLATE compression per file
 *   Buffer              — binary data assembly
 *
 * ZIP format implementation:
 *   Per-file:  Local File Header → Compressed Data
 *   Followed:  Central Directory (one entry per file)
 *   Closing:   End of Central Directory Record
 *
 * Compression: DEFLATE (method 8) for text files > 64 bytes, STORE otherwise.
 * Filename encoding: UTF-8 with General Purpose Bit Flag 0x0800.
 *
 * Pipeline position:
 *   exportHTML(composeResult)    → ExportPackage
 *       → exportZIP(exportPackage) → ZipResult { buffer, base64, filename }
 *
 * Typical HTTP response usage:
 *   res.setHeader('Content-Type', 'application/zip');
 *   res.setHeader('Content-Disposition', result.content_disposition);
 *   res.end(result.buffer);
 */

const zlib = require('zlib');

// ── CRC-32 lookup table (standard polynomial 0xEDB88320) ─────────────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── DOS date/time encoding ────────────────────────────────────────────────────
// ZIP stores modification time in MS-DOS format (2-byte time + 2-byte date).

function dosDateTime(date) {
  const d    = date || new Date();
  const time = ((d.getHours() & 0x1f) << 11) |
               ((d.getMinutes() & 0x3f) << 5) |
               ((d.getSeconds() >> 1) & 0x1f);
  const dt   = (((d.getFullYear() - 1980) & 0x7f) << 9) |
               (((d.getMonth() + 1) & 0x0f) << 5) |
               (d.getDate() & 0x1f);
  return { time, date: dt };
}

// ── Compress or store a file buffer ──────────────────────────────────────────
// DEFLATE for text content > 64 bytes — yields significant savings.
// STORE for empty/tiny files (compression overhead not worth it).

const MIN_COMPRESS_SIZE = 64;

function compressEntry(rawBuffer) {
  if (rawBuffer.length <= MIN_COMPRESS_SIZE) {
    return { data: rawBuffer, method: 0 }; // STORE
  }
  try {
    const compressed = zlib.deflateRawSync(rawBuffer, { level: 6 });
    // Only use compression if it actually reduces size
    if (compressed.length < rawBuffer.length) {
      return { data: compressed, method: 8 }; // DEFLATE
    }
    return { data: rawBuffer, method: 0 }; // STORE — compression didn't help
  } catch (_) {
    return { data: rawBuffer, method: 0 }; // STORE — compression failed
  }
}

// ── Write helpers (little-endian, same API as Buffer's built-ins) ─────────────

function writeU16(buf, offset, v) { buf.writeUInt16LE(v >>> 0, offset); }
function writeU32(buf, offset, v) { buf.writeUInt32LE(v >>> 0, offset); }

// ── Build one ZIP entry (local header + compressed data) ─────────────────────

function buildLocalEntry(filePath, rawBuffer, modDate) {
  const nameBuf         = Buffer.from(filePath, 'utf8');
  const { data, method} = compressEntry(rawBuffer);
  const checksum        = crc32(rawBuffer);
  const { time, date }  = dosDateTime(modDate);
  const UTF8_FLAG       = 0x0800;   // General Purpose Bit Flag: UTF-8 filename

  // Local File Header: 30 bytes + filename
  const header = Buffer.alloc(30 + nameBuf.length);
  writeU32(header,  0, 0x04034b50);       // Local file header signature
  writeU16(header,  4, 20);               // Version needed: 2.0
  writeU16(header,  6, UTF8_FLAG);        // General purpose bit flag
  writeU16(header,  8, method);           // Compression method
  writeU16(header, 10, time);             // Last mod time
  writeU16(header, 12, date);             // Last mod date
  writeU32(header, 14, checksum);         // CRC-32
  writeU32(header, 18, data.length);      // Compressed size
  writeU32(header, 22, rawBuffer.length); // Uncompressed size
  writeU16(header, 26, nameBuf.length);   // File name length
  writeU16(header, 28, 0);               // Extra field length
  nameBuf.copy(header, 30);              // File name

  return { header, data, nameBuf, checksum, method, time, date,
           compressedSize: data.length, uncompressedSize: rawBuffer.length };
}

// ── Build Central Directory entry for one file ────────────────────────────────

function buildCentralEntry(entry, localHeaderOffset) {
  const { nameBuf, checksum, method, time, date,
          compressedSize, uncompressedSize } = entry;
  const UTF8_FLAG = 0x0800;

  // Central Directory File Header: 46 bytes + filename
  const central = Buffer.alloc(46 + nameBuf.length);
  writeU32(central,  0, 0x02014b50);       // Central directory signature
  writeU16(central,  4, 20);               // Version made by
  writeU16(central,  6, 20);               // Version needed
  writeU16(central,  8, UTF8_FLAG);        // General purpose bit flag
  writeU16(central, 10, method);           // Compression method
  writeU16(central, 12, time);             // Last mod time
  writeU16(central, 14, date);             // Last mod date
  writeU32(central, 16, checksum);         // CRC-32
  writeU32(central, 20, compressedSize);   // Compressed size
  writeU32(central, 24, uncompressedSize); // Uncompressed size
  writeU16(central, 28, nameBuf.length);   // Filename length
  writeU16(central, 30, 0);               // Extra field length
  writeU16(central, 32, 0);               // File comment length
  writeU16(central, 34, 0);               // Disk number start
  writeU16(central, 36, 0);               // Internal attributes
  writeU32(central, 38, 0);               // External attributes
  writeU32(central, 42, localHeaderOffset); // Relative offset of local header
  nameBuf.copy(central, 46);              // Filename

  return central;
}

// ── Build End of Central Directory Record ─────────────────────────────────────

function buildEndRecord(entryCount, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  writeU32(end,  0, 0x06054b50);   // End of central directory signature
  writeU16(end,  4, 0);            // Disk number
  writeU16(end,  6, 0);            // Disk with start of central directory
  writeU16(end,  8, entryCount);   // Number of entries on this disk
  writeU16(end, 10, entryCount);   // Total number of entries
  writeU32(end, 12, centralSize);  // Size of central directory
  writeU32(end, 16, centralOffset);// Offset of central directory
  writeU16(end, 20, 0);            // Comment length
  return end;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildZipBuffer — assemble a complete ZIP from an array of file entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array<{ path: string, rawBuffer: Buffer, modDate?: Date }>} entries
 * @returns {Buffer} — complete ZIP file
 */
function buildZipBuffer(entries) {
  const localParts    = [];   // [ localHeader + data Buffer ] per entry
  const centralParts  = [];   // [ central directory header ] per entry
  const localEntries  = [];   // metadata for central directory
  let   localOffset   = 0;

  for (const entry of entries) {
    const local = buildLocalEntry(entry.path, entry.rawBuffer, entry.modDate);

    // Local header + file data
    const localBlock = Buffer.concat([local.header, local.data]);
    localParts.push(localBlock);
    localEntries.push({ ...local, headerOffset: localOffset });
    localOffset += localBlock.length;
  }

  // Central directory
  const centralOffset = localOffset;
  for (const le of localEntries) {
    centralParts.push(buildCentralEntry(le, le.headerOffset));
  }

  const centralDir   = Buffer.concat(centralParts);
  const endRecord    = buildEndRecord(entries.length, centralDir.length, centralOffset);

  return Buffer.concat([...localParts, centralDir, endRecord]);
}

// ─────────────────────────────────────────────────────────────────────────────
// exportZIP — main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {ExportPackage} exportPackage — from exportHTML() or exportMultiple()
 * @param {object}        options
 *   compress {boolean}  — enable DEFLATE compression (default: true)
 *   mod_date {Date}     — override modification date for all files
 * @returns {ZipResult}
 *   buffer               {Buffer} — complete ZIP as Node.js Buffer
 *   base64               {string} — base64-encoded ZIP (for JSON API responses)
 *   filename             {string} — suggested filename with .zip extension
 *   size_bytes           {number}
 *   mime_type            {string}
 *   content_disposition  {string} — ready for Content-Disposition header
 */
function exportZIP(exportPackage, options = {}) {
  if (!exportPackage || !Array.isArray(exportPackage.files)) {
    throw new Error('exportZIP: exportPackage.files must be an array');
  }

  const modDate  = options.mod_date || new Date();
  const basename = (exportPackage.filename || 'export').replace(/\.zip$/i, '');
  const zipName  = `${basename}.zip`;

  // Build raw Buffer entries from file list
  const entries = exportPackage.files.map((file) => {
    const raw = file.content == null
      ? Buffer.alloc(0)
      : Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from(file.content, file.encoding || 'utf8');

    return {
      path:      file.path,
      rawBuffer: raw,
      modDate,
    };
  });

  const zipBuffer = buildZipBuffer(entries);
  const base64    = zipBuffer.toString('base64');

  return {
    buffer:              zipBuffer,
    base64,
    filename:            zipName,
    size_bytes:          zipBuffer.length,
    mime_type:           'application/zip',
    content_disposition: `attachment; filename="${zipName}"`,
    // Entry summary for logging
    entry_count:         entries.length,
    files:               entries.map((e) => e.path),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// exportZIPResponse — convenience: return a Netlify-ready response object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a Netlify Functions-compatible response object with the ZIP as body.
 *
 * Usage inside a Netlify Function handler:
 *   const { exportZIPResponse } = require('./_shared/exporters/zip-exporter');
 *   return exportZIPResponse(exportPackage);
 *
 * @param {ExportPackage} exportPackage
 * @param {object}        options — passed to exportZIP()
 * @returns {{ statusCode, headers, body, isBase64Encoded }}
 */
function exportZIPResponse(exportPackage, options = {}) {
  const result = exportZIP(exportPackage, options);
  return {
    statusCode:      200,
    isBase64Encoded: true,
    headers: {
      'Content-Type':        result.mime_type,
      'Content-Disposition': result.content_disposition,
      'Content-Length':      String(result.size_bytes),
      'Cache-Control':       'no-store',
    },
    body: result.base64,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { exportZIP, exportZIPResponse, buildZipBuffer };
