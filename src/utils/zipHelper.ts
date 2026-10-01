// Lightweight, dependency-free ZIP file generator (PKZIP Store mode)
// Creates standard ZIP archives in pure browser JavaScript without requiring external libraries.

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0 ^ (-1);
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array | string;
}

export function createZipBlob(files: ZipFileInput[]): Blob {
  const textEncoder = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];

  let currentOffset = 0;

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.name);
    let dataBytes: Uint8Array;
    if (typeof file.data === 'string') {
      dataBytes = textEncoder.encode(file.data);
    } else {
      dataBytes = file.data;
    }

    const crc = calculateCrc32(dataBytes);
    const size = dataBytes.length;
    const localOffset = currentOffset;

    // Local file header (30 bytes + name length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true);         // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true);     // Flags (bit 11 = UTF-8 filename)
    lv.setUint16(8, 0, true);          // Store (no compression)
    lv.setUint16(10, 0x4800, true);    // Mod time (09:00:00)
    lv.setUint16(12, 0x5821, true);    // Mod date (2024-01-01)
    lv.setUint32(14, crc, true);       // CRC-32
    lv.setUint32(18, size, true);      // Compressed size
    lv.setUint32(22, size, true);      // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // Name length
    lv.setUint16(28, 0, true);         // Extra field length
    localHeader.set(nameBytes, 30);

    fileParts.push(localHeader);
    fileParts.push(dataBytes);
    currentOffset += localHeader.length + dataBytes.length;

    // Central Directory header (46 bytes + name length)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central header signature
    cv.setUint16(4, 20, true);         // Version made by
    cv.setUint16(6, 20, true);         // Version needed
    cv.setUint16(8, 0x0800, true);     // Flags (UTF-8)
    cv.setUint16(10, 0, true);         // Store
    cv.setUint16(12, 0x4800, true);    // Mod time
    cv.setUint16(14, 0x5821, true);    // Mod date
    cv.setUint32(16, crc, true);       // CRC-32
    cv.setUint32(20, size, true);      // Compressed size
    cv.setUint32(24, size, true);      // Uncompressed size
    cv.setUint16(28, nameBytes.length, true); // Name length
    cv.setUint16(30, 0, true);         // Extra field length
    cv.setUint16(32, 0, true);         // File comment length
    cv.setUint16(34, 0, true);         // Disk number start
    cv.setUint16(36, 0, true);         // Internal file attributes
    cv.setUint32(38, 0, true);         // External file attributes
    cv.setUint32(42, localOffset, true); // Relative offset of local header
    cdHeader.set(nameBytes, 46);

    cdParts.push(cdHeader);
  }

  const cdOffset = currentOffset;
  let cdSize = 0;
  for (const part of cdParts) {
    cdSize += part.length;
  }

  // End of Central Directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);   // EOCD signature
  ev.setUint16(4, 0, true);            // Number of this disk
  ev.setUint16(6, 0, true);            // Disk where CD starts
  ev.setUint16(8, files.length, true); // Number of central directory records on this disk
  ev.setUint16(10, files.length, true);// Total number of central directory records
  ev.setUint32(12, cdSize, true);      // Size of central directory
  ev.setUint32(16, cdOffset, true);    // Offset of start of central directory
  ev.setUint16(20, 0, true);           // Comment length

  return new Blob([...fileParts, ...cdParts, eocd], { type: 'application/zip' });
}
