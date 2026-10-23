/* ══════════ WEBSTUDIO · ZIP (store-метод, CRC32) ══════════
   ZipWriter.add(path, stringOrUint8); ZipWriter.finish() -> Uint8Array (.zip)
   Без внешних зависимостей. Store (без сжатия) — совместимо со всеми архиваторами.
*/
(function () {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(v) { return [v & 255, (v >> 8) & 255]; }
  function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }

  class ZipWriter {
    constructor() { this.entries = []; this.offset = 0; this.chunks = []; }

    add(path, data) {
      path = String(path).replace(/\\/g, '/');
      const bytes = (data instanceof Uint8Array) ? data : new TextEncoder().encode(String(data));
      const nameBytes = new TextEncoder().encode(path);
      const now = new Date();
      const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
      const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
      const crc = crc32(bytes);

      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), // version, flags(UTF-8), method=store
        u16(dosTime), u16(dosDate), u32(crc), u32(bytes.length), u32(bytes.length),
        u16(nameBytes.length), u16(0)
      );
      const localHeader = new Uint8Array(local);
      const rec = new Uint8Array(localHeader.length + nameBytes.length + bytes.length);
      rec.set(localHeader, 0); rec.set(nameBytes, localHeader.length); rec.set(bytes, localHeader.length + nameBytes.length);

      this.entries.push({ path: nameBytes, crc, size: bytes.length, offset: this.offset, dosTime, dosDate });
      this.offset += rec.length;
      this.chunks = this.chunks || [];
      this.chunks.push(rec);
    }

    finish() {
      let cdSize = 0;
      const cdChunks = [];
      for (const e of this.entries) {
        const head = new Uint8Array([].concat(
          u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
          u16(e.dosTime), u16(e.dosDate), u32(e.crc), u32(e.size), u32(e.size),
          u16(e.path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset)
        ));
        const rec = new Uint8Array(head.length + e.path.length);
        rec.set(head, 0); rec.set(e.path, head.length);
        cdChunks.push(rec); cdSize += rec.length;
      }
      const eocd = new Uint8Array([].concat(
        u32(0x06054b50), u16(0), u16(0),
        u16(this.entries.length), u16(this.entries.length),
        u32(cdSize), u32(this.offset), u16(0)
      ));
      const total = this.offset + cdSize + eocd.length;
      const out = new Uint8Array(total);
      let p = 0;
      for (const c of (this.chunks || [])) { out.set(c, p); p += c.length; }
      for (const c of cdChunks) { out.set(c, p); p += c.length; }
      out.set(eocd, p);
      return out;
    }
  }

  window.ZipWriter = ZipWriter;
})();
